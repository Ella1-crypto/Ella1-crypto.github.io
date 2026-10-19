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
    [/유흥주점/, 'bar'],
    [/단란주점/, 'danran'],
    [/종합병원/, 'generalHospital'],
    [/장례/, 'funeral'],
    [/목욕/, 'bathSmall'],
    [/세차|정비공장|폐차|검사장|차고/, 'autoService'],
    [/노유자|노인복지|아동관련|사회복지|어린이집/, 'welfare'],
    [/예식|공연|집회|전시|관람|영화관/, 'assembly'],
    [/방송|전신전화|통신용/, 'broadcast'],
    [/발전시설|발전소|변전/, 'power'], // '발전기실' 같은 부속실은 제외
    [/고물상|재활용|폐기물|하수|정수/, 'recycle'],
    [/축사|작물재배|온실|버섯재배/, 'farmShed'],
    [/여객자동차터미널|철도|공항|항만/, 'transport'],
    [/오피스텔/, 'officetel'],
    [/골프|스키|수영|빙상|승마|경주장|종합체육/, 'sports'],
    [/운동|체육/, 'sportsOther'],
    [/학원|교습/, 'academy'],
    [/의원/, 'clinic'], // 치과의원·한의원 포함, 치과병원은 병원
    [/업무/, 'office'],
    [/근린생활|판매|상점|음식/, 'retail'],
    [/도매|소매시장|시장/, 'market'],
    [/모텔|여관/, 'motel'],
    [/숙박|호텔/, 'hotel'],
    [/의료|병원/, 'hospital'],
    [/주차/, 'parking'],
    [/냉동|냉장/, 'coldStorage'],
    [/물류|집배송|터미널/, 'logistics'],
    [/창고/, 'warehouse'],
    [/위험물|주유/, 'gasStation'],
    [/지식산업/, 'kic'],
    [/공장|제조/, 'factory'],
    [/교육|연구|학교/, 'school'],
    [/종교/, 'religion'],
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

  const SHOP_USES = ['retail', 'market', 'mall'];

  /** 층수 구간별 값 — [상한층수, 값] 순서, 마지막은 상한 없음 */
  const band = (n, table) => (table.find(([max]) => n <= max) || table[table.length - 1])[1];

  /**
   * 건축물 가감산율 — 「지방세 시가표준액 조사·산정 기준」(행정안전부 훈령, 2026.6.1. 시행) 별표 8.
   * 층수는 지하층·옥탑 제외 지상층수. 둘 이상 해당하면 더한다(제19조③4).
   * 상가부분만: 1층 가산, 2층 가산(11층 이상 건물), 지하 감산, 5층 이상 감산. 건물 전체: 고층·초고층 가산.
   * 인텔리전트 빌딩·층고·무벽 등 대장으로 알 수 없는 항목은 화면에서 직접 고친다.
   * @returns {{ adjust: number, memo: string }}
   */
  function floorAdjust(floorsAbove, floor, use) {
    const n = Number(floorsAbove) || 0;
    const no = Number(floor && floor.no) || 0;
    const under = Boolean(floor && floor.under);
    const parts = [];
    if (SHOP_USES.includes(use) && no > 0) {
      if (under) {
        parts.push(no >= 2 ? ['지하2층 이하 상가', -0.40] : ['지하1층 상가', n <= 10 ? -0.25 : -0.20]);
      } else if (no === 1 && n >= 2) { // 단층건물 제외
        parts.push(['1층 상가', band(n, [[4, 0.17], [10, 0.27], [20, 0.32], [30, 0.36], [Infinity, 0.46]])]);
      } else if (no === 2 && n >= 11) {
        parts.push(['2층 상가', band(n, [[20, 0.04], [30, 0.05], [Infinity, 0.06]])]);
      } else if (no >= 5 && n >= 5) {
        parts.push(['5층 이상 상가', -band(n, [[10, 0.12], [20, 0.05], [30, 0.02], [Infinity, 0.01]])]);
      }
    }
    // 고층(30층 이상)·초고층(50층 이상) — 건축법 정의는 높이 기준도 있으나 대장 층수로 판정
    if (n >= 50) parts.push(['초고층', band(n, [[59, 0.06], [79, 0.07], [Infinity, 0.08]])]);
    else if (n >= 30) parts.push(['고층', 0.01]);
    const sum = parts.reduce((t, [, v]) => t + v, 0);
    const memo = parts.map(([k, v]) => `${k} ${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`).join(', ');
    return { adjust: Math.round((1 + sum) * 100) / 100, memo };
  }

  /** 층별개요 → 용도·가감산율별 면적 행 (지하·지상 합산, 가감산 붙은 줄을 위로, 최대 MAX_ROWS) */
  function rowsOf(b) {
    const groups = new Map();
    const add = (use, area, fa) => {
      const key = `${use}|${fa.adjust}|${fa.memo}`;
      const g = groups.get(key) || { use, area: 0, adjust: fa.adjust, ...(fa.memo ? { memo: fa.memo } : {}) };
      g.area += area;
      groups.set(key, g);
    };
    for (const f of b.floors || []) {
      const use = useKey(f.purpose, f.purposeDetail);
      if (!(f.area > 0) || use === 'house' || use === 'officetel') continue;
      const k = use || 'office';
      add(k, f.area, floorAdjust(b.floorsAbove, f, k));
    }
    if (!groups.size) {
      const use = useKey(b.purpose, b.purposeDetail);
      if (b.totalArea > 0 && use !== 'house' && use !== 'officetel') add(use || 'office', b.totalArea, floorAdjust(b.floorsAbove, null, use || 'office'));
    }
    return [...groups.values()]
      .sort((a, c) => (c.adjust !== 1 ? 1 : 0) - (a.adjust !== 1 ? 1 : 0) || c.area - a.area)
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
      raw: { structure: b.structure, builtYear: b.builtYear, floorsAbove: b.floorsAbove, archArea: b.archArea > 0 ? b.archArea : 0 },
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
    const fa = floorAdjust(title && title.floorsAbove, { under: u.under, no: u.floor }, k);
    const area = Math.round(((Number(u.excl) || 0) + (Number(u.common) || 0)) * 100) / 100;
    const t = title || {};
    return {
      name: `${u.dong ? `${u.dong} ` : ''}${u.ho}${/호$/.test(u.ho) ? '' : '호'}`.slice(0, 40),
      structure: structureKey(t.structure) || 'rc',
      builtYear: t.builtYear > 0 ? t.builtYear : 0,
      floors: Math.max(0, Number(t.floorsAbove) || 0),
      fire: 'auto',
      rows: [{ use: k, area, adjust: fa.adjust, ...(fa.memo ? { memo: fa.memo } : {}) }],
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

  return Object.freeze({ structureKey, useKey, rowsOf, toDong, toUnit, label, floorAdjust, MAX_ROWS });
}));
