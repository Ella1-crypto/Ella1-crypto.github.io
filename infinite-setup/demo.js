/* 체험판 — 설정 화면이 서버에 보내는 요청(/api/*)을 가로채 예시 데이터(window.DEMO)로 답한다. 실제 서버·계좌와 연결되지 않는다. */
(() => {
  "use strict";
  const D = window.DEMO;
  const NO_BOT = "체험판에서는 봇을 켜거나 끌 수 없어요";
  const bot = () => ({ running: false, pid: null, log: [], gate: [NO_BOT] });
  const usd = (n) => "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const reply = (body, status = 200, wait = 0) =>
    new Promise((ok) => setTimeout(() => ok(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })), wait));

  function state() {
    return { ...D.state, settings: { symbols: { TQQQ: { ...D.state.default } }, max_open_loss: 0.8 },
      usd: null, positions: {}, held: {}, validation: {}, toss: true, bot: bot() };
  }

  // 서버의 저장 전 검사 가운데 화면에서 바로 확인되는 것만 흉내 낸다 (1회분으로 2주 · 제외 종목)
  function check(body) {
    const errors = [], results = {};
    const have = Object.keys(D.check);
    for (const [sym, v] of Object.entries(body.symbols || {})) {
      const price = D.state.prices[sym], unit = v.principal / v.splits;
      if (D.state.excluded[sym]) errors.push(`${sym}: ${D.state.excluded[sym]} 종목 (규칙 2-3)`);
      else if (price && unit < 2 * price) errors.push(`${sym}: 1회분 ${usd(unit)}로 2주(${usd(2 * price)}) 못 삼 (규칙 1-2) — 원금을 올리거나 분할 수를 줄이세요`);
      else if (!D.check[sym]) errors.push(`${sym}: 체험판에는 이 종목의 백테스트 결과가 들어 있지 않아요 (들어 있는 종목: ${have.join(" · ")})`);
      else results[sym] = D.check[sym].results;
    }
    if (!Object.keys(body.symbols || {}).length) errors.push("종목을 하나 이상 담아 주세요");
    const warnings = errors.length ? [] : ["체험판: 아래 결과는 $10,000 · 40회 · 매일 · +10% 기준으로 미리 계산해 둔 예시예요. 지금 고른 값으로 다시 계산한 것이 아니에요."];
    return reply({ errors, warnings, results: errors.length ? {} : results, saved: false, settings: body }, errors.length ? 422 : 200, 700);
  }

  function recommend(body) {
    const results = Object.entries(body.symbols || {}).map(([sym, v]) =>
      D.recommend[sym] ? { ...D.recommend[sym], current: v.target } : { symbol: sym, error: "체험판에는 이 종목의 추천 계산이 들어 있지 않아요" });
    return reply({ results }, 200, 700);
  }

  const real = window.fetch.bind(window);
  window.fetch = (url, opt = {}) => {
    const path = String(url);
    if (!path.startsWith("/api/")) return real(url, opt);
    let body = {};
    try { body = JSON.parse(opt.body || "{}"); } catch (e) { /* 빈 요청 */ }
    if (path === "/api/state") return reply(state());
    if (path === "/api/check") return check(body);
    if (path === "/api/save") return reply({ errors: ["체험판에서는 저장되지 않아요. 실제 화면에서는 여기서 설정 파일과 검증 기록이 저장돼요."], warnings: [], results: {}, saved: false }, 422, 300);
    if (path === "/api/recommend") return recommend(body);
    if (path === "/api/bot") return reply({ error: NO_BOT, ...bot() }, 409, 300);
    if (path === "/api/bot/status") return reply(bot());
    return reply({ error: "없음" }, 404);
  };
})();
