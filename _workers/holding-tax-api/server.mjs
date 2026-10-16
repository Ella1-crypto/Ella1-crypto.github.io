/* 보유세맵 중계 서버 — 국내 VM(Oracle Cloud 춘천·서울 등)용 Node 실행기
 *
 * Cloudflare Worker와 같은 코드(src/index.js)를 Node 내장 http로 돌린다. VWorld가 Cloudflare 서버 IP를
 * 막기 때문에(2026-10-15 실측) 국내 IP에서 실행해야 2026년 공시지가가 들어온다.
 *
 *   VWORLD_KEY=... node server.mjs        (Node 20 이상, 외부 패키지 없음)
 *   환경변수: VWORLD_KEY(필수), VWORLD_DOMAIN, ALLOWED_ORIGINS, PORT(기본 8787), HOST(기본 127.0.0.1)
 *
 * HTTPS는 앞단 Caddy가 맡는다(docs: RELAY-ORACLE.md). 이 프로세스는 127.0.0.1에만 열어 둔다.
 */
import http from 'node:http';
import worker from './src/index.js';
import { installMemoryCache, envFromProcess } from './memory-cache.mjs';

const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || '127.0.0.1';
const env = envFromProcess();
if (!env.VWORLD_KEY) {
  console.error('VWORLD_KEY 환경변수가 없습니다.');
  process.exit(1);
}
installMemoryCache();

const server = http.createServer(async (req, res) => {
  try {
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
    // Caddy가 넣어 주는 실제 접속 IP로 요청 제한을 건다
    const peer = req.socket.remoteAddress || '';
    const fromProxy = peer === '127.0.0.1' || peer === '::1' || peer === '::ffff:127.0.0.1';
    // Caddy가 넣는 X-Real-IP(실제 접속 IP)만 쓴다 — 프록시를 거치지 않은 요청은 소켓 주소
    const ip = (fromProxy && String(req.headers['x-real-ip'] || '').trim()) || peer || 'unknown';
    headers.set('CF-Connecting-IP', ip);
    const request = new Request(`http://${HOST}:${PORT}${req.url}`, { method: req.method, headers });
    const pending = [];
    const response = await worker.fetch(request, env, { waitUntil: p => pending.push(p) });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
    await Promise.allSettled(pending);
  } catch (err) {
    console.error('relay', err.message);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end('{"error":"서버 오류"}');
  }
});

server.listen(PORT, HOST, () => console.log(`holding-tax relay on http://${HOST}:${PORT}`));
