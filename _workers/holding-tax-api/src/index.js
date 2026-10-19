/* 보유세맵 중계 서버 (Cloudflare Worker)
 *
 * 브라우저에서 직접 부를 수 없는 VWorld 토지특성 API(2026년 공시지가·토지대장 면적·지목·용도지역)를
 * 대신 불러 준다. 인증키는 Worker 비밀값(VWORLD_KEY)에만 둔다.
 *
 *   GET /search?q=역삼동 825        → 주소 후보 [{title, sub, lat, lng}]
 *   GET /parcel?lat=37.5&lng=127.0  → 필지 1건 {pnu, addr, jibun, jimok, area, price, priceYear, zone, geom, …}
 *   GET /building?pnu=…(19자리)     → 건축물대장 표제부·층별개요 {buildings: […]} (공공데이터포털 키 BLD_KEY, src/building.js)
 *   GET /units?pnu=…&dong=…         → 집합건축물 호별 전유·공용면적 {units: […], truncated}
 *   GET /house-price?pnu=…&dong=&ho= → 주택 공시가격 {kind:'apart', items} | {kind:'indvd', item} | {kind:'none'}
 */
import { buildings, units } from './building.js';
import { fieldsOf, apartItems, indvdItem } from './house-price.js';

const VWORLD = 'http://api.vworld.kr/'; // Workers에서 https 연결 시 520(2026-10-15 실측)
const ATTEMPTS = 3;            // VWorld가 정상 키에도 간헐적으로 INCORRECT_KEY를 돌려준다(2026-10-15 실측)
const RETRY_DELAY_MS = 350;
const TIMEOUT_MS = 8000;
const CACHE_PARCEL_SEC = 7 * 24 * 3600;
const CACHE_SEARCH_SEC = 24 * 3600;
const CACHE_BUILDING_SEC = 24 * 3600;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 90;           // IP당 분당 요청(인스턴스 단위 근사치)
const MAX_QUERY = 80;
const KOREA = { latMin: 32.5, latMax: 39.0, lngMin: 124.0, lngMax: 132.0 };

const JIMOK_CODE = {
  전: '전', 답: '답', 과: '과수원', 목: '목장용지', 임: '임야', 광: '광천지', 염: '염전', 대: '대', 장: '공장용지',
  학: '학교용지', 차: '주차장', 주: '주유소용지', 창: '창고용지', 도: '도로', 철: '철도용지', 제: '제방', 천: '하천',
  구: '구거', 유: '유지', 양: '양어장', 수: '수도용지', 공: '공원', 체: '체육용지', 원: '유원지', 종: '종교용지',
  사: '사적지', 묘: '묘지', 잡: '잡종지',
};

const hits = new Map(); // ip → [timestamps]

function allowedOrigin(request, env) {
  const origin = request.headers.get('Origin') || '';
  const list = String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  return list.includes(origin) ? origin : null;
}

function json(body, status, origin, maxAge = 0) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': maxAge ? `public, max-age=${maxAge}` : 'no-store',
    'X-Content-Type-Options': 'nosniff',
    Vary: 'Origin',
  };
  if (origin) headers['Access-Control-Allow-Origin'] = origin;
  return new Response(JSON.stringify(body), { status, headers });
}

function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter(t => now - t < RATE_WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.delete(hits.keys().next().value); // 메모리 보호 — 가장 오래된 IP부터
  return recent.length > RATE_MAX;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** VWorld 호출 — 키 오류·일시 오류는 몇 번 더 시도한다. ok(data)가 true일 때만 성공으로 본다. */
async function vworld(path, params, env, ok) {
  const url = `${env.VWORLD_BASE || VWORLD}${path}?${new URLSearchParams({ ...params, format: 'json', key: env.VWORLD_KEY, domain: env.VWORLD_DOMAIN })}`;
  let last = null;
  for (let i = 0; i < ATTEMPTS; i += 1) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      const data = await res.json();
      if (ok(data)) return data;
      last = data;
    } catch (err) {
      last = { error: err.message };
    }
    await sleep(RETRY_DELAY_MS * (i + 1));
  }
  const msg = JSON.stringify(last || {}).slice(0, 200);
  throw new Error(`VWorld 응답 오류: ${msg}`);
}

const reqOk = d => d && d.response && (d.response.status === 'OK' || d.response.status === 'NOT_FOUND');

async function search(q, env) {
  const run = category => vworld('req/search', {
    service: 'search', request: 'search', version: '2.0', crs: 'EPSG:4326', size: '8', page: '1', query: q, type: 'address', category,
  }, env, reqOk);
  const toItems = (d, category) => ((d.response.result && d.response.result.items) || []).map(it => ({
    title: (it.address && (it.address.parcel || it.address.road)) || it.title || '',
    sub: (it.address && (category === 'parcel' ? it.address.road : it.address.parcel)) || '',
    lat: Number(it.point && it.point.y),
    lng: Number(it.point && it.point.x),
  })).filter(it => Number.isFinite(it.lat) && Number.isFinite(it.lng));
  const parcel = toItems(await run('parcel'), 'parcel');
  return parcel.length ? parcel : toItems(await run('road'), 'road');
}

function toLatLngPolys(geometry) {
  if (!geometry || !Array.isArray(geometry.coordinates)) return null;
  const swap = ring => ring.map(([x, y]) => [Math.round(y * 1e7) / 1e7, Math.round(x * 1e7) / 1e7]);
  if (geometry.type === 'Polygon') return [geometry.coordinates.map(swap)];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.map(poly => poly.map(swap));
  return null;
}

function splitJibun(raw) {
  const m = String(raw || '').trim().match(/^(산)?\s*(\d+(?:-\d+)?)\s*([가-힣])?$/);
  if (!m) return { no: String(raw || ''), jimok: '' };
  return { no: `${m[1] ? '산 ' : ''}${m[2]}`, jimok: (m[3] && JIMOK_CODE[m[3]]) || '' };
}

function sggName(addr) {
  const parts = String(addr || '').split(/\s+/).filter(Boolean);
  const end = parts.findIndex(p => !/(도|시|군|구)$/.test(p));
  return parts.slice(0, end < 0 ? parts.length : end).join(' ');
}

const PRICE_PAGE = 1000;
const PRICE_PAGES = 5; // 한 지번 최대 5,000호

/** 공동주택가격 한 해치 — 1,000행씩 최대 5쪽 */
async function apartYear(pnu, y, env) {
  const ok = d => fieldsOf(d) !== null;
  let all = [];
  for (let page = 1; page <= PRICE_PAGES; page += 1) {
    const d = await vworld('ned/data/getApartHousingPriceAttr', { pnu, stdrYear: String(y), numOfRows: String(PRICE_PAGE), pageNo: String(page) }, env, ok);
    const f = fieldsOf(d) || [];
    all = all.concat(f);
    if (f.length < PRICE_PAGE) break;
  }
  return all;
}

/** 주택 공시가격 — 공동주택(동·호) 먼저, 없으면 개별주택. 올해 값이 없으면 전년도, 작년 값도 붙인다(세부담·과표상한용) */
async function housePrice(pnu, dong, ho, env) {
  const year = new Date().getUTCFullYear();
  for (const y of [year, year - 1]) {
    const items = apartItems(await apartYear(pnu, y, env), dong, ho);
    if (!items.length) continue;
    const before = apartItems(await apartYear(pnu, y - 1, env), dong, ho);
    const key = it => `${it.dong}|${it.ho}`;
    const prev = new Map(before.map(it => [key(it), it.price]));
    return { kind: 'apart', year: y, items: items.map(it => ({ ...it, prevPrice: prev.get(key(it)) || 0 })) };
  }
  const ok = d => fieldsOf(d) !== null;
  for (const y of [year, year - 1]) {
    const d = await vworld('ned/data/getIndvdHousingPriceAttr', { pnu, stdrYear: String(y), numOfRows: '10', pageNo: '1' }, env, ok);
    const item = indvdItem(fieldsOf(d));
    if (!item) continue;
    const p = await vworld('ned/data/getIndvdHousingPriceAttr', { pnu, stdrYear: String(y - 1), numOfRows: '10', pageNo: '1' }, env, ok);
    const prev = indvdItem(fieldsOf(p));
    return { kind: 'indvd', year: y, item: { ...item, prevPrice: prev ? prev.price : 0 } };
  }
  return { kind: 'none' };
}

/**
 * 임시 진단 — 대지권등록정보 API 이름을 몰라 후보를 한 번씩(재시도 없이) 불러 응답 모양만 돌려준다.
 * 키 값은 응답에서 지운다. 어떤 후보가 맞는지 확인하면 이 경로는 지운다.
 */
const LAND_RIGHT_CANDIDATES = ['ldaregList', 'getLdaregList', 'ldaRegList', 'getLandRightAttr', 'getLdaregAttr', 'buldRlnmList'];
async function probeLandRight(pnu, env) {
  const out = {};
  for (const op of LAND_RIGHT_CANDIDATES) {
    const url = `${env.VWORLD_BASE || VWORLD}ned/data/${op}?${new URLSearchParams({ pnu, format: 'json', numOfRows: '3', pageNo: '1', key: env.VWORLD_KEY, domain: env.VWORLD_DOMAIN })}`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      const body = (await res.text()).split(env.VWORLD_KEY).join('***').slice(0, 1500);
      out[op] = { http: res.status, body };
    } catch (err) {
      out[op] = { error: String(err.message).slice(0, 200) };
    }
  }
  return out;
}

/** 토지특성 — 올해 값이 없으면 전년도 */
async function landCharacteristics(pnu, env) {
  const year = new Date().getUTCFullYear();
  const ok = d => d && d.landCharacteristicss && (Array.isArray(d.landCharacteristicss.field) || d.landCharacteristicss.resultCode === 'INFO-000');
  for (const y of [year, year - 1]) {
    try {
      const d = await vworld('ned/data/getLandCharacteristics', { pnu, stdrYear: String(y), numOfRows: '1', pageNo: '1' }, env, ok);
      const f = d.landCharacteristicss.field && d.landCharacteristicss.field[0];
      if (f) {
        return {
          area: Number(f.lndpclAr) || 0,
          jimok: String(f.lndcgrCodeNm || ''),
          zone: String(f.prposArea1Nm || ''),
          zone2: String(f.prposArea2Nm || ''),
          price: Number(f.pblntfPclnd) || 0,
          priceYear: Number(f.stdrYear) || y,
          use: String(f.ladUseSittnNm || ''),
        };
      }
    } catch (_) {
      // 토지특성은 보조 정보 — 실패해도 지적도 값으로 응답한다
    }
  }
  return null;
}

async function parcel(lat, lng, env) {
  const d = await vworld('req/data', {
    service: 'data', request: 'GetFeature', data: 'LP_PA_CBND_BUBUN', crs: 'EPSG:4326',
    size: '1', page: '1', geometry: 'true', attribute: 'true', geomFilter: `POINT(${lng} ${lat})`,
  }, env, reqOk);
  const fc = d.response.result && d.response.result.featureCollection;
  const f = fc && fc.features && fc.features[0];
  if (!f) return null;
  const pr = f.properties || {};
  const pnu = String(pr.pnu || '');
  const j = splitJibun(pr.jibun);
  const lc = /^\d{19}$/.test(pnu) ? await landCharacteristics(pnu, env) : null;
  return {
    pnu,
    addr: String(pr.addr || ''),
    jibun: j.no,
    jimok: (lc && lc.jimok) || j.jimok,
    area: lc ? lc.area : 0,
    areaSource: lc && lc.area ? 'register' : 'polygon',
    price: lc && lc.price ? lc.price : Number(pr.jiga) || 0,
    priceYear: lc && lc.price ? lc.priceYear : Number(pr.gosi_year) || null,
    zone: lc ? lc.zone : '',
    zone2: lc ? lc.zone2 : '',
    landUse: lc ? lc.use : '',
    sgg: pnu.slice(0, 5),
    sggName: sggName(pr.addr),
    geom: toLatLngPolys(f.geometry),
  };
}

async function handle(request, env, ctx) {
  const origin = allowedOrigin(request, env);
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: origin ? 204 : 403, headers: origin ? {
      'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Max-Age': '86400', Vary: 'Origin',
    } : {} });
  }
  if (request.method !== 'GET') return json({ error: '허용되지 않은 요청' }, 405, origin);
  if (!origin) return json({ error: '허용되지 않은 출처' }, 403, null);
  if (!env.VWORLD_KEY) return json({ error: '서버 키가 설정되지 않았습니다' }, 500, origin);
  if (rateLimited(request.headers.get('CF-Connecting-IP') || 'unknown')) return json({ error: '요청이 너무 많습니다. 잠시 후 다시 시도하세요.' }, 429, origin);

  const url = new URL(request.url);
  const cache = caches.default;
  const cacheKey = new Request(`https://cache.local${url.pathname}?${url.searchParams}`, { method: 'GET' });

  let maxAge;
  let produce;
  if (url.pathname === '/search') {
    const q = (url.searchParams.get('q') || '').trim();
    if (!q || q.length > MAX_QUERY) return json({ error: '검색어를 1~80자로 입력하세요' }, 400, origin);
    maxAge = CACHE_SEARCH_SEC;
    produce = async () => ({ items: await search(q, env) });
  } else if (url.pathname === '/parcel') {
    const lat = Number(url.searchParams.get('lat'));
    const lng = Number(url.searchParams.get('lng'));
    if (!(lat > KOREA.latMin && lat < KOREA.latMax && lng > KOREA.lngMin && lng < KOREA.lngMax)) {
      return json({ error: '국내 좌표가 아닙니다' }, 400, origin);
    }
    maxAge = CACHE_PARCEL_SEC;
    produce = async () => ({ parcel: await parcel(lat.toFixed(7), lng.toFixed(7), env) });
  } else if (url.pathname === '/building') {
    const pnu = url.searchParams.get('pnu') || '';
    if (!/^\d{19}$/.test(pnu)) return json({ error: 'PNU는 숫자 19자리입니다' }, 400, origin);
    if (!env.BLD_KEY) return json({ error: '건축물대장 키가 아직 설정되지 않았습니다' }, 503, origin);
    maxAge = CACHE_BUILDING_SEC;
    produce = async () => ({ buildings: await buildings(pnu, env) });
  } else if (url.pathname === '/probe-land-right') { // 임시 진단(대지권 API 확인 후 삭제)
    const pnu = url.searchParams.get('pnu') || '';
    if (!/^\d{19}$/.test(pnu)) return json({ error: 'PNU는 숫자 19자리입니다' }, 400, origin);
    maxAge = 60;
    produce = async () => probeLandRight(pnu, env);
  } else if (url.pathname === '/house-price') {
    const pnu = url.searchParams.get('pnu') || '';
    const dong = (url.searchParams.get('dong') || '').trim();
    const ho = (url.searchParams.get('ho') || '').trim();
    if (!/^\d{19}$/.test(pnu)) return json({ error: 'PNU는 숫자 19자리입니다' }, 400, origin);
    if (dong.length > 20 || ho.length > 20) return json({ error: '동·호가 너무 깁니다' }, 400, origin);
    maxAge = CACHE_SEARCH_SEC;
    produce = async () => housePrice(pnu, dong, ho, env);
  } else if (url.pathname === '/units') {
    const pnu = url.searchParams.get('pnu') || '';
    const dong = (url.searchParams.get('dong') || '').trim();
    if (!/^\d{19}$/.test(pnu)) return json({ error: 'PNU는 숫자 19자리입니다' }, 400, origin);
    if (dong.length > 40) return json({ error: '동 이름이 너무 깁니다' }, 400, origin);
    if (!env.BLD_KEY) return json({ error: '건축물대장 키가 아직 설정되지 않았습니다' }, 503, origin);
    maxAge = CACHE_BUILDING_SEC;
    produce = async () => units(pnu, dong, env);
  } else {
    return json({ error: '없는 경로' }, 404, origin);
  }

  const cached = await cache.match(cacheKey);
  if (cached) return json(await cached.json(), 200, origin, maxAge);
  try {
    const body = await produce();
    ctx.waitUntil(cache.put(cacheKey, new Response(JSON.stringify(body), { headers: { 'Cache-Control': `public, max-age=${maxAge}` } })));
    return json(body, 200, origin, maxAge);
  } catch (err) {
    console.error('upstream', url.pathname, err.message); // 서버 로그(주소 원문은 남기지 않음)
    const source = ['/building', '/units'].includes(url.pathname) ? '건축물대장' : 'VWorld';
    return json({ error: `${source} 조회에 실패했습니다. 잠시 후 다시 시도하세요.` }, 502, origin);
  }
}

export default {
  fetch(request, env, ctx) {
    return handle(request, env, ctx);
  },
};
