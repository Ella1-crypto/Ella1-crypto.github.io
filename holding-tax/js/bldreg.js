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

  /** 층별개요 → 용도별 면적 행 (지하·지상 합산, 면적 큰 순, 최대 MAX_ROWS) */
  function rowsOf(b) {
    const byUse = new Map();
    for (const f of b.floors || []) {
      const use = useKey(f.purpose, f.purposeDetail);
      if (!(f.area > 0) || use === 'house' || use === 'officetel') continue;
      const k = use || 'office';
      byUse.set(k, (byUse.get(k) || 0) + f.area);
    }
    if (!byUse.size) {
      const use = useKey(b.purpose, b.purposeDetail);
      if (b.totalArea > 0 && use !== 'house' && use !== 'officetel') byUse.set(use || 'office', b.totalArea);
    }
    return [...byUse.entries()]
      .sort((a, c) => c[1] - a[1])
      .slice(0, MAX_ROWS)
      .map(([use, area]) => ({ use, area: Math.round(area * 100) / 100, adjust: 1 }));
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
      collective: /집합/.test(b.regKind || ''),
      fire: 'auto',
      rows,
      skip,
      notes,
    };
  }

  /** 화면 목록 한 줄 요약 */
  function label(d) {
    const fl = d.floors ? `지상 ${d.floors}층` : '';
    const area = d.totalArea ? `연면적 ${Math.round(d.totalArea).toLocaleString('ko-KR')}㎡` : '';
    const year = d.builtYear ? `${d.builtYear}년 승인` : '';
    return [d.main ? '주건축물' : '부속건축물', d.purpose, fl, area, year].filter(Boolean).join(' · ');
  }

  return Object.freeze({ structureKey, useKey, rowsOf, toDong, label, MAX_ROWS });
}));
