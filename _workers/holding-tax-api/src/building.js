/* 건축물대장(국토교통부 건축HUB 건축물대장정보 서비스, 공공데이터포털) 조회 — 표제부 + 층별개요
 *
 *   GET /building?pnu=1168010100108250002 → { buildings: [{ pk, name, main, regKind, structure, purpose, …, floors: [] }] }
 *   GET /units?pnu=…&dong=A동               → { units: [{ dong, ho, under, floor, purpose, detail, excl, common }], truncated }
 *     (집합건축물 전유공용면적 — 호별 전유·공용면적)
 *
 * 인증키는 서버 환경변수 BLD_KEY(공공데이터포털 '일반 인증키(Decoding)')에만 둔다.
 */
const BLD = 'https://apis.data.go.kr/1613000/BldRgstHubService/';
const TIMEOUT_MS = 8000;
const MAX_TITLES = 100;   // 한 지번의 동 수 상한
const MAX_FLOORS = 1000;  // 층별개요 행 상한
const UNIT_PAGE = 1000;   // 전유공용면적 한 번에 받는 행
const UNIT_PAGES = 8;     // 최대 8,000행(호마다 전유 1 + 공용 여러 행)
const MAX_UNITS = 2000;   // 화면에 돌려주는 호 수 상한

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
      dong: text(t.dongNm),                       // 호 목록(/units) 조회용 원래 동 이름(비어 있을 수 있음)
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

async function call(op, parts, rows, env, page = 1) {
  const params = new URLSearchParams({ ...parts, serviceKey: env.BLD_KEY, numOfRows: String(rows), pageNo: String(page), _type: 'json' });
  const res = await fetch(`${env.BLD_BASE || BLD}${op}?${params}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`건축물대장 HTTP ${res.status}`);
  const body = await res.text();
  let data;
  try { data = JSON.parse(body); } catch (_) { throw new Error('건축물대장 응답이 JSON이 아님(키 미등록 등)'); }
  const items = itemsOf(data);
  items.total = Number(data.response.body && data.response.body.totalCount) || items.length;
  return items;
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

/** 전유공용면적 행 → 호별 합계. 전유 행의 층·용도를 쓰고, 공용면적은 그 호에 딸린 행을 더한다 */
export function unitsOf(rows) {
  const byHo = new Map();
  for (const r of rows) {
    const dong = text(r.dongNm);
    const ho = text(r.hoNm);
    if (!ho) continue;
    const key = `${dong}|${ho}`;
    const u = byHo.get(key) || { dong, ho, under: false, floor: 0, purpose: '', detail: '', excl: 0, common: 0 };
    const area = number(r.area);
    if (/전유/.test(text(r.exposPubuseGbCdNm))) {
      u.excl += area;
      const under = /지하/.test(text(r.flrGbCdNm));
      const floor = Number(r.flrNo) || 0;
      if (!u.purpose || (!under && (u.under || floor < u.floor))) { // 복층이면 가장 낮은 지상층
        Object.assign(u, { under, floor, purpose: text(r.mainPurpsCdNm), detail: text(r.etcPurps) });
      }
    } else {
      u.common += area;
    }
    byHo.set(key, u);
  }
  const round = n => Math.round(n * 100) / 100;
  return [...byHo.values()]
    .filter(u => u.excl > 0)
    .map(u => ({ ...u, excl: round(u.excl), common: round(u.common) }))
    .sort((a, b) => a.dong.localeCompare(b.dong, 'ko') || (a.under - b.under) || (a.floor - b.floor) || a.ho.localeCompare(b.ho, 'ko', { numeric: true }));
}

/** 집합건축물 호 목록 — dong을 주면 그 동만 */
export async function units(pnu, dong, env) {
  const parts = pnuParts(pnu);
  if (!parts) throw new Error('PNU 형식 오류');
  const query = dong ? { ...parts, dongNm: dong } : parts;
  const first = await call('getBrExposPubuseAreaInfo', query, UNIT_PAGE, env, 1);
  const pages = Math.min(UNIT_PAGES, Math.ceil(first.total / UNIT_PAGE));
  const rest = await Promise.all(Array.from({ length: Math.max(0, pages - 1) }, (_, i) => call('getBrExposPubuseAreaInfo', query, UNIT_PAGE, env, i + 2)));
  const rows = first.concat(...rest).filter(r => !dong || text(r.dongNm) === dong);
  const all = unitsOf(rows);
  return { units: all.slice(0, MAX_UNITS), truncated: all.length > MAX_UNITS || first.total > UNIT_PAGES * UNIT_PAGE };
}
