/* 보유세 현금흐름(CF) — 연도별·월별 납부 일정. 분할납부를 고르면 납부월이 뒤로 옮겨진다.
 * 순수 함수(브라우저: window.HTMCF / Node: module.exports).
 *
 * 납기와 분할납부 (2026-10-15 확인)
 *  · 건축물 7.16~7.31 · 토지 9.16~9.30 · 주택 7월·9월 각 1/2(연 20만원 이하는 7월 한 번) — 지방세법 §115
 *  · 재산세 분할납부: 납부할 세액 250만원 초과 시 납부기한 후 3개월 이내(7월분 → 10월, 9월분 → 12월)
 *      500만원 이하는 250만원 초과분, 500만원 초과는 50% 이하 — 지방세법 §118, 시행령 §116
 *    지방교육세(부가세)와 소방분 지역자원시설세(§147② 준용)는 같은 비율로 함께 옮긴다.
 *  · 종부세 12.1~12.15, 250만원 초과 시 6개월 이내 분납(다음 해 6월 15일) — 종부세법 §16·§20, 농특세도 같은 비율
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./calc.js'), require('./house-engine.js'));
  else root.HTMCF = factory(root.HTMCalc, root.HouseTax);
}(typeof self !== 'undefined' ? self : this, function (C, H) {
  'use strict';

  const INSTALL_MIN = 2.5e6;
  const INSTALL_HALF = 5e6;
  const MAX_YEARS = 10;
  const sum = a => a.reduce((s, x) => s + x, 0);

  /** 분할(분납) 가능액 — 시행령 §116, 종부세법 시행령 §16 */
  function installmentPortion(amount) {
    if (amount <= INSTALL_MIN) return 0;
    if (amount <= INSTALL_HALF) return amount - INSTALL_MIN;
    return Math.floor(amount / 2);
  }

  /** 한 고지서를 '지금 낼 몫'과 '나중 낼 몫'으로 나눈다. base는 분할 기준세액(재산세 본세+도시지역분 또는 종부세) */
  function split(base, total, installments) {
    const later = installments && base > 0 ? installmentPortion(base) : 0;
    const laterTotal = later > 0 ? Math.floor(total * later / base) : 0;
    return { now: total - laterTotal, later: laterTotal };
  }

  const pad = m => String(m).padStart(2, '0');
  function entry(year, month, kind, label, amount, due, deferred) {
    return { year, month, ym: `${year}-${pad(month)}`, kind, label, amount, due, deferred: Boolean(deferred) };
  }

  function cmtEntries(year, decided, nong, installments) {
    if (!(decided > 0)) return [];
    const later = installments ? installmentPortion(decided) : 0;
    const nongLater = later > 0 ? Math.floor(nong * later / decided) : 0;
    const out = [entry(year, 12, 'cmt', '종합부동산세·농어촌특별세', decided - later + nong - nongLater, '12.1 ~ 12.15', false)];
    if (later > 0) out.push(entry(year + 1, 6, 'cmt', `${year}년분 종부세·농특세 분납`, later + nongLater, '다음 해 6.15까지', true));
    return out;
  }

  function summarize(entries, startYear, years) {
    const taxYears = Array.from({ length: years }, (_, i) => startYear + i);
    const byTaxYear = taxYears.map(y => {
      const own = entries.filter(e => e.taxYear === y);
      const k = kind => sum(own.filter(e => e.kind === kind).map(e => e.amount));
      return { year: y, bld: k('bld'), land: k('land'), house: k('house'), cmt: k('cmt'), total: sum(own.map(e => e.amount)) };
    });
    let cumulative = 0;
    const byCashYear = Array.from({ length: years + 1 }, (_, i) => startYear + i).map(y => {
      const cash = sum(entries.filter(e => e.year === y).map(e => e.amount));
      cumulative += cash;
      return { year: y, cash, cumulative };
    }).filter(r => r.cash > 0 || r.year < startYear + years);
    const months = [...new Set(entries.map(e => e.ym))].sort().map(ym => ({
      ym, amount: sum(entries.filter(e => e.ym === ym).map(e => e.amount)), items: entries.filter(e => e.ym === ym),
    }));
    return { byTaxYear, byCashYear, months, total: sum(entries.map(e => e.amount)) };
  }

  /**
   * 상업용(토지·비주거 건물) CF
   * @param {object} state 상업용 화면 상태(calc.js compute 입력)
   * @param {{years?:number, installments?:boolean}} [opt]
   */
  function commercial(state, opt = {}) {
    const years = Math.max(1, Math.min(MAX_YEARS, Math.round(opt.years || 5)));
    const g = (Number(state.growth) || 0) / 100;
    const startYear = (C.MODES[state.mode] || C.MODES['2026']).year;
    let cur = state;
    const entries = [];
    for (let i = 0; i < years; i += 1) {
      const year = startYear + i;
      const factor = Math.pow(1 + g, i);
      const scaled = { ...cur, parcels: cur.parcels.map(p => ({ ...p, price: p.price * factor })) };
      const r = C.compute(scaled, { year, skipProjection: true });
      const tag = e => ({ ...e, taxYear: year });

      for (const b of r.buildings.filter(x => x.own && !x.error)) {
        const p = state.parcels.find(x => x.id === b.parcelId) || {};
        const name = p.addr || '건물';
        const s = split(b.own.prop, b.own.total, opt.installments);
        if (s.now > 0) entries.push(tag(entry(year, 7, 'bld', `건축물분 재산세·교육세·소방분 — ${name}`, s.now, '7.16 ~ 7.31')));
        if (s.later > 0) entries.push(tag(entry(year, 10, 'bld', `건축물분 분할납부 — ${name}`, s.later, '10.31까지', true)));
      }
      if (r.land && r.totals.landProp > 0) {
        const s = split(r.land.prop.notice.prop, r.totals.landProp, opt.installments);
        entries.push(tag(entry(year, 9, 'land', '토지분 재산세·도시지역분·교육세', s.now, '9.16 ~ 9.30')));
        if (s.later > 0) entries.push(tag(entry(year, 12, 'land', '토지분 재산세 분할납부', s.later, '12.31까지', true)));
      }
      cmtEntries(year, r.totals.cmtMain, r.totals.nong, opt.installments).forEach(e => entries.push(tag(e)));

      // 다음 해 세부담상한 기준: 올해 계산액으로 연쇄 (토지 재산세·종부세, 건축물 본세·소방분)
      const prev = r.land ? {
        propSep: r.land.prop.sepTax, propJong: r.land.prop.jongTax, cmtSep: r.land.cmt.sep.decided, cmtJong: r.land.cmt.jong.decided,
      } : cur.prev;
      const byId = new Map(r.buildings.filter(x => x.own && !x.error).map(x => [x.parcelId, x]));
      cur = {
        ...cur,
        prev,
        parcels: cur.parcels.map(p => {
          const b = byId.get(p.id);
          if (!b || !p.bld) return p;
          const k = b.share / 100;
          return { ...p, bld: { ...p.bld, prevMain: Math.floor(b.tax.main * k), prevFire: b.own.fire } };
        }),
      };
    }
    return { kind: 'commercial', startYear, years, installments: Boolean(opt.installments), entries, ...summarize(entries, startYear, years) };
  }

  /** 다음 해 모드: 2026 현행에서 시작하면 2027년부터는 현행법(1주택 특례 종료), 2027 모드는 그대로 */
  const houseModeFor = (startMode, i) => (i === 0 ? startMode : startMode === '2027reform' ? '2027reform' : '2027law');

  /**
   * 주택 CF
   * @param {object} input house-engine calc 입력
   * @param {{years?:number, installments?:boolean, growth?:number}} [opt]
   */
  function house(input, opt = {}) {
    const years = Math.max(1, Math.min(MAX_YEARS, Math.round(opt.years || 5)));
    const g = (Number(opt.growth) || 0) / 100;
    const startMode = H.MODES[input.mode] ? input.mode : '2026';
    const startYear = H.MODES[startMode].year;
    let cur = input;
    const entries = [];
    for (let i = 0; i < years; i += 1) {
      const year = startYear + i;
      const factor = Math.pow(1 + g, i);
      const prevFactor = Math.pow(1 + g, i - 1);
      const houses = input.houses.filter(h => Number(h.price) > 0).map((h, j) => ({
        ...h,
        price: h.price * factor,
        prevPrice: i === 0 ? h.prevPrice : h.price * prevFactor,
        bldValue: h.bldValue,
        prevFire: i === 0 ? h.prevFire : (cur.houses[j] && cur.houses[j].prevFire) || 0,
      }));
      const r = H.calc({ ...cur, mode: houseModeFor(startMode, i), houses });
      const tag = e => ({ ...e, taxYear: year });
      const bill = r.prop.main + r.prop.urban;
      if (r.prop.total > 0) {
        if (bill <= H.P.julyOnlyMax) {
          entries.push(tag(entry(year, 7, 'house', '주택 재산세 전액(20만원 이하)·교육세·소방분', r.prop.total, '7.16 ~ 7.31')));
        } else {
          const first = Math.ceil(r.prop.total / 2);
          const halves = [[7, first, '7.16 ~ 7.31', 10, '10.31까지'], [9, r.prop.total - first, '9.16 ~ 9.30', 12, '12.31까지']];
          for (const [m, amt, due, lm, ldue] of halves) {
            const s = split(bill / 2, amt, opt.installments);
            entries.push(tag(entry(year, m, 'house', `주택 재산세 1/2·도시지역분·교육세·소방분`, s.now, due)));
            if (s.later > 0) entries.push(tag(entry(year, lm, 'house', `${m}월분 주택 재산세 분할납부`, s.later, ldue, true)));
          }
        }
      }
      if (r.cmt) cmtEntries(year, r.cmt.decided, r.cmt.nong, opt.installments).forEach(e => entries.push(tag(e)));
      cur = {
        ...cur,
        prevTotal: r.prop.main + (r.cmt ? r.cmt.decided : 0),
        houses: houses.map((h, j) => ({ ...h, prevFire: r.rows[j] ? r.rows[j].ownFire : 0 })),
      };
    }
    return { kind: 'house', startYear, years, installments: Boolean(opt.installments), entries, ...summarize(entries, startYear, years) };
  }

  return Object.freeze({ commercial, house, installmentPortion, split, MAX_YEARS });
}));
