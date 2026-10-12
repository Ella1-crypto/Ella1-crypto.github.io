// 무한매수 설정 화면 — 종목마다 원금·분할 수·매수 주기·익절률을 따로 정한다 (종목 하나 = 사이클 하나).
// 규칙 1-2(1회분 최소 2주), 2-1·2-3(3배·제외군)로 후보를 자동 판정한다. 보유 중인 종목은 원금·분할·주기가 잠긴다.
(() => {
  const $ = (id) => document.getElementById(id);
  const HDR = { "Content-Type": "application/json", "X-Infinite-Settings": "1" };
  let S = null;              // /api/state 응답
  let picks = [];            // [{sym, principal, splits, interval, target(%)}]
  let sel = 0;               // 01번 카드에서 고치는 종목
  let tray = [];             // 03번에서 고른 새 종목 [{sym, pct}] — "새 사이클 만들기"를 눌러야 내 종목이 된다
  let checkedKey = "";       // 마지막으로 검사 통과한 설정 — 바뀌면 저장 버튼 다시 잠금
  let showMoney = false;
  try { showMoney = localStorage.getItem("inf-show-money") === "1"; } catch (e) { /* 기본 가림 */ }

  const usd = (x) => (x == null || isNaN(x)) ? "-" : "$" + Number(x).toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  const usd0 = (x) => "$" + Number(x || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
  const pct = (x) => (x * 100).toFixed(1) + "%";
  const num = (v) => { const n = Number(String(v).replace(/[^0-9.]/g, "")); return isFinite(n) ? n : 0; };
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const tag = (kind, text) => el("span", "tag " + kind, text);
  const withCommas = (s) => { const [i, d] = String(s).replace(/[^0-9.]/g, "").split("."); return (i ? Number(i).toLocaleString("en-US") : "") + (d != null ? "." + d : ""); };
  const IV = { 1: "매일", 3: "3일", 5: "1주", 10: "2주", 20: "1달" };
  const ivLabel = (n) => IV[n] || n + "일";
  const ivLong = (n) => n === 1 ? "매일" : `${n}거래일마다`;
  const cur = () => picks[sel] || null;
  const heldOf = (sym) => (S.held || {})[sym];                 // 실전 보유 중이면 그 사이클 값 (잠금 근거)
  const unitOf = (p) => p.principal / p.splits;

  function form() {
    return {
      symbols: Object.fromEntries(picks.map((p) => [p.sym, { principal: p.principal, splits: p.splits, interval: p.interval, target: p.target / 100 }])),
      max_open_loss: S.settings.max_open_loss,
    };
  }

  function judge(sym, unit) {
    const ex = S.excluded[sym];
    if (ex) return ["bad", ex + " 제외"];
    const px = S.prices[sym];
    if (px == null) return ["warn", "현재가 확인 중"];
    if (px > unit / 2) return ["bad", `비싸요 · 2주 한도 ${usd(unit / 2)}`];
    return ["ok", `✓ 1회 최대 ${Math.floor(unit / px)}주`];
  }

  function renderChips() {
    const box = $("chips"); box.replaceChildren();
    for (const [sym, v] of Object.entries(S.positions || {})) {
      if (v.live && v.live.qty) box.append(el("span", "chip live", `실전 ${sym} ${v.live.qty}주`));
      if (v.live && v.live.halted) box.append(el("span", "chip live", `${sym} 정지됨`));
    }
    const money = el("button", "chip btn-chip"); money.type = "button";
    money.textContent = showMoney ? "💵 달러 잔액 " + (S.usd == null ? "확인 불가" : usd(S.usd)) + "  🙈" : "💵 달러 잔액 ••••  👁";
    money.addEventListener("click", () => { showMoney = !showMoney; try { localStorage.setItem("inf-show-money", showMoney ? "1" : "0"); } catch (e) { /* 무시 */ } renderChips(); });
    if (!window.DEMO) box.append(money);
    if (!S.toss) box.append(el("span", "chip", "시세 잠시 쉬는 중 (토큰 갱신 대기)"));
  }

  // ── 01 종목 설정 ──
  function renderTabs() {
    const box = $("tabs"); box.replaceChildren();
    picks.forEach((p, i) => {
      const b = el("button", "tab" + (i === sel ? " on" : ""), p.sym + (heldOf(p.sym) ? " 🔒" : ""));
      b.type = "button"; b.setAttribute("role", "tab"); b.setAttribute("aria-selected", i === sel ? "true" : "false");
      b.addEventListener("click", () => { sel = i; refresh(); });
      box.append(b);
    });
    if (!picks.length) box.append(el("span", "muted", "아래 03번에서 종목을 담아 주세요 ✧"));
  }

  function seg(id, choices, value, label, locked, onPick) {
    const box = $(id); box.replaceChildren();
    for (const n of choices) {
      const b = el("button", "seg-btn" + (n === value ? " on" : ""), label(n));
      b.type = "button"; b.setAttribute("role", "radio"); b.setAttribute("aria-checked", n === value ? "true" : "false");
      b.disabled = locked && n !== value;
      b.addEventListener("click", () => onPick(n));
      box.append(b);
    }
  }

  function renderEditor() {
    const p = cur();
    const fields = ["principal", "target", "target-num", "btn-reco"];
    for (const f of fields) $(f).disabled = !p;
    $("h-budget").textContent = p ? `${p.sym} 설정` : "종목 설정";
    if (!p) { for (const id of ["splits", "interval"]) $(id).replaceChildren(); $("lock-note").hidden = true; $("rule-line").textContent = ""; $("chart").replaceChildren(); return; }
    const h = heldOf(p.sym);
    $("lock-note").hidden = !h;
    if (h) $("lock-note").textContent = `🔒 실전 보유 중(${h.qty}주)이라 원금·분할 수·매수 주기는 잠겨 있어요. 사이클이 끝나면 바꿀 수 있어요. 익절률은 지금도 바꿀 수 있어요.`;
    if (document.activeElement !== $("principal")) $("principal").value = Number(p.principal).toLocaleString("en-US");
    $("principal").disabled = !!h;
    seg("splits", S.split_choices, p.splits, (n) => n + "회", !!h, (n) => { p.splits = n; refresh(); });
    seg("interval", S.interval_choices, p.interval, ivLabel, !!h, (n) => { p.interval = n; refresh(); });
    $("splits-out").textContent = p.splits + "회";
    $("interval-out").textContent = ivLong(p.interval);
    $("unit-out").textContent = "1회 " + usd(unitOf(p));
    $("target").value = p.target;
    if (document.activeElement !== $("target-num")) $("target-num").value = p.target;
    $("target-out").textContent = "+" + p.target + "%";
    const u = unitOf(p), px = S.prices[p.sym];
    $("rule-line").textContent = `${usd(p.principal)} ÷ ${p.splits} = 1회 ${usd(u)} · 한 번에 2주는 사야 하니 주가 ${usd(u / 2)} 이하여야 해요`
      + (px ? ` · 지금 ${p.sym} ${usd(px)} → 1회 최대 ${Math.floor(u / px)}주 (오르는 날은 절반)` : "")
      + ` · ${ivLong(p.interval)} 매수 판단 · 원금을 다 쓰는 데 최소 ${p.splits * p.interval}거래일`;
    renderChart();
  }

  // ★% = (10 − T/2 × 40/분할수)% 와 익절선
  function renderChart() {
    const svg = $("chart"); svg.replaceChildren();
    const p = cur(); if (!p) return;
    const N = p.splits, tgt = p.target;
    const W = 360, H = 250, L = 46, R = 10, T0 = 30, B = 32, ymin = -12, ymax = 17, F = 11;
    const x = (t) => L + (t / N) * (W - L - R);
    const y = (v) => T0 + (ymax - v) / (ymax - ymin) * (H - T0 - B);
    const sv = (t, attrs, text) => { const n = document.createElementNS("http://www.w3.org/2000/svg", t); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); if (text != null) n.textContent = text; return n; };
    svg.append(sv("text", { x: L, y: 14, "font-size": F + 1, "font-weight": 600, fill: "#eef0f7" }, `${p.sym} · 회차(T)별 ★% 기준선`));
    svg.append(sv("rect", { x: x(N / 2), y: T0, width: x(N) - x(N / 2), height: H - T0 - B, fill: "rgba(255,159,212,.08)" }));
    for (const g of [-10, -5, 0, 5, 10, 15]) {
      svg.append(sv("line", { x1: L, x2: W - R, y1: y(g), y2: y(g), stroke: g === 0 ? "rgba(238,240,247,.4)" : "rgba(238,240,247,.09)", "stroke-width": 1 }));
      svg.append(sv("text", { x: L - 6, y: y(g) + 4, "text-anchor": "end", "font-size": F, fill: "#9aa0b8" }, (g > 0 ? "+" : "") + g + "%"));
    }
    svg.append(sv("text", { x: L + 4, y: y(0) - 4, "font-size": F - 1, fill: "#9aa0b8" }, "평단"));
    for (const t of [0, 0.25, 0.5, 0.75, 1]) svg.append(sv("text", { x: x(t * N), y: H - 12, "text-anchor": "middle", "font-size": F, fill: "#9aa0b8" }, "T" + Math.round(t * N)));
    let d = "";
    for (let t = 0; t <= N; t += N / 80) { const v = 10 - t / 2 * 40 / N; d += (d ? "L" : "M") + x(t).toFixed(1) + "," + y(v).toFixed(1); }
    svg.append(sv("path", { d, fill: "none", stroke: "#b9a8ff", "stroke-width": 3 }));
    svg.append(sv("text", { x: x(N * 0.62), y: y(10 - N * 0.62 / 2 * 40 / N) - 8, "text-anchor": "middle", "font-size": F, fill: "#b9a8ff" }, N === 40 ? "★% = 10 − T/2" : `★% = 10 − T/2 × 40/${N}`));
    svg.append(sv("line", { x1: L, x2: W - R, y1: y(tgt), y2: y(tgt), stroke: "#d4ff5c", "stroke-width": 3, "stroke-dasharray": "6 4" }));
    svg.append(sv("text", { x: W - R, y: y(tgt) - 6, "text-anchor": "end", "font-size": F, "font-weight": 600, fill: "#d4ff5c" }, "익절 +" + tgt + "%"));
    svg.append(sv("text", { x: x(N / 4), y: T0 + 14, "text-anchor": "middle", "font-size": F, fill: "#9aa0b8" }, "전반전 (T<" + N / 2 + ")"));
    svg.append(sv("text", { x: x(N * 3 / 4), y: T0 + 14, "text-anchor": "middle", "font-size": F, fill: "#ff9fd4" }, "후반전 (T≥" + N / 2 + ")"));
    const live = ((S.positions || {})[p.sym] || {}).live;
    if (live && live.qty) {
      const u = unitOf(p), t = u ? Math.min(N, live.spent / u) : 0, v = 10 - t / 2 * 40 / N;
      svg.append(sv("circle", { cx: x(t), cy: y(v), r: 6, fill: "#ff9fd4", stroke: "#0b0c14", "stroke-width": 2 }));
      svg.append(sv("text", { x: x(t) + 9, y: y(v) + 16, "font-size": F, "font-weight": 600, fill: "#ff9fd4" }, `지금: T ${t.toFixed(2)} → ★ ${v >= 0 ? "+" : ""}${v.toFixed(2)}%`));
    }
  }

  // ── 02 내 종목 ──
  function renderPicks() {
    const list = $("picks"); list.replaceChildren();
    picks.forEach((p, i) => {
      const row = el("div", "pick" + (i === sel ? " sel" : ""));
      const u = unitOf(p), h = heldOf(p.sym);
      const [kind, text] = judge(p.sym, u);
      const head = el("button", "tk tk-btn", p.sym); head.type = "button"; head.title = "이 종목 설정하기";
      head.addEventListener("click", () => { sel = i; refresh(); document.querySelector(".bubble").scrollIntoView({ behavior: "smooth", block: "start" }); });
      const conf = el("div", "pick-conf");
      for (const t of [usd0(p.principal), p.splits + "회", ivLong(p.interval), "+" + p.target + "%"]) conf.append(el("span", "pill ghost", t));
      const meta = el("div", "pick-meta");
      for (const [k, v] of [["1회", usd(u)], ["현재가", usd(S.prices[p.sym])]]) { const s = el("span", null, k + " "); s.append(el("b", null, v)); meta.append(s); }
      meta.append(tag(kind, text));
      if (h) meta.append(tag("warn", `🔒 실전 ${h.qty}주 보유`));
      const rm = el("button", "btn small", "빼기");
      rm.disabled = !!h; rm.title = h ? "실전 보유 중 — 사이클이 끝난 뒤 뺄 수 있어요" : "";
      rm.addEventListener("click", () => { picks.splice(i, 1); sel = Math.max(0, Math.min(sel, picks.length - 1)); refresh(); });
      row.append(head, conf, meta, rm);
      list.append(row);
    });
    if (!picks.length) list.append(el("p", "muted", "＋ 새 사이클 만들기를 눌러 종목을 담아 주세요 ✧"));
    const total = picks.reduce((a, p) => a + p.principal, 0);
    $("sum").replaceChildren(el("span", null, "원금 합계"), tag("ok", usd0(total)),
      el("span", "muted", `종목 ${picks.length}개 · 증권 계좌 달러 잔액이 이만큼 있어야 끝까지 살 수 있어요 (모자라면 살 수 있는 만큼만 사고 알려줘요)`));
  }

  // ── 03 후보 · 담을 종목 비율 ──
  const newPrincipal = () => num($("new-principal").value) || S.default.principal;
  const evenPct = (n) => Math.floor(1000 / n) / 10;                          // 100% 를 n 개로 똑같이 (소수 1자리 내림)
  function splitEven() {                                                      // 남는 0.1% 는 첫 종목에 (33.4 · 33.3 · 33.3)
    const e = evenPct(tray.length);
    tray.forEach((t, i) => { t.pct = i ? e : Math.round((100 - e * (tray.length - 1)) * 10) / 10; });
  }

  function openNewCycle(open) {
    $("new-cycle").hidden = !open;
    $("btn-new-cycle").setAttribute("aria-expanded", String(open));
    if (!open) tray = [];
    renderCands(); syncHeights();
    if (open) { $("new-cycle").scrollIntoView({ behavior: "smooth", block: "start" }); $("new-principal").focus({ preventScroll: true }); }
  }

  function renderTray() {
    $("tray").hidden = !tray.length;
    const list = $("tray-list"); list.replaceChildren();
    tray.forEach((t, i) => {
      const row = el("div", "tray-row");
      const box = el("span", "pct-box");
      const input = el("input"); input.type = "text"; input.inputMode = "decimal"; input.autocomplete = "off"; input.value = t.pct;
      input.setAttribute("aria-label", t.sym + " 비율");
      input.addEventListener("focus", () => input.select());
      input.addEventListener("input", () => { input.value = input.value.replace(/[^0-9.]/g, ""); tray[i].pct = num(input.value); renderTraySum(); renderTrayMeta(); });
      box.append(input, el("i", null, "%"));
      const meta = el("span", "pick-meta tray-meta");
      const rm = el("button", "btn small", "빼기"); rm.type = "button";
      rm.addEventListener("click", () => { tray.splice(i, 1); if (tray.length) splitEven(); renderCands(); });
      row.append(el("span", "tk", t.sym), box, meta, rm);
      list.append(row);
    });
    renderTrayMeta(); renderTraySum();
  }
  function renderTrayMeta() {            // 비율을 고치는 중에는 입력칸을 다시 그리지 않고 금액·판정만 갱신 (커서 유지)
    const np = newPrincipal();
    document.querySelectorAll("#tray-list .tray-meta").forEach((meta, i) => {
      const t = tray[i]; if (!t) return;
      const principal = Math.round(np * (Number(t.pct) || 0)) / 100, unit = principal / S.default.splits;
      const [kind, text] = principal >= 100 ? judge(t.sym, unit) : ["bad", "원금 $100 이상이어야 해요"];
      const a = el("span", null, "원금 "); a.append(el("b", null, usd(principal)));
      const b = el("span", null, "1회 "); b.append(el("b", null, usd(unit)));
      meta.replaceChildren(a, b, tag(kind, text));
    });
  }
  function renderTraySum() {
    const np = newPrincipal();
    const total = Math.round(tray.reduce((a, t) => a + (Number(t.pct) || 0), 0) * 10) / 10;
    const bad = tray.some((t) => { const pr = np * (Number(t.pct) || 0) / 100; return pr < 100 || judge(t.sym, pr / S.default.splits)[0] === "bad"; });
    $("tray-sum").replaceChildren(el("span", null, "비율 합계"), tag(total > 100 ? "bad" : "ok", total + "%"),
      el("span", "muted", total > 100 ? "100% 이하로 맞춰 주세요" : total < 100 ? `${usd0(np)} 중 ${usd0(np * total / 100)}만 쓰고 나머지는 넣지 않아요` : `${usd0(np)}를 ${tray.length}종목에 나눠 넣어요`));
    $("tray-commit").disabled = !tray.length || total > 100 || bad;
    $("tray-commit").textContent = tray.length > 1 ? `새 사이클 ${tray.length}개 만들기` : "새 사이클 만들기";
  }
  function commitTray() {
    const np = newPrincipal();
    for (const t of tray) {
      picks.push({ sym: t.sym, principal: Math.round(np * t.pct) / 100, splits: S.default.splits, interval: S.default.interval, target: S.default.target * 100 });
    }
    sel = picks.length - tray.length; tray = [];
    $("new-cycle").hidden = true; $("btn-new-cycle").setAttribute("aria-expanded", "false");
    refresh();
    document.querySelector(".bubble").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderCands() {
    renderTray();
    const box = $("cands"); box.replaceChildren();
    const np = newPrincipal();
    const unit = np * evenPct(tray.length + 1) / 100 / S.default.splits;     // 하나 더 담아 똑같이 나눴을 때의 1회분으로 판정
    const showAll = $("show-all").checked;
    const chosen = new Set([...picks.map((p) => p.sym), ...tray.map((t) => t.sym)]);
    let okCount = 0;
    for (const u of S.universe) {
      const [kind, text] = judge(u.ticker, unit);
      if (kind === "ok") okCount++;
      if (!showAll && kind !== "ok") continue;
      const c = el("div", "cand" + (kind === "bad" ? " off" : ""));
      const top = el("div", "row"); top.append(el("span", "tk", u.ticker), el("span", "muted", u.structure || ""));
      const name = el("div", "name", (u.underlying || "") + " · ");
      const a = el("a", null, u.name || "출처"); a.href = u.source; a.target = "_blank"; a.rel = "noopener"; name.append(a);
      const bottom = el("div", "row"); bottom.append(el("span", null, usd(S.prices[u.ticker])), tag(kind, text));
      const add = el("button", "btn small", picks.some((p) => p.sym === u.ticker) ? "이미 내 종목" : chosen.has(u.ticker) ? "골랐어요" : "+ 고르기");
      add.disabled = chosen.has(u.ticker) || kind === "bad";
      add.addEventListener("click", () => { tray.push({ sym: u.ticker, pct: 0 }); splitEven(); renderCands(); syncHeights(); });
      c.append(top, name, bottom, add);
      box.append(c);
    }
    if (!box.children.length) box.append(el("p", "muted", !S.universe.length ? "후보 목록 준비 중"
      : !Object.keys(S.prices || {}).length ? "지금은 시세를 받지 못해 판정할 수 없어요. 잠시 뒤 새로고침해 주세요."
        : "이 원금으로는 담을 수 있는 종목이 없어요. 원금을 올려 보세요."));
    $("cand-note").textContent = `· ${tray.length ? (tray.length + 1) + "종목으로 나눌 때" : "한 종목에 다 넣을 때"} ${S.default.splits}회 기준 ${okCount}개`;
  }

  function lockSaveIfChanged() {
    if (JSON.stringify(form()) !== checkedKey) { $("btn-save").disabled = true; $("after-save").hidden = true; }
  }
  function syncHeights() {
    const b = document.querySelector(".bubble"), w = document.querySelector(".grid > .wide:not(.fill)"), f = document.querySelector(".fill");
    if (!b || !w || !f) return;
    if (window.innerWidth <= 860) { f.style.height = ""; return; }
    const gap = parseFloat(getComputedStyle(document.querySelector(".grid")).rowGap) || 0;
    f.style.height = "0px"; w.style.alignSelf = "start";
    const h = Math.floor(b.getBoundingClientRect().height - w.getBoundingClientRect().height - gap);
    w.style.alignSelf = "";
    f.style.height = h > 320 ? h + "px" : "";
  }
  new ResizeObserver(() => syncHeights()).observe(document.querySelector(".bubble"));
  window.addEventListener("resize", syncHeights);

  function refresh() { renderTabs(); renderEditor(); renderPicks(); renderCands(); lockSaveIfChanged(); syncHeights(); }

  // ── 검사 결과 ──
  function table(headers, rows, onPick) {
    const t = el("table", "gt"), thead = el("thead"), tr = el("tr");
    for (const h of headers) tr.append(el("th", null, h));
    thead.append(tr); t.append(thead);
    const tb = el("tbody");
    for (const r of rows) {
      const row = el("tr", r.cur ? "cur" : "");
      r.cells.forEach((v, i) => row.append(el("td", i === 0 ? "tk" : "", v)));
      row.tabIndex = 0; row.addEventListener("click", () => onPick(r.value));
      row.addEventListener("keydown", (e) => { if (e.key === "Enter") onPick(r.value); });
      tb.append(row);
    }
    t.append(tb);
    return t;
  }
  function pickOf(sym) { return picks.find((p) => p.sym === sym); }
  function setField(sym, key, value) {
    const p = pickOf(sym); if (!p) return;
    if (key !== "target" && heldOf(sym)) { alert(`${sym}은(는) 실전 보유 중이라 지금은 못 바꿔요. 사이클이 끝난 뒤 바꿀 수 있어요.`); return; }
    p[key] = value; sel = picks.indexOf(p); refresh();
  }
  function intervalTable(sym, grid, current) {
    const wrap = el("div", "grid-wrap");
    wrap.append(el("p", "muted", "매수 주기(거래일)만 바꿔 같은 기간을 돌린 결과예요. 행을 누르면 그 주기가 선택돼요 (저장·재시작 전엔 적용 안 됨)."));
    const best = Math.max(...grid.map((g) => g.profit));
    wrap.append(table(["매수 주기", "사이클", "익절 성공", "누적 손익", "최악 평가손실", "최장 물림", "검증구간", "실전 기준"],
      grid.map((g) => ({ value: g.interval, cur: g.interval === current,
        cells: [ivLabel(g.interval) + (g.profit === best ? " ★" : ""), g.cycles + "회", g.wins + "회", usd(g.profit), pct(g.worst), g.longest + "거래일",
          g.n_oos + "건 · " + pct(g.oos_mean), g.live_ok ? "충족" : "미달"] })), (n) => setField(sym, "interval", n)));
    return wrap;
  }
  function targetTable(sym, grid, current) {
    const wrap = el("div", "grid-wrap");
    wrap.append(el("p", "muted", "익절률만 바꿔 같은 기간을 돌린 결과예요. 행을 누르면 그 값이 입력돼요 (저장·재시작 전엔 적용 안 됨)."));
    const best = Math.max(...grid.map((g) => g.profit));
    wrap.append(table(["익절", "사이클", "익절 성공", "누적 손익", "최악 평가손실", "최장 물림", "평균 기간"],
      grid.map((g) => ({ value: g.target * 100, cur: Math.abs(g.target - current) < 1e-9,
        cells: ["+" + (g.target * 100).toFixed(1).replace(/\.0$/, "") + "%" + (g.profit === best ? " ★" : ""), g.cycles + "회", g.wins + "회", usd(g.profit),
          pct(g.worst), g.longest + "거래일", Math.round(g.avg_days) + "거래일"] })), (v) => setField(sym, "target", Math.round(v * 2) / 2)));
    return wrap;
  }

  // ── 검사 결과를 엑셀에서 열리는 CSV 로 내려받기 (브라우저 안에서만 만든다 — 서버로 보내지 않음) ──
  function csvOf(results) {
    const rows = [["무한매수 백테스트 결과", new Date().toISOString().slice(0, 10)], []];
    const p100 = (x) => (x == null ? "" : Math.round(x * 1000) / 10);                      // 0.123 → 12.3 (%)
    for (const [sym, r] of Object.entries(results)) {
      rows.push([sym], ["원금($)", "분할 수", "매수 주기(거래일)", "익절(%)", "기간 시작", "기간 끝", "완료 사이클", "누적 손익($)",
        "최악 평가손실(%)", "최장 물림(거래일)", "검증구간 평균(%)", "검증구간 건수", "실전 기준"],
        [r.principal, r.splits, r.interval || 1, p100(r.target), (r.period || [])[0], (r.period || [])[1], r.cycles, Math.round(r.total_profit * 100) / 100,
          p100(r.worst_open_loss), r.max_days_in_cycle, p100(r.oos_mean), r.n_oos, r.live_ok ? "충족" : "미달"], []);
      if ((r.interval_grid || []).length) {
        rows.push(["매수 주기별"], ["매수 주기(거래일)", "사이클", "익절 성공", "누적 손익($)", "최악 평가손실(%)", "최장 물림(거래일)", "검증구간 건수", "검증구간 평균(%)", "실전 기준"]);
        for (const g of r.interval_grid) rows.push([g.interval, g.cycles, g.wins, Math.round(g.profit * 100) / 100, p100(g.worst), g.longest, g.n_oos, p100(g.oos_mean), g.live_ok ? "충족" : "미달"]);
        rows.push([]);
      }
      if ((r.grid || []).length) {
        rows.push(["익절률별"], ["익절(%)", "사이클", "익절 성공", "누적 손익($)", "최악 평가손실(%)", "최장 물림(거래일)", "평균 기간(거래일)"]);
        for (const g of r.grid) rows.push([p100(g.target), g.cycles, g.wins, Math.round(g.profit * 100) / 100, p100(g.worst), g.longest, Math.round(g.avg_days)]);
        rows.push([]);
      }
    }
    const cell = (v) => { const t = v == null ? "" : String(v); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
    return "\uFEFF" + rows.map((r) => r.map(cell).join(",")).join("\r\n");               // BOM: 엑셀이 한글을 깨지 않게
  }
  function downloadCsv(results) {
    const url = URL.createObjectURL(new Blob([csvOf(results)], { type: "text/csv;charset=utf-8" }));
    const a = el("a"); a.href = url; a.download = `무한매수_백테스트_${Object.keys(results).join("_")}.csv`;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function showMsgs(data) {
    const box = $("msgs"); box.replaceChildren();
    for (const e of data.errors || []) box.append(el("div", "msg bad", "✕ " + e));
    for (const w of data.warnings || []) box.append(el("div", "msg warn", "! " + w));
    $("after-save").hidden = !data.saved;
    if (data.saved) box.append(el("div", "msg ok", "✦ 저장했어요! 아래 순서대로 봇을 다시 켜야 적용돼요."));
    else if (!(data.errors || []).length && data.results) box.append(el("div", "msg ok", "✓ 검사 통과 — 아래 '저장하기'를 누르면 파일에 기록돼요."));
    const res = $("results"); res.replaceChildren();
    if (Object.keys(data.results || {}).length) {
      const save = el("button", "btn small", "⬇ 엑셀로 저장 (CSV)"); save.type = "button";
      save.addEventListener("click", () => downloadCsv(data.results));
      const bar = el("div", "export-row"); bar.append(save, el("span", "muted", "설정과 백테스트 표를 엑셀에서 열리는 파일로 내려받아요."));
      res.append(bar);
    }
    for (const [sym, r] of Object.entries(data.results || {})) {
      const c = el("div", "result");
      const h = el("h3", null, `${sym} · ${usd0(r.principal)} · ${r.splits}회 · ${ivLong(r.interval || 1)} · +${(r.target * 100).toFixed(1).replace(/\.0$/, "")}%`);
      h.append(tag(r.live_ok ? "ok" : "bad", r.live_ok ? "실전 가능" : "위험선 초과"));
      const dl = el("dl");
      for (const [k, v] of [["기간", (r.period || []).join(" ~ ")], ["완료 사이클", r.cycles + "회"], ["누적 손익", usd(r.total_profit)],
        ["최악 평가손실", pct(r.worst_open_loss)], ["최장 물림", r.max_days_in_cycle + "거래일"], ["검증구간 평균", pct(r.oos_mean) + ` (${r.n_oos}건)`]]) dl.append(el("dt", null, k), el("dd", null, v));
      c.append(h, dl);
      if (r.interval_grid && r.interval_grid.length) c.append(intervalTable(sym, r.interval_grid, r.interval || 1));
      if (r.grid && r.grid.length) c.append(targetTable(sym, r.grid, r.target));
      res.append(c);
    }
  }

  async function post(path) {
    $("btn-check").disabled = true; $("btn-save").disabled = true;
    $("msgs").replaceChildren(el("div", "msg warn", path.endsWith("save") ? "저장하는 중…" : "백테스트 중… 종목당 10~30초 걸려요 (처음 한 번은 계산 엔진을 받느라 더 걸려요) ✧"));
    try {
      const r = await fetch(path, { method: "POST", headers: HDR, body: JSON.stringify(form()) });
      const data = await r.json();
      showMsgs(data);
      if (r.ok) checkedKey = JSON.stringify(form());
      $("btn-save").disabled = !r.ok || data.saved;
      if (data.saved) await load();
    } catch (e) {
      $("msgs").replaceChildren(el("div", "msg bad", "설정 서버에 잠깐 연결하지 못했어요 — 새로고침한 뒤 다시 눌러 주세요"));
    } finally { $("btn-check").disabled = false; }
  }

  async function load() {
    S = await (await fetch("/api/state")).json();
    picks = Object.entries(S.settings.symbols).map(([sym, v]) => ({ sym, principal: v.principal, splits: v.splits, interval: v.interval, target: Math.round(v.target * 200) / 2 }));
    sel = Math.max(0, Math.min(sel, picks.length - 1));
    if (!$("new-principal").value) $("new-principal").value = Number(S.default.principal).toLocaleString("en-US");
    renderChips(); refresh();
    if (S.bot) renderBot(S.bot);
  }

  // ── 실전 봇 켜기/끄기 ──
  function renderBot(bot) {
    const st = $("bot-state");
    st.className = "tag " + (bot.running ? "ok" : "warn");
    st.textContent = bot.running ? `켜짐 (PID ${bot.pid})` : "꺼짐";
    $("btn-start").disabled = bot.running || (bot.gate || []).length > 0;
    $("btn-stop").disabled = !bot.running;
    $("bot-note").textContent = (bot.gate || []).length ? "켤 수 없어요: " + bot.gate.join(" / ")
      : bot.running ? "돌아가는 중이에요. 설정을 바꿨다면 끄고 다시 켜야 적용돼요."
        : "켜면 실제 주문이 나가요. 미국장 열리기 전(한국 시간 22:30 전)에 켜 두면 그날 밤부터 돌아요.";
    const log = $("bot-log"); log.hidden = !(bot.log || []).length; log.textContent = (bot.log || []).join("\n");
  }
  async function botAction(action) {
    if (action === "start" && !confirm("실전 봇을 켭니다. 실제 주문이 나가요. 계속할까요?")) return;
    if (action === "stop" && !confirm("실전 봇을 끕니다. 오늘 남은 주문은 나가지 않아요. 계속할까요?")) return;
    $("btn-start").disabled = $("btn-stop").disabled = true;
    $("bot-msgs").replaceChildren(el("div", "msg warn", action === "start" ? "켜는 중… (5초쯤 걸려요)" : "끄는 중…"));
    try {
      const r = await fetch("/api/bot", { method: "POST", headers: HDR, body: JSON.stringify({ action }) });
      const data = await r.json();
      $("bot-msgs").replaceChildren(el("div", data.ok ? "msg ok" : "msg bad",
        data.ok ? (action === "start" ? "✦ 켰어요. 카카오톡에 '봇 시작' 메시지가 와요." : "■ 껐어요.") : "✕ " + (data.error || "실패")));
      if (data.output) $("bot-msgs").append(el("pre", "log", data.output));
      renderBot(data);
    } catch (e) { $("bot-msgs").replaceChildren(el("div", "msg bad", "설정 서버에 연결할 수 없어요")); }
  }
  $("btn-start").addEventListener("click", () => botAction("start"));
  $("btn-stop").addEventListener("click", () => botAction("stop"));
  setInterval(async () => { try { renderBot(await (await fetch("/api/bot/status", { method: "POST", headers: HDR, body: "{}" })).json()); } catch (e) { /* 무시 */ } }, 15000);

  // ── 입력 ──
  $("principal").addEventListener("focus", () => $("principal").select());
  $("principal").addEventListener("input", () => {
    const p = cur(); if (!p) return;
    $("principal").value = withCommas($("principal").value);
    p.principal = num($("principal").value); refresh();
  });
  $("new-principal").addEventListener("focus", () => $("new-principal").select());
  $("new-principal").addEventListener("input", () => { $("new-principal").value = withCommas($("new-principal").value); renderCands(); });
  $("target").addEventListener("input", () => { const p = cur(); if (!p) return; p.target = Number($("target").value); refresh(); });
  $("target-num").addEventListener("focus", () => $("target-num").select());
  $("target-num").addEventListener("input", () => {
    const p = cur(); if (!p) return;
    $("target-num").value = $("target-num").value.replace(/[^0-9.]/g, "");
    const v = Number($("target-num").value);
    if (isFinite(v) && v >= 10 && v <= 15) { p.target = Math.round(v * 2) / 2; refresh(); }
  });
  $("target-num").addEventListener("blur", () => { const p = cur(); if (p) $("target-num").value = p.target; });
  $("show-all").addEventListener("change", renderCands);
  $("tray-even").addEventListener("click", () => { splitEven(); renderTray(); });
  $("tray-clear").addEventListener("click", () => { tray = []; renderCands(); syncHeights(); });
  $("tray-commit").addEventListener("click", commitTray);
  $("btn-new-cycle").addEventListener("click", () => openNewCycle($("new-cycle").hidden));
  $("new-cycle-close").addEventListener("click", () => openNewCycle(false));
  $("btn-check").addEventListener("click", () => post("/api/check"));
  $("btn-save").addEventListener("click", () => post("/api/save"));

  // ── 그래프 크게 보기 ──
  const modal = $("chart-modal");
  function openChart() { $("chart-big").replaceChildren(...[...$("chart").childNodes].map((n) => n.cloneNode(true))); modal.hidden = false; $("chart-close").focus(); }
  function closeChart() { modal.hidden = true; $("chart-open").focus(); }
  $("chart-open").addEventListener("click", openChart);
  $("chart-close").addEventListener("click", closeChart);
  modal.addEventListener("click", (e) => { if (e.target === modal) closeChart(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !modal.hidden) closeChart(); });

  // ── 익절 목표 추천 ──
  $("btn-reco").addEventListener("click", async () => {
    const out = $("reco-out"); $("btn-reco").disabled = true;
    out.replaceChildren(el("div", "msg warn", "계산 중… 종목당 10~20초 걸려요 ✧"));
    try {
      const r = await fetch("/api/recommend", { method: "POST", headers: HDR, body: JSON.stringify(form()) });
      const data = await r.json();
      out.replaceChildren();
      if (!r.ok) { out.append(el("div", "msg bad", "✕ " + (data.error || "실패"))); return; }
      for (const x of data.results) {
        const c = el("div", "reco-card");
        if (x.error) { c.append(el("b", null, x.symbol), el("span", "muted", " " + x.error)); out.append(c); continue; }
        const bestPct = (x.best * 100).toFixed(1).replace(/\.0$/, ""), curPct = (x.current * 100).toFixed(1).replace(/\.0$/, "");
        const same = Math.abs(x.best - x.current) < 1e-9;
        const head = el("div", "row"); head.append(el("b", null, `${x.symbol} · 추천 +${bestPct}%`), tag(same ? "ok" : "warn", same ? "지금 설정과 같음" : `지금 +${curPct}%`));
        const dl = el("dl", "reco-dl");
        for (const [k, v] of [
          ["학습 구간 연평균", `${usd(x.is_best_yearly)} (지금 설정 ${usd(x.is_cur_yearly)})`],
          ["검증 구간 연평균", `${usd(x.oos_best_yearly)} (지금 설정 ${usd(x.oos_cur_yearly)})`],
          ["검증 구간 최악 평가손실", `${pct(x.oos_best_worst)} (지금 설정 ${pct(x.oos_cur_worst)})`],
          ["최근 20일 변동성", `연율 ${(x.vol20 * 100).toFixed(0)}% · 과거 500일 중 상위 ${(100 - x.vol_pct * 100).toFixed(0)}%`],
          ["기간", `${x.period[0]} ~ ${x.period[2]} (검증 ${x.period[1]}부터)`]]) dl.append(el("dt", null, k), el("dd", null, v));
        const note = el("p", "muted", x.vol_pct >= 0.8 ? "변동성이 높은 구간이에요. 익절가에 닿는 날도, 크게 빠지는 날도 많아져요."
          : x.vol_pct <= 0.2 ? "변동성이 낮은 구간이에요. 높은 목표는 닿기까지 오래 걸릴 수 있어요." : "변동성은 평소 수준이에요.");
        const apply = el("button", "btn small", `${x.symbol} +${bestPct}% 적용`); apply.addEventListener("click", () => setField(x.symbol, "target", x.best * 100));
        c.append(head, dl, note, apply); out.append(c);
      }
    } catch (e) { out.replaceChildren(el("div", "msg bad", "설정 서버에 연결할 수 없어요")); }
    finally { $("btn-reco").disabled = !cur(); syncHeights(); }
  });

  load();
})();
