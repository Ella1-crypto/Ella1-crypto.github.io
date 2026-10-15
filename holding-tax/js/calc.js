/* 화면 상태 → 세액 결과. 순수 함수(브라우저: window.HTMCalc / Node: module.exports).
 * 토지: engine.js(HoldingTax) — 납세자 1명, 시·군·구별 합산
 * 건물: valuation.js(2026 시가표준액 추정) → building-engine.js(비주거 건축물분)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./engine.js'), require('./building-engine.js'), require('./valuation.js'));
  } else {
    root.HTMCalc = factory(root.HoldingTax, root.BuildingTax, root.BuildingValue);
  }
}(typeof self !== 'undefined' ? self : this, function (HT, BT, BV) {
  'use strict';

  const PROJECTION_YEARS = 5;
  const sum = arr => arr.reduce((s, n) => s + n, 0);
  const isLandReady = p => p.price > 0 && p.area > 0;

  function landRows(parcels, factor = 1) {
    return parcels.filter(isLandReady).map(p => ({
      price: p.price * factor,
      area: p.area,
      share: 100,
      cls: p.cls,
      sgg: p.sgg || 'manual',
      sggName: p.sggName || '직접 입력',
      urban: p.urban !== false,
    }));
  }

  /** 건물 1건의 동·구 행 → 시가표준액 행 */
  function valueRows(parcel, baseYear) {
    const b = parcel.bld;
    if (b.mode === 'direct') {
      const v = Number(b.direct) || 0;
      return v > 0 ? [{ label: '시가표준액 직접 입력', value: v, est: null }] : [];
    }
    return (b.rows || []).map((r, i) => {
      const est = BV.estimate({ structure: b.structure, builtYear: b.builtYear, use: r.use, area: r.area, adjust: r.adjust, landPrice: parcel.price }, baseYear);
      const useLabel = BV.USE[r.use] ? BV.USE[r.use].label : '';
      return { label: `${i + 1}. ${useLabel}`, value: est.error ? null : est.value, est, use: r.use };
    });
  }

  function fireMultiplier(parcel, rows) {
    const b = parcel.bld;
    if ([1, 2, 3].includes(Number(b.fire))) return { fire: Number(b.fire), note: '직접 선택' };
    const first = rows.find(r => r.use) || {};
    const purpose = first.use && BV.USE[first.use] ? BV.USE[first.use].label : '';
    const totalArea = sum((b.rows || []).map(r => Number(r.area) || 0));
    return BT.suggestFire({ purpose, floorsAbove: Number(b.floors) || 0, totalArea });
  }

  /** 건물 1건의 보유세(100% 소유 기준) */
  function buildingFor(parcel, baseYear = BV.BASE_YEAR) {
    if (!parcel.bld) return null;
    const rows = valueRows(parcel, baseYear);
    const rowError = rows.find(r => r.est && r.est.error);
    if (!rows.length) return { parcelId: parcel.id, rows, error: '건물 정보를 입력하면 건물분을 계산합니다.' };
    if (rowError) return { parcelId: parcel.id, rows, error: rowError.est.error };
    const fire = fireMultiplier(parcel, rows);
    const rate = parcel.bld.rate || 'general';
    // 용도 구분은 가액 산정용일 뿐 한 동이므로, 소방분 누진·재산세 끝수는 동 전체 가액에 한 번 적용한다
    const tax = BT.calc({
      units: [{ name: '건물', use: '', amount: sum(rows.map(r => r.value)), rate, fire: fire.fire }],
      bldInput: 'value',
      bldUrban: parcel.urban === false ? 'off' : 'on',
    });
    return { parcelId: parcel.id, rows, fire, rate, tax, value: sum(rows.map(r => r.value)), error: tax.error || null };
  }

  function landFor(parcels, factor = 1) {
    const rows = landRows(parcels, factor);
    return rows.length ? HT.calcTaxpayer(rows) : null;
  }

  /** 고지서 끝수: 재산세·교육세는 10원 미만 절사, 종부세·농특세는 원 미만 버림 */
  function landTotals(land) {
    if (!land) return { prop: 0, cmt: 0, cmtMain: 0, nong: 0 };
    const cmtMain = Math.floor(land.cmt.decided);
    const nong = Math.floor(land.cmt.nong);
    return { prop: land.prop.notice.total, cmt: cmtMain + nong, cmtMain, nong };
  }

  function projection(state) {
    const growth = (Number(state.growth) || 0) / 100;
    const ready = state.parcels.filter(isLandReady);
    const tp = { id: 'me', name: '본인', type: state.ownerType };
    const landCf = ready.length
      ? HT.projectCashflow({ parcels: ready.map(p => ({ ...landRows([p])[0], tp: 'me' })), taxpayers: [tp], startYear: BV.BASE_YEAR, years: PROJECTION_YEARS, growthPct: state.growth || 0 })
      : null;
    return Array.from({ length: PROJECTION_YEARS }, (_, i) => {
      const year = BV.BASE_YEAR + i;
      const landRow = landCf ? landCf.annual[i] : { prop: 0, cmt: 0, value: 0 };
      const bld = state.parcels.map(p => buildingFor(p, year)).filter(b => b && b.tax && !b.error);
      return {
        year,
        landValue: landRow.value,
        land: Math.floor(landRow.prop),
        cmt: Math.floor(landRow.cmt),
        building: sum(bld.map(b => b.tax.total)),
        total: Math.floor(landRow.prop) + Math.floor(landRow.cmt) + sum(bld.map(b => b.tax.total)),
        growth,
      };
    });
  }

  /**
   * @param {{ownerType:'개인'|'법인', growth:number, parcels:Array}} state
   */
  function compute(state) {
    const parcels = state.parcels || [];
    const land = landFor(parcels);
    const lt = landTotals(land);
    const buildings = parcels.map(p => buildingFor(p)).filter(Boolean);
    const okBuildings = buildings.filter(b => b.tax && !b.error);
    const bld = sum(okBuildings.map(b => b.tax.total));
    const totals = { landProp: lt.prop, cmt: lt.cmt, cmtMain: lt.cmtMain, nong: lt.nong, building: bld, total: lt.prop + lt.cmt + bld };
    const schedule = [
      { month: 7, due: '7.16 ~ 7.31', item: '건축물분 재산세·지방교육세·지역자원시설세(소방분)', amount: bld },
      { month: 9, due: '9.16 ~ 9.30', item: '토지분 재산세·도시지역분·지방교육세', amount: lt.prop },
      { month: 12, due: '12.1 ~ 12.15', item: '종합부동산세·농어촌특별세', amount: lt.cmt },
    ].filter(s => s.amount > 0);
    const missing = parcels.filter(p => !isLandReady(p)).length;
    return { land, buildings, totals, schedule, projection: projection(state), missing, parcelCount: parcels.length };
  }

  return Object.freeze({ compute, buildingFor, landFor, landTotals, PROJECTION_YEARS });
}));
