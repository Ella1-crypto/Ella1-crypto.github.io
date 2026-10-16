/* VWorld 데이터 API — 정적 사이트용 JSONP 클라이언트(req/* 만 JSONP 지원, 2026-09 실측).
 * 토지특성(ned/data)은 JSONP·CORS 미지원이라 쓰지 않는다:
 *  지목 = 연속지적도 지번 끝 글자, 면적 = 경계 도형 면적(근사), 용도지역 = 사용자 선택.
 */
(function (ns) {
  'use strict';
  const BASE = 'https://api.vworld.kr/';
  const TIMEOUT_MS = 9000;
  const JIMOK_CODE = Object.freeze({
    전: '전', 답: '답', 과: '과수원', 목: '목장용지', 임: '임야', 광: '광천지', 염: '염전', 대: '대', 장: '공장용지',
    학: '학교용지', 차: '주차장', 주: '주유소용지', 창: '창고용지', 도: '도로', 철: '철도용지', 제: '제방', 천: '하천',
    구: '구거', 유: '유지', 양: '양어장', 수: '수도용지', 공: '공원', 체: '체육용지', 원: '유원지', 종: '종교용지',
    사: '사적지', 묘: '묘지', 잡: '잡종지',
  });
  let seq = 0;

  function cfg() {
    const c = window.HTM_CONFIG || {};
    // domain은 스킴 없는 호스트여야 한다 — "http://localhost:5178"이면 인증키 오류(2026-10-15 실측)
    const domain = String(c.VWORLD_DOMAIN || location.host).replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    return { key: String(c.VWORLD_KEY || '').trim(), domain };
  }
  const apiBase = () => String((window.HTM_CONFIG || {}).API_BASE || '').replace(/\/+$/, '');
  const enabled = () => Boolean(apiBase() || cfg().key);

  /** 중계 서버(Worker) 호출 */
  async function viaApi(path, params) {
    const res = await fetch(`${apiBase()}${path}?${new URLSearchParams(params)}`, { signal: AbortSignal.timeout(15000) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `조회 실패(${res.status})`);
    return data;
  }

  /** 토지특성의 용도지역명 → 화면 선택지 */
  function zoneGroup(name) {
    const z = String(name || '');
    const groups = ['주거', '상업', '공업', '녹지', '관리', '농림'];
    const g = groups.find(k => z.includes(k));
    if (g) return `${g}지역`;
    return z.includes('자연환경보전') ? '자연환경보전지역' : '';
  }

  function jsonp(url, params) {
    return new Promise((resolve, reject) => {
      seq += 1;
      const cb = `__htmVw${Date.now().toString(36)}${seq}`;
      const script = document.createElement('script');
      const timer = setTimeout(() => { cleanup(); reject(new Error('VWorld 응답 시간 초과')); }, TIMEOUT_MS);
      function cleanup() {
        clearTimeout(timer);
        delete window[cb];
        script.remove();
      }
      window[cb] = data => { cleanup(); resolve(data); };
      script.onerror = () => { cleanup(); reject(new Error('VWorld 요청 실패 — 인증키의 등록 도메인을 확인하세요')); };
      script.src = `${url}?${new URLSearchParams({ ...params, callback: cb })}`;
      document.head.appendChild(script);
    });
  }

  const RETRY_DELAY_MS = 700;
  const wait = ms => new Promise(r => setTimeout(r, ms));

  /** VWorld가 정상 키에도 간헐적으로 ERROR(인증키 오류 등)를 돌려줘 한 번 더 시도한다(2026-10-15 실측) */
  async function call(path, params) {
    const { key, domain } = cfg();
    if (!key) throw new Error('VWorld 인증키가 설정되지 않았습니다');
    const q = { format: 'json', errorformat: 'json', ...params, key, domain };
    const first = await jsonp(BASE + path, q).catch(() => null);
    if (first && first.response && first.response.status !== 'ERROR') return first;
    await wait(RETRY_DELAY_MS);
    return jsonp(BASE + path, q);
  }

  function unwrap(res) {
    const r = res && res.response;
    if (!r) throw new Error('VWorld 응답 형식 오류');
    if (r.status === 'NOT_FOUND') return null;
    if (r.status !== 'OK') throw new Error((r.error && r.error.text) || `VWorld 오류(${r.status})`);
    return r.result;
  }

  async function searchCategory(query, category) {
    const result = unwrap(await call('req/search', {
      service: 'search', request: 'search', version: '2.0', crs: 'EPSG:4326', size: '8', page: '1', query, type: 'address', category,
    }));
    return ((result && result.items) || []).map(it => ({
      title: (it.address && (it.address.parcel || it.address.road)) || it.title || '',
      sub: (it.address && (category === 'parcel' ? it.address.road : it.address.parcel)) || '',
      lat: Number(it.point && it.point.y),
      lng: Number(it.point && it.point.x),
    })).filter(it => Number.isFinite(it.lat) && Number.isFinite(it.lng));
  }

  /** 주소 검색 — 지번 우선, 없으면 도로명 */
  async function search(query) {
    if (apiBase()) {
      try { return (await viaApi('/search', { q: query })).items || []; } catch (err) {
        if (!cfg().key) throw err; // 중계 서버가 안 되면 브라우저에서 직접 조회(공시지가는 전년도까지)
      }
    }
    const parcel = await searchCategory(query, 'parcel');
    return parcel.length ? parcel : searchCategory(query, 'road');
  }

  function toLatLngPolys(geometry) {
    if (!geometry || !Array.isArray(geometry.coordinates)) return null;
    const swap = ring => ring.map(([x, y]) => [y, x]);
    if (geometry.type === 'Polygon') return [geometry.coordinates.map(swap)];
    if (geometry.type === 'MultiPolygon') return geometry.coordinates.map(poly => poly.map(swap));
    return null;
  }

  /** "1023-1대" → {no:'1023-1', jimok:'대'} / "산12임" → {no:'산 12', jimok:'임야'} */
  function splitJibun(raw) {
    const s = String(raw || '').trim();
    const m = s.match(/^(산)?\s*(\d+(?:-\d+)?)\s*([가-힣])?$/);
    if (!m) return { no: s, jimok: '' };
    return { no: `${m[1] ? '산 ' : ''}${m[2]}`, jimok: (m[3] && JIMOK_CODE[m[3]]) || '' };
  }

  /** 폴리곤 면적(㎡) 근사 — 토지대장 면적과 다를 수 있어 사용자가 고칠 수 있게 둔다 */
  function polygonArea(polys) {
    if (!polys || !polys.length) return 0;
    const lat0 = polys[0][0][0][0] * Math.PI / 180;
    const ringArea = ring => {
      let a = 0;
      for (let i = 0; i < ring.length; i += 1) {
        const [la1, ln1] = ring[i];
        const [la2, ln2] = ring[(i + 1) % ring.length];
        a += (ln1 * Math.cos(lat0) * 111320) * (la2 * 110574) - (ln2 * Math.cos(lat0) * 111320) * (la1 * 110574);
      }
      return Math.abs(a) / 2;
    };
    return polys.reduce((s, poly) => s + ringArea(poly[0]) - poly.slice(1).reduce((h, r) => h + ringArea(r), 0), 0);
  }

  /** 주소 앞의 시·도/시·군·구 부분 — "충청남도 천안시 동남구 ○○면 …" → "충청남도 천안시 동남구" */
  function sggName(addr) {
    const parts = String(addr || '').split(/\s+/).filter(Boolean);
    const end = parts.findIndex(p => !/(도|시|군|구)$/.test(p));
    return parts.slice(0, end < 0 ? parts.length : end).join(' ');
  }

  function toParcel(feature) {
    const pr = feature.properties || {};
    const j = splitJibun(pr.jibun);
    const geom = toLatLngPolys(feature.geometry);
    const pnu = String(pr.pnu || '');
    return {
      pnu,
      addr: String(pr.addr || ''),
      jibun: j.no,
      jimok: j.jimok,
      price: Number(pr.jiga) || 0,
      priceYear: Number(pr.gosi_year) || null,
      area: Math.round(polygonArea(geom) * 10) / 10,
      areaSource: 'polygon',
      sgg: pnu.slice(0, 5),
      sggName: sggName(pr.addr),
      geom,
    };
  }

  /** 좌표의 연속지적도 필지(공시지가 포함) */
  async function parcelAt(lat, lng) {
    if (apiBase()) {
      let p;
      try { p = (await viaApi('/parcel', { lat: lat.toFixed(7), lng: lng.toFixed(7) })).parcel; } catch (err) {
        if (!cfg().key) throw err;
        p = undefined; // 중계 서버 장애 → 아래 직접 조회로
      }
      if (p === null) return null;
      if (p) {
        const area = p.area > 0 ? p.area : Math.round(polygonArea(p.geom) * 10) / 10;
        return { ...p, area, areaSource: p.area > 0 ? 'register' : 'polygon', zoneName: p.zone, zone: zoneGroup(p.zone) };
      }
    }
    const result = unwrap(await call('req/data', {
      service: 'data', request: 'GetFeature', data: 'LP_PA_CBND_BUBUN', crs: 'EPSG:4326',
      size: '1', page: '1', geometry: 'true', attribute: 'true', geomFilter: `POINT(${lng} ${lat})`,
    }));
    const f = result && result.featureCollection && result.featureCollection.features && result.featureCollection.features[0];
    return f ? toParcel(f) : null;
  }

  /** 지번의 건축물대장(표제부·층별개요) — 공공데이터포털 키가 서버에만 있어 중계 서버로만 부른다 */
  async function buildingsAt(pnu) {
    if (!apiBase()) throw new Error('건축물대장은 중계 서버가 설정돼야 불러올 수 있습니다.');
    return (await viaApi('/building', { pnu })).buildings || [];
  }

  ns.vworld = Object.freeze({
    enabled, search, parcelAt, buildingsAt, splitJibun, polygonArea, sggName,
    registerEnabled: () => Boolean(apiBase()), tileKey: () => cfg().key,
  });
})(window.HTM = window.HTM || {});
