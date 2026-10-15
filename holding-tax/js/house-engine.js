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
 *  · 소방분 지역자원시설세: 주택 건축물 부분 시가표준액 × 주택 공정시장가액비율에 0.04~0.12% 누진(§146③④),
 *      재산세 납기(7·9월 1/2)·분할납부·150% 상한 준용(§147②)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./relief.js'));
  else root.HouseTax = factory(root.HTMRelief);
}(typeof self !== 'undefined' ? self : this, function (RL) {
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

  /**
   * 주택별 특례 구분 — 종부세 과세표준 합산·주택 수·1세대1주택 판정에 쓰인다 (2026-10-15 확인)
   *  excludeValue: 종부세 과세표준에서 뺀다(합산배제) / excludeCount: 세율 판정 주택 수에서 뺀다
   *  keepOneHouse: 다른 1주택과 함께 있어도 1세대1주택자로 본다(종부세법 §8④) — 세액공제는 이 주택분 제외(§9⑦⑨)
   */
  const KINDS = Object.freeze({
    none: { label: '일반 주택' },
    rentalExclusion: {
      label: '종부세 합산배제 임대주택', excludeValue: true, excludeCount: true, keepOneHouse: true,
      law: '종부세법 제8조②1, 시행령 제3조·제4조의3③3가',
      need: '등록 임대사업자·사업자등록, 임대개시 당시 공시가격 수도권 6억(지방 3억) 이하(매입임대), 의무임대기간, 임대료 증액 5% 이내, 9.16~9.30 합산배제 신고',
    },
    inherited: {
      label: '상속주택', excludeCount: true, keepOneHouse: true,
      law: '종부세법 제8조④3, 시행령 제4조의2②·제4조의3③3나',
      need: '상속개시 5년 이내, 또는 지분 40% 이하, 또는 지분 공시가격 6억(수도권 밖 3억) 이하',
    },
    regionalLow: {
      label: '지방 저가주택', excludeCount: true, keepOneHouse: true,
      law: '종부세법 제8조④4, 시행령 제4조의2③',
      need: '공시가격 4억 이하, 수도권·광역시·특별자치시 밖(광역시 군·세종 읍면 등 포함)',
    },
    temporary: {
      label: '일시적 2주택 — 신규주택', excludeCount: true, keepOneHouse: true,
      law: '종부세법 제8조④2, 시행령 제4조의2①·제4조의3③3라',
      need: '신규주택 취득일부터 3년(조정대상지역 간 이동은 2년) 이내, 종전주택을 아직 양도하지 않음',
    },
    smallNew: {
      label: '주택 수 제외 주택(소형 신축·지방 미분양·인구감소지역)', excludeCount: true,
      law: '종부세법 시행령 제4조의3③3바',
      need: '2024.1.10~2027.12.31 취득 소형 신축(전용 60㎡·6억[지방 3억] 이하) 또는 지방 준공후 미분양(85㎡·7억 이하), 2026년 이후 취득 인구감소지역 주택 등',
    },
  });
  const kindOf = h => (Object.prototype.hasOwnProperty.call(KINDS, h.kind) ? h.kind : 'none');
  const FIRE_BRACKETS = Object.freeze([[6e6, 4e-4], [13e6, 5e-4], [26e6, 6e-4], [39e6, 8e-4], [64e6, 1e-3], [Infinity, 1.2e-3]]);
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
    const one = Boolean(opt.oneHouse) && h.isMain !== false; // 1세대1주택 재산세 특례는 주된 1주택에만
    const fmv = fmvFor(price, one, opt.mode);
    const rawBase = sfloor(price * fmv);
    const prev = Number(h.prevPrice) || 0;
    const capBase = prev > 0 ? sfloor(prev * fmv + rawBase * P.capRate) : Infinity;
    const base = Math.min(rawBase, capBase);
    const special = specialRateApplies(price, one, opt.mode);
    const main = sfloor(progressive(base, special ? PROP_ONE : PROP_STD));
    const stdMain = progressive(base, PROP_STD);
    const urban = h.urban === false ? 0 : sfloor(base * P.urbanRate);
    const edu = sfloor(main * P.eduRate);
    const bldValue = Number(h.bldValue) || 0;
    const fireBase = sfloor(bldValue * fmv);
    const fireRaw = sfloor(progressive(fireBase, FIRE_BRACKETS));
    const prevFire = Number(h.prevFire) || 0; // 내 몫 기준 → 100%로 환산은 ownerShare에서
    return { price, kind: kindOf(h), isMain: h.isMain !== false, fmv, rawBase, base, capped: base < rawBase, special, main, stdMain, urban, edu, bldValue, fireBase, fireRaw, prevFire, total: main + urban + edu };
  }

  /** 지분만큼 귀속 — 재산세는 주택 전체에 세율을 적용한 뒤 지분으로 나눈다 */
  function ownerShare(t, share, h = {}) {
    const k = (Number(share) > 0 ? Math.min(100, Number(share)) : 100) / 100;
    const main0 = sfloor(t.main * k), urban0 = sfloor(t.urban * k);
    // 장기일반·공공지원민간임대주택 재산세 감면(지특법 §31의3④) — 감면 제외 가액을 넘으면 적용하지 않는다
    const rule = RL.rentalRule(h.rentalSize);
    const cap = RL.rentalCap(h.region, h.construction);
    const capped = Boolean(rule) && t.price > cap;
    const cut = rule && !capped ? RL.apply({ main: main0, urban: urban0 }, rule) : { rate: 0, mainCut: 0, urbanCut: 0, minTax: false };
    const main = main0 - cut.mainCut, urban = urban0 - cut.urbanCut, edu = sfloor(main * P.eduRate);
    const relief = rule ? { ...rule, ...cut, overCap: capped, cap, eduCut: sfloor(t.edu * k) - edu, total: cut.mainCut + cut.urbanCut + (sfloor(t.edu * k) - edu) } : null;
    const fireOwn = sfloor(t.fireRaw * k);
    const fire = t.prevFire > 0 ? Math.min(fireOwn, sfloor(t.prevFire * P.cmtCap)) : fireOwn; // 소방분 150% 상한(§147②)
    return { ...t, share: k * 100, relief, ownMain: main, ownUrban: urban, ownEdu: edu, ownFire: fire, ownTotal: main + urban + edu + fire, ownValue: t.price * k, ownBase: t.base * k };
  }

  /** 단일세율(2.7%·5%) 법인 — 공익법인·공공주택사업자 등 일반 누진세율 법인(§9②1·2)은 개인과 같이 계산 */
  const flatCorp = opt => opt.ownerType === '법인' && !opt.corpGeneral;

  function deductionFor(opt) {
    const m = MODES[opt.mode] || MODES['2026'];
    if (flatCorp(opt)) return P.dedCorp;
    if (opt.ownerType === '법인') return P.dedPerson;
    if (!opt.oneHouse) return P.dedPerson;
    if (m.reform) return opt.resident === false ? P.dedOneNonResidentReform : P.dedOneResidentReform;
    return P.dedOne;
  }

  const agePct = age => (age >= 70 ? 0.4 : age >= 65 ? 0.3 : age >= 60 ? 0.2 : 0);
  const holdPct = years => (years >= 15 ? 0.5 : years >= 10 ? 0.4 : years >= 5 ? 0.2 : 0);

  function cmtTax(allRows, opt) {
    const m = MODES[opt.mode] || MODES['2026'];
    const rows = allRows.filter(r => !KINDS[r.kind].excludeValue);
    const excluded = allRows.filter(r => KINDS[r.kind].excludeValue);
    const counted = allRows.filter(r => !KINDS[r.kind].excludeCount).length;
    const unlisted = Math.max(0, (Number(opt.houseCount) || 0) - allRows.length);
    const count = counted + unlisted;
    const value = rows.reduce((s, r) => s + r.ownValue, 0);
    const deduction = deductionFor(opt);
    const base = sfloor(Math.max(0, value - deduction) * P.cmtFmv);
    const corp = flatCorp(opt);
    let computed;
    if (corp) computed = base * (count >= 3 ? P.corpRate3 : P.corpRate2);
    else {
      const table = count >= 3 ? CMT_3PLUS : CMT_UPTO2;
      computed = progressive(base, m.reform ? withReformRate(table) : table);
    }
    computed = sfloor(computed);

    const propActual = rows.reduce((s, r) => s + r.ownMain, 0);
    const main = rows.find(r => r.isMain) || rows[0];
    const creditFmv = opt.oneHouse && main ? main.fmv : P.fmvStd;
    const propOnCmt = base * creditFmv * P.creditStdRate;
    const propStd = progressive(rows.reduce((s, r) => s + r.ownBase, 0), PROP_STD);
    const ratio = base > 0 && propStd > 0 ? Math.min(1, propOnCmt / propStd) : 0;
    const credit = Math.min(computed, Math.round(propActual * ratio));
    const afterCredit = computed - credit;

    const eligible = opt.oneHouse && opt.ownerType !== '법인';
    const aPct = eligible ? agePct(Number(opt.age) || 0) : 0;
    const hPct = eligible ? holdPct(Number(opt.holdYears) || 0) : 0;
    const creditPct = Math.min(P.creditMax, aPct + hPct);
    // 상속주택·지방 저가주택·일시적 2주택 신규주택분 산출세액은 세액공제에서 뺀다(공시가격 비율 안분, §9⑦⑨)
    const mainShare = eligible && main && value > 0 ? main.ownValue / value : 1;
    const seniorCredit = sfloor(afterCredit * mainShare * creditPct);
    const beforeCap = afterCredit - seniorCredit;

    const prev = Number(opt.prevTotal) || 0;
    const capApplies = prev > 0 && !corp;
    const decided = capApplies ? Math.max(0, Math.min(beforeCap, sfloor(prev * P.cmtCap - propActual))) : beforeCap;
    const nong = sfloor(decided * P.nongRate);
    return {
      count, unlisted, excluded: excluded.map(r => ({ price: r.price, value: r.ownValue })), value, deduction, base, computed, propActual,
      creditFmv, propOnCmt, propStd, ratio, credit, afterCredit, mainShare,
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
    const listed = (opt.houses || []).filter(h => Number(h.price) > 0);
    // 1세대1주택: 일반 주택이 1채이고, 나머지는 §8④·합산배제 주택뿐이며, 목록 밖 주택이 없을 때
    const regular = listed.filter(h => !KINDS[kindOf(h)].keepOneHouse);
    const oneHouseOk = opt.ownerType !== '법인' && regular.length === 1 && !((Number(opt.houseCount) || 0) > listed.length);
    if (!oneHouseOk) opt.oneHouse = false;
    const mainHouse = regular[0];
    const rows = listed.map(h => ownerShare(propertyTax({ ...h, isMain: h === mainHouse }, opt), h.share, h));
    const prop = rows.reduce((a, r) => ({
      main: a.main + r.ownMain, urban: a.urban + r.ownUrban, edu: a.edu + r.ownEdu, fire: a.fire + r.ownFire, total: a.total + r.ownTotal,
    }), { main: 0, urban: 0, edu: 0, fire: 0, total: 0 });
    // 부부 공동명의 각자 과세(jointEach): 재산세는 세대 1주택 특례, 종부세는 각자 9억 공제·세액공제 없음
    const cmt = rows.length ? cmtTax(rows, opt.jointEach ? { ...opt, oneHouse: false } : opt) : null;
    const julyOnly = prop.main + prop.urban <= P.julyOnlyMax;
    const half = julyOnly ? prop.total : Math.ceil(prop.total / 2);
    const year = (MODES[opt.mode] || MODES['2026']).year;
    const schedule = [
      { month: 7, due: '7.16 ~ 7.31', item: julyOnly ? '주택 재산세 전액(20만원 이하)·도시지역분·교육세·소방분' : '주택 재산세 1/2·도시지역분·교육세·소방분', amount: half },
      { month: 9, due: '9.16 ~ 9.30', item: '주택 재산세 나머지 1/2', amount: prop.total - half },
      { month: 12, due: '12.1 ~ 12.15', item: '종합부동산세·농어촌특별세', amount: cmt ? cmt.total : 0 },
    ].filter(s => s.amount > 0);
    const relief = rows.filter(r => r.relief).reduce((a, r) => a + r.relief.total, 0);
    return { mode: opt.mode, year, opt, rows, prop, cmt, relief, total: prop.total + (cmt ? cmt.total : 0), schedule, cmtInstallment: cmt ? installmentPortion(cmt.decided) : 0 };
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
    { item: '합산배제 임대주택', rule: '요건을 갖춘 등록 임대주택은 종부세 과세표준·주택 수에서 제외(9.16~9.30 신고)', law: '종부세법 제8조②, 시행령 제3조' },
    { item: '1세대1주택 특례 유지', rule: '일시적 2주택 신규주택·상속주택·지방 저가주택을 함께 가져도 1세대1주택자(12억 공제), 세액공제는 해당 주택분 제외', law: '종부세법 제8조④·제9조⑦⑨, 시행령 제4조의2' },
    { item: '주택 수 제외', rule: '합산배제·상속(요건)·일시적 2주택 신규·지방 저가·소형 신축·지방 미분양·인구감소지역 주택은 세율 판정 주택 수에서 제외', law: '종부세법 시행령 제4조의3③' },
    { item: '임대주택 재산세 감면', rule: '장기일반·공공지원민간임대: 전용 40㎡ 이하 면제, 60㎡ 이하 75%, 85㎡ 이하 50% (공시가격 수도권 6억·지방 3억 초과 제외)', law: '지방세특례제한법 제31조의3④' },
    { item: '최소납부세제', rule: '재산세 면제라도 산출액 50만원 초과면 85%만 감면', law: '지방세특례제한법 제177조의2' },
    { item: '부부 공동명의 1주택 특례', rule: '부부 공동명의 1주택은 신청 시 지분 큰 1인을 납세의무자로 보아 1세대1주택(12억 공제·고령자·장기보유 공제)으로 계산', law: '종부세법 제10조의2' },
    { item: '공익법인 등 법인', rule: '공익법인·공공주택사업자 등은 일반 누진세율·9억 공제 적용', law: '종부세법 제9조②1·2' },
    { item: '납기', rule: '재산세 7.16~7.31·9.16~9.30 각 1/2(20만원 이하는 7월 한 번에) · 종부세 12.1~12.15', law: '지방세법 제115조, 종부세법 제16조' },
    { item: '소방분 지역자원시설세', rule: '주택 건물 시가표준액 × 주택 공정시장가액비율에 0.04~0.12% 누진, 재산세 납기·분할납부·150% 상한 준용', law: '지방세법 제146조③④·제147조②' },
    { item: '분할납부·분납', rule: '재산세 납기별 250만원 초과: 500만원 이하는 초과분, 초과는 50% 이하를 3개월 이내 / 종부세 6개월 이내', law: '지방세법 제118조, 시행령 제116조, 종부세법 제20조' },
  ]);

  return Object.freeze({ VERSION, KINDS, MODES, P, PROP_STD, PROP_ONE, CMT_UPTO2, CMT_3PLUS, BASIS, progressive, fmvFor, specialRateApplies, propertyTax, calc, installmentPortion, agePct, holdPct });
}));
