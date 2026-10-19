/* 주택 공시가격(VWorld 국가중점데이터) 응답 정리 — 순수 함수(중계 서버·테스트 공용)
 *
 *   공동주택가격 ned/data/getApartHousingPriceAttr : pnu·stdrYear → 호별 { aphusNm, dongNm, floorNm, hoNm, prvuseAr, pblntfPc, stdrYear }
 *   개별주택가격 ned/data/getIndvdHousingPriceAttr : pnu·stdrYear → { housePc, stdrYear, … }
 *
 * 동·호 표기는 "101동"·"101", "1001호"·"1001"처럼 섞여 오므로 숫자·글자만 남겨 비교한다.
 */
const MAX_ITEMS = 300; // 화면에 돌려주는 호 수 상한

const text = v => (v == null ? '' : String(v).trim()).slice(0, 60);
const won = v => {
  const n = Number(String(v == null ? '' : v).replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

/** "101동" → "101", "B동" → "b", "제1001호" → "1001" — 비교용 */
export function unitKey(v) {
  return String(v == null ? '' : v).toLowerCase().replace(/제|동|호|층|\s|-/g, '');
}

/** VWorld ned/data 응답에서 field 배열 꺼내기 — 최상위 키 이름이 API마다 달라 첫 번째 객체를 쓴다 */
export function fieldsOf(d) {
  if (!d || typeof d !== 'object') return null;
  for (const v of Object.values(d)) {
    if (v && typeof v === 'object' && ('field' in v || 'resultCode' in v)) {
      const f = v.field;
      if (Array.isArray(f)) return f;
      return f && typeof f === 'object' ? [f] : [];
    }
  }
  return null;
}

/** 공동주택 호 목록 → 화면용. dong·ho를 주면 그에 맞는 것만(호만 주면 모든 동에서) */
export function apartItems(fields, dong, ho) {
  const dk = unitKey(dong);
  const hk = unitKey(ho);
  return (fields || [])
    .map(f => ({
      complex: text(f.aphusNm),
      dong: text(f.dongNm),
      floor: text(f.floorNm),
      ho: text(f.hoNm),
      area: Number(f.prvuseAr) > 0 ? Math.round(Number(f.prvuseAr) * 100) / 100 : 0,
      price: won(f.pblntfPc),
      year: Number(f.stdrYear) || 0,
    }))
    .filter(it => it.price > 0 && (!dk || unitKey(it.dong) === dk) && (!hk || unitKey(it.ho) === hk))
    .sort((a, b) => a.dong.localeCompare(b.dong, 'ko', { numeric: true }) || a.ho.localeCompare(b.ho, 'ko', { numeric: true }))
    .slice(0, MAX_ITEMS);
}

/** 개별주택(단독·다가구) — 지번에 한 건 */
export function indvdItem(fields) {
  const f = (fields || []).find(x => won(x.housePc) > 0);
  return f ? { price: won(f.housePc), year: Number(f.stdrYear) || 0, area: Number(f.ladRegstrAr) > 0 ? Number(f.ladRegstrAr) : 0 } : null;
}
