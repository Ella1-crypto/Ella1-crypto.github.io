/* 체험판 — 설정 화면이 서버에 보내는 요청(/api/*)을 가로챈다. 실제 서버·계좌와 연결되지 않는다.
   백테스트는 브라우저 안에서 실제로 돌린다: engine-worker.js 가 Pyodide(브라우저용 파이썬)로 본 프로그램과 같은 규칙 코드를 실행한다. */
(() => {
  "use strict";
  const D = window.DEMO;
  const NO_BOT = "체험판에서는 봇을 켜거나 끌 수 없어요";
  const bot = () => ({ running: false, pid: null, log: [], gate: [NO_BOT] });
  const usd = (n) => "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const respond = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const later = (body, status, ms) => new Promise((ok) => setTimeout(() => ok(respond(body, status)), ms));

  // ── 계산 엔진 (첫 검사 때 한 번만 내려받는다) ──
  let worker = null, seq = 0;
  const waiting = new Map();
  function engine(kind, body) {
    if (!worker) {
      worker = new Worker("engine-worker.js?v=" + D.v);
      worker.postMessage({ init: D.v });
      worker.onmessage = (e) => { const w = waiting.get(e.data.id); if (!w) return; waiting.delete(e.data.id); e.data.error ? w.no(new Error(e.data.error)) : w.ok(e.data.out); };
      worker.onerror = (e) => { for (const w of waiting.values()) w.no(new Error(e.message || "계산 엔진 오류")); waiting.clear(); worker = null; };
    }
    return new Promise((ok, no) => { const id = ++seq; waiting.set(id, { ok, no }); worker.postMessage({ id, kind, body }); });
  }

  function state() {
    return { ...D.state, settings: { symbols: {}, max_open_loss: 0.8 },      // 체험판은 빈 상태에서 시작 — 방문자가 직접 종목을 담는다
      usd: null, positions: {}, held: {}, validation: {}, toss: true, bot: bot() };
  }

  // 서버의 저장 전 검사 가운데 화면에서 바로 확인되는 것 (1회분으로 2주 · 제외 종목 · 체험판에 일봉이 있는 종목인지)
  function precheck(body) {
    const errors = [];
    for (const [sym, v] of Object.entries(body.symbols || {})) {
      const price = D.state.prices[sym], unit = v.principal / v.splits;
      if (D.state.excluded[sym]) errors.push(`${sym}: ${D.state.excluded[sym]} 종목 (규칙 2-3)`);
      else if (!(v.principal >= 100 && v.principal <= 1000000)) errors.push(`${sym}: 원금은 $100 ~ $1,000,000`);
      else if (price && unit < 2 * price) errors.push(`${sym}: 1회분 ${usd(unit)}로 2주(${usd(2 * price)}) 못 삼 (규칙 1-2) — 원금을 올리거나 분할 수를 줄이세요`);
      else if (!D.symbols.includes(sym)) errors.push(`${sym}: 체험판에는 이 종목의 과거 데이터가 들어 있지 않아요 (들어 있는 종목: ${D.symbols.join(" · ")})`);
    }
    if (!Object.keys(body.symbols || {}).length) errors.push("종목을 하나 이상 담아 주세요");
    return errors;
  }

  async function check(body) {
    const errors = precheck(body);
    if (errors.length) return later({ errors, warnings: [], results: {}, saved: false, settings: body }, 422, 300);
    try {
      const out = await engine("check", body);
      if (!out.data.errors.length) out.data.warnings.push(`체험판: 지금 고른 값으로 이 브라우저에서 방금 계산한 결과예요 (일봉 ${D.day} 까지). 저장은 되지 않아요.`,
        "과거 데이터로 계산한 결과이며 투자 권유가 아닙니다. 미래 수익을 보장하지 않아요.");
      return respond(out.data, out.status);
    } catch (e) {
      return respond({ errors: ["계산 엔진을 불러오지 못했어요 — 인터넷 연결을 확인하고 새로고침해 주세요 (" + e.message.slice(0, 120) + ")"], warnings: [], results: {} }, 422);
    }
  }

  async function recommend(body) {
    const known = Object.fromEntries(Object.entries(body.symbols || {}).filter(([sym]) => D.symbols.includes(sym)));
    const missing = Object.keys(body.symbols || {}).filter((sym) => !D.symbols.includes(sym))
      .map((sym) => ({ symbol: sym, error: "체험판에는 이 종목의 과거 데이터가 들어 있지 않아요" }));
    try {
      const out = Object.keys(known).length ? await engine("recommend", { ...body, symbols: known }) : { status: 200, data: { results: [] } };
      return respond({ results: [...(out.data.results || []), ...missing] }, out.status);
    } catch (e) {
      return respond({ error: "계산 엔진을 불러오지 못했어요 — 새로고침해 주세요" }, 500);
    }
  }

  const real = window.fetch.bind(window);
  window.fetch = (url, opt = {}) => {
    const path = String(url);
    if (!path.startsWith("/api/")) return real(url, opt);
    let body = {};
    try { body = JSON.parse(opt.body || "{}"); } catch (e) { /* 빈 요청 */ }
    if (path === "/api/state") return Promise.resolve(respond(state()));
    if (path === "/api/check") return check(body);
    if (path === "/api/save") return later({ errors: ["체험판에서는 저장되지 않아요. 실제 화면에서는 여기서 설정 파일과 검증 기록이 저장돼요."], warnings: [], results: {}, saved: false }, 422, 300);
    if (path === "/api/recommend") return recommend(body);
    if (path === "/api/bot") return later({ error: NO_BOT, ...bot() }, 409, 300);
    if (path === "/api/bot/status") return Promise.resolve(respond(bot()));
    return Promise.resolve(respond({ error: "없음" }, 404));
  };
})();
