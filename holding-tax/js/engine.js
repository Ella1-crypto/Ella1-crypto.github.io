/* 보유세 맵 v0.2 — 토지 보유세 엔진 + 현금흐름(CF)
 * 순수 함수만 포함(브라우저: window.HoldingTax / Node: module.exports).
 * 조문은 2026-10-15 현행본으로 재확인(지방세법 2026.1.1 시행본, 시행령 2026.10.1 시행본, 종부세법 2026.1.1 시행본).
 * 세율·공제·공정시장가액비율 변동 없음. 세율·공제는 PARAMS/BRACKETS 한 곳에서만 관리한다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HoldingTax = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PARAMS = Object.freeze({
    version: '2026-10-15',
    propFmv: 0.7,            // 지방세법 시행령 제109조 — 토지 공정시장가액비율
    cmtFmv: 1.0,             // 종부세법 시행령 제2조의4 — 토지
    cmtSepDeduction: 8e9,    // 종부세법 제13조② 별도합산 공제
    cmtJongDeduction: 5e8,   // 종부세법 제13조① 종합합산 공제
    urbanRate: 0.0014,       // 지방세법 제112조① 도시지역분(조례로 0.23%까지 가능)
    eduRate: 0.2,            // 지방세법 제151조 지방교육세
    nongRate: 0.2,           // 농어촌특별세법 제5조 — 종부세분
    capRate: 1.5,            // 지방세법 제122조, 종부세법 제15조 세부담상한
    installMin: 2.5e6,       // 지방세법 제118조, 종부세법 제20조 분납 기준
    installHalf: 5e6,        // 각 시행령 — 500만원 초과 시 50% 이하
  });

  // [구간 상한, 한계세율]
  const BRACKETS = Object.freeze({
    propSep: [[2e8, 0.002], [1e9, 0.003], [Infinity, 0.004]],     // 지방세법 제111조①1나
    propJong: [[5e7, 0.002], [1e8, 0.003], [Infinity, 0.005]],    // 지방세법 제111조①1가
    cmtSep: [[2e10, 0.005], [4e10, 0.006], [Infinity, 0.007]],    // 종부세법 제14조④
    cmtJong: [[1.5e9, 0.01], [4.5e9, 0.02], [Infinity, 0.03]],    // 종부세법 제14조①
  });

  const CLASS = Object.freeze({
    sep: { label: '별도합산' },
    jong: { label: '종합합산' },
    b007: { label: '분리 0.07%', rate: 0.0007, hint: '농지·목장용지·임야(요건 충족 시)' },
    b02: { label: '분리 0.2%', rate: 0.002, hint: '공장용지(산단·공업지역) 등' },
    b4: { label: '분리 4%', rate: 0.04, hint: '골프장·고급오락장' },
  });
  const CLASS_KEYS = Object.freeze(Object.keys(CLASS));
  const isBunri = cls => cls === 'b007' || cls === 'b02' || cls === 'b4';

  const sum = arr => arr.reduce((s, n) => s + n, 0);

  function progressive(base, brackets) {
    let tax = 0;
    let lower = 0;
    for (const [upper, rate] of brackets) {
      if (base <= lower) break;
      tax += (Math.min(base, upper) - lower) * rate;
      lower = upper;
    }
    return tax;
  }

  /** 필지 공시가격 = 공시지가(원/㎡) × 면적 × 지분 */
  function landValue(p) {
    const share = p.share == null ? 100 : p.share;
    return (p.price || 0) * (p.area || 0) * share / 100;
  }

  function groupBy(items, keyOf) {
    const map = new Map();
    for (const item of items) {
      const k = keyOf(item);
      map.set(k, [...(map.get(k) || []), item]);
    }
    return map;
  }

  const floor10 = n => Math.floor(n / 10) * 10;
  const applyCap = (tax, prevTax) => (prevTax > 0 ? Math.min(tax, prevTax * PARAMS.capRate) : tax);

  /** 재산세는 시·군·구 단위로 합산(누진) — 서로 다른 지자체 토지는 합산하지 않는다 */
  function regionTax(sgg, list) {
    const valueOf = cls => sum(list.filter(p => p.cls === cls).map(landValue));
    const sepBase = valueOf('sep') * PARAMS.propFmv;
    const jongBase = valueOf('jong') * PARAMS.propFmv;
    const bunriParcels = list.filter(p => isBunri(p.cls));
    const bunriBase = sum(bunriParcels.map(landValue)) * PARAMS.propFmv;
    const bunriTax = sum(bunriParcels.map(p => landValue(p) * PARAMS.propFmv * CLASS[p.cls].rate));
    const urban = sum(list.filter(p => p.urban !== false).map(p => landValue(p) * PARAMS.propFmv * PARAMS.urbanRate));
    return {
      sgg,
      sggName: list[0].sggName || sgg,
      sepBase, jongBase, bunriBase,
      sepTax: progressive(sepBase, BRACKETS.propSep),
      jongTax: progressive(jongBase, BRACKETS.propJong),
      bunriTax, urban,
    };
  }

  /**
   * 종부세 한 과세유형(별도/종합).
   * 공제할 재산세액(시행령 §5의3) = 부과 재산세 × (종부세 과표 × 70% × 표준세율) ÷ (토지를 합산해 표준세율로 계산한 재산세)
   * 분모는 전국 토지 과세표준을 합산해 누진 표준세율을 적용한 값("합산하여", 2024.2.29 개정 문구).
   * 표준세율은 공제액을 넘는 최상위 구간의 세율 — 별도합산 0.4%, 종합합산 0.5% (국세청 과세표준계산명세서 서식).
   * 2026-10-15 수정: 이전 판은 분자를 누진(종부세 과표 × 70%)로 계산해 공제가 작았다(종부세 과다).
   */
  function cmtPart({ value, deduction, brackets, propBrackets, propTopRate, propTax, propBase, prevTotal }) {
    const base = Math.max(0, value - deduction) * PARAMS.cmtFmv;
    const computed = progressive(base, brackets);
    const propOnCmt = base * PARAMS.propFmv * propTopRate;
    const propStd = progressive(propBase, propBrackets);
    const creditRatio = base > 0 && propStd > 0 ? Math.min(1, propOnCmt / propStd) : 0;
    const credit = Math.min(computed, propTax * creditRatio);
    const beforeCap = Math.max(0, computed - credit);
    const decided = prevTotal > 0
      ? Math.max(0, Math.min(beforeCap, prevTotal * PARAMS.capRate - propTax))
      : beforeCap;
    return { value, deduction, base, computed, propTax, propOnCmt, propStd, creditRatio, credit, beforeCap, capReduction: beforeCap - decided, decided };
  }

  /**
   * 납세자 1명의 토지 보유세.
   * @param {Array} parcels 해당 납세자 필지 [{price, area, share, cls, sgg, sggName, urban}]
   * @param {{propSep?:number, propJong?:number, cmtSep?:number, cmtJong?:number}} prev 직전연도 세액(세부담상한용, 선택)
   * @param {{sep?:number, jong?:number}} [propCut] 감면으로 줄어든 재산세 본세 — 종부세 공제할 재산세는 실제 부과액(감면 후)으로 본다
   */
  function calcTaxpayer(parcels, prev, propCut) {
    const p0 = prev || {};
    const cut = propCut || {};
    const regions = [...groupBy(parcels, p => p.sgg || '미상')].map(([sgg, list]) => regionTax(sgg, list));
    const total = key => sum(regions.map(r => r[key]));

    const sepTaxRaw = total('sepTax');
    const jongTaxRaw = total('jongTax');
    const sepTax = applyCap(sepTaxRaw, p0.propSep);
    const jongTax = applyCap(jongTaxRaw, p0.propJong);
    const bunriTax = total('bunriTax');
    const urban = total('urban');
    const main = sepTax + jongTax + bunriTax;
    const edu = main * PARAMS.eduRate;

    const valueOf = pred => sum(parcels.filter(pred).map(landValue));
    const values = {
      sep: valueOf(p => p.cls === 'sep'),
      jong: valueOf(p => p.cls === 'jong'),
      bunri: valueOf(p => isBunri(p.cls)),
    };
    values.total = values.sep + values.jong + values.bunri;

    const sep = cmtPart({
      value: values.sep, deduction: PARAMS.cmtSepDeduction, brackets: BRACKETS.cmtSep, propBrackets: BRACKETS.propSep, propTopRate: 0.004,
      propTax: Math.max(0, sepTax - (Number(cut.sep) || 0)), propBase: total('sepBase'), prevTotal: p0.cmtSep,
    });
    const jong = cmtPart({
      value: values.jong, deduction: PARAMS.cmtJongDeduction, brackets: BRACKETS.cmtJong, propBrackets: BRACKETS.propJong, propTopRate: 0.005,
      propTax: Math.max(0, jongTax - (Number(cut.jong) || 0)), propBase: total('jongBase'), prevTotal: p0.cmtJong,
    });
    const decided = sep.decided + jong.decided;
    const nong = decided * PARAMS.nongRate;

    // 고지서 끝수: 세목별 원 미만 버림 → 재산세 합계·지방교육세 10원 미만 절사 (실제 고지서로 대사)
    const noticeMain = Math.floor(sepTax) + Math.floor(jongTax) + Math.floor(bunriTax);
    const noticeProp = floor10(noticeMain + Math.floor(urban));
    const noticeEdu = floor10(noticeMain * PARAMS.eduRate);
    const prop = {
      sepBase: total('sepBase'), jongBase: total('jongBase'), bunriBase: total('bunriBase'),
      sepTaxRaw, sepTax, jongTaxRaw, jongTax, bunriTax, urban, edu, main,
      total: main + urban + edu,
      notice: { prop: noticeProp, edu: noticeEdu, total: noticeProp + noticeEdu },
    };
    const cmt = { sep, jong, decided, nong, total: decided + nong };
    return { regions, values, prop, cmt, total: prop.total + cmt.total };
  }

  /** 물건은 한 번 저장하고 계산 경계에서만 소유권별 행으로 펼친다. */
  function ownershipRows(parcels) {
    return parcels.flatMap(p => Array.isArray(p.owners)
      ? p.owners.filter(o => o.share > 0).map(o => ({ ...p, owners: undefined, tp: o.tp, share: o.share, cls: o.cls || p.cls, clsConfirmed: o.clsConfirmed }))
      : [p]);
  }

  function calcPortfolio(parcels, taxpayers) {
    parcels = ownershipRows(parcels);
    const rows = taxpayers.map(tp => {
      const mine = parcels.filter(p => p.tp === tp.id);
      return { taxpayer: tp, count: mine.length, result: mine.length ? calcTaxpayer(mine, tp.prev) : null };
    });
    const totals = rows.reduce((acc, r) => (r.result ? {
      value: acc.value + r.result.values.total,
      prop: acc.prop + r.result.prop.total,
      cmt: acc.cmt + r.result.cmt.total,
      total: acc.total + r.result.total,
    } : acc), { value: 0, prop: 0, cmt: 0, total: 0 });
    return { rows, totals };
  }

  /** 분납 가능액: 250만원 이하 0 / 500만원 이하 250만원 초과분 / 초과 시 50% */
  function installmentPortion(amount) {
    if (amount <= PARAMS.installMin) return 0;
    if (amount <= PARAMS.installHalf) return amount - PARAMS.installMin;
    return Math.floor(amount / 2);
  }

  const nextPrev = r => ({
    propSep: r.prop.sepTax,
    propJong: r.prop.jongTax,
    cmtSep: r.prop.sepTax + r.cmt.sep.decided,
    cmtJong: r.prop.jongTax + r.cmt.jong.decided,
  });

  function paymentsFor(r, tp, year, opt) {
    const out = [];
    const propPayable = r.prop.main + r.prop.urban; // 분납 판정: 재산세 납부세액(교육세 제외)
    const propShare = opt.installments && propPayable > 0 ? installmentPortion(propPayable) / propPayable : 0;
    const propDefer = r.prop.total * propShare;
    if (r.prop.total > 0) {
      out.push({ ym: `${year}-09`, due: '9.16~9.30', tp: tp.name, taxYear: year, kind: 'prop', item: '재산세(토지)·도시지역분·지방교육세', amount: r.prop.total - propDefer });
    }
    if (propDefer > 0) {
      out.push({ ym: `${year}-12`, due: '분할납부 ~12.31', tp: tp.name, taxYear: year, kind: 'prop', item: '재산세 분할납부분', amount: propDefer });
    }
    const cmtShare = opt.installments && r.cmt.decided > 0 ? installmentPortion(r.cmt.decided) / r.cmt.decided : 0;
    const cmtDefer = r.cmt.total * cmtShare;
    if (r.cmt.total > 0) {
      out.push({ ym: `${year}-12`, due: '12.1~12.15', tp: tp.name, taxYear: year, kind: 'cmt', item: '종합부동산세·농어촌특별세', amount: r.cmt.total - cmtDefer });
    }
    if (cmtDefer > 0) {
      out.push({ ym: `${year + 1}-06`, due: '분납 ~6.15', tp: tp.name, taxYear: year, kind: 'cmt', item: '종부세·농특세 분납분', amount: cmtDefer });
    }
    if (opt.shieldPct > 0 && r.total > 0) {
      const corp = tp.type === '법인';
      out.push({
        ym: `${year + 1}-${corp ? '03' : '05'}`, due: corp ? '법인세 신고(12월 결산 가정)' : '종합소득세 신고',
        tp: tp.name, taxYear: year, kind: 'shield',
        item: corp ? '법인세 절감(손금산입)' : '소득세 절감(필요경비, 사업용 한정)',
        amount: -r.total * opt.shieldPct / 100,
      });
    }
    return out;
  }

  /**
   * 다년 CF 추정. 공시지가는 매년 growthPct로 일괄 변동, 세부담상한은 전년도 계산액으로 연쇄 적용.
   * @returns {{annual:Array, schedule:Array, beyond:number}}
   */
  function projectCashflow(opt) {
    opt = { ...opt, parcels: ownershipRows(opt.parcels) };
    const years = Math.max(1, Math.min(30, Math.round(opt.years || 1)));
    const growth = (opt.growthPct || 0) / 100;
    const tps = opt.taxpayerId && opt.taxpayerId !== 'all'
      ? opt.taxpayers.filter(t => t.id === opt.taxpayerId)
      : opt.taxpayers;
    let prevByTp = new Map(tps.map(t => [t.id, t.prev || {}]));
    const annual = [];
    const schedule = [];

    for (let i = 0; i < years; i += 1) {
      const year = opt.startYear + i;
      const factor = Math.pow(1 + growth, i);
      const row = { year, value: 0, prop: 0, cmt: 0, total: 0, shield: 0 };
      const nextMap = new Map(prevByTp);
      for (const tp of tps) {
        const mine = opt.parcels.filter(p => p.tp === tp.id).map(p => ({ ...p, price: p.price * factor }));
        if (!mine.length) continue;
        const r = calcTaxpayer(mine, prevByTp.get(tp.id));
        nextMap.set(tp.id, nextPrev(r));
        row.value += r.values.total;
        row.prop += r.prop.total;
        row.cmt += r.cmt.total;
        row.total += r.total;
        row.shield += opt.shieldPct > 0 ? r.total * opt.shieldPct / 100 : 0;
        schedule.push(...paymentsFor(r, tp, year, opt));
      }
      prevByTp = nextMap;
      annual.push(row);
    }

    schedule.sort((a, b) => (a.ym < b.ym ? -1 : a.ym > b.ym ? 1 : 0));
    const lastYear = opt.startYear + years - 1;
    const cashOf = y => sum(schedule.filter(s => Number(s.ym.slice(0, 4)) === y).map(s => s.amount));
    let cumulative = 0;
    const withCash = annual.map(r => {
      const cash = cashOf(r.year);
      cumulative += cash;
      return { ...r, net: r.total - r.shield, cash, cumulative };
    });
    const beyond = sum(schedule.filter(s => Number(s.ym.slice(0, 4)) > lastYear).map(s => s.amount));
    return { annual: withCash, schedule, beyond };
  }

  /**
   * 지목·용도지역·납세자 유형으로 과세구분 1차 추정(반드시 사용자 확인).
   * 근거: 지방세법 제106조, 시행령 제101조·제102조
   */
  function estimateClass(jimok, zone, ownerType) {
    const j = jimok || '';
    const z = zone || '';
    const urbanZone = /주거|상업|공업/.test(z);
    if (/^(전|답|과수원|과|목장용지|목)$/.test(j)) {
      if (ownerType === '개인' && !urbanZone) {
        return { cls: 'b007', note: '개인 자경 농지·목장용지(도시지역은 녹지·개발제한구역 한정)일 때만 분리과세 — 영농 여부 확인' };
      }
      return { cls: 'jong', note: ownerType === '법인' ? '법인 농지는 농업법인 등 예외 외에는 종합합산' : '도시지역(주거·상업·공업) 농지는 종합합산' };
    }
    if (j === '임야') return { cls: 'jong', note: '보전산지·개발제한구역 등 요건 충족 임야만 분리과세(0.07%)' };
    if (j === '공장용지') {
      return /공업/.test(z)
        ? { cls: 'b02', note: '공업지역·산단 공장입지기준면적 이내만 분리과세' }
        : { cls: 'sep', note: '공장용 건축물 부속토지(기준면적 이내) 가정' };
    }
    if (/^(대|창고용지|주유소용지|학교용지|체육용지|종교용지)$/.test(j)) {
      return { cls: 'sep', note: '건축물 부속토지(용도지역별 적용배율 이내) 가정 — 나대지·초과면적은 종합합산' };
    }
    return { cls: 'jong', note: '기본 종합합산 추정 — 차고용·부설주차장 등은 별도합산 가능' };
  }

  /**
   * 도시지역분 적용 추정 — 국토계획법 제6조 도시지역(주거·상업·공업·녹지).
   * 지자체 고시지역 여부와 제외 토지(지방세법 제112조③④, 2026.1.1 개정 — 미집행 도시·군계획시설 부지(주택 부속토지 포함),
   * 건축물 등 이용시설이 없는 개발제한구역 토지)는 사용자 확인.
   */
  function estimateUrban(zone) {
    const z = zone || '';
    if (!z) return { urban: true, known: false, note: '용도지역 미확인 — 도시지역으로 가정(해제 가능)' };
    if (/관리지역|농림|자연환경보전/.test(z)) return { urban: false, known: true, note: `${z}은 도시지역이 아니어서 도시지역분 제외` };
    if (/주거|상업|공업|녹지/.test(z)) return { urban: true, known: true, note: `${z}(도시지역) — 조례 고시지역이면 적용` };
    return { urban: true, known: false, note: '용도지역 판별 불가 — 확인 필요' };
  }

  /** PNU = 법정동코드(10) + 산여부(1:일반, 2:산) + 본번(4) + 부번(4) */
  function makePnu(bcode, jibun) {
    const code = String(bcode || '');
    const m = String(jibun || '').trim().match(/(산\s*)?(\d+)(?:-(\d+))?\s*$/);
    if (!/^\d{10}$/.test(code) || !m) return '';
    return `${code}${m[1] ? '2' : '1'}${m[2].padStart(4, '0')}${(m[3] || '0').padStart(4, '0')}`;
  }

  /** 계산 근거표 — 2026-10-15 현행 조문 확인 */
  const BASIS = Object.freeze([
    { item: '재산세 과세표준', rule: '공시가격 × 70% (공정시장가액비율)', law: '지방세법 제110조, 시행령 제109조' },
    { item: '합산 단위', rule: '납세자 × 시·군·구 × 과세구분별로 합산', law: '지방세법 제113조' },
    { item: '별도합산 재산세', rule: '2억 이하 0.2% · 10억 이하 40만+0.3% · 초과 280만+0.4%', law: '지방세법 제111조①1나' },
    { item: '종합합산 재산세', rule: '5천만 이하 0.2% · 1억 이하 10만+0.3% · 초과 25만+0.5%', law: '지방세법 제111조①1가' },
    { item: '분리과세 재산세', rule: '농지·목장·임야 0.07% · 골프장·고급오락장 4% · 그 밖 0.2%', law: '지방세법 제111조①1다, 시행령 제102조' },
    { item: '도시지역분', rule: '과세표준 × 0.14% (조례로 0.23%까지). 미집행 도시·군계획시설 부지, 이용시설 없는 개발제한구역 토지는 제외(2026.1.1 개정)', law: '지방세법 제112조①~④' },
    { item: '지방교육세', rule: '재산세 본세 × 20%', law: '지방세법 제151조' },
    { item: '세부담상한', rule: '직전연도 세액상당액 × 150%', law: '지방세법 제122조, 종부세법 제15조' },
    { item: '종부세 과세표준', rule: '(별도합산 − 80억) 또는 (종합합산 − 5억) × 100%', law: '종부세법 제13조, 시행령 제2조의4' },
    { item: '종부세 별도합산', rule: '200억 이하 0.5% · 400억 이하 1억+0.6% · 초과 2.2억+0.7%', law: '종부세법 제14조④' },
    { item: '종부세 종합합산', rule: '15억 이하 1% · 45억 이하 1,500만+2% · 초과 7,500만+3%', law: '종부세법 제14조①' },
    { item: '공제할 재산세액', rule: '부과 재산세 × (종부세 과표 × 70% × 0.4%[종합합산 0.5%]) ÷ 누진 표준세율(전국 과세표준 합산)', law: '종부세법 제14조③⑥, 시행령 제5조의3' },
    { item: '농어촌특별세', rule: '종부세 결정세액 × 20%', law: '농어촌특별세법 제5조' },
    { item: '납기·분납', rule: '토지 재산세 9.16~9.30(250만 초과 시 3개월 내 분할) · 종부세 12.1~12.15(250만 초과 시 6개월 내 분납)', law: '지방세법 제115조·제118조, 종부세법 제16조·제20조' },
  ]);

  return Object.freeze({
    PARAMS, BRACKETS, CLASS, CLASS_KEYS, BASIS,
    isBunri, progressive, landValue, calcTaxpayer, calcPortfolio, ownershipRows,
    installmentPortion, projectCashflow, estimateClass, estimateUrban, makePnu,
  });
}));
