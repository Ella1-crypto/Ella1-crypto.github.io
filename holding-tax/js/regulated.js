/* 조정대상지역 판정 — 주소 문자열 + 기준일 → 지정 여부
 * 브라우저: window.Regulated / Node: module.exports
 *
 * 2023.1.5. 이후는 지정 이력을 모두 넣어 자동으로 판정한다.
 *   · 서울 강남·서초·송파·용산: 2016.11.3. 지정 이후 계속
 *   · 서울 나머지 21개 구: 2016.11.3.~2023.1.4. 지정 → 2023.1.5. 해제 → 2025.10.16. 재지정
 *   · 경기 12곳: 2025.10.16. 지정 (과천·광명·하남·의왕, 성남 분당·수정·중원, 수원 영통·장안·팔달, 안양 동안, 용인 수지)
 *   · 경기 3곳: 2026.7.1. 지정 (화성 동탄구, 용인 기흥구, 구리) — 국토교통부공고 제2026-882호
 * 2023.1.4. 이전 서울 밖 지역은 지정·해제가 잦아(2020~2022년 전국 100여 곳) 자동 판정하지 않고 '확인 필요'로 돌려준다.
 * 목록 확인일: 2026-10-16 (2026.7.1. 이후 추가 지정·해제 공고 없음). 새 공고가 나오면 AREAS만 고친다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Regulated = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CHECKED = '2026-10-16';
  const FIRST = '2016-11-03';     // 조정대상지역 제도 첫 지정
  const FULL_FROM = '2023-01-05'; // 이날부터는 지정 이력을 모두 갖고 있다
  const SEOUL_GU = ['종로', '중', '용산', '성동', '광진', '동대문', '중랑', '성북', '강북', '도봉', '노원', '은평', '서대문', '마포', '양천', '강서', '구로', '금천', '영등포', '동작', '관악', '서초', '강남', '송파', '강동'];
  const SEOUL_CORE = ['강남', '서초', '송파', '용산'];
  const NOTICE_2510 = '2025.10.16. 지정(10·15 대책)';
  const NOTICE_2607 = '2026.7.1. 지정(국토교통부공고 제2026-882호)';

  // [이름, 시 이름, 구 이름 또는 null, 지정 구간들]
  const GYEONGGI = [
    ['과천시', '과천', null, '2025-10-16'], ['광명시', '광명', null, '2025-10-16'], ['하남시', '하남', null, '2025-10-16'], ['의왕시', '의왕', null, '2025-10-16'],
    ['성남시 분당구', '성남', '분당', '2025-10-16'], ['성남시 수정구', '성남', '수정', '2025-10-16'], ['성남시 중원구', '성남', '중원', '2025-10-16'],
    ['수원시 영통구', '수원', '영통', '2025-10-16'], ['수원시 장안구', '수원', '장안', '2025-10-16'], ['수원시 팔달구', '수원', '팔달', '2025-10-16'],
    ['안양시 동안구', '안양', '동안', '2025-10-16'], ['용인시 수지구', '용인', '수지', '2025-10-16'],
    ['화성시 동탄구', '화성', '동탄', '2026-07-01'], ['용인시 기흥구', '용인', '기흥', '2026-07-01'], ['구리시', '구리', null, '2026-07-01'],
  ];

  const PARTIAL_CITY = ['성남', '수원', '안양', '용인', '화성'];
  const SIDO_RE = /^(부산|대구|인천|광주|대전|울산|세종|강원|충청|충북|충남|전라|전북|전남|경상|경북|경남|제주|경기)/;
  const norm = s => String(s || '').replace(/\s+/g, '').replace(/특별시|광역시|특별자치시|특별자치도/g, '');
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  /** 주소에서 지역 찾기 → { name, periods: [[from, to|null]], note } | null */
  function locate(address) {
    const a = norm(address);
    if (!a) return null;
    if (/^서울/.test(a)) {
      const gu = SEOUL_GU.find(g => new RegExp(`^서울(시)?${g}구`).test(a));
      if (!gu) return { name: '서울특별시', periods: [], partial: true };
      const core = SEOUL_CORE.includes(gu);
      return {
        name: `서울특별시 ${gu}구`,
        periods: core ? [[FIRST, null]] : [[FIRST, '2023-01-04'], ['2025-10-16', null]],
        note: core ? '2016.11.3. 지정 이후 계속' : `2023.1.5. 해제 → ${NOTICE_2510}`,
        seoul: true,
      };
    }
    const g = GYEONGGI.find(([, city, gu]) => new RegExp(`^(경기도?)?${city}시?${gu ? `${gu}구` : ''}`).test(a));
    if (g) return { name: `경기도 ${g[0]}`, periods: [[g[3], null]], note: g[3] === '2026-07-01' ? NOTICE_2607 : NOTICE_2510 };
    // 일부 구만 지정된 시(수원·안양·용인·화성)는 구가 없으면 판정할 수 없다. 성남은 3개 구 모두 지정.
    const city = PARTIAL_CITY.find(c => new RegExp(`^(경기도?)?${c}시?`).test(a));
    if (city === '성남') return { name: '경기도 성남시', periods: [['2025-10-16', null]], note: NOTICE_2510 };
    if (city && !new RegExp(`^(경기도?)?${city}시?[가-힣]{1,3}구`).test(a)) return { name: `경기도 ${city}시`, periods: [], partial: true, partialNote: `${city}시는 일부 구만 지정돼 있어 구 이름까지 넣어 주세요` };
    // 시·도나 시·군 이름으로 시작해야 '아님'으로 판정한다(동 이름만 넣은 경우 등은 확인 필요)
    if (!SIDO_RE.test(a) && !/^[가-힣]{1,4}(시|군)/.test(a)) return { name: '', periods: [], partial: true, partialNote: '시·도부터 넣어 주세요 (예: 경기도 수원시 영통구)' };
    return { name: '', periods: [], other: true };
  }

  /**
   * @param {string} address 소재지 주소(시·군·구까지 있으면 된다)
   * @param {string} date 기준일 YYYY-MM-DD (취득일·양도일)
   * @returns {{status:'yes'|'no'|'unknown', name:string, note:string}}
   */
  function check(address, date) {
    const loc = locate(address);
    if (!loc) return { status: 'unknown', name: '', note: '주소를 넣으면 조정대상지역을 자동으로 확인합니다' };
    if (loc.partial) return { status: 'unknown', name: loc.name, note: loc.partialNote || '서울은 구 이름까지 넣어 주세요' };
    if (!DATE_RE.test(date || '')) return { status: 'unknown', name: loc.name, note: '날짜를 넣으면 판정합니다' };
    if (date < FIRST) return { status: 'no', name: loc.name, note: '조정대상지역 제도 시행(2016.11.3.) 전' };
    const on = loc.periods.some(([from, to]) => date >= from && (!to || date <= to));
    if (on) return { status: 'yes', name: loc.name, note: loc.note };
    if (date < FULL_FROM && !loc.seoul) return { status: 'unknown', name: loc.name, note: '2023년 이전 서울 밖 지역은 당시 국토교통부 공고로 직접 확인하세요' };
    return { status: 'no', name: loc.name || '입력한 지역', note: `조정대상지역 아님(${CHECKED} 기준 목록)` };
  }

  const LIST_TEXT = `서울 25개 구 전역, 경기 과천·광명·하남·의왕·구리, 성남 분당·수정·중원, 수원 영통·장안·팔달, 안양 동안, 용인 수지·기흥, 화성 동탄 (${CHECKED} 확인)`;

  return Object.freeze({ CHECKED, LIST_TEXT, locate, check });
}));
