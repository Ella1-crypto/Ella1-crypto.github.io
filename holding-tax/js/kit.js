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

  window.TaxKit = Object.freeze({ esc, won, pct, eok, money, today, read, write, store, moneyInputs, basisTable, cta });
}());
