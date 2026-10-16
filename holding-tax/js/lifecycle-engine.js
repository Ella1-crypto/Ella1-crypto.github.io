/* 취득 → 보유 → 양도 생애주기 엔진 — 세금 4종을 한 번에 이어 연도별 현금흐름(CF)과 세후 수익률을 낸다.
 * 브라우저: window.Lifecycle / Node: module.exports (다른 엔진을 인자로 받는다)
 *
 *  · 0년차: 매입가 + 취득세(AcqTax) + 중개수수료
 *  · 1~N년차: 임대수입 − 대출이자 − 보유세(주택: HouseTax / 상업용: HoldingTax 토지 + BuildingTax 건물)
 *  · N년차 말: 매각가 − 중개수수료 − 양도세(TransferTax, 개인 양도소득세 / 법인 처분 법인세)
 *  보유세는 해당 연도 6월 1일 보유분을 낸다(매입 연도는 6.1. 이전 잔금이면 포함, 매각 연도는 6.1. 이후 잔금이면 포함).
 *  공시가격은 시세 × 현실화율로 보고 시세 상승률만큼 해마다 오른다. 건물 시가표준액은 고정으로 본다.
 *  임대소득세·법인의 임대 법인세·감가상각·대출원금 상환은 넣지 않는다(화면에 표시).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.Lifecycle = factory(root.AcqTax, root.HouseTax, root.HoldingTax, root.BuildingTax, root.TransferTax);
}(typeof self !== 'undefined' ? self : this, function (A, H, L, B, T) {
  'use strict';

  const MAX_YEARS = 30;
  const DEFAULTS = Object.freeze({
    owner: '개인', kind: 'house', price: 0, buyDate: '2026-03-02', years: 5, growth: 3,
    officialRatio: 69, landShare: 60, landRatio: 65, bldStd: 0,
    houseCount: 1, adjusted: false, oneHouse: true, live: true, age: 0, otherValue: 0, relief: 'none', over85: false,
    rent: 0, rentGrowth: 2, loan: 0, loanRate: 4.5, fee: 0.5, heavyExcluded: false,
  });
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v) || 0));
  const floor = n => Math.floor(n + 1e-6);
  const pad = n => String(n).padStart(2, '0');

  function addYears(dateStr, n) {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return '';
    const t = new Date(d.getFullYear() + n, d.getMonth(), d.getDate());
    return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
  }

  function norm(raw) {
    const x = { ...DEFAULTS, ...(raw || {}) };
    return {
      ...x,
      owner: x.owner === '법인' ? '법인' : '개인',
      kind: x.kind === 'commercial' ? 'commercial' : 'house',
      price: clamp(x.price, 0, 1e13),
      years: Math.round(clamp(x.years || 1, 1, MAX_YEARS)),
      growth: clamp(x.growth, -20, 30) / 100,
      officialRatio: clamp(x.officialRatio || 69, 10, 100) / 100,
      landShare: clamp(x.landShare, 0, 100) / 100,
      landRatio: clamp(x.landRatio || 65, 10, 100) / 100,
      bldStd: clamp(x.bldStd, 0, 1e13),
      houseCount: Math.round(clamp(x.houseCount || 1, 1, 20)),
      age: clamp(x.age, 0, 120),
      otherValue: clamp(x.otherValue, 0, 1e13),
      rent: clamp(x.rent, 0, 1e12),
      rentGrowth: clamp(x.rentGrowth, -20, 30) / 100,
      loan: clamp(x.loan, 0, 1e13),
      loanRate: clamp(x.loanRate, 0, 30) / 100,
      fee: clamp(x.fee, 0, 10) / 100,
      buyDate: /^\d{4}-\d{2}-\d{2}$/.test(x.buyDate) ? x.buyDate : DEFAULTS.buyDate,
    };
  }

  /** 주택 보유세 — 이 주택 때문에 늘어나는 몫(다른 주택이 있으면 합산 종부세의 증가분) */
  function houseHolding(x, official, year, heldYears) {
    const mode = year <= 2026 ? '2026' : '2027law';
    const corp = x.owner === '법인';
    const one = !corp && x.oneHouse && x.houseCount === 1;
    const common = { mode, ownerType: x.owner, oneHouse: one, age: x.age, holdYears: heldYears, houseCount: x.houseCount, resident: x.live };
    const withIt = H.calc({ ...common, houses: [{ price: official, share: 100, urban: true }, ...(x.otherValue ? [{ price: x.otherValue, share: 100, urban: true }] : [])] });
    const without = x.otherValue ? H.calc({ ...common, oneHouse: false, houses: [{ price: x.otherValue, share: 100, urban: true }] }) : { prop: { total: 0 }, cmt: null, total: 0 };
    const prop = withIt.prop.total - without.prop.total;
    const cmt = (withIt.cmt ? withIt.cmt.total : 0) - (without.cmt ? without.cmt.total : 0);
    return { prop, cmt, total: prop + cmt };
  }

  /** 상업용 보유세 — 토지 별도합산(재산세·종부세) + 건물 재산세·소방분 */
  function commercialHolding(x, landOfficial) {
    const land = L.calcTaxpayer([{ sgg: 'A', cls: 'sep', price: landOfficial, area: 1, share: 100, urban: true }]);
    const bldValue = x.bldStd || floor(x.price * (1 - x.landShare) * 0.5);
    const bld = bldValue > 0 ? B.calc({ units: [{ name: '건물', use: '근린생활시설', amount: bldValue, rate: 'general', fire: 1 }], bldUrban: 'on' }, { urban: true }) : { total: 0 };
    const prop = Math.round(land.prop.total) + (bld.total || 0);
    const cmt = Math.round(land.cmt.total);
    return { prop, cmt, total: prop + cmt, bldValue };
  }

  /** 세후 IRR(연) — 이분법 */
  function irr(flows) {
    const npv = r => flows.reduce((s, f, i) => s + f / (1 + r) ** i, 0);
    let lo = -0.99, hi = 1;
    if (npv(lo) * npv(hi) > 0) return null;
    for (let i = 0; i < 200; i += 1) {
      const mid = (lo + hi) / 2;
      if (npv(lo) * npv(mid) <= 0) hi = mid; else lo = mid;
    }
    return (lo + hi) / 2;
  }

  function calc(raw) {
    const x = norm(raw);
    const sellDate = addYears(x.buyDate, x.years);
    const isHouse = x.kind === 'house';
    const notes = [];

    // 0년차 — 취득
    const acq = A.calc({
      buyer: x.owner, asset: isHouse ? 'house' : 'nonres', cause: 'sale', price: x.price, houseCount: x.houseCount,
      adjusted: x.adjusted, over85: x.over85, relief: isHouse ? x.relief : 'none', heavyExcluded: x.heavyExcluded,
    });
    const buyFee = floor(x.price * x.fee);
    const equity0 = x.price - x.loan;
    const rows = [{
      year: 0, label: `${x.buyDate} 매입`, value: x.price, official: 0, rent: 0, interest: 0, prop: 0, cmt: 0,
      acqTax: acq.total, fee: buyFee, saleNet: 0, transferTax: 0, flow: -(equity0 + acq.total + buyFee),
    }];

    // 1~N년차 — 보유
    let holding = { prop: 0, cmt: 0 };
    for (let i = 1; i <= x.years; i += 1) {
      // i년차 [매입일+(i−1)년, 매입일+i년) 안에 6월 1일이 꼭 한 번 있다 — 그해 보유세를 낸다
      const start = addYears(x.buyDate, i - 1);
      const sy = Number(start.slice(0, 4));
      const calYear = start <= `${sy}-06-01` ? sy : sy + 1;
      const value = floor(x.price * (1 + x.growth) ** i);
      const valueAtJune = floor(x.price * (1 + x.growth) ** (i - 1));
      let h = { prop: 0, cmt: 0 };
      let official = 0;
      {
        if (isHouse) {
          official = floor(valueAtJune * x.officialRatio);
          h = houseHolding(x, official, calYear, i - 1);
        } else {
          official = floor(valueAtJune * x.landShare * x.landRatio);
          h = commercialHolding(x, official);
        }
      }
      const rent = floor(x.rent * (1 + x.rentGrowth) ** (i - 1));
      const interest = floor(x.loan * x.loanRate);
      holding = { prop: holding.prop + h.prop, cmt: holding.cmt + h.cmt };
      rows.push({ year: i, label: `${i}년차 (${calYear}년 보유세)`, value, official, rent, interest, prop: h.prop, cmt: h.cmt, acqTax: 0, fee: 0, saleNet: 0, transferTax: 0, flow: rent - interest - h.prop - h.cmt });
    }

    // N년차 말 — 양도
    const salePrice = rows[rows.length - 1].value;
    const sellFee = floor(salePrice * x.fee);
    const tr = T.calc({
      seller: x.owner, asset: isHouse ? 'house' : 'building', price: salePrice, cost: x.price, expense: acq.total + buyFee + sellFee,
      acqDate: x.buyDate, saleDate: sellDate, oneHouse: isHouse && x.oneHouse && x.houseCount === 1, residenceYears: isHouse && x.live ? x.years : 0,
      houseCount: x.houseCount, adjustedNow: x.adjusted, adjustedAtAcq: x.adjusted, heavyExcluded: x.heavyExcluded,
    });
    const last = rows[rows.length - 1];
    last.fee = sellFee;
    last.transferTax = tr.total;
    last.saleNet = salePrice - sellFee - x.loan;
    last.flow += last.saleNet - tr.total;
    last.label += ` · ${sellDate} 매각`;

    const flows = rows.map(r => r.flow);
    const invested = -flows[0];
    const profit = flows.reduce((s, f) => s + f, 0);
    const taxes = { acq: acq.total, prop: holding.prop, cmt: holding.cmt, transfer: tr.total };
    taxes.total = taxes.acq + taxes.prop + taxes.cmt + taxes.transfer;
    const preTaxFlows = rows.map((r, i) => r.flow + (i === 0 ? r.acqTax : 0) + r.prop + r.cmt + r.transferTax);
    if (x.rent > 0) notes.push('임대소득에 대한 종합소득세(법인은 법인세)는 넣지 않았습니다.');
    if (isHouse && x.otherValue > 0) notes.push('보유세는 다른 주택과 합산한 종부세에서 이 주택 때문에 늘어나는 몫만 넣었습니다.');
    if (!isHouse && !x.bldStd) notes.push('건물 시가표준액을 넣지 않아 건물가(매입가 × 건물 비중)의 50%로 추정했습니다.');
    if (x.owner === '법인') notes.push('법인 양도는 장부가액을 매입가로 보고(감가상각 없음) 처분이익만 따로 계산했습니다.');
    return {
      input: x, sellDate, rows, acq, transfer: tr, taxes, invested, profit,
      irr: irr(flows), preTaxIrr: irr(preTaxFlows),
      multiple: invested > 0 ? (profit + invested) / invested : null,
      taxShare: profit + taxes.total > 0 ? taxes.total / (profit + taxes.total) : 0,
      notes,
    };
  }

  /** 시나리오 표 — 보유기간 × 상승률 */
  function grid(raw, holds, growths) {
    return holds.map(n => growths.map(g => {
      const r = calc({ ...raw, years: n, growth: g });
      return { years: n, growth: g, irr: r.irr, profit: r.profit, taxes: r.taxes.total };
    }));
  }

  return Object.freeze({ DEFAULTS, MAX_YEARS, calc, grid, irr, addYears });
}));
