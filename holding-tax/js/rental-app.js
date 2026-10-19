/* 임대수익률 화면 — 상가·건물 임대(보증금·월세·공실·운영비)를 생애주기 엔진으로 계산하고 수익률 지표를 보여 준다 */
(function () {
  'use strict';
  const Life = window.Lifecycle;
  const M = window.RentalMetrics;
  const K = window.TaxKit;
  const { esc, won, pct, eok } = K;
  const $ = s => document.querySelector(s);
  const form = $('#form');
  const saved = K.store('rental:v1');
  const HOLDS = [3, 5, 7, 10];
  const GROWTHS = [0, 2, 4, 6];
  let last = null;

  const COLS = [
    ['label', '연도'], ['value', '시세(연말)'], ['deposit', '보증금 수수'], ['rent', '임대수입'], ['opex', '운영비'], ['interest', '이자'],
    ['prop', '재산세 등'], ['cmt', '종부세'], ['acqTax', '취득세'], ['transferTax', '양도세'], ['fee', '중개수수료'], ['saleNet', '매각−대출상환'], ['flow', '순현금흐름'],
  ];
  const pctText = v => (v == null ? '—' : pct(v, 2));
  const irrText = v => (v == null ? '—' : pct(v, 1));

  function setOwner(v) {
    form.querySelector('[data-f="owner"]').value = v;
    form.querySelectorAll('[data-owner]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.owner === v)));
  }

  function summary(r, m) {
    const t = r.taxes;
    const tiles = [
      ['표면수익률', pctText(m.grossYield), `연 임대료 ${eok(m.gross)} ÷ 매입가`],
      ['순수익률(Cap)', pctText(m.capRate), `1년차 순영업소득 ${eok(m.noi)}`],
      ['실투자 수익률', pctText(m.cashOnCash), `(순영업소득 − 이자) ÷ 실투자금`],
      ['이자보상배율', m.dscr == null ? '대출 없음' : `${m.dscr.toFixed(2)}배`, m.dscr != null && m.dscr < 1 ? '임대료로 이자를 다 못 냄' : '순영업소득 ÷ 이자'],
    ];
    return `
      <p class="eyebrow">${esc(r.input.owner)} · 상가·건물 · ${r.input.years}년 보유</p>
      <p class="total" aria-live="polite"><span>${irrText(r.irr)}</span></p>
      <p class="total-sub">세후 IRR(연) · 세전 ${irrText(r.preTaxIrr)} · 실투자금 ${eok(r.invested)} → 순이익 ${eok(r.profit)}${m.multiple ? ` (${m.multiple.toFixed(2)}배)` : ''}</p>
      <div class="kpis">${tiles.map(([h, v, s]) => `<div class="kpi"><span>${h}</span><b>${esc(v)}</b><small>${esc(s)}</small></div>`).join('')}</div>
      <ul class="parts">
        <li><i class="dot seg-land"></i><span>취득세<small>0년차</small></span><b>${won(t.acq)}</b></li>
        <li><i class="dot seg-bld"></i><span>재산세 등<small>${r.input.years}년 합계</small></span><b>${won(t.prop)}</b></li>
        <li><i class="dot seg-cmt"></i><span>종부세·농특세<small>${r.input.years}년 합계</small></span><b>${won(t.cmt)}</b></li>
        <li><i class="dot seg-house"></i><span>양도세<small>${esc(r.sellDate)}</small></span><b>${won(t.transfer)}</b></li>
      </ul>
      <p class="relief-line">세금 합계 ${won(t.total)}원${m.payback ? ` · 누적 현금흐름 회수 ${m.payback}년차` : ''}</p>
      ${r.notes.map(n => `<p class="warn-line">${esc(n)}</p>`).join('')}
      ${K.toolbar()}
      ${K.cta(window.HTM_CONFIG)}
      <p class="fine">간편 추정치입니다. 투자 권유나 세무 자문이 아닙니다.</p>`;
  }

  function cfTable(r) {
    const sum = k => r.rows.reduce((s, x) => s + (Number(x[k]) || 0), 0);
    return `<div class="tw"><table class="cf-year"><thead><tr>${COLS.map(([, h]) => `<th>${h}</th>`).join('')}</tr></thead><tbody>
      ${r.rows.map(x => `<tr>${COLS.map(([k]) => (k === 'label' ? `<th>${esc(x.label)}</th>` : `<td${(k === 'flow' || k === 'deposit') && x[k] < 0 ? ' class="neg"' : ''}>${x[k] ? won(x[k]) : '—'}</td>`)).join('')}</tr>`).join('')}
    </tbody><tfoot><tr><th>합계</th>${COLS.slice(1).map(([k]) => `<td>${k === 'value' ? '' : won(sum(k))}</td>`).join('')}</tr></tfoot></table></div>`;
  }

  function gridTable(x) {
    const g = Life.grid(x, HOLDS, GROWTHS);
    return `<div class="tw"><table class="grid-irr"><thead><tr><th>보유 \\ 상승률</th>${GROWTHS.map(v => `<th>${v}%</th>`).join('')}</tr></thead><tbody>
      ${g.map(row => `<tr><th>${row[0].years}년</th>${row.map(c => `<td class="${c.irr == null ? '' : c.irr < 0 ? 'neg' : c.irr >= 0.06 ? 'pos' : ''}" title="세금 ${won(c.taxes)}원 · 순이익 ${won(c.profit)}원">${irrText(c.irr)}</td>`).join('')}</tr>`).join('')}
    </tbody></table></div><p class="fine">임대 조건은 그대로 두고 보유기간과 시세 상승률만 바꾼 세후 IRR입니다.</p>`;
  }

  /** 엑셀 — 연도별 CF(값) + 수익률(IRR은 CF 열을 참조하는 수식) + 입력 + 가정 */
  function xlsx() {
    const { x, r, m } = last;
    const col = String.fromCharCode(64 + COLS.findIndex(([k]) => k === 'flow') + 1);
    const n = r.rows.length + 1;
    const ratioRow = (label, v) => { const row = [label, v == null ? null : v]; row.fmt = { 1: '0.00%' }; return row; };
    const irrRow = ['세후 IRR (엑셀 수식 — CF를 고치면 다시 계산)', { formula: `IRR('연도별 CF'!${col}2:${col}${n})`, result: r.irr == null ? 0 : r.irr }];
    irrRow.fmt = { 1: '0.00%' };
    irrRow.bold = true;
    const ri = r.input;
    return window.HTMXlsx.downloadSheets({
      fileName: `임대수익률_${ri.years}년.xlsx`,
      title: '보유세맵 임대수익률 · 세후 현금흐름',
      sheets: [
        { name: '연도별 CF', cols: COLS.map(([k, h]) => ({ h, w: k === 'label' ? 34 : 16, money: k !== 'label' })), rows: r.rows.map(row => COLS.map(([k]) => (k === 'label' ? row.label : row[k] || 0))) },
        { name: '수익률', cols: [{ h: '항목', w: 44 }, { h: '값', w: 20, money: true }], rows: [
          irrRow,
          ratioRow('세전 IRR', r.preTaxIrr),
          ratioRow('표면수익률', m.grossYield), ratioRow('순수익률(Cap)', m.capRate), ratioRow('실투자 수익률(1년차)', m.cashOnCash),
          ['연 임대료(공실 전)', m.gross], ['1년차 순영업소득(NOI)', m.noi], ['1년차 순현금(NOI − 이자)', m.cash1],
          ['실투자금(0년차 지출)', r.invested], ['순이익(세후)', r.profit],
          ['취득세', r.taxes.acq], ['재산세 등', r.taxes.prop], ['종부세·농특세', r.taxes.cmt], ['양도세', r.taxes.transfer], ['세금 합계', r.taxes.total],
        ] },
        { name: '입력', cols: [{ h: '항목', w: 24 }, { h: '값', w: 20, money: true }], rows: [
          ['소유자', ri.owner], ['매입가', ri.price], ['매입일', ri.buyDate], ['대출', ri.loan], ['대출 금리(%)', +(ri.loanRate * 100).toFixed(3)],
          ['임대보증금', ri.deposit], ['월세', ri.monthlyRent], ['공실률(%)', +(ri.vacancy * 100).toFixed(2)], ['운영비(연)', ri.opex],
          ['임대료 상승률(%)', +(ri.rentGrowth * 100).toFixed(2)], ['보유기간(년)', ri.years], ['시세 상승률(%)', +(ri.growth * 100).toFixed(2)],
        ] },
        { name: '가정', cols: [{ h: '내용', w: 110 }], rows: r.notes.map(t => [t]) },
      ],
    });
  }

  function render() {
    const x = { ...K.read(form), kind: 'commercial' };
    const r = Life.calc(x);
    const m = M.metrics(r);
    last = { x, r, m };
    $('#summary').innerHTML = summary(r, m);
    $('#cf-table').innerHTML = cfTable(r);
    $('#grid').innerHTML = gridTable(x);
    $('#mbar-total').textContent = irrText(r.irr);
    saved.save(x);
  }

  function apply(st) {
    form.reset();
    K.write(form, st);
    setOwner(st && st.owner === '법인' ? '법인' : '개인');
    render();
  }

  function init() {
    const t = K.tools({
      key: 'rental', form, apply,
      state: () => K.read(form),
      label: () => { const x = K.read(form); return `임대 ${eok(x.price)} 월세 ${eok(x.monthlyRent)} ${x.years}년`; },
      total: () => (last ? last.r.taxes.total : 0),
      xlsx,
    });
    const prev = t.shared || saved.load();
    if (prev && typeof prev === 'object') K.write(form, prev);
    setOwner(prev && prev.owner === '법인' ? '법인' : '개인');
    K.moneyInputs(form);
    form.addEventListener('input', render);
    form.querySelectorAll('[data-owner]').forEach(b => b.addEventListener('click', () => { setOwner(b.dataset.owner); render(); }));
    render();
  }

  init();
}());
