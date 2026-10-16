/* 보유세맵 중계 서버 — AWS Lambda(서울 ap-northeast-2) 함수 URL용 실행기
 *
 * Cloudflare Worker와 같은 코드(src/index.js)를 Lambda 함수 URL 이벤트(페이로드 2.0)로 돌린다.
 * VWorld는 해외·Cloudflare IP를 막지만 AWS 서울 IP는 허용한다(2026-10-16 CloudShell 실측: 200·status OK).
 *
 *   핸들러: lambda.handler  런타임: Node.js 22 이상
 *   환경변수: VWORLD_KEY(필수), VWORLD_DOMAIN, ALLOWED_ORIGINS, VWORLD_BASE
 * 배포 방법: RELAY-AWS.md
 */
import worker from './src/index.js';
import { installMemoryCache, envFromProcess } from './memory-cache.mjs';

installMemoryCache(); // 같은 실행 환경이 살아 있는 동안 응답을 재사용한다
const env = envFromProcess();

export async function handler(event) {
  const http = (event && event.requestContext && event.requestContext.http) || {};
  const headers = new Headers();
  for (const [k, v] of Object.entries((event && event.headers) || {})) if (typeof v === 'string') headers.set(k, v);
  // 함수 URL이 알려 주는 실제 접속 IP — 클라이언트가 보낸 헤더는 믿지 않는다
  headers.set('CF-Connecting-IP', http.sourceIp || 'unknown');
  const qs = event && event.rawQueryString ? `?${event.rawQueryString}` : '';
  const request = new Request(`https://relay.local${(event && event.rawPath) || '/'}${qs}`, { method: http.method || 'GET', headers });
  try {
    const pending = [];
    const response = await worker.fetch(request, env, { waitUntil: p => pending.push(p) });
    const body = await response.text();
    await Promise.allSettled(pending);
    return { statusCode: response.status, headers: Object.fromEntries(response.headers), body };
  } catch (err) {
    console.error('relay', err.message);
    return { statusCode: 500, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: '{"error":"서버 오류"}' };
  }
}
