/* 건축물대장(중계 서버 /building 응답) → 건물 입력값. 순수 함수(브라우저: window.HTMBldReg / Node: module.exports).
 * 구조·용도 이름을 valuation.js의 구조지수·용도지수 키로 옮기고, 층별개요 면적을 용도별로 묶는다.
 * 대장 이름이 표에 딱 맞지 않으면 가까운 키로 두고 note에 남긴다 — 화면에서 고칠 수 있다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HTMBldReg = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_ROWS = 10; // state.js MAX_ROWS와 같게

  // 위에서부터 먼저 맞는 것 — '철골철근콘크리트'가 '철근콘크리트'·'철골'보다 앞서야 한다
  const STRUCTURES = [
    [/철골철근콘크리트|SRC/i, 'src'],
    [/경량철골/, 'lightSteel'],
    [/철골콘크리트/, 'src'],
    [/철근콘크리트|라멘|PC|프리캐스트|석조/i, 'rc'],
    [/철골|스틸/, 'steel'],
    [/보강/, 'reinforced'],
    [/연와|벽돌|조적/, 'brick'],
    [/블록/, 'block'],
    [/패널|FRP/i, 'panel'],
    [/통나무/, 'log'],
    [/목조|목구조/, 'wood'],
    [/ALC|황토/i, 'alc'],
    [/컨테이너/, 'container'],
    [/파이프/, 'pipe'],
  ];

  const USES = [
    [/공동주택|단독주택|다가구|다세대|아파트|연립/, 'house'],
    [/대규모점포|백화점|대형마트|쇼핑센터/, 'mall'],
    [/오피스텔/, 'officetel'],
    [/업무/, 'office'],
    [/근린생활|판매|상점|음식/, 'retail'],
    [/도매|소매시장|시장/, 'market'],
    [/모텔|여관/, 'motel'],
    [/숙박|호텔/, 'hotel'],
    [/의원|치과|한의원/, 'clinic'],
    [/의료|병원/, 'hospital'],
    [/주차/, 'parking'],
    [/냉동|냉장/, 'coldStorage'],
    [/물류|집배송|터미널/, 'logistics'],
    [/창고/, 'warehouse'],
    [/위험물|주유/, 'gasStation'],
    [/지식산업/, 'kic'],
    [/공장|제조/, 'factory'],
    [/학원|교습/, 'academy'],
    [/교육|연구|학교/, 'school'],
    [/종교/, 'religion'],
    [/운동|체육/, 'sports'],
  ];

  const pick = (table, s, fallback) => {
    const hit = table.find(([re]) => re.test(s));
    return hit ? hit[1] : fallback;
  };

  function structureKey(name) {
    return pick(STRUCTURES, String(name || ''), null);
  }

  /** 용도 이름 → valuation 용도 키. 주택·오피스텔은 이 계산기에서 다루지 않으므로 그대로 표시만 한다.
   * 대장의 기타용도(detail)가 더 구체적이다 — 예: 주용도 '기타일반업무시설', 기타용도 '주차장' → 주차장 */
  function useKey(purpose, detail) {
    return pick(USES, String(detail || ''), null) || pick(USES, String(purpose || ''), null);
  }

  const SHOP_USES = ['retail', 'market'];

  /** 1층 상가 가감산율 — 화면 안내(index.html FAQ)와 같은 값: 5층 미만 +0.17, 5~10층 +0.27. 11층 이상은 직접 확인 */
  function groundShopAdjust(floorsAbove) {
    const n = Number(floorsAbove) || 0;
    if (n > 0 && n < 5) return 1.17;
    if (n >= 5 && n <= 10) return 1.27;
    return 1;
  }

  /** 층별개요 → 용도별 면적 행 (지하·지상 합산, 1층 상가는 따로, 면적 큰 순, 최대 MAX_ROWS) */
  function rowsOf(b) {
    const groups = new Map();
    const add = (key, use, area, extra) => {
      const g = groups.get(key) || { use, area: 0, adjust: 1, ...extra };
      g.area += area;
      groups.set(key, g);
    };
    for (const f of b.floors || []) {
      const use = useKey(f.purpose, f.purposeDetail);
      if (!(f.area > 0) || use === 'house' || use === 'officetel') continue;
      const k = use || 'office';
      if (SHOP_USES.includes(k) && !f.under && Number(f.no) === 1) {
        add(`${k}@1F`, k, f.area, { adjust: groundShopAdjust(b.floorsAbove), memo: '1층 상가' });
      } else {
        add(k, k, f.area);
      }
    }
    if (!groups.size) {
      const use = useKey(b.purpose, b.purposeDetail);
      if (b.totalArea > 0 && use !== 'house' && use !== 'officetel') add('main', use || 'office', b.totalArea);
    }
    return [...groups.values()]
      .sort((a, c) => (c.memo ? 1 : 0) - (a.memo ? 1 : 0) || c.area - a.area) // 1층 상가를 맨 위에 — 가감산율 확인용
      .slice(0, MAX_ROWS)
      .map(g => ({ ...g, area: Math.round(g.area * 100) / 100 }));
  }

  /** 대장 건물 1동 → 계산기 동 입력. skip이 있으면 이 계산기 대상이 아님(주택·오피스텔) */
  function toDong(b) {
    const use = useKey(b.purpose, b.purposeDetail);
    const notes = [];
    let skip = null;
    if (use === 'house') skip = '주택 — 주택 계산기에서 계산';
    else if (use === 'officetel') skip = '오피스텔 — 시가표준액 직접 입력 필요';
    const structure = structureKey(b.structure);
    if (!structure) notes.push(`구조 '${b.structure || '없음'}' → 철근콘크리트조로 두었습니다`);
    const rows = rowsOf(b);
    if (!skip && !rows.length) skip = '연면적 정보 없음';
    if (rows.some(r => r.memo) && groundShopAdjust(b.floorsAbove) === 1) notes.push('11층 이상 건물의 1층 상가 가감산율은 직접 확인하세요');
    return {
      name: String(b.name || '건물').slice(0, 40),
      main: b.main !== false,
      structure: structure || 'rc',
      builtYear: b.builtYear > 0 ? b.builtYear : 0,
      floors: Math.max(0, Number(b.floorsAbove) || 0),
      footprint: b.archArea > 0 ? b.archArea : 0,
      totalArea: b.totalArea > 0 ? b.totalArea : 0,
      purpose: [...new Set([b.purpose, b.purposeDetail].filter(Boolean))].join(' · '), // 주용도=기타용도면 한 번만
      collective: /집합/.test(b.regKind || '') || b.regKind === '표제부', // 집합건축물 표제부의 종류명은 '표제부'(일반은 '일반건축물')
      rawDong: typeof b.dong === 'string' ? b.dong : undefined, // 호 목록 조회용
      raw: { structure: b.structure, builtYear: b.builtYear, floorsAbove: b.floorsAbove },
      fire: 'auto',
      rows,
      skip,
      notes,
    };
  }

  /**
   * 집합건축물 호 1개 → 계산기 동 입력 1개. 소방분은 구(호)별로 누진(시행규칙 §75③)하고,
   * 화재위험 배수는 1동 기준(층수)이라 표제부의 지상층수를 쓴다. 면적 = 전유 + 공용.
   */
  function toUnit(u, title) {
    const use = useKey(u.purpose, u.detail);
    let skip = null;
    if (use === 'house') skip = '주택';
    else if (use === 'officetel') skip = '오피스텔 — 시가표준액 직접 입력';
    const k = use || 'office';
    const shop = SHOP_USES.includes(k) && !u.under && Number(u.floor) === 1;
    const area = Math.round(((Number(u.excl) || 0) + (Number(u.common) || 0)) * 100) / 100;
    const t = title || {};
    return {
      name: `${u.dong ? `${u.dong} ` : ''}${u.ho}${/호$/.test(u.ho) ? '' : '호'}`.slice(0, 40),
      structure: structureKey(t.structure) || 'rc',
      builtYear: t.builtYear > 0 ? t.builtYear : 0,
      floors: Math.max(0, Number(t.floorsAbove) || 0),
      fire: 'auto',
      rows: [{ use: k, area, adjust: shop ? groundShopAdjust(t.floorsAbove) : 1, ...(shop ? { memo: '1층 상가' } : {}) }],
      floorLabel: `${u.under ? '지하' : ''}${u.floor || '?'}층`,
      purpose: [...new Set([u.purpose, u.detail].filter(Boolean))].join(' · '),
      excl: Number(u.excl) || 0,
      common: Number(u.common) || 0,
      skip,
    };
  }

  /** 화면 목록 한 줄 요약 */
  function label(d) {
    const fl = d.floors ? `지상 ${d.floors}층` : '';
    const area = d.totalArea ? `연면적 ${Math.round(d.totalArea).toLocaleString('ko-KR')}㎡` : '';
    const year = d.builtYear ? `${d.builtYear}년 승인` : '';
    return [d.main ? '주건축물' : '부속건축물', d.purpose, fl, area, year].filter(Boolean).join(' · ');
  }

  return Object.freeze({ structureKey, useKey, rowsOf, toDong, toUnit, label, groundShopAdjust, MAX_ROWS });
}));
