/* 보유세 감면·중과 규정표 — 상업용(토지·비주거 건물)과 주택 재산세 감면 (2026-10-15 현행 조문 확인)
 * 순수 데이터 + 감면율 계산(브라우저: window.HTMRelief / Node: module.exports).
 *
 * 공통 원칙
 *  · 재산세 감면율은 재산세 본세에 적용하고, 조문이 "「지방세법」 제112조에 따른 부과액을 포함"이라고 할 때만 도시지역분도 감면한다.
 *  · 지방교육세는 감면 후 재산세의 20%라 함께 줄어든다. 소방분 지역자원시설세는 감면 대상이 아니다.
 *  · 최소납부세제(지특법 §177의2): 재산세 '면제'(100%)라도 재산세 산출액이 50만원을 넘으면 85%만 감면한다
 *    (§177의2①2에 열거된 조문은 예외 — 아래 규정 중에는 해당 없음).
 *  · 재산세 감면에는 농어촌특별세가 붙지 않는다(농특세법 §5①1은 취득세·등록면허세 감면만 대상).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HTMRelief = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const REGIONS = Object.freeze({
    metro: '수도권(인구감소지역 제외)',
    local: '수도권 밖(인구감소지역 제외)',
    depop: '인구감소지역',
  });
  const MIN_TAX_THRESHOLD = 5e5; // 지특법 §177의2①1나
  const MIN_TAX_RATE = 0.85;

  /** 상업용 — 필지(토지+건물) 단위로 고르는 재산세 감면 */
  const COMMERCIAL = Object.freeze({
    none: { label: '해당 없음' },
    knowledgeTenant: {
      label: '지식산업센터 최초 분양 중소기업 — 직접 사용',
      rate: () => 0.35, urban: false,
      law: '지방세특례제한법 제58조의2②2', period: '재산세 납세의무 최초 성립일부터 5년간, 2028.12.31.까지',
      need: '산업집적법 제28조의4에 따라 설립자로부터 최초 분양받은 중소기업이 사업시설용으로 직접 사용',
    },
    knowledgeBuilder: {
      label: '지식산업센터 설립자 — 직접 사용·중소기업에 분양·임대',
      rate: region => (region === 'metro' ? 0.15 : 0.35), urban: false,
      law: '지방세특례제한법 제58조의2①2', period: '납세의무 최초 성립일부터 5년간, 2028.12.31.까지',
      need: '신축·증축한 지식산업센터를 사업시설용으로 직접 사용하거나 중소기업에 분양·임대',
    },
    industrialComplex: {
      label: '산업단지·유치지역·산업기술단지 — 신·증축 산업용 건축물',
      rate: region => ({ metro: 0.35, local: 0.6, depop: 0.75 }[region] || 0.35), urban: false,
      law: '지방세특례제한법 제78조⑤2나', period: '납세의무 최초 성립일부터 5년간',
      need: '사업시행자 외의 자가 산업용 건축물을 신·증축(중소기업에 임대 포함), 3년 내 직접 사용·2년 이상 사용',
    },
    startupExempt: {
      label: '창업중소기업 사업용 — 창업 후 1~3년차(면제)',
      rate: () => 1, urban: false,
      law: '지방세특례제한법 제58조의3①2·②2, 제177조의2', period: '창업일(벤처 확인일)부터 3년간 면제, 2026.12.31.까지 창업분',
      need: '과밀억제권역 밖 창업, 법정 업종, 창업 당시 업종에 직접 사용(부속토지는 기준면적 이내)',
    },
    startupHalf: {
      label: '창업중소기업 사업용 — 4~5년차(50%)',
      rate: () => 0.5, urban: false,
      law: '지방세특례제한법 제58조의3①2·②2', period: '면제기간 다음 2년간',
      need: '위와 같음',
    },
    custom: {
      label: '기타 감면(조례·개별 감면) — 감면율 직접 입력',
      rate: (_, custom) => Math.max(0, Math.min(1, (Number(custom) || 0) / 100)), urban: false,
      law: '지방세특례제한법·감면조례 해당 조문', period: '조문에 따름', need: '고지서·감면결정서의 감면율을 입력',
    },
  });

  /** 주택 — 장기일반·공공지원민간임대주택 재산세 감면 (지특법 §31의3④) */
  const RENTAL_SIZE = Object.freeze({
    none: { label: '임대등록 감면 없음' },
    s40: { label: '전용 40㎡ 이하 (면제)', rate: 1, urban: true },
    s60: { label: '전용 40~60㎡ (75% 경감)', rate: 0.75, urban: true },
    s85: { label: '전용 60~85㎡ (50% 경감)', rate: 0.5, urban: false },
  });
  const RENTAL_LAW = '지방세특례제한법 제31조의3④ (2027.12.31.까지)';
  /** 감면 제외 공시가격 상한 — 수도권 6억(민간건설임대 9억), 비수도권 3억 */
  const rentalCap = (region, construction) => (region === 'metro' ? (construction ? 9e8 : 6e8) : 3e8);

  /**
   * 감면 적용 — 재산세 본세·도시지역분 금액에 감면율을 적용한다.
   * @param {{main:number, urban:number}} tax 감면 전 금액(해당 물건 귀속분)
   * @param {{rate:number, urban:boolean}} rule
   * @returns {{rate:number, mainCut:number, urbanCut:number, minTax:boolean}}
   */
  function apply(tax, rule) {
    if (!rule || !(rule.rate > 0)) return { rate: 0, mainCut: 0, urbanCut: 0, minTax: false };
    const base = tax.main + (rule.urban ? tax.urban : 0);
    const minTax = rule.rate >= 1 && base > MIN_TAX_THRESHOLD;
    const rate = minTax ? MIN_TAX_RATE : rule.rate;
    return {
      rate,
      mainCut: Math.floor(tax.main * rate),
      urbanCut: rule.urban ? Math.floor(tax.urban * rate) : 0,
      minTax,
    };
  }

  /** 상업용 규정 → 이 필지에 적용할 {rate, urban, …} */
  function commercialRule(key, region, custom) {
    const r = Object.prototype.hasOwnProperty.call(COMMERCIAL, key) ? COMMERCIAL[key] : COMMERCIAL.none;
    if (!r.rate) return null;
    return { key, label: r.label, rate: r.rate(region || 'metro', custom), urban: r.urban, law: r.law, period: r.period, need: r.need };
  }

  function rentalRule(size) {
    const r = Object.prototype.hasOwnProperty.call(RENTAL_SIZE, size) ? RENTAL_SIZE[size] : RENTAL_SIZE.none;
    if (!r.rate) return null;
    return { key: size, label: r.label, rate: r.rate, urban: r.urban, law: RENTAL_LAW };
  }

  /** 중과·특례 안내(계산은 각 엔진이 함) */
  const NOTES = Object.freeze([
    { item: '과밀억제권역 공장 신설·증설', rule: '건축물 재산세 0.25%의 5배(1.25%)를 최초 과세기준일부터 5년간 — 산업단지·유치지역·공업지역 제외', law: '지방세법 제111조②' },
    { item: '골프장·고급오락장', rule: '건축물·토지 재산세 4%', law: '지방세법 제111조①1다2)·①2가' },
    { item: '주거지역 등 공장 건축물', rule: '시 지역 주거지역 등의 공장용 건축물 0.5%', law: '지방세법 제111조①2나' },
    { item: '최소납부세제', rule: '재산세 면제라도 산출액 50만원 초과면 85%만 감면', law: '지방세특례제한법 제177조의2' },
    { item: '법인 주택 종부세', rule: '공제 0원, 2.7%(3주택 이상 5%) 단일세율, 세부담상한 미적용. 공익법인·공공주택사업자 등은 일반 누진세율·9억 공제', law: '종부세법 제8조①2·제9조②·제10조' },
  ]);

  return Object.freeze({ REGIONS, COMMERCIAL, RENTAL_SIZE, RENTAL_LAW, NOTES, MIN_TAX_THRESHOLD, MIN_TAX_RATE, apply, commercialRule, rentalRule, rentalCap });
}));
