/* 취득세 엔진 — 취득세·지방교육세·농어촌특별세, 중과와 감면 (2026-10-15 현행 조문 확인)
 * 순수 함수(브라우저: window.AcqTax / Node: module.exports).
 *
 *  표준세율(지방세법 §11①): 상속 농지 2.3%·그 외 2.8% / 증여 3.5% / 신축 2.8% / 유상 농지 3% / 유상 그 밖 4% /
 *    주택 유상: 6억 이하 1%, 6~9억 (가액×2/3억−3)%, 9억 초과 3%
 *  주택 중과(§13의2): 법인 12% / 개인 조정 2주택·비조정 3주택 8%, 조정 3주택·비조정 4주택 이상 12% (일시적 2주택·중과 제외 주택 제외)
 *    조정대상지역 시가표준액 3억 이상 증여 12% (1세대1주택자의 배우자·직계존비속 증여 제외)
 *  대도시 법인 중과(§13②): 표준세율×3 − 4%(주택은 §13의2) / 사치성재산(§13⑤): +8% / 둘 다(§13⑦): 표준세율×3 + 4%
 *  지방교육세(§151①1): (표준세율−2%)×20%, 주택 유상은 세율×50%×20%, 주택 중과는 0.4%, 대도시 중과는 ×3
 *  농어촌특별세(농특세법 §5①6·①1): (2% + 중과분)×10%, 감면세액×20% — 전용 85㎡ 이하 주택 비과세(§4⑨⑪),
 *    지식산업센터·창업중소기업 감면분 비과세(시행령 §4⑦5, 법 §4 4의2)
 *  감면(지방세특례제한법): 생애최초 §36의3 200만원(소형주택 300만원), 출산·양육 §36의5 500만원 — 12억 이하 주택,
 *    지식산업센터 §58의2 35%(설립자 수도권 15%), 창업중소기업 §58의3 75%, 산업단지 §78⑤ 35·50·75%,
 *    임대주택 §31의3 60㎡ 이하 면제 — 면제는 최소납부세제(§177의2: 산출 취득세 200만원 초과면 85%)
 *  신고기한(§20): 유상 60일, 증여 말일부터 3개월, 상속 말일부터 6개월(외국 주소 상속인 9개월)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AcqTax = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSION = '2026-10-15';
  const HEAVY_BASE = 0.02; // 중과기준세율(§6 19호)
  const CAUSES = Object.freeze({ sale: '매매(유상)', new: '신축·증축(원시)', gift: '증여(무상)', inherit: '상속' });
  const ASSETS = Object.freeze({ house: '주택', nonres: '토지·건물·상가(비주거)', farm: '농지' });
  const RELIEFS = Object.freeze({
    none: { label: '없음' },
    firstHome: { label: '생애최초 주택 구입 (200만원 한도)', house: true, cap: 2e6, maxPrice: 1.2e9, law: '지방세특례제한법 제36조의3', need: '본인·배우자 무주택, 취득가액 12억 이하, 유상취득, 3년 내 매각·임대 시 추징' },
    firstHomeSmall: { label: '생애최초 — 소형주택 (300만원 한도)', house: true, cap: 3e6, maxPrice: 1.2e9, law: '지방세특례제한법 제36조의3', need: '전용 60㎡ 이하·3억(수도권 6억) 이하 아파트 외 공동주택·도시형생활주택·다가구, 또는 인구감소지역 주택' },
    birth: { label: '출산·양육 주택 (500만원 한도)', house: true, cap: 5e6, maxPrice: 1.2e9, law: '지방세특례제한법 제36조의5', need: '출산일부터 5년 이내(출산 전 1년 포함) 취득, 12억 이하, 1가구 1주택, 2028.12.31.까지 출산' },
    rental60: { label: '등록 임대사업자 — 전용 60㎡ 이하 공동주택 최초 분양 (면제)', house: true, rate: 1, minTax: true, law: '지방세특례제한법 제31조의3②', need: '건축주로부터 최초 유상취득, 3억(수도권 6억) 이하, 임대의무기간 내 매각 시 추징', nongFree: true },
    knowledge: { label: '지식산업센터 최초 분양 중소기업 (35%)', rate: 0.35, law: '지방세특례제한법 제58조의2②1', need: '사업시설용 직접 사용, 1년 내 사용·4년 내 매각 시 추징', nongFree: true },
    knowledgeBuilderMetro: { label: '지식산업센터 설립자 — 수도권 (15%)', rate: 0.15, law: '지방세특례제한법 제58조의2①1', need: '신축·증축해 직접 사용하거나 중소기업에 분양·임대', nongFree: true },
    knowledgeBuilder: { label: '지식산업센터 설립자 — 수도권 밖 (35%)', rate: 0.35, law: '지방세특례제한법 제58조의2①1', need: '위와 같음', nongFree: true },
    startup: { label: '창업중소기업 사업용 부동산 (75%)', rate: 0.75, law: '지방세특례제한법 제58조의3①1·②1', need: '과밀억제권역 밖 2026.12.31.까지 창업, 창업 후 4년(청년 5년) 내 취득, 3년 내 직접 사용', nongFree: true },
    industrialMetro: { label: '산업단지 신·증축 — 수도권 (35%)', rate: 0.35, law: '지방세특례제한법 제78조⑤2가', need: '산업용 건축물 신축용 토지·신증축, 3년 내 직접 사용' },
    industrialLocal: { label: '산업단지 신·증축 — 수도권 밖 (50%)', rate: 0.5, law: '지방세특례제한법 제78조⑤2가', need: '위와 같음' },
    industrialDepop: { label: '산업단지 신·증축 — 인구감소지역 (75%)', rate: 0.75, law: '지방세특례제한법 제78조⑤2가', need: '위와 같음' },
    custom: { label: '기타 감면 — 감면율 직접 입력', law: '해당 조문·조례', need: '감면율을 입력' },
  });

  const floor = n => Math.floor(n + 1e-6);
  const round5 = n => Math.round(n * 1e5) / 1e5;

  /** 주택 유상거래 세율 (§11①8) */
  function houseRate(price) {
    if (price <= 6e8) return 0.01;
    if (price <= 9e8) return Math.round((price * 2 / 3e8 - 3) / 100 * 1e4) / 1e4; // 소수점 다섯째 자리 반올림
    return 0.03;
  }

  /** 표준세율 */
  function standardRate(x) {
    const price = Number(x.price) || 0;
    if (x.cause === 'inherit') return x.asset === 'farm' ? 0.023 : 0.028;
    if (x.cause === 'gift') return 0.035;
    if (x.cause === 'new') return 0.028;
    if (x.asset === 'house') return houseRate(price);
    if (x.asset === 'farm') return 0.03;
    return 0.04;
  }

  /** 개인 주택 유상취득 중과율 — 취득 후 세대 주택 수 기준 */
  function houseHeavy(x) {
    if (x.asset !== 'house' || x.cause !== 'sale' || x.heavyExcluded) return 0;
    // 시가표준액 1억원 이하 주택은 중과하지 않는다(정비구역·사업시행구역 안 주택 제외, 시행령 제28조의2 1호)
    if (Number(x.stdValue) > 0 && Number(x.stdValue) <= 1e8 && !x.redevZone) return 0;
    if (x.buyer === '법인') return 0.12;
    const n = Number(x.houseCount) || 1;
    if (x.adjusted) {
      if (n >= 3) return 0.12;
      if (n === 2 && !x.temporary2) return 0.08;
      return 0;
    }
    if (n >= 4) return 0.12;
    if (n === 3) return 0.08;
    return 0;
  }

  function calc(input) {
    const x = { buyer: '개인', asset: 'house', cause: 'sale', ...input };
    const price = Number(x.price) || 0;
    const notes = [];
    const s = standardRate(x);
    const rel = Object.prototype.hasOwnProperty.call(RELIEFS, x.relief) ? RELIEFS[x.relief] : RELIEFS.none;
    const homeRelief = ['firstHome', 'firstHomeSmall', 'birth'].includes(x.relief);
    // 생애최초·출산 감면: 개인의 유상취득으로 1가구 1주택(생애최초는 무주택 → 1주택)이 되고 12억 이하일 때만
    const homeOk = !homeRelief || (x.buyer !== '법인' && x.cause === 'sale' && (Number(x.houseCount) || 1) <= 1 && price <= rel.maxPrice);
    if (homeRelief && x.asset === 'house' && !homeOk) notes.push(`${rel.label}: 개인이 12억 이하 주택을 유상취득해 1주택이 되는 경우에만 감면됩니다 — 적용하지 않았습니다.`);
    const reliefOn = rel !== RELIEFS.none && (!rel.house || x.asset === 'house') && homeOk;
    const firstLike = reliefOn && (x.relief === 'firstHome' || x.relief === 'firstHomeSmall');

    // 중과 판정
    let heavy = firstLike ? 0 : houseHeavy(x); // 생애최초 감면을 받으면 §13의2 중과를 적용하지 않는다
    if (firstLike && houseHeavy(x)) notes.push('생애최초 감면을 받으면 다주택 중과를 적용하지 않습니다(지특법 제36조의3).');
    const giftHeavy = x.asset === 'house' && x.cause === 'gift' && x.giftHeavy;
    if (giftHeavy) heavy = 0.12;
    const metro = Boolean(x.metroCorp) && x.buyer === '법인';
    const luxury = Boolean(x.luxury);

    // 무주택 상속인이 상속으로 1가구 1주택이 되는 경우: 표준세율 − 중과기준세율(0.8%)
    const inheritOne = x.cause === 'inherit' && x.asset === 'house' && Boolean(x.inheritOneHouse);
    let rate = s, rule = '표준세율', law = '지방세법 제11조①';
    let edu, nongBase;
    if (heavy) {
      rate = heavy + (luxury ? 4 * HEAVY_BASE : 0);
      rule = giftHeavy ? '조정대상지역 3억 이상 주택 증여 중과' : x.buyer === '법인' ? '법인 주택 중과' : `다주택 중과(${heavy === 0.12 ? '12%' : '8%'})`;
      law = luxury ? '지방세법 제13조의2①②③' : '지방세법 제13조의2';
      edu = price * (0.04 - HEAVY_BASE) * 0.2;
    } else if (metro && luxury) {
      rate = s * 3 + HEAVY_BASE * 2; rule = '대도시 법인 + 사치성재산 중과'; law = '지방세법 제13조⑦';
      edu = price * Math.max(0, s - HEAVY_BASE) * 0.2 * 3;
    } else if (metro) {
      rate = s * 3 - HEAVY_BASE * 2; rule = '대도시 법인 설립·전입 중과'; law = '지방세법 제13조②';
      edu = price * Math.max(0, s - HEAVY_BASE) * 0.2 * 3;
    } else {
      if (luxury) { rate = s + 4 * HEAVY_BASE; rule = '사치성재산(골프장·고급주택·고급오락장) 중과'; law = '지방세법 제13조⑤'; }
      else if (inheritOne) { rate = s - HEAVY_BASE; rule = '1가구 1주택 상속 세율 특례'; law = '지방세법 제15조①2가'; }
      const houseSale = x.asset === 'house' && x.cause === 'sale';
      edu = houseSale ? price * s * 0.5 * 0.2 : price * Math.max(0, s - HEAVY_BASE) * 0.2;
    }
    rate = round5(rate);
    const acq = floor(price * rate);
    // 농특세(취득세분): 표준세율을 2%로 본 세액 + 중과분 → 10%
    nongBase = inheritOne && !luxury ? 0 : price * (HEAVY_BASE + Math.max(0, rate - (heavy ? 0.04 : s))) * 0.1; // 상속 특례분은 농특세 과세표준이 없다
    const smallHouse = x.asset === 'house' && !x.over85;
    let nong = smallHouse ? 0 : floor(nongBase);
    if (smallHouse) notes.push('전용 85㎡ 이하 주택은 농어촌특별세 비과세입니다(농특세법 제4조⑪).');
    edu = floor(edu);

    // 감면
    let reliefAmt = 0, reliefEdu = 0, minTax = false;
    if (reliefOn) {
      if (rel.cap) {
        if (price > rel.maxPrice) notes.push(`${rel.label}: 취득가액이 ${rel.maxPrice / 1e8}억원을 넘어 감면되지 않습니다.`);
        else {
          reliefAmt = Math.min(acq, rel.cap);
          // 정액 감면도 감면율(감면액÷산출세액)로 보아 지방교육세를 같은 비율로 줄인다(§151①1다1), 행안부 운영요령)
          reliefEdu = acq > 0 ? floor(edu * reliefAmt / acq) : 0;
        }
      } else {
        let r = x.relief === 'custom' ? Math.max(0, Math.min(1, (Number(x.customRate) || 0) / 100)) : rel.rate;
        if (r >= 1 && acq > 2e6) { r = 0.85; minTax = true; notes.push('면제 대상이지만 산출 취득세가 200만원을 넘어 최소납부세제로 85%만 감면합니다(지특법 제177조의2).'); }
        reliefAmt = floor(acq * r);
        reliefEdu = floor(edu * r); // 지방교육세도 같은 비율로 줄어든다(§151①1다)
      }
    }
    const reliefNong = reliefOn && reliefAmt > 0 && !rel.nongFree && !smallHouse ? floor(reliefAmt * 0.2) : 0;
    const acqFinal = acq - reliefAmt;
    const eduFinal = edu - reliefEdu;
    nong += reliefNong;
    const total = acqFinal + eduFinal + nong;

    const dueMonths = x.cause === 'gift' ? 3 : x.cause === 'inherit' ? (x.abroad ? 9 : 6) : 0;
    return {
      price, standard: s, rate, rule, law, acq, edu, nongAcq: nong - reliefNong, reliefNong, nong,
      relief: reliefOn ? { ...rel, amount: reliefAmt, edu: reliefEdu, minTax } : null,
      acqFinal, eduFinal, total, effective: price > 0 ? total / price : 0,
      due: dueMonths ? `취득일이 속하는 달의 말일부터 ${dueMonths}개월` : '취득일부터 60일',
      dueLaw: '지방세법 제20조①', notes,
    };
  }

  /** 신고기한 날짜 */
  function dueDate(dateStr, cause, abroad) {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return '';
    const pad = n => String(n).padStart(2, '0');
    let t;
    if (cause === 'gift' || cause === 'inherit') {
      const m = cause === 'gift' ? 3 : abroad ? 9 : 6;
      t = new Date(d.getFullYear(), d.getMonth() + 1 + m, 0);
    } else {
      t = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 60);
    }
    return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
  }

  const BASIS = Object.freeze([
    { item: '표준세율', rule: '상속 2.8%(농지 2.3%) · 증여 3.5% · 신축 2.8% · 유상 농지 3% · 유상 그 밖 4% · 주택 유상 1~3%', law: '지방세법 제11조①' },
    { item: '주택 유상 세율', rule: '6억 이하 1% · 6~9억 (취득가액×2/3억 − 3)% · 9억 초과 3%', law: '지방세법 제11조①8' },
    { item: '주택 중과', rule: '법인 12% · 조정 2주택(일시적 2주택 제외)·비조정 3주택 8% · 조정 3주택·비조정 4주택 이상 12% · 조정 3억 이상 증여 12%', law: '지방세법 제13조의2, 시행령 제28조의2·제28조의4·제28조의5·제28조의6' },
    { item: '일시적 2주택', rule: '신규주택 취득 후 3년 내 종전주택 처분(둘 다 조정대상지역이면 2년, 2026.10.1. 이후 성립분·2026.8.26. 이전 계약은 3년)', law: '지방세법 시행령 제28조의5①, 부칙(제36736호)' },
    { item: '대도시·사치성 중과', rule: '대도시 법인 설립·전입 표준세율×3−4% · 골프장·고급주택·고급오락장 +8% · 겹치면 표준세율×3+4%', law: '지방세법 제13조②⑤⑦' },
    { item: '지방교육세', rule: '(표준세율−2%)×20%, 주택 유상은 세율×10%, 주택 중과 0.4%, 대도시 중과 ×3, 감면율만큼 감면', law: '지방세법 제151조①1' },
    { item: '농어촌특별세', rule: '(2%+중과분)×10%, 감면세액×20% — 전용 85㎡ 이하 주택·지식산업센터·창업중소기업 감면분 비과세', law: '농어촌특별세법 제4조·제5조, 시행령 제4조⑦' },
    { item: '생애최초·출산 감면', rule: '12억 이하 주택: 생애최초 200만원(소형주택 300만원), 출산·양육 500만원까지 면제·초과 시 공제 — 생애최초는 중과 미적용', law: '지방세특례제한법 제36조의3·제36조의5' },
    { item: '사업용 감면', rule: '지식산업센터 35%(설립자 수도권 15%) · 창업중소기업 75% · 산업단지 35·50·75% · 등록임대 60㎡ 이하 면제', law: '지방세특례제한법 제58조의2·제58조의3·제78조⑤·제31조의3' },
    { item: '최소납부세제', rule: '취득세 면제라도 산출세액 200만원 초과면 85%만 감면', law: '지방세특례제한법 제177조의2' },
    { item: '상속 1가구 1주택', rule: '무주택 상속인이 상속으로 1가구 1주택이 되면 2.8% − 2% = 0.8% (지방교육세 0.16%, 농특세 없음)', law: '지방세법 제15조①2가' },
    { item: '신고·납부', rule: '유상 60일 · 증여 말일부터 3개월 · 상속 말일부터 6개월(외국 주소 상속인 9개월)', law: '지방세법 제20조①' },
  ]);

  return Object.freeze({ VERSION, CAUSES, ASSETS, RELIEFS, BASIS, houseRate, standardRate, houseHeavy, calc, dueDate });
}));
