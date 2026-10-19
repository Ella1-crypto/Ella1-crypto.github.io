/* 대지권등록목록(VWorld 국가중점데이터 ned/data/ldaregList) 응답 정리 — 순수 함수(중계 서버·테스트 공용)
 *
 *   응답: { ldaregVOList: { ldaregVOList: [{ buldDongNm, buldFloorNm, buldHoNm, ldaQotaRate: "6.9807/4263", … }], totalCount } }
 *   동·호가 없으면 "0000"으로 온다. 대지권비율은 "분자/분모"(대지 면적 중 내 몫 ㎡ / 대지 전체 ㎡).
 */
import { unitKey } from './house-price.js';

const MAX_ITEMS = 3000;

const text = v => (v == null ? '' : String(v).trim()).slice(0, 40);
const blankZero = v => (/^0+$/.test(text(v)) ? '' : text(v));

/** VWorld 응답 → 행 배열(없으면 빈 배열, 형식이 다르면 null) */
export function rowsOf(d) {
  const box = d && d.ldaregVOList;
  if (!box || typeof box !== 'object') return null;
  const list = box.ldaregVOList;
  if (Array.isArray(list)) return list;
  return list && typeof list === 'object' ? [list] : [];
}

/** "6.9807/4263" → { num, den, share(%) } — 형식이 틀리면 null */
export function parseRate(v) {
  const m = String(v == null ? '' : v).replace(/\s/g, '').match(/^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const num = Number(m[1]);
  const den = Number(m[2]);
  if (!(num > 0 && den > 0 && num <= den)) return null;
  return { num, den, share: Math.round((num / den) * 100 * 1e6) / 1e6 };
}

/** 행 → 화면용 { dong, floor, ho, rate, share } (비율이 없는 행은 뺀다) */
export function landRights(rows) {
  return (rows || [])
    .map(r => ({ dong: blankZero(r.buldDongNm), floor: blankZero(r.buldFloorNm), ho: blankZero(r.buldHoNm), rate: text(r.ldaQotaRate), p: parseRate(r.ldaQotaRate) }))
    .filter(x => x.p && x.ho)
    .slice(0, MAX_ITEMS)
    .map(({ p, ...x }) => ({ ...x, num: p.num, den: p.den, share: p.share }));
}

/** 같은 호 찾기 — 동·호 표기 차이("101동"/"101", "0000"/"")를 무시 */
export function findRight(list, dong, ho) {
  const dk = unitKey(dong);
  const hk = unitKey(ho);
  return (list || []).find(x => unitKey(x.ho) === hk && unitKey(x.dong) === dk) || null;
}
