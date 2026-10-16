/* Worker의 caches.default 대신 쓰는 메모리 캐시(만료 시각 포함) — Node 실행기(server.mjs·lambda.mjs) 공용 */
const MAX_CACHE = 5000;

export function installMemoryCache() {
  if (globalThis.caches && globalThis.caches.default) return;
  const store = new Map();
  globalThis.caches = {
    default: {
      async match(req) {
        const hit = store.get(req.url);
        if (!hit) return undefined;
        if (hit.expires < Date.now()) { store.delete(req.url); return undefined; }
        return new Response(hit.body);
      },
      async put(req, res) {
        const maxAge = Number((res.headers.get('Cache-Control') || '').match(/max-age=(\d+)/)?.[1]) || 0;
        if (!maxAge) return;
        if (store.size >= MAX_CACHE) store.delete(store.keys().next().value);
        store.set(req.url, { body: await res.text(), expires: Date.now() + maxAge * 1000 });
      },
    },
  };
}

/** 환경변수 → Worker env */
export function envFromProcess() {
  return {
    VWORLD_KEY: process.env.VWORLD_KEY || '',
    VWORLD_DOMAIN: process.env.VWORLD_DOMAIN || 'ella1-crypto.github.io',
    VWORLD_BASE: process.env.VWORLD_BASE || 'https://api.vworld.kr/', // 국내 서버에서는 https로 키를 보낸다
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS || 'https://ella1-crypto.github.io',
  };
}
