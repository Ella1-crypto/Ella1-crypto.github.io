/* 비주거 건축물 보유세: 건축물분 재산세 · 도시지역분 · 지방교육세 · 소방분 지역자원시설세
 *
 * 조문 확인 2026-09-14, 재확인 2026-10-15(세율·소방분 구간 변동 없음)
 *  · 과세표준 = 시가표준액 × 70% (지방세법 §110, 시행령 §109①1)
 *  · 세율 (§111①2): 골프장·고급오락장 4%, 시 지역 주거지역 등 공장용 0.5%, 그 밖의 건축물 0.25%
 *  · 도시지역분 과세표준 × 0.14% (§112①2) — 지방교육세 과세표준에서 제외 (§151①6)
 *  · 지방교육세 = 재산세액 × 20% (§151①6)
 *  · 세 부담 상한: 본세·도시지역분 각각 직전 연도의 150% (§122, 주택 제외). 소방분도 150% (§147② — §122 본문 준용)
 *  · 소방분 누진세율, 화재위험 ×2 · 대형 화재위험 ×3 (§146③, 시행령 §138), 겸용은 구·동별 안분 (시행규칙 §75)
 *  · 납기 7.16~7.31 (§115①2)
 * 주택은 토지·건물을 합친 주택분으로 과세되므로 여기서 계산하지 않는다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BuildingTax = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const VERSION = '2026-10-15';
  const FMV = 0.7;
  const URBAN_RATE = 0.0014;
  const EDU_RATE = 0.2;
  const CAP = 1.5;
  const INSTALL_MIN = 2.5e6;   // 분할납부 기준 (§118)
  const INSTALL_HALF = 5e6;
  const RATES = Object.freeze({
    general: { rate: 0.0025, label: '그 밖의 건축물 0.25%', law: '지방세법 §111①2다' },
    factory: { rate: 0.005, label: '주거지역 등 공장용 0.5%', law: '지방세법 §111①2나' },
    luxury: { rate: 0.04, label: '골프장·고급오락장 4%', law: '지방세법 §111①2가' },
  });
  const FIRE = Object.freeze({
    1: { label: '일반 ×1', law: '지방세법 §146③1' },
    2: { label: '화재위험 ×2', law: '지방세법 §146③2 · 시행령 §138①' },
    3: { label: '대형 화재위험 ×3', law: '지방세법 §146③2의2 · 시행령 §138②' },
  });
  const FIRE_BRACKETS = [[6e6, 4e-4], [13e6, 5e-4], [26e6, 6e-4], [39e6, 8e-4], [64e6, 1e-3], [Infinity, 1.2e-3]];
  const HOUSING = /아파트|공동주택|연립|다세대|다가구|단독주택/;
  const MAX_UNITS = 50;

  const sum = a => a.reduce((s, x) => s + x, 0);
  // 0.0012 같은 세율의 이진 오차로 812,299.9999가 812,299원이 되지 않게 아주 작은 여유를 두고 버림
  const sfloor = n => Math.floor(n + 1e-6);
  const floor10 = n => Math.floor(sfloor(n) / 10) * 10;
  const num = v => (v === '' || v == null || !Number.isFinite(Number(v)) || Number(v) < 0 ? null : Math.min(1e15, Number(v)));
  const text = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');

  /** 소방분 표준세액(배수 적용 전) */
  function fireProgressive(base) {
    let value = 0, low = 0;
    for (const [high, rate] of FIRE_BRACKETS) {
      if (base <= low) break;
      value += (Math.min(base, high) - low) * rate;
      low = high;
    }
    return value;
  }

  /** 저장용 정리: 동·구별 행과 건물분 옵션만 (나머지 건물 필드는 LifecycleTax.clean 담당) */
  function clean(raw) {
    const r = raw || {};
    const units = (Array.isArray(r.units) ? r.units : []).slice(0, MAX_UNITS).map(u => ({
      name: text(u && u.name, 60),
      use: text(u && u.use, 60),
      amount: num(u && u.amount),
      rate: u && RATES[u.rate] ? u.rate : 'general',
      fire: [1, 2, 3].includes(Number(u && u.fire)) ? Number(u.fire) : 1,
    }));
    return {
      units,
      bldInput: r.bldInput === 'base' ? 'base' : 'value',        // 시가표준액 / 고지서 과세표준
      bldUrban: ['on', 'off'].includes(r.bldUrban) ? r.bldUrban : 'auto',
      bldPrevMain: num(r.bldPrevMain),
      bldPrevUrban: num(r.bldPrevUrban),
      bldPrevFire: num(r.bldPrevFire),
    };
  }

  /** 건축물대장 표제부로 소방분 배수 제안. 층수 외 용도·면적 요건은 사용자 확인이 필요하다 */
  function suggestFire(title) {
    const t = title || {};
    const purpose = `${t.purpose || ''} ${t.purposeDetail || ''}`;
    const floors = Number(t.floorsAbove) || 0;
    const area = Number(t.totalArea) || 0;
    if (HOUSING.test(purpose)) return { fire: 1, note: '주거용 — 층수 중과 대상 아님' };
    if (floors >= 11) return { fire: 3, note: '주거용이 아닌 11층 이상 (시행령 §138②1)' };
    if (/창고/.test(purpose) && area >= 15000) {
      return { fire: floors >= 4 ? 2 : 1, note: '연면적 1만5천㎡ 이상 창고: 샌드위치패널 물류창고·냉동냉장창고면 ×3 (시행령 §138②2마) — 확인 필요' };
    }
    if (floors >= 4) return { fire: 2, note: '주거용이 아닌 4~10층 (시행령 §138①1)' };
    if (/창고|판매|숙박|위락|문화|집회|장례|공장|의료|학원|위험물|주차/.test(purpose)) {
      return { fire: 1, note: '용도별 면적 요건에 따라 ×2 가능 (시행령 §138①2) — 확인 필요' };
    }
    return { fire: 1, note: '일반' };
  }

  function unitTax(u, inputKind, urban) {
    const base = inputKind === 'base' ? sfloor(u.amount) : sfloor(u.amount * FMV);
    const main = sfloor(base * RATES[u.rate].rate);
    const urbanTax = urban ? sfloor(base * URBAN_RATE) : 0;
    const fireStd = sfloor(fireProgressive(base));
    return { ...u, base, main, urban: urbanTax, fireStd, fire: fireStd * u.fire };
  }

  /** 직전 연도 150% 상한 — 본세·도시지역분 각각 (§122) */
  function capped(raw, prev) {
    if (!(prev > 0)) return { value: raw, reduced: 0 };
    const limit = Math.floor(prev * CAP);
    return raw > limit ? { value: limit, reduced: raw - limit } : { value: raw, reduced: 0 };
  }

  /**
   * 건물 1건(필지 1개에 딸린 동·구 목록) 100% 기준 세액
   * @param {object} record LifecycleTax.clean + BuildingTax.clean 결과를 합친 건물 자료
   * @param {{urban:boolean}} opt 필지의 도시지역분 적용 여부(bldUrban이 auto일 때 사용)
   */
  function calc(record, opt) {
    const r = { ...clean(record), ...(record || {}) };
    const legacy = r.units && r.units.length ? null
      : (r.buildingValue != null ? [{ name: r.unitName || '건물', use: r.purpose || '', amount: r.buildingValue, rate: 'general', fire: 1 }] : null);
    const units = legacy || clean(record).units;
    const inputKind = legacy ? 'value' : r.bldInput;
    if (!units.length) return { empty: true, error: '동·구별 시가표준액을 입력하거나 건축물대장으로 동을 불러오세요.' };
    const missing = units.filter(u => u.amount == null && !HOUSING.test(u.use));
    if (missing.length) return { error: `${missing.map(u => u.name || '이름 없는 동').join(', ')}의 ${inputKind === 'base' ? '과세표준' : '시가표준액'}을 입력하세요.` };
    const urban = r.bldUrban === 'on' ? true : r.bldUrban === 'off' ? false : Boolean(opt && opt.urban);
    const excluded = units.filter(u => HOUSING.test(u.use));
    const rows = units.filter(u => !HOUSING.test(u.use)).map(u => unitTax(u, inputKind, urban));
    if (!rows.length) return { error: '모든 동이 주택 용도입니다. 주택은 주택분(토지+건물 합산)으로 계산해야 합니다.', excluded };
    const mainCap = capped(sum(rows.map(x => x.main)), r.bldPrevMain);
    const urbanCap = capped(sum(rows.map(x => x.urban)), r.bldPrevUrban);
    const main = mainCap.value, urbanTax = urbanCap.value;
    const prop = floor10(main + urbanTax);
    const edu = floor10(main * EDU_RATE);
    const fireCap = capped(sum(rows.map(x => x.fire)), r.bldPrevFire);
    const fire = fireCap.value;
    return {
      rows, excluded, inputKind, urban,
      base: sum(rows.map(x => x.base)),
      main, urbanTax, prop, edu, fire,
      capReduced: mainCap.reduced + urbanCap.reduced + fireCap.reduced,
      total: prop + edu + fire,
    };
  }

  /** 소유지분별 귀속 세액 (100% 세액 × 지분, 원 미만 버림) */
  function forOwners(result, owners) {
    return (owners || []).map(o => {
      const k = (Number(o.share) || 0) / 100;
      const prop = Math.floor(result.prop * k), edu = Math.floor(result.edu * k), fire = Math.floor(result.fire * k);
      return { tp: o.tp, share: o.share, prop, edu, fire, total: prop + edu + fire };
    });
  }

  /** 분할납부 가능액: 250만원 초과 500만원 이하는 초과분, 500만원 초과는 50% (§118) */
  function installmentPortion(amount) {
    if (amount <= INSTALL_MIN) return 0;
    if (amount <= INSTALL_HALF) return amount - INSTALL_MIN;
    return Math.floor(amount / 2);
  }

  /** 7월 정기분, 분납을 쓰면 재산세(본세+도시지역분)의 분납분을 10월로 */
  function payments(owner, year, installments) {
    const later = installments ? installmentPortion(owner.prop) : 0;
    return [
      { month: `${year}-07`, amount: owner.total - later, label: '건축물 재산세·교육세·소방분 (7.16~7.31)' },
      ...(later > 0 ? [{ month: `${year}-10`, amount: later, label: '건축물 재산세 분할납부 (납기 후 3개월 이내)' }] : []),
    ];
  }

  return Object.freeze({
    VERSION, FMV, URBAN_RATE, EDU_RATE, RATES, FIRE, HOUSING,
    clean, suggestFire, fireProgressive, calc, forOwners, installmentPortion, payments,
  });
}));
