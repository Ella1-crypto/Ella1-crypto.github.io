/* 화면 상태 → 세액 결과. 순수 함수(브라우저: window.HTMCalc / Node: module.exports).
 * 토지: engine.js(HoldingTax) — 납세자 1명, 시·군·구별 합산, 종부세 전국 합산
 * 건물: valuation.js(2026 시가표준액 추정) → building-engine.js(비주거 건축물분)
 *
 * 별도합산 부속토지 기준(지방세법 시행령 §101①1 단서): 건축물 시가표준액이 부속토지 시가표준액의 2%에 못 미치면
 * 건축물 바닥면적을 뺀 부속토지는 종합합산. 2026 지방세 개편안(정부안)은 이 기준을 5%로 올린다(2027년분부터, 국회 심의 중).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./engine.js'), require('./building-engine.js'), require('./valuation.js'), require('./relief.js'));
  } else {
    root.HTMCalc = factory(root.HoldingTax, root.BuildingTax, root.BuildingValue, root.HTMRelief);
  }
}(typeof self !== 'undefined' ? self : this, function (HT, BT, BV, RL) {
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
  const OVERCROWD_YEARS = 5;

  function buildingFor(parcel, baseYear = BV.BASE_YEAR) {
    if (!parcel.bld || isHouse(parcel)) return null;
    const rows = valueRows(parcel, baseYear);
    const rowError = rows.find(r => r.est && r.est.error);
    if (!rows.length) return { parcelId: parcel.id, rows, error: '건물 정보를 입력하면 건물분을 계산합니다.' };
    if (rowError) return { parcelId: parcel.id, rows, error: rowError.est.error };
    const fire = fireMultiplier(parcel, rows);
    // 과밀억제권역 공장 중과는 최초 과세기준일부터 5년간만(지방세법 제111조②) — 그 뒤 연도는 일반 0.25%
    const from = Number(parcel.bld.overcrowdFrom) || 0;
    const expired = parcel.bld.rate === 'overcrowd' && from > 0 && baseYear >= from + OVERCROWD_YEARS;
    const rate = expired ? 'general' : (parcel.bld.rate || 'general');
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

  /* ---------- 감면 ---------- */
  /** 감면이 이 연도에 적용되는지 — relief.years(남은 감면 연수, 올해 포함)가 비어 있으면 계속 적용 */
  const reliefActive = (p, yearIndex) => p.relief && p.relief.key && p.relief.key !== 'none'
    && (!(Number(p.relief.years) > 0) || yearIndex < Number(p.relief.years));

  /** 토지 행의 재산세를 필지별로 나눈다 — 시·군·구·과세구분 안에서 과세표준 비율로 안분, 세부담상한 비율 반영 */
  function landAlloc(land, row) {
    const base = row.price * row.area * (row.share / 100) * HT.PARAMS.propFmv;
    const urban = row.urban ? base * HT.PARAMS.urbanRate : 0;
    if (HT.isBunri(row.cls)) return { main: base * HT.CLASS[row.cls].rate, urban };
    const reg = land.regions.find(r => r.sgg === (row.sgg || 'manual'));
    const key = row.cls === 'sep' ? 'sep' : 'jong';
    const raw = key === 'sep' ? land.prop.sepTaxRaw : land.prop.jongTaxRaw;
    const capped = key === 'sep' ? land.prop.sepTax : land.prop.jongTax;
    const regTax = reg ? reg[key + 'Tax'] : 0;
    const regBase = reg ? reg[key + 'Base'] : 0;
    const capRatio = raw > 0 ? capped / raw : 1;
    return { main: regBase > 0 ? regTax * base / regBase * capRatio : 0, urban };
  }

  /** 필지별 감면을 토지분·건축물분에 적용한다. 반환: 감면 내역과 줄어든 건물 귀속액 */
  function applyReliefs(parcels, land, rows, buildings, yearIndex) {
    const items = [];
    const landCut = { main: 0, urban: 0, edu: 0, sep: 0, jong: 0 };
    const bldOwn = new Map();
    for (const p of parcels.filter(x => !isHouse(x) && reliefActive(x, yearIndex))) {
      const rule = RL.commercialRule(p.relief.key, p.relief.region, p.relief.custom);
      if (!rule) continue;
      const item = { parcelId: p.id, ...rule, land: null, bld: null };
      if (land) {
        const own = rows.filter(r => r.id === p.id);
        const mine = own.map(r => landAlloc(land, r));
        const tax = { main: Math.floor(sum(mine.map(m => m.main))), urban: Math.floor(sum(mine.map(m => m.urban))) };
        const cut = RL.apply(tax, rule);
        // 본세 감면액을 별도합산·종합합산으로 나눠 둔다(종부세 공제할 재산세 재계산용)
        own.forEach((r, j) => {
          const k = r.cls === 'sep' ? 'sep' : r.cls === 'jong' ? 'jong' : null;
          if (k && tax.main > 0) landCut[k] += cut.mainCut * mine[j].main / tax.main;
        });
        const eduCut = Math.floor(cut.mainCut * HT.PARAMS.eduRate);
        item.land = { ...cut, eduCut, total: cut.mainCut + cut.urbanCut + eduCut };
        landCut.main += cut.mainCut; landCut.urban += cut.urbanCut; landCut.edu += eduCut;
      }
      const b = buildings.find(x => x.parcelId === p.id && x.own && !x.error);
      if (b) {
        const k = b.share / 100;
        const tax = { main: Math.floor(b.tax.main * k), urban: Math.floor(b.tax.urbanTax * k) };
        const cut = RL.apply(tax, rule);
        const eduCut = Math.floor(cut.mainCut * BT.EDU_RATE);
        item.bld = { ...cut, eduCut, total: cut.mainCut + cut.urbanCut + eduCut };
        bldOwn.set(b.parcelId, { ...b.own, prop: b.own.prop - cut.mainCut - cut.urbanCut, edu: b.own.edu - eduCut, total: b.own.total - item.bld.total });
      }
      item.total = (item.land ? item.land.total : 0) + (item.bld ? item.bld.total : 0);
      items.push(item);
    }
    return { items, landCut, bldOwn };
  }

  /**
   * @param {{ownerType:'개인'|'법인', growth:number, mode?:string, prev?:object, parcels:Array}} state
   * @param {{year?:number, yearIndex?:number, skipProjection?:boolean}} [opts]
   */
  function compute(state, opts = {}) {
    const parcels = state.parcels || [];
    const year = opts.year || modeOf(state.mode).year; // 다년 계산은 연도를 바꿔 부른다(건물 잔가율 기준연도)
    const yearIndex = opts.yearIndex || 0;
    const rawBuildings = parcels.map(p => buildingFor(p, year)).filter(Boolean);
    const split = landSplit(parcels, rawBuildings, state.mode);
    const land0 = split.rows.length ? HT.calcTaxpayer(split.rows, prevFor(state)) : null;
    const relief = applyReliefs(parcels, land0, split.rows, rawBuildings, yearIndex);
    // 감면받은 토지는 종부세에서 빼 주는 재산세도 감면 후 금액이다(종부세법 제14조③·⑥) — 종부세만 다시 계산
    const cutLand = relief.landCut.sep > 0 || relief.landCut.jong > 0;
    const land = land0 && cutLand && land0.cmt.total > 0
      ? HT.calcTaxpayer(split.rows, prevFor(state), { sep: relief.landCut.sep, jong: relief.landCut.jong }) : land0;
    const lt = landTotals(land);
    const buildings = rawBuildings.map(b => (relief.bldOwn.has(b.parcelId) ? { ...b, own: relief.bldOwn.get(b.parcelId), relieved: true } : b));
    const okBuildings = buildings.filter(b => b.own && !b.error);
    const bld = sum(okBuildings.map(b => b.own.total));
    const lc = relief.landCut;
    const landProp = Math.max(0, lt.prop - lc.main - lc.urban - lc.edu);
    const landBill = land ? Math.max(0, land.prop.notice.prop - lc.main - lc.urban) : 0; // 분할납부 판정 기준(재산세 본세+도시지역분)
    const reliefTotal = sum(relief.items.map(i => i.total));
    const totals = { landProp, landBill, cmt: lt.cmt, cmtMain: lt.cmtMain, nong: lt.nong, building: bld, relief: reliefTotal, total: landProp + lt.cmt + bld };
    const schedule = [
      { month: 7, due: '7.16 ~ 7.31', item: '건축물분 재산세·지방교육세·지역자원시설세(소방분)', amount: bld },
      { month: 9, due: '9.16 ~ 9.30', item: '토지분 재산세·도시지역분·지방교육세', amount: landProp },
      { month: 12, due: '12.1 ~ 12.15', item: '종합부동산세·농어촌특별세', amount: lt.cmt },
    ].filter(s => s.amount > 0);
    const housing = parcels.filter(isHouse).length;
    const missing = parcels.filter(p => !isHouse(p) && !isLandReady(p)).length;
    const result = { mode: state.mode || '2026', year, land, buildings, totals, reliefs: relief.items, schedule, warnings: split.warnings, missing, housing, parcelCount: parcels.length };
    return opts.skipProjection ? { ...result, projection: [] } : { ...result, projection: projection(state) };
  }

  /**
   * 연도별 계산 — 공시지가 상승률을 적용하고, 세부담상한 기준(작년 세액)은 앞 연도 계산액으로 연쇄한다.
   * CF와 5년 전망이 같은 결과를 쓰도록 한 곳에서 계산한다.
   */
  function series(state, years) {
    const g = (Number(state.growth) || 0) / 100;
    const startYear = modeOf(state.mode).year;
    let cur = state;
    const out = [];
    for (let i = 0; i < years; i += 1) {
      const year = startYear + i;
      const factor = Math.pow(1 + g, i);
      const scaled = { ...cur, parcels: cur.parcels.map(p => ({ ...p, price: p.price * factor })) };
      const r = compute(scaled, { year, yearIndex: i, skipProjection: true });
      out.push({ year, i, r });
      const prev = r.land
        ? { propSep: r.land.prop.sepTax, propJong: r.land.prop.jongTax, cmtSep: r.land.cmt.sep.decided, cmtJong: r.land.cmt.jong.decided }
        : cur.prev;
      const byId = new Map(r.buildings.filter(x => x.own && !x.error).map(x => [x.parcelId, x]));
      cur = {
        ...cur,
        prev,
        parcels: cur.parcels.map(p => {
          const b = byId.get(p.id);
          if (!b || !p.bld) return p;
          return { ...p, bld: { ...p.bld, prevMain: Math.floor(b.tax.main * b.share / 100), prevFire: b.own.fire } };
        }),
      };
    }
    return out;
  }

  function projection(state) {
    return series(state, PROJECTION_YEARS).map(({ year, r }) => ({
      year, land: r.totals.landProp, cmt: r.totals.cmt, building: r.totals.building, total: r.totals.total,
    }));
  }

  return Object.freeze({ MODES, compute, series, buildingFor, landSplit, landTotals, landAlloc, PROJECTION_YEARS });
}));
