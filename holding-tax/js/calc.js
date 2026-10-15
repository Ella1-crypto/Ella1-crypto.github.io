/* 화면 상태 → 세액 결과. 순수 함수(브라우저: window.HTMCalc / Node: module.exports).
 * 토지: engine.js(HoldingTax) — 납세자 1명, 시·군·구별 합산, 종부세 전국 합산
 * 건물: valuation.js(2026 시가표준액 추정) → building-engine.js(비주거 건축물분)
 *
 * 별도합산 부속토지 기준(지방세법 시행령 §101①1 단서): 건축물 시가표준액이 부속토지 시가표준액의 2%에 못 미치면
 * 건축물 바닥면적을 뺀 부속토지는 종합합산. 2026 지방세 개편안(정부안)은 이 기준을 5%로 올린다(2027년분부터, 국회 심의 중).
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
  const MODES = Object.freeze({
    '2026': { label: '2026년 (현행)', year: 2026, attachRatio: 0.02 },
    '2027reform': { label: '2027년 — 2026 지방세 개편안(정부안) 미리보기', year: 2027, attachRatio: 0.05 },
  });
  const modeOf = m => MODES[m] || MODES['2026'];
  const sum = arr => arr.reduce((s, n) => s + n, 0);
  const isHouse = p => p.hasHouse === true; // 주택 부속토지·주택은 주택분(주택 계산기)으로 과세 — 여기서는 뺀다
  const isLandReady = p => !isHouse(p) && p.price > 0 && p.area > 0;
  const shareOf = p => (Number(p.share) > 0 ? Math.min(100, Number(p.share)) : 100);

  /** 건물 1건의 동·구 행 → 시가표준액 행 */
  function valueRows(parcel, baseYear) {
    const b = parcel.bld;
    if (b.mode === 'direct') {
      const v = Number(b.direct) || 0;
      return v > 0 ? [{ label: '시가표준액 직접 입력', value: v, est: null }] : [];
    }
    return (b.rows || []).map((r, i) => {
      const est = BV.estimate({ structure: b.structure, builtYear: b.builtYear, use: r.use, area: r.area, adjust: r.adjust, landPrice: parcel.price }, baseYear);
      const useLabel = Object.prototype.hasOwnProperty.call(BV.USE, r.use) ? BV.USE[r.use].label : '';
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

  /** 건물 1건의 보유세 — tax는 건물 전체(100%), own은 내 지분 귀속분 */
  function buildingFor(parcel, baseYear = BV.BASE_YEAR) {
    if (!parcel.bld || isHouse(parcel)) return null;
    const rows = valueRows(parcel, baseYear);
    const rowError = rows.find(r => r.est && r.est.error);
    if (!rows.length) return { parcelId: parcel.id, rows, error: '건물 정보를 입력하면 건물분을 계산합니다.' };
    if (rowError) return { parcelId: parcel.id, rows, error: rowError.est.error };
    const fire = fireMultiplier(parcel, rows);
    const rate = parcel.bld.rate || 'general';
    const k = shareOf(parcel) / 100;
    const prevMain = Number(parcel.bld.prevMain) || 0; // 내 몫 기준 작년 본세 → 건물 전체로 환산해 상한 비교
    const prevFire = Number(parcel.bld.prevFire) || 0;
    // 용도 구분은 가액 산정용일 뿐 한 동이므로, 소방분 누진·재산세 끝수는 동 전체 가액에 한 번 적용한다
    const tax = BT.calc({
      units: [{ name: '건물', use: '', amount: sum(rows.map(r => r.value)), rate, fire: fire.fire }],
      bldInput: 'value',
      bldUrban: parcel.urban === false ? 'off' : 'on',
      bldPrevMain: prevMain > 0 ? prevMain / k : null,
      bldPrevFire: prevFire > 0 ? prevFire / k : null,
    });
    const own = tax.error ? null : BT.forOwners(tax, [{ tp: 'me', share: shareOf(parcel) }])[0];
    return { parcelId: parcel.id, rows, fire, rate, tax, own, share: shareOf(parcel), value: sum(rows.map(r => r.value)), error: tax.error || null };
  }

  /**
   * 토지 행 — 별도합산 필지에 건물이 있고 건물 가액이 토지 가액의 기준비율(2%/5%) 미만이면
   * 바닥면적(건축면적)만 별도합산, 나머지는 종합합산으로 나눈다. 건축면적이 없으면 나누지 않고 경고만 한다.
   */
  function landSplit(parcels, buildings, mode) {
    const ratioMin = modeOf(mode).attachRatio;
    const byId = new Map(buildings.map(b => [b.parcelId, b]));
    const rows = [];
    const warnings = [];
    for (const p of parcels.filter(isLandReady)) {
      const base = { price: p.price, share: shareOf(p), sgg: p.sgg || 'manual', sggName: p.sggName || '직접 입력', urban: p.urban !== false };
      const b = byId.get(p.id);
      const landValue = p.price * p.area;
      const ratio = b && !b.error && landValue > 0 ? b.value / landValue : null;
      if (p.cls === 'sep' && ratio != null && ratio < ratioMin) {
        const footprint = Math.min(p.area, Number(p.bld && p.bld.footprint) || 0);
        warnings.push({ parcelId: p.id, ratio, ratioMin, footprint, split: footprint > 0 });
        if (footprint > 0) {
          rows.push({ ...base, id: p.id, area: footprint, cls: 'sep' });
          if (p.area - footprint > 0) rows.push({ ...base, id: p.id, area: p.area - footprint, cls: 'jong' });
          continue;
        }
      }
      rows.push({ ...base, id: p.id, area: p.area, cls: p.cls });
    }
    return { rows, warnings };
  }

  function prevFor(state) {
    const v = state.prev || {};
    const n = k => Number(v[k]) || 0;
    const out = {};
    if (n('propSep') > 0) { out.propSep = n('propSep'); out.cmtSep = n('propSep') + n('cmtSep'); }
    if (n('propJong') > 0) { out.propJong = n('propJong'); out.cmtJong = n('propJong') + n('cmtJong'); }
    return out;
  }

  /** 고지서 끝수: 재산세·교육세는 10원 미만 절사, 종부세·농특세는 원 미만 버림 */
  function landTotals(land) {
    if (!land) return { prop: 0, cmt: 0, cmtMain: 0, nong: 0 };
    const cmtMain = Math.floor(land.cmt.decided);
    const nong = Math.floor(land.cmt.nong);
    return { prop: land.prop.notice.total, cmt: cmtMain + nong, cmtMain, nong };
  }

  function projection(state, rows) {
    const startYear = modeOf(state.mode).year;
    const tp = { id: 'me', name: '본인', type: state.ownerType, prev: prevFor(state) };
    const landCf = rows.length
      ? HT.projectCashflow({ parcels: rows.map(r => ({ ...r, tp: 'me' })), taxpayers: [tp], startYear, years: PROJECTION_YEARS, growthPct: state.growth || 0 })
      : null;
    return Array.from({ length: PROJECTION_YEARS }, (_, i) => {
      const year = startYear + i;
      const landRow = landCf ? landCf.annual[i] : { prop: 0, cmt: 0, value: 0 };
      // 작년 건축물 세액(150% 상한)은 첫해에만 비교 — 이후 연도는 매년 앞 연도 대비라 단순 전망에서는 적용하지 않는다
      const parcels = i === 0 ? state.parcels : state.parcels.map(p => (p.bld ? { ...p, bld: { ...p.bld, prevMain: 0 } } : p));
      const bld = parcels.map(p => buildingFor(p, year)).filter(b => b && b.own && !b.error);
      const building = sum(bld.map(b => b.own.total));
      return { year, landValue: landRow.value, land: Math.floor(landRow.prop), cmt: Math.floor(landRow.cmt), building, total: Math.floor(landRow.prop) + Math.floor(landRow.cmt) + building };
    });
  }

  /**
   * @param {{ownerType:'개인'|'법인', growth:number, mode?:string, prev?:object, parcels:Array}} state
   */
  function compute(state, opts = {}) {
    const parcels = state.parcels || [];
    const year = opts.year || modeOf(state.mode).year; // CF 다년 계산은 연도를 바꿔 부른다(건물 잔가율 기준연도)
    const buildings = parcels.map(p => buildingFor(p, year)).filter(Boolean);
    const split = landSplit(parcels, buildings, state.mode);
    const land = split.rows.length ? HT.calcTaxpayer(split.rows, prevFor(state)) : null;
    const lt = landTotals(land);
    const okBuildings = buildings.filter(b => b.own && !b.error);
    const bld = sum(okBuildings.map(b => b.own.total));
    const totals = { landProp: lt.prop, cmt: lt.cmt, cmtMain: lt.cmtMain, nong: lt.nong, building: bld, total: lt.prop + lt.cmt + bld };
    const schedule = [
      { month: 7, due: '7.16 ~ 7.31', item: '건축물분 재산세·지방교육세·지역자원시설세(소방분)', amount: bld },
      { month: 9, due: '9.16 ~ 9.30', item: '토지분 재산세·도시지역분·지방교육세', amount: lt.prop },
      { month: 12, due: '12.1 ~ 12.15', item: '종합부동산세·농어촌특별세', amount: lt.cmt },
    ].filter(s => s.amount > 0);
    const housing = parcels.filter(isHouse).length;
    const missing = parcels.filter(p => !isHouse(p) && !isLandReady(p)).length;
    return { mode: state.mode || '2026', year, land, buildings, totals, schedule, warnings: split.warnings, projection: opts.skipProjection ? [] : projection(state, split.rows), missing, housing, parcelCount: parcels.length };
  }

  return Object.freeze({ MODES, compute, buildingFor, landSplit, landTotals, PROJECTION_YEARS });
}));
