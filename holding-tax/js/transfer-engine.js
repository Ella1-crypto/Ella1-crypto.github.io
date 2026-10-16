/* 양도소득세(개인)·법인 부동산 처분 세금 엔진 — 2026-10-15 현행 조문 확인
 * 순수 함수(브라우저: window.TransferTax / Node: module.exports).
 *
 *  · 1세대1주택 비과세: 보유 2년(취득 당시 조정대상지역이면 거주 2년), 실거래가 12억 초과분만 과세(소득세법 §89①3, §95③, 시행령 §154·§160)
 *  · 장기보유특별공제: 표1 3년 6%~15년 30% / 표2(1세대1주택·거주 2년) 보유 4%·거주 4%(2~3년 거주 8%), 각 40%·합계 80% (§95②)
 *    미등기·다주택 중과 대상은 없음
 *  · 세율(§104): 기본 6~45% / 토지·건물 1년 미만 50%·2년 미만 40% / 주택·입주권·분양권 1년 미만 70%·2년 미만 60%
 *    분양권 2년 이상 60% / 비사업용 토지 +10%p / 조정대상지역 다주택 2주택 +20%p·3주택 이상 +30%p / 미등기 70%
 *    — 여러 세율이 겹치면 산출세액이 큰 쪽. 다주택 중과 한시 배제는 2026.5.9.로 종료(시행령 §167의3①12의2)
 *  · 기본공제 250만원(미등기 제외, §103) · 개인지방소득세 = 산출세액의 10%(지방세법 §103의3)
 *  · 예정신고: 양도일이 속하는 달의 말일부터 2개월(§105), 지방소득세는 그 후 2개월(지방세법 §103의5)
 *  · 조특법 감면: 8년 자경농지 100%(연 1억 한도, 농특세 비과세, §69·§133) / 공익사업 수용 현금 15%·채권 20%·
 *    3년 만기 35%·5년 만기 45%(연 2억 한도, 농특세 20%, §77·§133) — 2026.12.31. 양도분까지
 *  · 법인: 법인세 10·20·22·25%(2026 사업연도, 법인세법 §55) + 토지등 양도소득 추가과세 주택·분양권 20%, 비사업용 토지 10%,
 *    미등기 40%(§55의2) + 법인지방소득세 각 10%(지방세법 §103의20·§103의31)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TransferTax = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSION = '2026-10-15';
  const HIGH_PRICE = 1.2e9;
  const BASIC_DEDUCTION = 2.5e6;
  // [구간 상한, 세율, 누진공제]
  const BASIC = Object.freeze([
    [1.4e7, 0.06, 0], [5e7, 0.15, 1.26e6], [8.8e7, 0.24, 5.76e6], [1.5e8, 0.35, 1.544e7],
    [3e8, 0.38, 1.994e7], [5e8, 0.40, 2.594e7], [1e9, 0.42, 3.594e7], [Infinity, 0.45, 6.594e7],
  ]);
  const CORP = Object.freeze([[2e8, 0.10], [2e10, 0.20], [3e11, 0.22], [Infinity, 0.25]]);
  const CORP_SMALL_RENTAL = Object.freeze([[2e10, 0.20], [3e11, 0.22], [Infinity, 0.25]]);
  const ASSETS = Object.freeze({
    house: '주택(부수토지 포함)',
    land: '토지',
    building: '건물·상가',
    membership: '조합원입주권',
    presale: '분양권',
  });
  const RELIEFS = Object.freeze({
    none: { label: '없음' },
    farm8: { label: '8년 이상 재촌·자경 농지 (100%, 연 1억 한도)', rate: 1, cap: 1e8, nong: false, assets: ['land'], law: '조세특례제한법 제69조·제133조①' },
    expropCash: { label: '공익사업 수용 — 현금 보상 (15%)', rate: 0.15, cap: 2e8, nong: true, law: '조세특례제한법 제77조·제133조②' },
    expropBond: { label: '공익사업 수용 — 채권 보상 (20%)', rate: 0.2, cap: 2e8, nong: true, law: '조세특례제한법 제77조·제133조②' },
    expropBond3: { label: '공익사업 수용 — 채권 3년 만기보유 (35%)', rate: 0.35, cap: 2e8, nong: true, law: '조세특례제한법 제77조·제133조②' },
    expropBond5: { label: '공익사업 수용 — 채권 5년 만기보유 (45%)', rate: 0.45, cap: 2e8, nong: true, law: '조세특례제한법 제77조·제133조②' },
  });

  const floor = n => Math.floor(n + 1e-6);
  const basicTax = base => {
    if (base <= 0) return 0;
    const [, rate, ded] = BASIC.find(([upper]) => base <= upper);
    return base * rate - ded;
  };
  const surchargeTax = (base, add) => (base > 0 ? basicTax(base) + base * add : 0);
  function progressive(base, table) {
    let tax = 0, lower = 0;
    for (const [upper, rate] of table) {
      if (base <= lower) break;
      tax += (Math.min(base, upper) - lower) * rate;
      lower = upper;
    }
    return tax;
  }

  /** 만 보유연수 — 취득일 다음 날부터 기산, 양도일까지 */
  function fullYears(from, to) {
    const a = new Date(from), b = new Date(to);
    if (!(a < b)) return 0;
    let y = b.getFullYear() - a.getFullYear();
    if (b.getMonth() < a.getMonth() || (b.getMonth() === a.getMonth() && b.getDate() < a.getDate())) y -= 1;
    return Math.max(0, y);
  }

  /** 장기보유특별공제율 */
  function longTermRate({ years, residenceYears, table2 }) {
    if (years < 3) return { rate: 0, hold: 0, live: 0, table: 0 };
    if (!table2) return { rate: Math.min(0.3, 0.02 * years), hold: Math.min(0.3, 0.02 * years), live: 0, table: 1 };
    const hold = Math.min(0.4, 0.04 * years);
    const r = residenceYears;
    const live = r >= 3 ? Math.min(0.4, 0.04 * r) : r >= 2 ? 0.08 : 0;
    return { rate: Math.min(0.8, hold + live), hold, live, table: 2 };
  }

  const pad = n => String(n).padStart(2, '0');
  /** 그 달 말일부터 n개월 뒤 말일 */
  function monthEndPlus(dateStr, n) {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return '';
    const end = new Date(d.getFullYear(), d.getMonth() + 1 + n, 0);
    return `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}`;
  }

  /** 개인 양도소득세 — 한 가지 취득가액·취득일 가정으로 계산 */
  function individualCore(x) {
    const notes = [];
    const price = Number(x.price) || 0;
    const cost = Number(x.cost) || 0;
    const expense = Number(x.expense) || 0;
    const DAY = /^\d{4}-\d{2}-\d{2}$/;
    if (!DAY.test(x.acqDate || '') || !DAY.test(x.saleDate || '') || !(new Date(x.acqDate) < new Date(x.saleDate))) {
      // 날짜가 없거나 앞뒤가 바뀌면 보유기간을 알 수 없으므로 단기세율로 추정하지 않는다
      const gain0 = Math.max(0, price - cost - expense);
      return {
        seller: '개인', price, cost, expense, gain: gain0, years: 0, residence: 0, under1: false, under2: false, exempt: false, highRatio: 1,
        taxableGain: 0, oneHouseOk: false, heavyAdd: 0, lt: { rate: 0, hold: 0, live: 0, table: 0 }, longTerm: 0, income: 0, basic: 0, base: 0,
        rateLabel: '', candidates: [], computed: 0, relief: null, decided: 0, nong: 0, local: 0, total: 0,
        due: { national: '', local: '' }, missingDates: true,
        notes: ['취득일과 양도일(취득일보다 뒤)을 넣어야 보유기간·세율을 판정할 수 있습니다.'],
      };
    }
    const years = fullYears(x.acqDate, x.saleDate);
    const heldMonths = (() => {
      const a = new Date(x.acqDate), b = new Date(x.saleDate);
      return a < b ? (b - a) / (30.4375 * 24 * 3600 * 1000) : 0;
    })();
    const under1 = heldMonths < 12 && years < 1;
    const under2 = years < 2;
    const isHouse = x.asset === 'house';
    const isRights = x.asset === 'membership' || x.asset === 'presale';
    const gain = Math.max(0, price - cost - expense);
    const residence = Math.min(Number(x.residenceYears) || 0, years); // 거주기간은 보유기간을 넘을 수 없다

    // 1세대1주택 비과세
    let exempt = false, taxableGain = gain, highRatio = 1;
    // 일시적 2주택(종전주택 양도)은 1세대1주택 비과세 특례(시행령 제155조①)
    const temp2 = isHouse && x.temporary2 && Number(x.houseCount) === 2;
    if (temp2) notes.push('일시적 2주택 — 종전주택을 신규주택 취득 후 3년(둘 다 조정대상지역이면 2년) 안에 팔면 1세대1주택으로 봅니다(소득세법 시행령 제155조①).');
    const oneHouseTry = isHouse && (x.oneHouse || temp2) && !x.unregistered;
    if (oneHouseTry) {
      const holdOk = years >= 2;
      const liveOk = !x.adjustedAtAcq || residence >= 2;
      if (holdOk && liveOk) {
        if (price <= HIGH_PRICE) { exempt = true; taxableGain = 0; notes.push('1세대1주택 비과세(양도가액 12억 이하)'); }
        else { highRatio = (price - HIGH_PRICE) / price; taxableGain = floor(gain * highRatio); notes.push(`고가주택 — 12억 초과분 ${(highRatio * 100).toFixed(2)}%만 과세`); }
      } else {
        notes.push(!holdOk ? '보유 2년 미만이라 1세대1주택 비과세가 안 됩니다' : '취득 당시 조정대상지역이라 거주 2년이 필요합니다');
      }
    }
    const oneHouseOk = oneHouseTry && (exempt || highRatio < 1);

    // 다주택 중과 여부
    const heavyAdd = isHouse && !oneHouseOk && x.adjustedNow && !x.heavyExcluded && Number(x.houseCount) >= 2
      ? (Number(x.houseCount) >= 3 ? 0.3 : 0.2) : 0;

    // 장기보유특별공제
    const ltNone = x.unregistered || heavyAdd > 0 || isRights;
    let lt = ltNone ? { rate: 0, hold: 0, live: 0, table: 0 } : longTermRate({ years, residenceYears: residence, table2: oneHouseOk && residence >= 2 });
    let longTerm = floor(taxableGain * lt.rate);
    // 조합원입주권: 관리처분계획인가 전 양도차익(권리가액 − 취득가액 − 필요경비)만 종전주택 보유기간으로 장특공(소득세법 제95조①, 시행령 제166조⑤)
    let preGain = 0;
    if (x.asset === 'membership' && !x.unregistered && DAY.test(x.approvalDate || '') && Number(x.rightValue) > 0 && x.approvalDate > x.acqDate && x.approvalDate <= x.saleDate) {
      const preYears = fullYears(x.acqDate, x.approvalDate);
      preGain = Math.min(taxableGain, Math.max(0, Number(x.rightValue) - cost - expense));
      lt = longTermRate({ years: preYears, residenceYears: 0, table2: false });
      longTerm = floor(preGain * lt.rate);
      notes.push(`조합원입주권 — 관리처분인가 전 차익 ${Math.round(preGain).toLocaleString('ko-KR')}원에만 장기보유특별공제(종전주택 보유 ${preYears}년)`);
    }
    const income = taxableGain - longTerm;
    const basic = x.unregistered || x.basicUsed ? 0 : Math.min(BASIC_DEDUCTION, income);
    const base = Math.max(0, income - basic);

    // 세율 후보 — 가장 큰 산출세액
    const cands = [];
    if (x.unregistered) cands.push({ label: '미등기 70%', tax: base * 0.7 });
    else {
      if (isHouse || isRights) {
        if (under1) cands.push({ label: '보유 1년 미만 70%', tax: base * 0.7 });
        else if (under2) cands.push({ label: '보유 2년 미만 60%', tax: base * 0.6 });
        else if (x.asset === 'presale') cands.push({ label: '분양권 60%', tax: base * 0.6 });
      } else {
        if (under1) cands.push({ label: '보유 1년 미만 50%', tax: base * 0.5 });
        else if (under2) cands.push({ label: '보유 2년 미만 40%', tax: base * 0.4 });
      }
      // 같은 해 먼저 판 건이 있으면 과세표준을 합산해 누진세율로 늘어난 몫만 이번 건 세액으로 본다(소득세법 제92조·제104조⑤)
      const prior = Math.max(0, Number(x.priorBase) || 0);
      const progressiveTax = add => (base > 0 ? basicTax(prior + base) - basicTax(prior) + base * add : 0);
      if (x.asset === 'land' && x.nonBusinessLand) cands.push({ label: '비사업용 토지 기본세율 +10%p', tax: progressiveTax(0.1) });
      if (heavyAdd) cands.push({ label: `조정대상지역 ${Number(x.houseCount) >= 3 ? '3주택 이상 +30%p' : '2주택 +20%p'}`, tax: progressiveTax(heavyAdd) });
      cands.push({ label: prior ? '기본세율 6~45% (같은 해 합산)' : '기본세율 6~45%', tax: progressiveTax(0) });
    }
    const pick = cands.reduce((a, b) => (b.tax > a.tax ? b : a), { label: '', tax: 0 });
    const computed = floor(pick.tax);

    // 조특법 감면
    const relDef = Object.prototype.hasOwnProperty.call(RELIEFS, x.relief) && RELIEFS[x.relief].rate ? RELIEFS[x.relief] : null;
    const rel = relDef && (!relDef.assets || relDef.assets.includes(x.asset)) ? relDef : null;
    if (relDef && !rel) notes.push(`${relDef.label}: 토지에만 적용됩니다 — 적용하지 않았습니다.`);
    const reliefAmount = rel ? Math.min(floor(computed * rel.rate), rel.cap) : 0;
    const nong = rel && rel.nong ? floor(reliefAmount * 0.2) : 0;
    const decided = computed - reliefAmount;
    const local = floor(decided * 0.1);
    const due = monthEndPlus(x.saleDate, 2);
    return {
      seller: '개인', price, cost, expense, gain, years, residence, under1, under2, exempt, highRatio, taxableGain,
      oneHouseOk, heavyAdd, lt, longTerm, preGain, income, basic, base, rateLabel: pick.label, candidates: cands.map(c => ({ ...c, tax: floor(c.tax) })),
      computed, relief: rel ? { ...rel, amount: reliefAmount } : null, decided, nong, local,
      total: decided + nong + local,
      due: { national: due, local: monthEndPlus(x.saleDate, 4) },
      notes,
    };
  }

  const CONVERSION_DEEMED = 0.03;    // 개산공제: 취득 당시 기준시가 × 3%(미등기 0.3%)
  const CARRYOVER_YEARS = 10;        // 2023.1.1. 이후 증여분
  const CARRYOVER_YEARS_OLD = 5;     // 2022.12.31. 이전 증여분
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const fmtWon = n => Math.round(n).toLocaleString('ko-KR');

  /** 환산취득가액(소득세법 제97조②, 시행령 제163조⑥·제176조의2②) */
  function conversion(x) {
    const acqStd = Number(x.acqStd) || 0, saleStd = Number(x.saleStd) || 0, price = Number(x.price) || 0;
    if (!(acqStd > 0 && saleStd > 0)) return null;
    const cost = floor(price * acqStd / saleStd);
    const deemed = floor(acqStd * (x.unregistered ? 0.003 : CONVERSION_DEEMED));
    const actual = Number(x.expense) || 0;
    // 환산가액+개산공제 합계보다 실제 자본적지출+양도비가 크면 그쪽을 쓸 수 있다
    const useActual = actual > cost + deemed;
    return { cost: useActual ? 0 : cost, expense: useActual ? actual : deemed, converted: cost, deemed, useActual };
  }

  /** 개인 양도소득세 — 환산취득가액·이월과세까지 처리 */
  function individual(x) {
    let base = { ...x };
    const pre = [];
    if (x.useConversion) {
      const c = conversion(x);
      if (c) {
        base = { ...base, cost: c.cost, expense: c.expense };
        pre.push(c.useActual
          ? `환산취득가액 ${fmtWon(c.converted)}원 + 개산공제보다 실제 필요경비가 커서 필요경비만 공제했습니다(소득세법 제97조②2).`
          : `환산취득가액 ${fmtWon(c.converted)}원(양도가액 × 취득 당시 기준시가 ÷ 양도 당시 기준시가) + 개산공제 ${fmtWon(c.deemed)}원 (소득세법 제97조②, 시행령 제163조⑥)`);
        if (x.asset === 'building' || x.asset === 'house') pre.push('건물을 신축·증축하고 5년 안에 팔면서 환산가액을 쓰면 건물 환산가액의 5% 가산세가 붙습니다(소득세법 제114조의2) — 계산에 넣지 않았습니다.');
      } else pre.push('환산취득가액: 취득 당시·양도 당시 기준시가를 모두 넣어야 합니다.');
    }
    const plain = individualCore(base);
    const out = (r, extra) => ({ ...r, notes: [...pre, ...extra, ...r.notes] });
    if (!x.carryover) return out(plain, []);

    // 이월과세(제97조의2): 배우자·직계존비속에게 증여받아 10년 안에 팔면 증여자의 취득가액·취득일로 계산, 증여세는 필요경비
    if (!DATE_RE.test(x.donorAcqDate || '') || !(x.donorAcqDate < (x.acqDate || ''))) return out(plain, ['이월과세: 증여자의 취득일(증여일보다 앞)과 취득가액을 넣어야 합니다.']);
    const limit = (x.acqDate || '') >= '2023-01-01' ? CARRYOVER_YEARS : CARRYOVER_YEARS_OLD;
    if (fullYears(x.acqDate, x.saleDate) >= limit) return out(plain, [`증여받은 지 ${limit}년이 지나 이월과세를 적용하지 않습니다(${limit === CARRYOVER_YEARS ? '2023년 이후 증여 10년' : '2022년 이전 증여 5년'}).`]);
    if (plain.exempt) return out(plain, ['1세대1주택 비과세 대상이라 이월과세를 적용하지 않습니다(제97조의2②2).']);
    const giftTax = Number(x.giftTax) || 0;
    const carried = individualCore({ ...base, acqDate: x.donorAcqDate, cost: Number(x.donorCost) || 0, expense: (Number(base.expense) || 0) + giftTax });
    // 이월과세로 계산한 세액이 더 적으면 적용하지 않는다(제97조의2②3)
    if (carried.decided < plain.decided) return { ...out(plain, [`이월과세로 계산한 세액(${fmtWon(carried.total)}원)이 더 적어 적용하지 않습니다(제97조의2②3).`]), carryoverCompared: carried.total };
    return { ...out(carried, [`이월과세 적용 — 증여자 취득일·취득가액 기준, 증여세 ${fmtWon(giftTax)}원 필요경비 (소득세법 제97조의2). 적용하지 않으면 ${fmtWon(plain.total)}원`]), carryoverApplied: true, carryoverCompared: plain.total };
  }

  /** 법인: 각 사업연도 소득 법인세 증가분 + 토지등 양도소득 추가과세 + 법인지방소득세 */
  function corporate(x) {
    const price = Number(x.price) || 0;
    const book = Number(x.cost) || 0;
    const expense = Number(x.expense) || 0;
    const gain = price - book - expense;
    const other = Number(x.corpBase) || 0;
    const table = x.smallRental ? CORP_SMALL_RENTAL : CORP;
    const corpTax = floor(Math.max(0, progressive(other + gain, table) - progressive(other, table)));
    const addRate = x.unregistered ? 0.4
      : (x.asset === 'house' || x.asset === 'membership' || x.asset === 'presale') ? 0.2
      : x.asset === 'land' && x.nonBusinessLand ? 0.1 : 0;
    const extra = floor(Math.max(0, gain) * addRate);
    const local = floor(corpTax * 0.1) + floor(extra * 0.1);
    return {
      seller: '법인', price, book, expense, gain, other, corpTax, addRate, extra, local,
      total: corpTax + extra + local,
      notes: [
        '법인세는 각 사업연도 소득에 합산되므로 올해 다른 과세표준을 넣으면 한계세율로 계산합니다.',
        addRate ? `토지등 양도소득 추가과세 ${Math.round(addRate * 100)}% (법인세법 제55조의2)` : '상가·업무용 건물·사업용 토지는 추가과세가 없습니다.',
      ],
    };
  }

  function calc(x) {
    return x.seller === '법인' ? corporate(x) : individual(x);
  }

  const BASIS = Object.freeze([
    { item: '1세대1주택 비과세', rule: '보유 2년(취득 당시 조정대상지역이면 거주 2년), 양도가액 12억 이하 비과세·초과분 안분 과세', law: '소득세법 제89조①3·제95조③, 시행령 제154조·제160조' },
    { item: '일시적 2주택', rule: '신규주택을 종전주택 취득 1년 후 취득, 3년 내 종전주택 양도(종전·신규 모두 조정대상지역이고 신규를 2026.8.4. 이후 취득하면 2년)', law: '소득세법 시행령 제155조①, 부칙(제36737호)' },
    { item: '장기보유특별공제', rule: '표1: 3년 6%~15년 30% / 표2(1세대1주택·거주 2년): 보유 연 4%·거주 연 4%, 합계 80% / 조합원입주권은 관리처분인가 전 차익만 종전주택 보유기간으로 공제', law: '소득세법 제95조②, 시행령 제159조의4' },
    { item: '기본세율', rule: '1,400만 6% · 5,000만 15% · 8,800만 24% · 1.5억 35% · 3억 38% · 5억 40% · 10억 42% · 초과 45%', law: '소득세법 제55조①·제104조①1' },
    { item: '단기·미등기', rule: '토지·건물 1년 미만 50%·2년 미만 40% / 주택·입주권·분양권 70%·60%, 분양권 2년 이상 60% / 미등기 70%', law: '소득세법 제104조①' },
    { item: '비사업용 토지', rule: '기본세율 + 10%p (장기보유특별공제는 적용)', law: '소득세법 제104조①8·제104조의3' },
    { item: '다주택 중과', rule: '조정대상지역 2주택 +20%p, 3주택 이상 +30%p, 장기보유특별공제 배제 — 한시 배제는 2026.5.9. 양도분까지(일부 토지거래허가 계약은 2026.11.9.까지)', law: '소득세법 제104조⑦, 시행령 제167조의3·제167조의10' },
    { item: '기본공제·지방소득세', rule: '연 250만원(미등기 제외) / 개인지방소득세는 산출세액의 10%', law: '소득세법 제103조, 지방세법 제103조의3' },
    { item: '같은 해 여러 건', rule: '먼저 판 건의 과세표준을 합산해 누진세율로 늘어난 몫을 이번 건 세액으로 계산(기본공제는 연 1회)', law: '소득세법 제92조·제103조·제104조⑤' },
    { item: '환산취득가액', rule: '실지취득가액을 모를 때: 양도가액 × 취득 당시 기준시가 ÷ 양도 당시 기준시가 + 개산공제 3%(미등기 0.3%)', law: '소득세법 제97조②, 시행령 제163조⑥·제176조의2' },
    { item: '이월과세', rule: '배우자·직계존비속에게 증여받아 10년(2022년 이전 증여 5년) 안에 양도: 증여자의 취득가액·취득일 기준, 증여세는 필요경비 — 그 결과가 더 적으면 적용 배제', law: '소득세법 제97조의2' },
    { item: '신고기한', rule: '양도일이 속하는 달의 말일부터 2개월(지방소득세는 그 후 2개월), 확정신고 다음 해 5월', law: '소득세법 제105조·제110조, 지방세법 제103조의5' },
    { item: '조특법 감면', rule: '8년 자경농지 100%(연 1억) / 공익사업 수용 현금 15%·채권 20~45%(연 2억), 감면세액의 20% 농특세(자경농지 제외)', law: '조세특례제한법 제69조·제77조·제133조, 농어촌특별세법 제5조' },
    { item: '법인', rule: '법인세 10·20·22·25%(2026) + 주택·입주권·분양권 20%, 비사업용 토지 10%, 미등기 40% 추가 + 법인지방소득세 10%', law: '법인세법 제55조·제55조의2, 지방세법 제103조의20·제103조의31' },
  ]);

  return Object.freeze({ VERSION, ASSETS, RELIEFS, BASIC, CORP, BASIS, basicTax, fullYears, longTermRate, monthEndPlus, conversion, calc, individual, corporate });
}));
