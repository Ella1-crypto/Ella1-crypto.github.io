/* 보유세맵 — 주택 전용 화면. 상태 → HouseTax.calc → 렌더. 공유 링크·계산 기록 포함 */
(function () {
  'use strict';
  const H = window.HouseTax;
  const $ = s => document.querySelector(s);
  const STORE = 'htm.house.v1';
  const HISTORY = 'htm.house.history.v1';
  const MAX_HOUSES = 20;
  const MAX_HISTORY = 12;

  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const won = n => Math.round(Number(n) || 0).toLocaleString('ko-KR');
  const eok = n => {
    const v = Number(n) || 0;
    if (v >= 1e8) return `${(v / 1e8).toLocaleString('ko-KR', { maximumFractionDigits: 2 })}억원`;
    if (v >= 1e4) return `${Math.round(v / 1e4).toLocaleString('ko-KR')}만원`;
    return `${won(v)}원`;
  };
  const fmt = n => (Number(n) > 0 ? Number(n).toLocaleString('ko-KR') : '');
  const num = (v, max) => {
    const n = Number(String(v).replace(/[,\s]/g, ''));
    return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : 0;
  };
  const uid = () => Math.random().toString(36).slice(2, 9);
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  /* ---------- 상태 ---------- */
  const newHouse = () => ({ id: uid(), name: '', price: 0, share: 100, urban: true, prevPrice: 0 });
  function clean(raw) {
    const s = raw && typeof raw === 'object' ? raw : {};
    const houses = (Array.isArray(s.houses) ? s.houses : []).filter(h => h && typeof h === 'object').slice(0, MAX_HOUSES).map(h => ({
      id: typeof h.id === 'string' ? h.id.slice(0, 12) : uid(),
      name: typeof h.name === 'string' ? h.name.slice(0, 60) : '',
      price: num(h.price, 1e12),
      share: Math.max(0.01, Math.min(100, num(h.share, 100) || 100)),
      urban: h.urban !== false,
      prevPrice: num(h.prevPrice, 1e12),
    }));
    return {
      mode: own(H.MODES, s.mode) ? s.mode : '2026',
      ownerType: s.ownerType === '법인' ? '법인' : '개인',
      oneHouse: s.oneHouse !== false,
      resident: s.resident !== false,
      age: Math.round(num(s.age, 120)),
      holdYears: Math.round(num(s.holdYears, 100)),
      houseCount: Math.round(num(s.houseCount, 100)),
      prevTotal: num(s.prevTotal, 1e12),
      houses: houses.length ? houses : [newHouse()],
    };
  }
  let state = clean({});
  let pointerDown = false;
  let pendingRender = false;

  function load() {
    try { const r = localStorage.getItem(STORE); return r ? clean(JSON.parse(r)) : null; } catch (_) { return null; }
  }
  function save() {
    try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (_) { /* 저장 불가 환경 */ }
  }
  const b64 = str => btoa(String.fromCharCode(...new TextEncoder().encode(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unb64 = t => new TextDecoder().decode(Uint8Array.from(atob(t.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)));

  function input() {
    return { ...state, houses: state.houses.map(h => ({ price: h.price, share: h.share, urban: h.urban, prevPrice: h.prevPrice })) };
  }

  /* ---------- 렌더 ---------- */
  function houseRows(r) {
    const byIndex = new Map();
    state.houses.filter(h => h.price > 0).forEach((h, i) => byIndex.set(h.id, r.rows[i]));
    return state.houses.map((h, i) => {
      const row = byIndex.get(h.id);
      return `
      <article class="pcard" data-card="${esc(h.id)}">
        <header>
          <span class="pno">${i + 1}</span>
          <div class="ptitle"><input class="addr-in" type="text" maxlength="60" placeholder="주택 이름 (예: 반포 아파트)" aria-label="${i + 1}번 주택 이름" data-hid="${esc(h.id)}" data-f="name" value="${esc(h.name)}">
            <p>${row ? `과세표준 ${eok(row.base)} (공시가격 × ${Math.round(row.fmv * 100)}%)${row.capped ? ' · 과세표준상한 적용' : ''}${row.special ? ' · 1주택 특례세율' : ''}` : '공시가격을 입력하세요'}</p></div>
          ${state.houses.length > 1 ? `<button type="button" class="icon-btn" data-act="del" data-hid="${esc(h.id)}" aria-label="${i + 1}번 주택 삭제">×</button>` : ''}
        </header>
        <div class="grid4">
          <label class="fld"><span class="fld-l">주택 공시가격</span><span class="num"><input type="text" inputmode="numeric" data-hid="${esc(h.id)}" data-f="price" value="${esc(fmt(h.price))}"><em>원</em></span><span class="fld-h">${h.price > 0 ? eok(h.price) : '<a href="https://www.realtyprice.kr" target="_blank" rel="noopener">부동산공시가격알리미</a>'}</span></label>
          <label class="fld"><span class="fld-l">내 지분</span><span class="num"><input type="text" inputmode="decimal" data-hid="${esc(h.id)}" data-f="share" value="${esc(h.share)}"><em>%</em></span><span class="fld-h">공동명의면 내 지분</span></label>
          <label class="fld"><span class="fld-l">작년 공시가격</span><span class="num"><input type="text" inputmode="numeric" data-hid="${esc(h.id)}" data-f="prevPrice" value="${esc(fmt(h.prevPrice))}"><em>원</em></span><span class="fld-h">선택 — 과세표준상한(5%) 계산</span></label>
          <label class="fld"><span class="fld-l">재산세</span><span class="fld-h house-tax">${row ? `<b>${won(row.ownTotal)}원</b> (본세 ${won(row.ownMain)} · 도시 ${won(row.ownUrban)} · 교육 ${won(row.ownEdu)})` : '—'}</span></label>
        </div>
        <label class="chk"><input type="checkbox" data-hid="${esc(h.id)}" data-f="urban"${h.urban ? ' checked' : ''}> 도시지역분(0.14%) 부과 — 대부분의 시 지역 주택은 해당</label>
      </article>`;
    }).join('');
  }

  function summary(r) {
    const c = r.cmt || { total: 0, decided: 0, nong: 0 };
    const parts = [
      { k: 'bld', label: '재산세·도시지역분·교육세', when: '7월·9월', v: r.prop.total },
      { k: 'cmt', label: '종부세·농특세', when: '12월', v: c.total },
    ];
    const total = r.total;
    const cfg = window.HTM_CONFIG || {};
    const ctas = [
      cfg.CONSULT_URL ? `<a class="btn primary" href="${esc(cfg.CONSULT_URL)}" target="_blank" rel="noopener">${esc(cfg.CONSULT_LABEL)}</a>` : '',
    ].join('');
    return `
      <p class="eyebrow">${esc(H.MODES[state.mode].label)} 예상 보유세</p>
      <p class="total" aria-live="polite"><span>${won(total)}</span>원</p>
      <p class="total-sub">${total > 0 ? `약 ${eok(total)} · 월 평균 ${eok(total / 12)}` : '공시가격을 넣으면 바로 계산됩니다'}</p>
      ${total > 0 ? `<div class="stack">${parts.filter(x => x.v > 0).map(x => `<span class="seg-${x.k}" style="flex:${x.v}"></span>`).join('')}</div>` : ''}
      <ul class="parts">${parts.map(x => `<li><i class="dot seg-${x.k}"></i><span>${x.label}<small>${x.when} 납부</small></span><b>${won(x.v)}</b></li>`).join('')}</ul>
      ${state.mode === '2027reform' ? '<p class="warn-line">정부안(국회 심의 중) 중 확정 숫자만 반영한 예상치입니다.</p>' : ''}
      <div class="actions">
        <button type="button" class="btn" data-act="share">링크 복사</button>
        <button type="button" class="btn" data-act="print">PDF 보고서</button>
        <button type="button" class="btn" data-act="save">계산 기록 저장</button>
        <button type="button" class="btn" data-act="history">기록 보기</button>
      </div>
      ${ctas ? `<div class="cta">${ctas}</div>` : ''}
      <p class="fine">간편 추정치입니다. 1세대1주택·주택 수 판정, 합산배제, 감면, 지자체 조례에 따라 실제 고지액과 다를 수 있습니다.</p>`;
  }

  function detail(r) {
    const c = r.cmt;
    if (!c) return '<p class="muted">공시가격을 넣으면 계산 과정이 나옵니다.</p>';
    const rows = [
      ['공시가격 합계(내 지분)', c.value],
      [`공제 (${state.ownerType === '법인' ? '법인 0원' : state.oneHouse ? '1세대1주택' : '개인 9억원'})`, -c.deduction],
      ['과세표준 (× 60%)', c.base],
      [`산출세액 (${state.ownerType === '법인' ? (c.count >= 3 ? '법인 5%' : '법인 2.7%') : c.count >= 3 ? '3주택 이상 세율' : '2주택 이하 세율'})`, c.computed],
      [`공제할 재산세 (${won(c.propActual)} × ${won(Math.round(c.propOnCmt))} ÷ ${won(c.propStd)})`, -c.credit],
      ...(c.creditPct > 0 ? [[`고령자 ${Math.round(c.agePct * 100)}% + 장기보유 ${Math.round(c.holdPct * 100)}% 공제`, -c.seniorCredit]] : []),
      ...(c.capReduction > 0 ? [['세부담상한(150%) 초과분', -c.capReduction]] : []),
      ['종합부동산세 결정세액', c.decided],
      ['농어촌특별세 (× 20%)', c.nong],
    ];
    return `<h4>주택분 종합부동산세 — 납세자별 합산</h4>
      <div class="tw"><table><tbody>${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${v < 0 ? '−' : ''}${won(Math.abs(v))}</td></tr>`).join('')}</tbody></table></div>
      ${c.decided === 0 && c.base === 0 ? `<p class="formula">공시가격 합계가 공제액 ${eok(c.deduction)} 이하라 종부세가 없습니다.</p>` : ''}
      ${r.cmtInstallment > 0 ? `<p class="formula">종부세 ${eok(c.decided)}은 250만원을 넘어 ${eok(r.cmtInstallment)}까지 6개월 분납할 수 있습니다.</p>` : ''}`;
  }

  function schedule(r) {
    if (!r.schedule.length) return '<p class="muted">세금이 계산되면 납부 일정이 나옵니다.</p>';
    return `<ol class="timeline">${r.schedule.map(s => `<li><span class="m">${s.month}월</span><div><b>${won(s.amount)}원</b><p>${esc(s.item)}</p><small>${esc(s.due)}</small></div></li>`).join('')}</ol>`;
  }

  function compare() {
    const keys = Object.keys(H.MODES);
    const totals = keys.map(k => ({ k, r: H.calc({ ...input(), mode: k }) }));
    const max = Math.max(1, ...totals.map(t => t.r.total));
    return `<div class="proj cmp">${totals.map(({ k, r }) => `
      <div class="pcol${k === state.mode ? ' is-on' : ''}"><div class="pbar" style="--h:${(r.total / max * 100).toFixed(1)}%"><span class="seg-bld" style="flex:${r.prop.total}"></span><span class="seg-cmt" style="flex:${r.cmt ? r.cmt.total : 0}"></span></div>
      <b>${eok(r.total)}</b><small>${esc(H.MODES[k].label.replace(' — ', ' '))}</small></div>`).join('')}</div>
      <p class="fine">2027년 공시가격은 올해와 같다고 가정합니다. "현행법이 그대로면"은 2026년분까지인 1세대1주택 특례(공정시장가액비율 43~45%, 특례세율)가 끝나는 경우입니다.</p>`;
  }

  function render(keepFocus) {
    const focus = keepFocus && document.activeElement && document.activeElement.dataset ? { ...document.activeElement.dataset } : null;
    const r = H.calc(input());
    $('#houses').innerHTML = houseRows(r);
    $('#summary').innerHTML = summary(r);
    $('#detail').innerHTML = detail(r);
    $('#schedule').innerHTML = schedule(r);
    $('#compare').innerHTML = compare();
    $('#mbar-total').textContent = `${won(r.total)}원`;
    document.querySelectorAll('[data-owner]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.owner === state.ownerType)));
    $('#mode').value = state.mode;
    const single = state.houses.length === 1 && state.ownerType === '개인' && !(state.houseCount > 1);
    $('#oneHouse').checked = state.oneHouse && single;
    $('#oneHouse').disabled = !single;
    $('#one-opts').hidden = !(state.oneHouse && single);
    $('#resident-wrap').hidden = state.mode !== '2027reform';
    ['age', 'holdYears', 'houseCount'].forEach(k => { if (document.activeElement !== $(`#${k}`)) $(`#${k}`).value = state[k] || ''; });
    if (document.activeElement !== $('#prevTotal')) $('#prevTotal').value = fmt(state.prevTotal);
    $('#resident').checked = state.resident;
    if (focus && focus.f) {
      const el = document.querySelector(`[data-hid="${CSS.escape(focus.hid || '')}"][data-f="${CSS.escape(focus.f)}"]`);
      if (el) el.focus({ preventScroll: true });
    }
  }

  function setState(next, keepFocus) {
    state = clean(next);
    save();
    render(keepFocus);
  }

  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => el.classList.remove('show'), 2600);
  }

  /* ---------- 계산 기록 ---------- */
  function readHistory() {
    try { const r = JSON.parse(localStorage.getItem(HISTORY) || '[]'); return Array.isArray(r) ? r.slice(0, MAX_HISTORY) : []; } catch (_) { return []; }
  }
  function showHistory() {
    const list = readHistory();
    $('#history').hidden = false;
    $('#history-list').innerHTML = list.length
      ? list.map((h, i) => `<li><button type="button" data-act="restore" data-i="${i}"><b>${esc(h.name)}</b><span>${esc(h.at)} · ${won(h.total)}원</span></button></li>`).join('')
      : '<li class="muted">저장한 계산이 없습니다. "계산 기록 저장"을 누르면 이 기기에 보관됩니다.</li>';
    $('#history').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  const actions = {
    add: () => { if (state.houses.length >= MAX_HOUSES) return; setState({ ...state, houses: [...state.houses, newHouse()], oneHouse: false }); },
    del: d => setState({ ...state, houses: state.houses.filter(h => h.id !== d.hid) }),
    share: async () => {
      const url = `${location.origin}${location.pathname}#s=${b64(JSON.stringify(state))}`;
      try { await navigator.clipboard.writeText(url); toast('계산 결과 링크를 복사했습니다.'); } catch (_) { history.replaceState(null, '', url); toast('주소창의 링크를 복사해 공유하세요.'); }
    },
    print: () => window.print(),
    save: () => {
      const r = H.calc(input());
      const name = state.houses.map(h => h.name).filter(Boolean).join(', ') || `주택 ${state.houses.length}채`;
      const entry = { name: name.slice(0, 40), at: new Date().toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }), total: r.total, state };
      try { localStorage.setItem(HISTORY, JSON.stringify([entry, ...readHistory()].slice(0, MAX_HISTORY))); toast('이 기기에 계산을 저장했습니다.'); } catch (_) { toast('이 브라우저에서는 저장할 수 없습니다.'); }
    },
    history: showHistory,
    restore: d => { const h = readHistory()[Number(d.i)]; if (h) { setState(h.state); toast(`"${h.name}" 계산을 불러왔습니다.`); } },
    'history-clear': () => { try { localStorage.removeItem(HISTORY); } catch (_) { /* 무시 */ } showHistory(); },
  };

  function onHouseInput(e) {
    const el = e.target.closest('[data-f]');
    if (!el || !el.dataset.hid) return;
    const f = el.dataset.f;
    const v = el.type === 'checkbox' ? el.checked : el.value;
    const houses = state.houses.map(h => (h.id !== el.dataset.hid ? h : { ...h, [f]: f === 'name' ? v : f === 'urban' ? v : num(v, 1e12) }));
    state = clean({ ...state, houses });
    save();
    if (e.type === 'change' && pointerDown) pendingRender = true; // 버튼 누르는 중 다시 그리면 클릭이 사라진다
    else if (e.type === 'change') render(true);
    else {
      const r = H.calc(input());
      $('#summary').innerHTML = summary(r);
      $('#detail').innerHTML = detail(r);
      $('#schedule').innerHTML = schedule(r);
      $('#mbar-total').textContent = `${won(r.total)}원`;
    }
  }

  function boot() {
    const m = location.hash.match(/^#s=([A-Za-z0-9_-]+)$/);
    let shared = null;
    if (m) {
      try { shared = clean(JSON.parse(unb64(m[1]))); } catch (_) { shared = null; }
      history.replaceState(null, '', location.pathname);
    }
    state = shared || load() || clean({ houses: [{ ...newHouse(), name: '예시 아파트', price: 1.5e9 }] });
    if (m) toast(shared ? '공유된 계산을 불러왔습니다.' : '공유 링크를 읽지 못했습니다.');
    $('#houses').addEventListener('input', onHouseInput);
    $('#houses').addEventListener('change', onHouseInput);
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (b && actions[b.dataset.act]) actions[b.dataset.act](b.dataset);
    });
    document.addEventListener('pointerdown', () => { pointerDown = true; }, true);
    const release = () => { pointerDown = false; if (pendingRender) { pendingRender = false; setTimeout(() => render(true), 0); } };
    document.addEventListener('pointerup', release, true);
    document.addEventListener('pointercancel', release, true);
    document.querySelectorAll('[data-owner]').forEach(b => b.addEventListener('click', () => setState({ ...state, ownerType: b.dataset.owner })));
    $('#mode').addEventListener('change', e => setState({ ...state, mode: e.target.value }));
    $('#oneHouse').addEventListener('change', e => setState({ ...state, oneHouse: e.target.checked }));
    $('#resident').addEventListener('change', e => setState({ ...state, resident: e.target.checked }));
    ['age', 'holdYears', 'houseCount', 'prevTotal'].forEach(k => $(`#${k}`).addEventListener('change', e => setState({ ...state, [k]: num(e.target.value, 1e12) })));
    $('#basis').innerHTML = `<div class="tw"><table class="basis"><thead><tr><th>항목</th><th>기준</th><th>근거</th></tr></thead><tbody>${H.BASIS.map(b => `<tr><th>${esc(b.item)}</th><td>${esc(b.rule)}</td><td>${esc(b.law)}</td></tr>`).join('')}</tbody></table></div>`;
    render(false);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
