/* 주택 화면용 필지 → 입력값 변환 — VWorld 필지(vworld.parcelAt 결과)에서 주택 계산기가 쓸 수 있는 값만 뽑는다
 * 브라우저: window.HouseParcel / Node: module.exports
 *
 * 필지에서 받는 것: 주소, 시·군·구(조정대상지역·수도권 판정), 대지 면적, 개별공시지가, 용도지역(도시지역분 추정).
 * 주택 공시가격은 화면의 "공시가격 불러오기"(중계 서버 /house-price, VWorld 공동·개별주택가격)로 따로 조회한다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HouseParcel = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const METRO_RE = /^(서울|인천|경기)/;
  const PNU_RE = /^\d{19}$/;
  const MAX_AREA = 1e8;   // ㎡
  const MAX_PRICE = 1e10; // 원/㎡
  // 대한민국 범위(대략) — 공유 링크에 엉뚱한 좌표가 들어와도 지도를 그쪽으로 보내지 않는다
  const LAT = [32, 39.5];
  const LNG = [124, 132.5];

  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const amount = (v, max) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.min(n, max) : 0;
  };
  const inRange = (v, [lo, hi]) => Number.isFinite(v) && v >= lo && v <= hi;

  /** 수도권(서울·인천·경기) 여부 — 주소를 모르면 null */
  function isMetro(addr) {
    const a = String(addr || '').replace(/\s+/g, '');
    if (!a) return null;
    return METRO_RE.test(a);
  }

  /** 용도지역 → 도시지역분 부과 대상 추정. 모르면 null (사용자 선택 유지) */
  function isUrbanZone(zone) {
    const z = String(zone || '');
    if (/관리지역|농림|자연환경보전/.test(z)) return false;
    if (/주거|상업|공업|녹지/.test(z)) return true;
    return null;
  }

  /** "서울특별시 강남구 역삼동 825-2" + "서울특별시 강남구" → "역삼동 825-2" */
  function shortLabel(addr, sggName) {
    const a = String(addr || '').trim();
    const s = String(sggName || '').trim();
    const rest = s && a.startsWith(s) ? a.slice(s.length).trim() : a;
    return (rest || a).slice(0, 60);
  }

  /** 저장·공유 링크에서 읽은 위치 필드 정리 */
  function cleanLoc(h) {
    const o = h && typeof h === 'object' ? h : {};
    const lat = Number(o.lat);
    const lng = Number(o.lng);
    const year = Math.round(Number(o.landYear));
    const located = inRange(lat, LAT) && inRange(lng, LNG);
    return {
      addr: str(o.addr, 80),
      pnu: PNU_RE.test(String(o.pnu || '')) ? String(o.pnu) : '',
      sggName: str(o.sggName, 40),
      zone: str(o.zone, 30),
      landArea: Math.round(amount(o.landArea, MAX_AREA) * 10) / 10,
      landAreaApprox: o.landAreaApprox === true,
      landPrice: Math.round(amount(o.landPrice, MAX_PRICE)),
      landYear: year >= 1990 && year <= 2100 ? year : 0,
      lat: located ? lat : null,
      lng: located ? lng : null,
    };
  }

  /** 위치를 지운 주택 */
  const EMPTY_LOC = Object.freeze(cleanLoc({}));

  /**
   * 필지 → 주택에 넣을 값
   * @param {object} parcel vworld.parcelAt 결과 { addr, pnu, sggName, area, areaSource, price, priceYear, zone }
   * @param {{lat:number, lng:number}} at 누른 좌표
   */
  function fromParcel(parcel, at) {
    const p = parcel && typeof parcel === 'object' ? parcel : {};
    const pos = at && typeof at === 'object' ? at : {};
    const loc = cleanLoc({
      addr: p.addr, pnu: p.pnu, sggName: p.sggName || '', zone: p.zone || '',
      landArea: p.area, landAreaApprox: p.areaSource !== 'register', landPrice: p.price, landYear: p.priceYear,
      lat: pos.lat, lng: pos.lng,
    });
    const metro = isMetro(loc.sggName || loc.addr);
    return { ...loc, region: metro === null ? null : metro ? 'metro' : 'local', urban: isUrbanZone(loc.zone) };
  }

  /**
   * 주택에 필지 값을 채운 새 주택(원본은 그대로). 이름이 비었거나 예시 그대로면 주소로 바꾸고,
   * 예시 공시가격은 이 집의 값이 아니므로 비운다. 소재지·도시지역분은 판정된 경우에만 바꾼다.
   * @param {object} house 주택 입력
   * @param {object} found fromParcel 결과
   * @param {{name:string, price:number}} example 처음 화면의 예시 주택
   */
  function applyParcel(house, found, example) {
    const ex = example || { name: '', price: 0 };
    const isExample = Boolean(ex.name) && house.name === ex.name;
    const { region, urban, ...loc } = found;
    return {
      ...house,
      ...loc,
      name: !house.name || isExample ? shortLabel(loc.addr, loc.sggName) : house.name,
      price: isExample && house.price === ex.price ? 0 : house.price,
      region: region || house.region,
      urban: urban === null ? house.urban : urban,
    };
  }

  /** 대지 면적 × 개별공시지가 — 참고용 토지 가액(원) */
  const landValue = h => Math.round((Number(h.landArea) || 0) * (Number(h.landPrice) || 0));

  return Object.freeze({ isMetro, isUrbanZone, shortLabel, cleanLoc, EMPTY_LOC, fromParcel, applyParcel, landValue });
}));
