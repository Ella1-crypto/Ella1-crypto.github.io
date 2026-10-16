/* 화면 상태 — 저장(localStorage)·공유 링크(#s=…) 인코딩. 공유 링크는 외부 입력이므로 항상 정리(sanitize)한다. */
(function (ns) {
  'use strict';
  const STORE_KEY = 'htm.public.v1';
  const MAX_PARCELS = 20;
  const MAX_ROWS = 10;
  const CLASSES = ['sep', 'jong', 'b007', 'b02', 'b4'];
  const RATES = () => Object.keys(window.BuildingTax.RATES); // 건물 엔진 세율표와 항상 같게(과밀억제권역 중과 포함)

  const num = (v, max = 1e13) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : 0;
  };
  const str = (v, n = 120) => (typeof v === 'string' ? v.slice(0, n) : '');
  const pick = (v, list, dflt) => (list.includes(v) ? v : dflt);
  const uid = () => Math.random().toString(36).slice(2, 9);
  const own = (obj, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(obj, k); // 'constructor' 등 차단
  const MAX_GEOM_POINTS = 4000;

  /** 필지 경계: [[[lat,lng],…]] 다각형 목록. 형식이 어긋나거나 너무 크면 버린다(지도만 안 그려지고 계산은 계속) */
  function cleanGeom(g) {
    if (!Array.isArray(g) || g.length > 20) return null;
    let points = 0;
    const okPt = pt => Array.isArray(pt) && pt.length === 2 && pt[0] > 32 && pt[0] < 39.5 && pt[1] > 123 && pt[1] < 132.5;
    for (const poly of g) {
      if (!Array.isArray(poly) || poly.length > 50) return null;
      for (const ring of poly) {
        if (!Array.isArray(ring) || !ring.every(okPt)) return null;
        points += ring.length;
        if (points > MAX_GEOM_POINTS) return null;
      }
    }
    return g;
  }

  function newBuilding() {
    return { mode: 'estimate', structure: 'rc', builtYear: 2010, floors: 5, rate: 'general', fire: 'auto', direct: 0, rows: [{ use: 'office', area: 0, adjust: 1 }] };
  }

  function cleanBuilding(b) {
    if (!b || typeof b !== 'object') return null;
    const BV = window.BuildingValue;
    const rows = (Array.isArray(b.rows) ? b.rows : []).slice(0, MAX_ROWS).map(r => ({
      use: own(BV.USE, r && r.use) ? r.use : 'office',
      area: num(r && r.area, 1e7),
      adjust: num(r && r.adjust, 3) || 1,
    }));
    return {
      mode: b.mode === 'direct' ? 'direct' : 'estimate',
      structure: own(BV.STRUCTURE, b.structure) ? b.structure : 'rc',
      builtYear: Math.round(num(b.builtYear, BV.BASE_YEAR)) || 2010,
      floors: Math.round(num(b.floors, 200)),
      rate: pick(b.rate, RATES(), 'general'),
      overcrowdFrom: Math.round(num(b.overcrowdFrom, 2100)) || 0, // 과밀억제권역 중과 최초 과세연도
      fire: [1, 2, 3].includes(Number(b.fire)) ? Number(b.fire) : 'auto',
      direct: num(b.direct),
      footprint: num(b.footprint, 1e7),
      prevMain: num(b.prevMain),
      prevFire: num(b.prevFire),
      rows: rows.length ? rows : newBuilding().rows,
    };
  }

  function cleanRelief(r) {
    const RL = window.HTMRelief;
    const v = r && typeof r === 'object' ? r : {};
    return {
      key: Object.prototype.hasOwnProperty.call(RL.COMMERCIAL, v.key) ? v.key : 'none',
      region: Object.prototype.hasOwnProperty.call(RL.REGIONS, v.region) ? v.region : 'metro',
      custom: Math.min(100, num(v.custom, 100)),
      years: Math.round(num(v.years, 30)),
    };
  }

  function cleanParcel(p) {
    const o = p && typeof p === 'object' ? p : {};
    return {
      id: str(o.id, 16) || uid(),
      pnu: /^\d{19}$/.test(o.pnu) ? o.pnu : '',
      addr: str(o.addr, 120),
      jibun: str(o.jibun, 20),
      jimok: str(o.jimok, 10),
      zone: str(o.zone, 30),
      area: num(o.area, 1e8),
      areaSource: ['polygon', 'register'].includes(o.areaSource) ? o.areaSource : 'manual',
      zoneName: str(o.zoneName, 30),
      price: num(o.price, 1e9),
      share: Math.max(0.01, Math.min(100, num(o.share, 100) || 100)),
      priceYear: Math.round(num(o.priceYear, 2100)) || null,
      cls: pick(o.cls, CLASSES, 'sep'),
      clsAuto: o.clsAuto !== false,
      urban: o.urban !== false,
      hasHouse: o.hasHouse === true,
      relief: cleanRelief(o.relief),
      sgg: str(o.sgg, 10),
      sggName: str(o.sggName, 40),
      geom: cleanGeom(o.geom),
      bld: cleanBuilding(o.bld),
    };
  }

  function clean(raw) {
    const s = raw && typeof raw === 'object' ? raw : {};
    return {
      ownerType: s.ownerType === '개인' ? '개인' : '법인',
      growth: Math.min(30, num(s.growth, 30)),
      mode: s.mode === '2027reform' ? '2027reform' : '2026',
      cfYears: [1, 3, 5, 10].includes(Number(s.cfYears)) ? Number(s.cfYears) : 5,
      cfInstall: s.cfInstall === true,
      prev: { propSep: num(s.prev && s.prev.propSep), propJong: num(s.prev && s.prev.propJong), cmtSep: num(s.prev && s.prev.cmtSep), cmtJong: num(s.prev && s.prev.cmtJong) },
      parcels: (Array.isArray(s.parcels) ? s.parcels : []).slice(0, MAX_PARCELS).map(cleanParcel),
    };
  }

  const initial = () => clean({ ownerType: '법인', growth: 3, parcels: [] });

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      return raw ? clean(JSON.parse(raw)) : null;
    } catch (_) {
      return null; // 사생활 보호 모드 등 저장소 차단 — 저장 없이 동작
    }
  }

  function save(state) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (_) { /* 저장 불가 환경은 무시 */ }
  }

  /* 공유 링크: 필지 경계(geom)는 빼고 UTF-8 JSON → base64url */
  function encode(state) {
    const slim = { ...state, parcels: state.parcels.map(p => ({ ...p, geom: undefined })) };
    const bytes = new TextEncoder().encode(JSON.stringify(slim));
    let bin = '';
    bytes.forEach(b => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function decode(token) {
    try {
      const b64 = String(token).replace(/-/g, '+').replace(/_/g, '/');
      const bin = atob(b64);
      const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
      const s = clean(JSON.parse(new TextDecoder().decode(bytes)));
      return { ...s, parcels: s.parcels.map(p => ({ ...p, geom: null })) }; // 공유 링크에는 경계가 없다
    } catch (_) {
      return null;
    }
  }

  ns.state = Object.freeze({ initial, clean, cleanParcel, newBuilding, load, save, encode, decode, uid, MAX_PARCELS, MAX_ROWS });
})(window.HTM = window.HTM || {});
