/* 2026년 건축물(오피스텔 외) 시가표준액 추정
 *
 * 근거 (2026-10-15 확인)
 *  · 지방세법 §4②, 시행령 §4①1의2 — 신축가격기준액 × 구조·용도·위치지수 × 경과연수별 잔가율 × 면적 × 가감산율
 *  · 「2026년 건물신축가격기준액 고시」 행정안전부고시 제2025-82호(2025.12.29., 시행 2026.6.1.)
 *  · 행정안전부 「2026년 지방세 시가표준액 조사·산정 업무요령」 제3장 — 구조지수·용도지수·위치지수·잔가율표
 *  · ㎡당 금액은 1,000원 미만 버림(1,000원 미만이면 1,000원) — 조사·산정 기준 §19
 * 오피스텔은 표준가격기준액 방식이라 이 산식을 쓰지 않는다(시행령 §4①1).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BuildingValue = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const BASE_YEAR = 2026;
  const VERSION = '2026 업무요령 · 2026-10-15 확인';

  // 건물신축가격기준액(원/㎡) — 2025년 값은 비교 표시용
  const NEW_PRICE = Object.freeze({
    residential: { label: '주거용', y2026: 860000, y2025: 840000 },
    commercial: { label: '상업용', y2026: 860000, y2025: 830000 },
    industrial: { label: '공업용', y2026: 840000, y2025: 820000 },
    agricultural: { label: '농수산용', y2026: 640000, y2025: 630000 },
    culture: { label: '문화·복지·교육용', y2026: 860000, y2025: 840000 },
    public: { label: '공공용', y2026: 850000, y2025: 830000 },
  });

  // 구조지수 — 업무요령 제3장 제3절 1. / life: 잔가율표 내용연수 그룹(제4절)
  //  50년: 철골(철골철근)콘크리트조·통나무조 | 40년: 철근콘크리트조·라멘조·석조·PC조·목구조
  //  30년: 철골조·스틸하우스조·연와조·보강콘크리트·보강블록·황토·시멘트벽돌·목조·ALC·와이어패널
  //  20년: 시멘트블록조·경량철골조·조립식패널조·FRP패널조 | 10년: 흙벽돌·토담·철파이프·컨테이너
  const STRUCTURE = Object.freeze({
    src: { label: '철골(철골철근)콘크리트조', index: 1.20, life: 50 },
    log: { label: '통나무조', index: 1.35, life: 50 },
    rc: { label: '철근콘크리트조·라멘조·석조·PC조', index: 1.00, life: 40 },
    wood2: { label: '목구조', index: 1.25, life: 40 },
    steel: { label: '철골조·스틸하우스조', index: 1.00, life: 30 },
    brick: { label: '연와조', index: 1.00, life: 30 },
    reinforced: { label: '보강콘크리트조·보강블록조', index: 0.95, life: 30 },
    alc: { label: '황토조·ALC조·시멘트벽돌조', index: 0.90, life: 30 },
    wood: { label: '목조', index: 0.83, life: 30 },
    wirePanel: { label: '와이어패널조', index: 0.60, life: 30 },
    lightSteel: { label: '경량철골조', index: 0.65, life: 20 },
    block: { label: '시멘트블록조', index: 0.60, life: 20 },
    panel: { label: '조립식패널조·FRP패널조', index: 0.55, life: 20 },
    mud: { label: '석회·흙벽돌조, 돌담·토담조', index: 0.35, life: 10 },
    container: { label: '컨테이너건물', index: 0.30, life: 10 },
    pipe: { label: '철파이프조', index: 0.30, life: 10 },
  });

  // 용도지수 — 상업용 부동산에서 자주 쓰는 세부용도만(업무요령 용도지수표)
  const USE = Object.freeze({
    office: { label: '사무실용 건물(업무시설)', group: 'commercial', index: 1.12 },
    retail: { label: '상점·일반음식점·근린 판매시설', group: 'commercial', index: 1.12 },
    mall: { label: '대형마트·백화점·쇼핑센터', group: 'commercial', index: 1.29 },
    market: { label: '소매·도매·전통시장', group: 'commercial', index: 1.05 },
    hotel5: { label: '관광호텔(5·4성급)', group: 'commercial', index: 1.39 },
    hotel3: { label: '관광호텔(3성급 이하)·콘도', group: 'commercial', index: 1.29 },
    hotel: { label: '호텔(숙박업)·생활숙박시설', group: 'commercial', index: 1.24 },
    motel: { label: '여관·모텔', group: 'commercial', index: 1.20 },
    hospital: { label: '일반병원·요양병원', group: 'commercial', index: 1.20 },
    clinic: { label: '의원·치과의원·한의원', group: 'commercial', index: 1.12 },
    parking: { label: '주차장', group: 'commercial', index: 0.71 },
    parkingBldg: { label: '주차전용빌딩', group: 'commercial', index: 0.62 },
    factory: { label: '공장·공장사무실', group: 'industrial', index: 0.80 },
    kic: { label: '지식산업센터 내 공장', group: 'industrial', index: 1.00 },
    smallFactory: { label: '제조업소(바닥면적 500㎡ 미만)', group: 'industrial', index: 0.95 },
    coldStorage: { label: '공업용 냉동·냉장창고', group: 'industrial', index: 0.95 },
    logistics: { label: '물류터미널·집배송시설·대형창고', group: 'industrial', index: 0.85 },
    warehouse: { label: '창고(일반)', group: 'industrial', index: 0.80 },
    gasStation: { label: '주유소·위험물 저장시설', group: 'industrial', index: 1.26 },
    school: { label: '학교·연구소·교육원', group: 'culture', index: 1.03 },
    academy: { label: '학원·교습소', group: 'culture', index: 1.13 },
    religion: { label: '교회·성당·사찰 등 종교집회장', group: 'culture', index: 1.04 },
    sports: { label: '골프장·옥내수영장 등 운동시설', group: 'culture', index: 1.13 },
  });

  // 위치지수 — 건물 부속토지 개별공시지가(천원/㎡) 구간 상한과 지수
  const LOCATION = Object.freeze([
    [10, 0.80], [30, 0.82], [50, 0.84], [100, 0.86], [150, 0.88], [200, 0.90], [350, 0.92], [500, 0.94],
    [650, 0.96], [800, 0.98], [1000, 1.00], [1200, 1.03], [1600, 1.06], [2000, 1.09], [2500, 1.12],
    [3000, 1.15], [4000, 1.18], [5000, 1.21], [6000, 1.24], [7000, 1.27], [8000, 1.30], [9000, 1.33],
    [10000, 1.36], [20000, 1.40], [30000, 1.45], [40000, 1.50], [50000, 1.55], [60000, 1.60],
    [70000, 1.63], [80000, 1.66], [Infinity, 1.69],
  ]);

  // 잔가율표: 내용연수 → 매년 상각률 (최종연도 잔가율은 모두 10%)
  const DEPRECIATION = Object.freeze({ 50: 0.018, 40: 0.0225, 30: 0.030, 20: 0.045, 10: 0.090 });
  const FINAL_RESIDUAL = 0.10;

  /** 위치지수: 개별공시지가(원/㎡) → 지수 */
  function locationIndex(landPricePerM2) {
    const k = (Number(landPricePerM2) || 0) / 1000;
    const row = LOCATION.find(([upper]) => k <= upper);
    return row[1];
  }

  /** 경과연수별 잔가율 = max(10%, 1 − 상각률 × (기준연도 − 신축연도)) — 소수 4자리 */
  function residualRate(builtYear, life, baseYear = BASE_YEAR) {
    const rate = DEPRECIATION[life];
    if (!rate) throw new Error(`지원하지 않는 내용연수: ${life}`);
    const age = Math.max(0, baseYear - Number(builtYear));
    return Math.max(FINAL_RESIDUAL, Math.round((1 - rate * age) * 10000) / 10000);
  }

  /** ㎡당 금액 단수: 1,000원 미만 버림, 1,000원 미만이면 1,000원 */
  const perM2Round = v => Math.max(1000, Math.floor(v / 1000) * 1000);

  /**
   * @param {{structure:string, use:string, builtYear:number, area:number, landPrice:number, adjust?:number}} input
   *   landPrice: 부속토지 개별공시지가(원/㎡), adjust: 가감산율(기본 1.00)
   * @param {number} [baseYear] 잔가율 기준연도(전망용). 신축가격기준액은 2026년 값을 그대로 쓴다.
   */
  function estimate(input, baseYear = BASE_YEAR) {
    const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
    const s = has(STRUCTURE, input.structure) ? STRUCTURE[input.structure] : null;
    const u = has(USE, input.use) ? USE[input.use] : null;
    if (!s) return { error: '구조를 선택하세요.' };
    if (!u) return { error: '용도를 선택하세요.' };
    const builtYear = Number(input.builtYear);
    const area = Number(input.area);
    if (!(builtYear >= 1900 && builtYear <= BASE_YEAR)) return { error: `사용승인연도를 1900~${BASE_YEAR} 사이로 입력하세요.` };
    if (!(area > 0)) return { error: '연면적(㎡)을 입력하세요.' };
    const adjust = Number(input.adjust) > 0 ? Number(input.adjust) : 1;
    const newPrice = NEW_PRICE[u.group].y2026;
    const loc = locationIndex(input.landPrice);
    const residual = residualRate(builtYear, s.life, baseYear);
    const rawPerM2 = newPrice * s.index * u.index * loc * residual;
    const perM2 = perM2Round(rawPerM2);
    const value = Math.floor(perM2 * area * adjust + 1e-6); // 859,000×406×1.51 같은 이진 오차 보정
    return {
      value, perM2, rawPerM2, newPrice, newPriceGroup: NEW_PRICE[u.group].label,
      structureIndex: s.index, useIndex: u.index, locationIndex: loc,
      life: s.life, residual, age: Math.max(0, baseYear - builtYear), area, adjust,
      formula: `${newPrice.toLocaleString('ko-KR')} × ${s.index.toFixed(2)} × ${u.index.toFixed(2)} × ${loc.toFixed(2)} × ${residual.toFixed(4)} = ㎡당 ${perM2.toLocaleString('ko-KR')}원 × ${area.toLocaleString('ko-KR')}㎡${adjust !== 1 ? ` × ${adjust}` : ''}`,
    };
  }

  return Object.freeze({
    BASE_YEAR, VERSION, NEW_PRICE, STRUCTURE, USE, LOCATION, DEPRECIATION, FINAL_RESIDUAL,
    locationIndex, residualRate, perM2Round, estimate,
  });
}));
