/* 생애주기 화면 — 취득 → 보유 → 양도 CF, 시나리오 표, 개인 vs 법인 */
(function () {
  'use strict';
  const Life = window.Lifecycle;
  const K = window.TaxKit;
  const { esc, won, pct, eok } = K;
  const $ = s => document.querySelector(s);
  const form = $('#form');
  const saved = K.store('lifecycle:v1');
  const HOLDS = [3, 5, 7, 10];
  const GROWTHS = [0, 2, 4, 6];
  let last = null;

  function setOwner(v) {
    form.querySelector('[data-f="owner"]').value = v;
    form.querySelectorAll('[data-owner]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.owner === v)));
  }

  const irrText = v => (v == null ? '—' : pct(v, 1));

  function summary(r) {
    const t = r.taxes;
    const parts = [
      { k: 'land', label: '취득세', v: t.acq, when: '0년차' },
      { k: 'bld', label: '재산세 등', v: t.prop, when: `${r.input.years}년 합계` },
      { k: 'cmt', label: '종부세·농특세', v: t.cmt, when: `${r.input.years}년 합계` },
      { k: 'house', label: '양도세', v: t.transfer, when: r.transfer.exempt ? '비과세' : r.sellDate },
    ];
    return `
      <p class="eyebrow">${esc(r.input.owner)} · ${r.input.kind === 'house' ? '주택' : '상가·건물'} · ${r.input.years}년 보유</p>
      <p class="total" aria-live="polite"><span>${irrText(r.irr)}</span></p>
      <p class="total-sub">세후 IRR(연) · 세전 ${irrText(r.preTaxIrr)} · 자기자본 ${eok(r.invested)} → 순이익 ${eok(r.profit)}</p>
      ${t.total > 0 ? `<div class="stack">${parts.filter(p => p.v > 0).map(p => `<span class="seg-${p.k}" style="flex:${p.v}"></span>`).join('')}</div>` : ''}
      <ul class="parts">${parts.map(p => `<li><i class="dot seg-${p.k}"></i><span>${p.label}<small>${esc(p.when)}</small></span><b>${won(p.v)}</b></li>`).join('')}</ul>
      <p class="relief-line">세금 합계 ${won(t.total)}원 — 세전 이익의 ${pct(r.taxShare, 1)}</p>
      ${r.notes.map(n => `<p class="warn-line">${esc(n)}</p>`).join('')}
      ${K.toolbar()}
      ${K.cta(window.HTM_CONFIG)}
      <p class="fine">간편 추정치입니다. 투자 권유나 세무 자문이 아닙니다.</p>`;
  }

  const COLS = [
    ['label', '연도'], ['value', '시세(연말)'], ['official', '공시가격(6.1.)'], ['deposit', '보증금 수수'], ['rent', '임대수입'], ['opex', '운영비'], ['interest', '이자'],
    ['prop', '재산세 등'], ['cmt', '종부세'], ['acqTax', '취득세'], ['transferTax', '양도세'], ['fee', '중개수수료'], ['saleNet', '매각−대출상환'], ['flow', '순현금흐름'],
  ];

  function cfTable(r) {
    const sum = k => r.rows.reduce((s, x) => s + (Number(x[k]) || 0), 0);
    return `<div class="tw"><table class="cf-year"><thead><tr>${COLS.map(([, h]) => `<th>${h}</th>`).join('')}</tr></thead><tbody>
      ${r.rows.map(x => `<tr>${COLS.map(([k]) => (k === 'label' ? `<th>${esc(x.label)}</th>` : `<td${k === 'flow' && x.flow < 0 ? ' class="neg"' : ''}>${x[k] ? won(x[k]) : '—'}</td>`)).join('')}</tr>`).join('')}
    </tbody><tfoot><tr><th>합계</th>${COLS.slice(1).map(([k]) => `<td>${['value', 'official'].includes(k) ? '' : won(sum(k))}</td>`).join('')}</tr></tfoot></table></div>`;
  }

  function gridTable(x) {
    const g = Life.grid(x, HOLDS, GROWTHS);
    return `<div class="tw"><table class="grid-irr"><thead><tr><th>보유 \\ 상승률</th>${GROWTHS.map(v => `<th>${v}%</th>`).join('')}</tr></thead><tbody>
      ${g.map(row => `<tr><th>${row[0].years}년</th>${row.map(c => `<td class="${c.irr == null ? '' : c.irr < 0 ? 'neg' : c.irr >= 0.06 ? 'pos' : ''}" title="세금 ${won(c.taxes)}원 · 순이익 ${won(c.profit)}원">${irrText(c.irr)}</td>`).join('')}</tr>`).join('')}
    </tbody></table></div><p class="fine">칸에 마우스를 올리면 그 시나리오의 세금 합계·순이익을 볼 수 있습니다.</p>`;
  }

  function ownerCompare(x) {
    const a = Life.calc({ ...x, owner: '개인' });
    const b = Life.calc({ ...x, owner: '법인', oneHouse: false });
    const row = (name, r) => `<tr><th>${name}</th><td>${won(r.taxes.acq)}</td><td>${won(r.taxes.prop + r.taxes.cmt)}</td><td>${won(r.taxes.transfer)}</td><td><b>${won(r.taxes.total)}</b></td><td>${irrText(r.irr)}</td></tr>`;
    const better = (a.irr || -1) >= (b.irr || -1) ? '개인' : '법인';
    return `<div class="tw"><table><thead><tr><th></th><th>취득세</th><th>보유세</th><th>양도 세금</th><th>세금 합계</th><th>세후 IRR</th></tr></thead><tbody>${row('개인', a)}${row('법인', b)}</tbody></table></div>
      <p class="law-line"><b>${better} 명의가 세후 수익률이 높습니다</b> — 법인은 주택 취득세 12%·종부세 2.7%·양도 추가과세 20%가 붙고, 상가는 법인세율(10~25%)이 양도세율보다 낮아 유리할 수 있습니다.</p>
      <p class="need-line">법인 설립·유지비, 배당 시 소득세, 임대 법인세는 빠져 있습니다.</p>`;
  }

  function proCta() {
    const cfg = window.HTM_CONFIG || {};
    const link = cfg.PRO_URL && /^https:\/\//.test(cfg.PRO_URL) ? `<a class="btn primary" href="${esc(cfg.PRO_URL)}" target="_blank" rel="noopener">${esc(cfg.PRO_LABEL || 'Pro')}</a>` : '';
    const consult = cfg.CONSULT_URL && /^https:\/\//.test(cfg.CONSULT_URL) ? `<a class="btn" href="${esc(cfg.CONSULT_URL)}" target="_blank" rel="noopener">${esc(cfg.CONSULT_LABEL || '세무 상담')}</a>` : '';
    return `<div class="pro-box"><p><b>PRO</b> — 시나리오 표·개인 vs 법인 비교·CF 엑셀은 지금 무료로 공개 중입니다. 여러 물건 포트폴리오, 대출 원리금·임대소득세·법인 배당까지 넣은 정밀 리포트는 준비 중입니다.</p>${link || consult ? `<div class="cta">${link}${consult}</div>` : ''}</div>`;
  }

  function render() {
    const x = K.read(form);
    $('#house-opts').hidden = x.kind !== 'house';
    $('#com-opts').hidden = x.kind === 'house';
    const r = Life.calc(x);
    last = { x, r };
    $('#summary').innerHTML = summary(r);
    $('#cf-table').innerHTML = cfTable(r);
    $('#grid').innerHTML = gridTable(x);
    $('#owner-compare').innerHTML = ownerCompare(x);
    $('#mbar-total').textContent = irrText(r.irr);
    saved.save(x);
  }

  function apply(st) {
    form.reset();
    K.write(form, st);
    setOwner(st && st.owner === '법인' ? '법인' : '개인');
    render();
  }

  /** '연도별 CF' 시트의 순현금흐름 열로 엑셀이 직접 계산하는 IRR — 사용자가 CF를 고치면 따라 바뀐다 */
  function irrFormulaRow(r) {
    const col = String.fromCharCode(64 + COLS.findIndex(([k]) => k === 'flow') + 1); // 열 26개 이하
    const row = ['세후 IRR (엑셀 수식 — 연도별 CF를 고치면 다시 계산)', { formula: `IRR('연도별 CF'!${col}2:${col}${r.rows.length + 1})`, result: r.irr == null ? 0 : r.irr }];
    row.fmt = { 1: '0.00%' };
    row.bold = true;
    return row;
  }

  function xlsx() {
    const { x, r } = last;
    const g = Life.grid(x, HOLDS, GROWTHS);
    return window.HTMXlsx.downloadSheets({
      fileName: `세금생애주기_${r.input.years}년.xlsx`,
      title: '보유세맵 취득→보유→양도 현금흐름',
      sheets: [
        { name: '연도별 CF', cols: COLS.map(([k, h]) => ({ h, w: k === 'label' ? 34 : 16, money: k !== 'label' })), rows: r.rows.map(row => COLS.map(([k]) => (k === 'label' ? row.label : row[k] || 0))) },
        { name: '요약', cols: [{ h: '항목', w: 24 }, { h: '값', w: 20, money: true }], rows: [
          ['자기자본(0년차 지출)', r.invested], ['순이익(세후)', r.profit], ['취득세', r.taxes.acq], ['재산세 등', r.taxes.prop], ['종부세·농특세', r.taxes.cmt], ['양도세', r.taxes.transfer], ['세금 합계', r.taxes.total],
          ['세후 IRR(%)', r.irr == null ? null : Math.round(r.irr * 10000) / 100], ['세전 IRR(%)', r.preTaxIrr == null ? null : Math.round(r.preTaxIrr * 10000) / 100],
          irrFormulaRow(r),
        ] },
        { name: '시나리오 IRR', cols: [{ h: '보유기간', w: 12 }, ...GROWTHS.map(v => ({ h: `상승률 ${v}%`, w: 14 }))], rows: g.map(row => [`${row[0].years}년`, ...row.map(c => (c.irr == null ? '' : `${(c.irr * 100).toFixed(1)}%`))]) },
        { name: '가정', cols: [{ h: '내용', w: 110 }], rows: r.notes.map(n => [n]) },
      ],
    });
  }

  function init() {
    const t = K.tools({
      key: 'lifecycle', form, apply,
      state: () => K.read(form),
      label: () => { const x = K.read(form); return `${x.kind === 'house' ? '주택' : '상가'} ${eok(x.price)} ${x.years}년`; },
      total: () => (last ? last.r.taxes.total : 0),
      xlsx,
    });
    const prev = t.shared || saved.load();
    if (prev && typeof prev === 'object') K.write(form, prev);
    setOwner(prev && prev.owner === '법인' ? '법인' : '개인');
    K.moneyInputs(form);
    form.addEventListener('input', render);
    form.querySelectorAll('[data-owner]').forEach(b => b.addEventListener('click', () => { setOwner(b.dataset.owner); render(); }));
    $('#pro-cta').innerHTML = proCta();
    render();
  }

  init();
}());
