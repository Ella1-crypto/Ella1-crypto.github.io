/* 건축물대장(국토교통부 건축HUB 건축물대장정보 서비스, 공공데이터포털) 조회 — 표제부 + 층별개요
 *
 *   GET /building?pnu=1168010100108250002 → { buildings: [{ pk, name, main, regKind, structure, purpose, …, floors: [] }] }
 *
 * 인증키는 서버 환경변수 BLD_KEY(공공데이터포털 '일반 인증키(Decoding)')에만 둔다.
 */
const BLD = 'https://apis.data.go.kr/1613000/BldRgstHubService/';
const TIMEOUT_MS = 8000;
const MAX_TITLES = 100;   // 한 지번의 동 수 상한
const MAX_FLOORS = 1000;  // 층별개요 행 상한

const text = v => (v == null ? '' : String(v).trim()).slice(0, 60);
const number = v => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** PNU 19자리 → 건축물대장 조회 키. 법정동 10 + 필지구분 1(1 일반, 2 산) + 본번 4 + 부번 4 */
export function pnuParts(pnu) {
  const s = String(pnu || '');
  if (!/^\d{19}$/.test(s)) return null;
  return {
    sigunguCd: s.slice(0, 5),
    bjdongCd: s.slice(5, 10),
    platGbCd: s[10] === '2' ? '1' : '0', // 대장: 0 대지, 1 산
    bun: s.slice(11, 15),
    ji: s.slice(15, 19),
  };
}

/** 공공데이터포털 JSON 응답 → 항목 배열(1건이면 객체, 0건이면 빈 문자열로 온다) */
export function itemsOf(data) {
  const res = data && data.response;
  const code = res && res.header && String(res.header.resultCode);
  if (code !== '00') throw new Error(`건축물대장 응답 오류(${code || '형식'})`);
  const items = res.body && res.body.items && res.body.items.item;
  if (!items) return [];
  return Array.isArray(items) ? items : [items];
}

/** 표제부·층별개요 → 화면에 필요한 값만 (동별, 층은 해당 동에 묶음) */
export function normalize(titles, floors) {
  const byPk = new Map();
  for (const f of floors.slice(0, MAX_FLOORS)) {
    const pk = text(f.mgmBldrgstPk);
    if (!byPk.has(pk)) byPk.set(pk, []);
    byPk.get(pk).push({
      under: /지하/.test(text(f.flrGbCdNm)),
      no: Number(f.flrNo) || 0,
      label: text(f.flrNoNm),
      purpose: text(f.mainPurpsCdNm),
      purposeDetail: text(f.etcPurps),
      area: number(f.area),
    });
  }
  return titles.slice(0, MAX_TITLES).map(t => {
    const pk = text(t.mgmBldrgstPk);
    const day = text(t.useAprDay);
    return {
      pk,
      name: text(t.dongNm) || text(t.bldNm) || '건물',
      main: !/부속/.test(text(t.mainAtchGbCdNm)),
      regKind: text(t.regstrKindCdNm),          // 일반건축물 / 집합건축물(표제부)
      structure: text(t.strctCdNm) || text(t.etcStrct),
      purpose: text(t.mainPurpsCdNm),
      purposeDetail: text(t.etcPurps),
      floorsAbove: Number(t.grndFlrCnt) || 0,
      floorsBelow: Number(t.ugrndFlrCnt) || 0,
      totalArea: number(t.totArea),
      archArea: number(t.archArea),
      builtYear: /^\d{8}$/.test(day) ? Number(day.slice(0, 4)) : 0,
      floors: byPk.get(pk) || [],
    };
  });
}

async function call(op, parts, rows, env) {
  const params = new URLSearchParams({ ...parts, serviceKey: env.BLD_KEY, numOfRows: String(rows), pageNo: '1', _type: 'json' });
  const res = await fetch(`${env.BLD_BASE || BLD}${op}?${params}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`건축물대장 HTTP ${res.status}`);
  const body = await res.text();
  let data;
  try { data = JSON.parse(body); } catch (_) { throw new Error('건축물대장 응답이 JSON이 아님(키 미등록 등)'); }
  return itemsOf(data);
}

/** 지번 한 곳의 건물 목록 */
export async function buildings(pnu, env) {
  const parts = pnuParts(pnu);
  if (!parts) throw new Error('PNU 형식 오류');
  const [titles, floors] = await Promise.all([
    call('getBrTitleInfo', parts, MAX_TITLES, env),
    call('getBrFlrOulnInfo', parts, MAX_FLOORS, env),
  ]);
  return normalize(titles, floors);
}
