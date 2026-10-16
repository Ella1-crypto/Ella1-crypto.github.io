/* 취득세·양도세 화면 공용 도구 — 고정된 폼을 읽어 결과만 다시 그린다 */
(function () {
  'use strict';
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const won = n => Math.round(Number(n) || 0).toLocaleString('ko-KR');
  const pct = (r, d = 2) => `${(Math.round(r * 100 * 10 ** d) / 10 ** d).toLocaleString('ko-KR')}%`;
  const eok = n => {
    const v = Math.round(Number(n) || 0);
    if (v >= 1e8) { const e = Math.floor(v / 1e8), m = Math.round((v % 1e8) / 1e4); return `${e}억${m ? ` ${m.toLocaleString('ko-KR')}만` : ''}원`; }
    if (v >= 1e4) return `${Math.round(v / 1e4).toLocaleString('ko-KR')}만원`;
    return `${won(v)}원`;
  };
  const MAX_MONEY = 1e13;
  const money = s => Math.min(MAX_MONEY, Math.max(0, Number(String(s || '').replace(/[^\d.]/g, '')) || 0));
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const today = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };

  /** 폼 필드 값을 객체로 읽는다 — data-f: 이름, data-t: money|int|bool|date|text */
  function read(form) {
    const out = {};
    form.querySelectorAll('[data-f]').forEach(el => {
      const t = el.dataset.t || 'text';
      const f = el.dataset.f;
      if (t === 'bool') out[f] = el.checked;
      else if (t === 'money') out[f] = money(el.value);
      else if (t === 'int') out[f] = Math.min(99, Math.max(0, parseInt(el.value, 10) || 0));
      else if (t === 'date') out[f] = DATE_RE.test(el.value) ? el.value : '';
      else out[f] = el.value;
    });
    return out;
  }

  function write(form, data) {
    form.querySelectorAll('[data-f]').forEach(el => {
      const f = el.dataset.f;
      if (!Object.prototype.hasOwnProperty.call(data, f)) return;
      const v = data[f];
      if (el.dataset.t === 'bool') el.checked = v === true;
      else if (el.dataset.t === 'money') el.value = v ? won(v) : '';
      else if (el.tagName === 'SELECT') { if ([...el.options].some(o => o.value === String(v))) el.value = String(v); }
      else el.value = v == null ? '' : String(v);
    });
  }

  function store(key) {
    return {
      load() { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; } },
      save(v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* 저장 불가(사생활 보호 모드 등) — 계산은 계속 */ } },
    };
  }

  /** 돈 입력칸: 입력 중엔 숫자만, 포커스가 빠지면 천 단위 쉼표 */
  function moneyInputs(form) {
    form.querySelectorAll('[data-t="money"]').forEach(el => {
      el.addEventListener('blur', () => { const v = money(el.value); el.value = v ? won(v) : ''; });
    });
  }

  function basisTable(rows) {
    return `<div class="tw"><table><thead><tr><th>항목</th><th>적용</th><th>근거</th></tr></thead><tbody>${rows.map(b => `<tr><th>${esc(b.item)}</th><td>${esc(b.rule)}</td><td>${esc(b.law)}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function cta(cfg) {
    if (!cfg) return '';
    const btn = (url, label, cls) => (url && /^https:\/\//.test(url) ? `<a class="btn ${cls}" href="${esc(url)}" target="_blank" rel="noopener">${esc(label)}</a>` : '');
    const html = btn(cfg.CONSULT_URL, cfg.CONSULT_LABEL || '세무 상담', 'primary') + btn(cfg.PRO_URL, cfg.PRO_LABEL || 'PRO', '');
    return html ? `<div class="cta">${html}</div>` : '';
  }

  /* ---------- 공유 링크 · 계산 기록 · PDF · 엑셀 ---------- */
  const b64 = str => btoa(String.fromCharCode(...new TextEncoder().encode(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unb64 = t => new TextDecoder().decode(Uint8Array.from(atob(t.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)));
  const MAX_HISTORY = 12;
  const MAX_SHARE = 6000;

  function toast(msg) {
    let el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast'; el.className = 'toast'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => el.classList.remove('show'), 2600);
  }

  const toolbar = () => `<div class="actions">
        <button type="button" class="btn" data-act="share">링크 복사</button>
        <button type="button" class="btn" data-act="print">PDF 보고서</button>
        <button type="button" class="btn" data-act="save">계산 기록 저장</button>
        <button type="button" class="btn" data-act="history">기록 보기</button>
        <button type="button" class="btn" data-act="xlsx" style="grid-column: span 2">엑셀 다운로드</button>
      </div>`;

  /** 해시(#s=)에 담긴 공유 상태 — 읽으면 주소창에서 지운다 */
  function sharedState() {
    const m = location.hash.match(/^#s=([A-Za-z0-9_-]{1,6000})$/);
    if (!m) return null;
    history.replaceState(null, '', location.pathname);
    try { const v = JSON.parse(unb64(m[1])); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch (e) { return null; }
  }

  /**
   * @param {{key:string, form:HTMLFormElement, state:()=>object, apply:(object)=>void, label:()=>string, total:()=>number, xlsx:()=>Promise}} o
   */
  function tools(o) {
    const histKey = `${o.key}:history`;
    const box = document.createElement('section');
    box.className = 'history'; box.hidden = true; box.setAttribute('aria-label', '계산 기록');
    box.innerHTML = '<div class="h-row"><h3>이 기기에 저장한 계산</h3><button type="button" class="link-btn" data-act="history-clear">기록 지우기</button></div><ul></ul>';
    o.form.after(box);
    const readHist = () => { try { const r = JSON.parse(localStorage.getItem(histKey) || '[]'); return Array.isArray(r) ? r.slice(0, MAX_HISTORY) : []; } catch (e) { return []; } };
    const show = () => {
      const list = readHist();
      box.hidden = false;
      box.querySelector('ul').innerHTML = list.length
        ? list.map((h, i) => `<li><button type="button" data-act="restore" data-i="${i}"><b>${esc(h.name)}</b><span>${esc(h.at)} · ${won(h.total)}원</span></button></li>`).join('')
        : '<li class="muted">저장한 계산이 없습니다. "계산 기록 저장"을 누르면 이 기기에 보관됩니다.</li>';
      box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };
    let busy = false;
    const acts = {
      share: async () => {
        const enc = b64(JSON.stringify(o.state()));
        if (enc.length > MAX_SHARE) { toast('입력이 너무 길어 링크로 만들 수 없습니다.'); return; }
        const url = `${location.origin}${location.pathname}#s=${enc}`;
        try { await navigator.clipboard.writeText(url); toast('계산 결과 링크를 복사했습니다.'); } catch (e) { history.replaceState(null, '', url); toast('주소창의 링크를 복사해 공유하세요.'); }
      },
      print: () => window.print(),
      save: () => {
        const entry = { name: String(o.label()).slice(0, 40), at: new Date().toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }), total: o.total(), state: o.state() };
        try { localStorage.setItem(histKey, JSON.stringify([entry, ...readHist()].slice(0, MAX_HISTORY))); toast('이 기기에 계산을 저장했습니다.'); } catch (e) { toast('이 브라우저에서는 저장할 수 없습니다.'); }
      },
      history: show,
      restore: d => { const h = readHist()[Number(d.i)]; if (h && h.state) { o.apply(h.state); toast(`"${h.name}" 계산을 불러왔습니다.`); } },
      'history-clear': () => { try { localStorage.removeItem(histKey); } catch (e) { /* 저장소 없음 */ } show(); },
      xlsx: async () => {
        if (busy) return;
        busy = true;
        toast('엑셀 파일을 만드는 중…');
        try { await o.xlsx(); toast('엑셀 파일을 내려받았습니다.'); } catch (e) { toast(e && e.message ? e.message : '엑셀을 만들지 못했습니다.'); } finally { busy = false; }
      },
    };
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (b && acts[b.dataset.act]) { e.preventDefault(); acts[b.dataset.act](b.dataset); }
    });
    const hadHash = /^#s=/.test(location.hash);
    const shared = sharedState();
    if (hadHash) toast(shared ? '공유된 계산을 불러왔습니다.' : '공유 링크를 읽지 못했습니다.');
    return { shared, toast };
  }

  /* ---------- 조정대상지역 자동 판정 ---------- */
  /**
   * 주소·날짜가 바뀌면 해당 체크박스를 판정 결과로 맞춘다(사용자가 나중에 바꾸면 그대로 둔다).
   * @param {HTMLFormElement} form
   * @param {string} addrField
   * @param {Array<[string, string]>} pairs [날짜 필드, 체크박스 필드]
   * @param {Event|null} ev 변경 이벤트(null이면 처음 그릴 때)
   * @returns {Array<{field:string, res:object}>}
   */
  function regulatedSync(form, addrField, pairs, ev) {
    const R = window.Regulated;
    if (!R) return [];
    const val = f => (form.querySelector(`[data-f="${f}"]`) || {}).value || '';
    const changed = ev && ev.target && ev.target.dataset ? ev.target.dataset.f : null;
    return pairs.map(([dateF, boxF]) => {
      const res = R.check(val(addrField), val(dateF));
      const box = form.querySelector(`[data-f="${boxF}"]`);
      if (box && (changed === addrField || changed === dateF) && res.status !== 'unknown') box.checked = res.status === 'yes';
      return { field: boxF, res };
    });
  }

  const regLine = (label, res) => {
    const cls = res.status === 'yes' ? 'reg-yes' : res.status === 'no' ? 'reg-no' : 'reg-unk';
    const tag = res.status === 'yes' ? '조정대상지역' : res.status === 'no' ? '비조정' : '확인 필요';
    return `<p class="reg-line ${cls}"><b>${esc(label)}: ${tag}</b>${res.name ? ` · ${esc(res.name)}` : ''} — ${esc(res.note)}</p>`;
  };

  window.TaxKit = Object.freeze({ esc, won, pct, eok, money, today, read, write, store, moneyInputs, basisTable, cta, toast, toolbar, tools, regulatedSync, regLine });
}());
