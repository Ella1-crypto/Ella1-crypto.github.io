/* 주택 보유세 엔진 — 주택분 재산세(물건별) + 주택분 종합부동산세(인별 합산)
 * 순수 함수(브라우저: window.HouseTax / Node: module.exports).
 *
 * 근거 (2026-10-15 현행본 확인)
 *  · 재산세 과세표준 = 공시가격 × 공정시장가액비율: 60%, 2026년 1세대1주택 43%(3억 이하)·44%(6억 이하)·45%(6억 초과)
 *      (지방세법 §110①2, 시행령 §109①2)
 *  · 과세표준상한 = 직전 연도 공시가격 × 올해 비율 + 올해 과세표준 × 5% (지방세법 §110③, 시행령 §109의2)
 *  · 세율: 0.1~0.4% 누진(§111①3나), 1세대1주택이고 공시가격 9억 이하면 0.05~0.35%(§111의2 — 2026년 납세의무분까지)
 *  · 도시지역분 0.14%(§112), 지방교육세 = 재산세 × 20%(§151). 주택은 재산세 세부담상한 없음(§122 단서)
 *  · 종부세 과세표준 = (공시가격 합계 − 12억[1세대1주택]·9억[개인]·0[법인]) × 60% (종부세법 §8①, 시행령 §2조의4①)
 *  · 세율: 개인 2주택 이하·3주택 이상 누진(§9①), 법인 2.7%·5%(§9②3)
 *  · 공제할 재산세 = 부과 재산세 합계 × (종부세 과표 × 재산세 공정시장가액비율 × 0.4%) ÷ 합산 과세표준의 표준세율 재산세
 *      (시행령 §4의3①, 국세청 과세표준계산명세서)
 *  · 1세대1주택 세액공제: 고령자 20·30·40% + 장기보유 20·40·50%, 합계 80% 한도(§9⑤~⑧)
 *  · 세부담상한: 개인은 (재산세+종부세) 직전 연도 상당액의 150%(§10), 법인 중과세율 적용분은 없음
 *  · 농어촌특별세 = 종부세 × 20%
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HouseTax = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSION = '2026-10-15';
  const MODES = Object.freeze({
    '2026': { label: '2026년 (현행)', year: 2026, reform: false },
    '2027law': { label: '2027년 — 현행법이 그대로면', year: 2027, reform: false },
    '2027reform': { label: '2027년 — 2026 세제개편안(정부안) 반영', year: 2027, reform: true },
  });

  const PROP_STD = Object.freeze([[6e7, 0.001], [1.5e8, 0.0015], [3e8, 0.0025], [Infinity, 0.004]]);
  const PROP_ONE = Object.freeze([[6e7, 0.0005], [1.5e8, 0.001], [3e8, 0.002], [Infinity, 0.0035]]);
  const CMT_UPTO2 = Object.freeze([[3e8, 0.005], [6e8, 0.007], [1.2e9, 0.01], [2.5e9, 0.013], [5e9, 0.015], [9.4e9, 0.02], [Infinity, 0.027]]);
  const CMT_3PLUS = Object.freeze([[3e8, 0.005], [6e8, 0.007], [1.2e9, 0.01], [2.5e9, 0.02], [5e9, 0.03], [9.4e9, 0.04], [Infinity, 0.05]]);
  // 정부안(2026.8.3): 과세표준 6억~12억 구간 1.0% → 1.3%. 가액 기준 세율표 전환 등 세부는 미공개라 반영하지 않는다.
  const withReformRate = table => Object.freeze(table.map(([u, r]) => (u === 1.2e9 ? [u, 0.013] : [u, r])));

  const P = Object.freeze({
    fmvStd: 0.6,
    oneHouseSpecialMax: 9e8,
    capRate: 0.05,          // 과세표준상한율
    urbanRate: 0.0014,
    eduRate: 0.2,
    cmtFmv: 0.6,
    creditStdRate: 0.004,
    dedOne: 1.2e9, dedOneResidentReform: 1.4e9, dedOneNonResidentReform: 9e8, dedPerson: 9e8, dedCorp: 0,
    corpRate2: 0.027, corpRate3: 0.05,
    nongRate: 0.2,
    cmtCap: 1.5,
    creditMax: 0.8,
    julyOnlyMax: 2e5,        // 주택 재산세 20만원 이하면 7월 한 번에(§115①3 단서, 조례)
    installMin: 2.5e6, installHalf: 5e6,
  });

  const sfloor = n => Math.floor(n + 1e-6);
  function progressive(base, brackets) {
    let tax = 0, lower = 0;
    for (const [upper, rate] of brackets) {
      if (base <= lower) break;
      tax += (Math.min(base, upper) - lower) * rate;
      lower = upper;
    }
    return tax;
  }

  /** 1세대1주택 공정시장가액비율 — 2026년분은 43·44·45%, 그 밖의 연도는 정부안 반영 시에만 같은 값을 가정 */
  function fmvFor(price, oneHouse, mode) {
    const m = MODES[mode] || MODES['2026'];
    if (!oneHouse || (m.year !== 2026 && !m.reform)) return P.fmvStd;
    if (price <= 3e8) return 0.43;
    if (price <= 6e8) return 0.44;
    return 0.45;
  }

  /** 9억 이하 1세대1주택 특례세율 — 2026년분까지(현행), 정부안은 2029년까지 연장 */
  function specialRateApplies(price, oneHouse, mode) {
    const m = MODES[mode] || MODES['2026'];
    return Boolean(oneHouse) && price <= P.oneHouseSpecialMax && (m.year === 2026 || m.reform);
  }

  /** 주택 1채(100% 기준) 재산세 */
  function propertyTax(h, opt) {
    const price = Number(h.price) || 0;
    const fmv = fmvFor(price, opt.oneHouse, opt.mode);
    const rawBase = sfloor(price * fmv);
    const prev = Number(h.prevPrice) || 0;
    const capBase = prev > 0 ? sfloor(prev * fmv + rawBase * P.capRate) : Infinity;
    const base = Math.min(rawBase, capBase);
    const special = specialRateApplies(price, opt.oneHouse, opt.mode);
    const main = sfloor(progressive(base, special ? PROP_ONE : PROP_STD));
    const stdMain = progressive(base, PROP_STD);
    const urban = h.urban === false ? 0 : sfloor(base * P.urbanRate);
    const edu = sfloor(main * P.eduRate);
    return { price, fmv, rawBase, base, capped: base < rawBase, special, main, stdMain, urban, edu, total: main + urban + edu };
  }

  /** 지분만큼 귀속 — 재산세는 주택 전체에 세율을 적용한 뒤 지분으로 나눈다 */
  function ownerShare(t, share) {
    const k = (Number(share) > 0 ? Math.min(100, Number(share)) : 100) / 100;
    const main = sfloor(t.main * k), urban = sfloor(t.urban * k), edu = sfloor(t.edu * k);
    return { ...t, share: k * 100, ownMain: main, ownUrban: urban, ownEdu: edu, ownTotal: main + urban + edu, ownValue: t.price * k, ownBase: t.base * k };
  }

  function deductionFor(opt) {
    const m = MODES[opt.mode] || MODES['2026'];
    if (opt.ownerType === '법인') return P.dedCorp;
    if (!opt.oneHouse) return P.dedPerson;
    if (m.reform) return opt.resident === false ? P.dedOneNonResidentReform : P.dedOneResidentReform;
    return P.dedOne;
  }

  const agePct = age => (age >= 70 ? 0.4 : age >= 65 ? 0.3 : age >= 60 ? 0.2 : 0);
  const holdPct = years => (years >= 15 ? 0.5 : years >= 10 ? 0.4 : years >= 5 ? 0.2 : 0);

  function cmtTax(rows, opt) {
    const m = MODES[opt.mode] || MODES['2026'];
    const count = Math.max(rows.length, Number(opt.houseCount) || 0);
    const value = rows.reduce((s, r) => s + r.ownValue, 0);
    const deduction = deductionFor(opt);
    const base = sfloor(Math.max(0, value - deduction) * P.cmtFmv);
    const corp = opt.ownerType === '법인';
    let computed;
    if (corp) computed = base * (count >= 3 ? P.corpRate3 : P.corpRate2);
    else {
      const table = count >= 3 ? CMT_3PLUS : CMT_UPTO2;
      computed = progressive(base, m.reform ? withReformRate(table) : table);
    }
    computed = sfloor(computed);

    const propActual = rows.reduce((s, r) => s + r.ownMain, 0);
    const creditFmv = opt.oneHouse && rows[0] ? rows[0].fmv : P.fmvStd;
    const propOnCmt = base * creditFmv * P.creditStdRate;
    const propStd = progressive(rows.reduce((s, r) => s + r.ownBase, 0), PROP_STD);
    const ratio = base > 0 && propStd > 0 ? Math.min(1, propOnCmt / propStd) : 0;
    const credit = Math.min(computed, Math.round(propActual * ratio));
    const afterCredit = computed - credit;

    const eligible = opt.oneHouse && !corp;
    const aPct = eligible ? agePct(Number(opt.age) || 0) : 0;
    const hPct = eligible ? holdPct(Number(opt.holdYears) || 0) : 0;
    const creditPct = Math.min(P.creditMax, aPct + hPct);
    const seniorCredit = sfloor(afterCredit * creditPct);
    const beforeCap = afterCredit - seniorCredit;

    const prev = Number(opt.prevTotal) || 0;
    const capApplies = prev > 0 && !corp;
    const decided = capApplies ? Math.max(0, Math.min(beforeCap, sfloor(prev * P.cmtCap - propActual))) : beforeCap;
    const nong = sfloor(decided * P.nongRate);
    return {
      count, value, deduction, base, computed, propActual, creditFmv, propOnCmt, propStd, ratio, credit, afterCredit,
      agePct: aPct, holdPct: hPct, creditPct, seniorCredit, beforeCap, capReduction: beforeCap - decided, decided, nong,
      total: decided + nong,
    };
  }

  function installmentPortion(amount) {
    if (amount <= P.installMin) return 0;
    if (amount <= P.installHalf) return amount - P.installMin;
    return Math.floor(amount / 2);
  }

  /**
   * @param {{mode?:string, ownerType?:'개인'|'법인', oneHouse?:boolean, resident?:boolean, age?:number, holdYears?:number,
   *          houseCount?:number, prevTotal?:number, houses:Array<{price:number, share?:number, urban?:boolean, prevPrice?:number}>}} input
   */
  function calc(input) {
    const opt = { mode: '2026', ownerType: '개인', ...input };
    if (opt.ownerType === '법인') opt.oneHouse = false;
    if ((opt.houses || []).length !== 1) opt.oneHouse = false; // 1세대1주택은 1채일 때만(부속토지·상속주택 특례 등은 별도 확인)
    if ((Number(opt.houseCount) || 0) > 1) opt.oneHouse = false; // 목록 밖 주택이 있으면 1세대1주택이 아니다
    const rows = (opt.houses || []).filter(h => Number(h.price) > 0).map(h => ownerShare(propertyTax(h, opt), h.share));
    const prop = rows.reduce((a, r) => ({
      main: a.main + r.ownMain, urban: a.urban + r.ownUrban, edu: a.edu + r.ownEdu, total: a.total + r.ownTotal,
    }), { main: 0, urban: 0, edu: 0, total: 0 });
    const cmt = rows.length ? cmtTax(rows, opt) : null;
    const julyOnly = prop.main <= P.julyOnlyMax;
    const half = julyOnly ? prop.total : Math.ceil(prop.total / 2);
    const year = (MODES[opt.mode] || MODES['2026']).year;
    const schedule = [
      { month: 7, due: '7.16 ~ 7.31', item: julyOnly ? '주택 재산세 전액(20만원 이하)·도시지역분·교육세' : '주택 재산세 1/2·도시지역분·교육세', amount: half },
      { month: 9, due: '9.16 ~ 9.30', item: '주택 재산세 나머지 1/2', amount: prop.total - half },
      { month: 12, due: '12.1 ~ 12.15', item: '종합부동산세·농어촌특별세', amount: cmt ? cmt.total : 0 },
    ].filter(s => s.amount > 0);
    return { mode: opt.mode, year, opt, rows, prop, cmt, total: prop.total + (cmt ? cmt.total : 0), schedule, cmtInstallment: cmt ? installmentPortion(cmt.decided) : 0 };
  }

  const BASIS = Object.freeze([
    { item: '주택 재산세 과세표준', rule: '공시가격 × 60% (2026년 1세대1주택 43·44·45%), 직전 연도 대비 5% 과세표준상한', law: '지방세법 제110조, 시행령 제109조·제109조의2' },
    { item: '주택 재산세 세율', rule: '6천만 이하 0.1% · 1.5억 이하 6만+0.15% · 3억 이하 19.5만+0.25% · 초과 57만+0.4%', law: '지방세법 제111조①3' },
    { item: '1세대1주택 특례세율', rule: '공시가격 9억 이하: 0.05% · 0.1% · 0.2% · 0.35% (2026년분까지, 정부안은 2029년까지 연장)', law: '지방세법 제111조의2, 부칙(법률 제17769호) 제2조' },
    { item: '종부세 공제·과세표준', rule: '(공시가격 합계 − 12억[1세대1주택]·9억[개인]·0[법인]) × 60%', law: '종부세법 제8조, 시행령 제2조의4' },
    { item: '종부세 세율', rule: '2주택 이하 0.5~2.7%, 3주택 이상 0.5~5.0% 누진 / 법인 2.7%·5%', law: '종부세법 제9조①②' },
    { item: '공제할 재산세액', rule: '부과 재산세 × (과표 × 재산세 공정시장가액비율 × 0.4%) ÷ 합산 과세표준의 표준세율 재산세', law: '종부세법 제9조③, 시행령 제4조의3' },
    { item: '1세대1주택 세액공제', rule: '60·65·70세 20·30·40% + 보유 5·10·15년 20·40·50%, 합계 80% 한도', law: '종부세법 제9조⑤~⑧' },
    { item: '세부담상한', rule: '개인: (재산세+종부세) 직전 연도 상당액 × 150% 초과분 제외 / 법인 중과세율분 미적용', law: '종부세법 제10조' },
    { item: '농어촌특별세', rule: '종부세 결정세액 × 20%', law: '농어촌특별세법 제5조' },
    { item: '납기', rule: '재산세 7.16~7.31·9.16~9.30 각 1/2(20만원 이하는 7월 한 번에) · 종부세 12.1~12.15', law: '지방세법 제115조, 종부세법 제16조' },
  ]);

  return Object.freeze({ VERSION, MODES, P, PROP_STD, PROP_ONE, CMT_UPTO2, CMT_3PLUS, BASIS, progressive, fmvFor, specialRateApplies, propertyTax, calc, installmentPortion, agePct, holdPct });
}));
