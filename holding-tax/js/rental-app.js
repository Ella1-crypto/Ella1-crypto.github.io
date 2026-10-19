/* 임대수익률 화면 — 상가·건물 임대(보증금·월세·공실·운영비)를 생애주기 엔진으로 계산하고,
 * 월별 현금흐름(RentalMonthly)으로 세후 IRR을 낸다. 들어오는 돈 +, 나가는 돈 −. */
(function () {
  'use strict';
  const Life = window.Lifecycle;
  const M = window.RentalMetrics;
  const RM = window.RentalMonthly;
  const K = window.TaxKit;
  const { esc, won, pct, eok } = K;
  const $ = s => document.querySelector(s);
  const form = $('#form');
  const saved = K.store('rental:v1');
  const HOLDS = [3, 5, 7, 10];
  const GROWTHS = [0, 2, 4, 6];
  let last = null;

  // 들어오는 돈 +, 나가는 돈 −
  const COLS = [
    ['label', '기간'], ['trade', '매입·매각'], ['loan', '대출'], ['deposit', '보증금'], ['rent', '월세'], ['opex', '운영비'], ['interest', '이자'],
    ['prop', '재산세'], ['cmt', '종부세'], ['acqTax', '취득세'], ['transferTax', '양도세'], ['fee', '중개수수료'], ['flow', '순현금흐름'],
  ];
  const MONTH_COLS = [['ym', '월'], ...COLS.slice(1)];
  const pctText = v => (v == null ? '—' : pct(v, 2));
  const irrText = v => (v == null ? '—' : pct(v, 1));

  function setOwner(v) {
    form.querySelector('[data-f="owner"]').value = v;
    form.querySelectorAll('[data-owner]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.owner === v)));
  }

  function summary(r, m, mm) {
    const t = r.taxes;
    const tiles = [
      ['표면수익률', pctText(m.grossYield), `연 임대료 ${eok(m.gross)} ÷ 매입가`],
      ['순수익률(Cap)', pctText(m.capRate), `1년차 순영업소득 ${eok(m.noi)}`],
      ['실투자 수익률', pctText(m.cashOnCash), `(순영업소득 − 이자) ÷ 실투자금`],
      ['이자보상배율', m.dscr == null ? '대출 없음' : `${m.dscr.toFixed(2)}배`, m.dscr != null && m.dscr < 1 ? '임대료로 이자를 다 못 냄' : '순영업소득 ÷ 이자'],
    ];
    return `
      <p class="eyebrow">${esc(r.input.owner)} · 상가·건물 · ${r.input.years}년 보유</p>
      <p class="total" aria-live="polite"><span>${irrText(mm.irr)}</span></p>
      <p class="total-sub">세후 IRR(연, 월별 CF 기준) · 월 ${mm.monthlyIrr == null ? '—' : pct(mm.monthlyIrr, 2)} · 실투자금 ${eok(r.invested)} → 순이익 ${eok(r.profit)}${m.multiple ? ` (${m.multiple.toFixed(2)}배)` : ''}</p>
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

  const cell = (x, k) => `<td class="${x[k] < 0 ? 'neg' : ''}">${x[k] ? won(x[k]) : '—'}</td>`;

  /** 연차별 합계(월별 CF를 12개월씩 더한 것) */
  function cfTable(mm) {
    const sum = k => mm.years.reduce((s, x) => s + (Number(x[k]) || 0), 0);
    return `<div class="tw"><table class="cf-year"><thead><tr>${COLS.map(([, h]) => `<th>${h}</th>`).join('')}</tr></thead><tbody>
      ${mm.years.map(x => `<tr>${COLS.map(([k]) => (k === 'label' ? `<th>${esc(x.label)}</th>` : cell(x, k))).join('')}</tr>`).join('')}
    </tbody><tfoot><tr><th>합계</th>${COLS.slice(1).map(([k]) => `<td class="${sum(k) < 0 ? 'neg' : ''}">${won(sum(k))}</td>`).join('')}</tr></tfoot></table></div>
    ${monthTable(mm)}`;
  }

  /** 월별 CF 전체(접어 둠) */
  function monthTable(mm) {
    const lastIdx = mm.months.length - 1;
    return `<details class="months"><summary>월별 현금흐름 ${mm.months.length}개월 펼치기</summary><div class="tw"><table class="cf-year"><thead><tr>${MONTH_COLS.map(([, h]) => `<th>${h}</th>`).join('')}</tr></thead><tbody>
      ${mm.months.map(x => `<tr>${MONTH_COLS.map(([k]) => (k === 'ym' ? `<th>${esc(x.ym)}${x.idx === 0 ? ' 매입' : x.idx === lastIdx ? ' 매각' : ''}</th>` : cell(x, k))).join('')}</tr>`).join('')}
    </tbody></table></div></details>`;
  }

  function gridTable(x) {
    // 시나리오도 월별 CF 기준 IRR
    const g = HOLDS.map(years => GROWTHS.map(growth => {
      const r = Life.calc({ ...x, years, growth });
      return { years, irr: RM.monthly(r).irr, taxes: r.taxes.total, profit: r.profit };
    }));
    const head = GROWTHS.map(v => `<th>${v}%</th>`).join('');
    const body = g.map(row => `<tr><th>${row[0].years}년</th>${row.map(c => `<td class="${c.irr == null ? '' : c.irr < 0 ? 'neg' : c.irr >= 0.06 ? 'pos' : ''}" title="세금 ${won(c.taxes)}원 · 순이익 ${won(c.profit)}원">${irrText(c.irr)}</td>`).join('')}</tr>`).join('');
    return `<div class="tw"><table class="grid-irr"><thead><tr><th>보유 ＼ 상승률</th>${head}</tr></thead><tbody>${body}</tbody></table></div><p class="fine">임대 조건은 그대로 두고 보유기간과 시세 상승률만 바꾼 세후 IRR(월별 CF 기준)입니다.</p>`;
  }

  /** 엑셀 — 월별 CF(세후 IRR 수식) + 연차별 CF + 수익률 + 입력 + 가정. 들어오는 돈 +, 나가는 돈 − */
  function xlsx() {
    const { r, m, mm } = last;
    const ri = r.input;
    const letter = n => String.fromCharCode(64 + n);
    const flowCol = letter(MONTH_COLS.findIndex(([k]) => k === 'flow') + 1);
    const lastRow = mm.months.length + 1;
    const pctRow = (label, v) => { const row = [label, v == null ? null : v]; row.fmt = { 1: '0.00%' }; return row; };
    const irrRow = ['세후 IRR (연 환산, 엑셀 수식 — 월별 CF를 고치면 다시 계산)', { formula: `(1+IRR('월별 CF'!${flowCol}2:${flowCol}${lastRow}))^12-1`, result: mm.irr == null ? 0 : mm.irr }];
    irrRow.fmt = { 1: '0.00%' };
    irrRow.bold = true;
    const monthIrr = ['월 IRR (엑셀 수식)', { formula: `IRR('월별 CF'!${flowCol}2:${flowCol}${lastRow})`, result: mm.monthlyIrr == null ? 0 : mm.monthlyIrr }];
    monthIrr.fmt = { 1: '0.000%' };
    const money = cols => cols.map(([k, h]) => ({ h, w: k === 'label' || k === 'ym' ? 30 : 16, money: k !== 'label' && k !== 'ym' }));
    return window.HTMXlsx.downloadSheets({
      fileName: `임대수익률_${ri.years}년.xlsx`,
      title: '보유세맵 임대수익률 · 월별 세후 현금흐름',
      sheets: [
        { name: '월별 CF', cols: money(MONTH_COLS), rows: mm.months.map(x => MONTH_COLS.map(([k]) => (k === 'ym' ? x.ym : x[k] || 0))) },
        { name: '수익률', cols: [{ h: '항목', w: 48 }, { h: '값', w: 20, money: true }], rows: [
          irrRow, monthIrr,
          pctRow('표면수익률', m.grossYield), pctRow('순수익률(Cap)', m.capRate), pctRow('실투자 수익률(1년차)', m.cashOnCash),
          ['연 임대료(공실 전)', m.gross], ['1년차 순영업소득(NOI)', m.noi], ['1년차 순현금(NOI − 이자)', m.cash1],
          ['실투자금(매입 월 지출)', r.invested], ['순이익(세후)', r.profit],
          ['취득세', r.taxes.acq], ['재산세 등', r.taxes.prop], ['종부세·농특세', r.taxes.cmt], ['양도세', r.taxes.transfer], ['세금 합계', r.taxes.total],
        ] },
        { name: '연차별 CF', cols: money(COLS), rows: mm.years.map(x => COLS.map(([k]) => (k === 'label' ? x.label : x[k] || 0))) },
        { name: '입력', cols: [{ h: '항목', w: 24 }, { h: '값', w: 20, money: true }], rows: [
          ['소유자', ri.owner], ['매입가', ri.price], ['매입일', ri.buyDate], ['대출', ri.loan], ['대출 금리(%)', +(ri.loanRate * 100).toFixed(3)],
          ['임대보증금', ri.deposit], ['월세', ri.monthlyRent], ['공실률(%)', +(ri.vacancy * 100).toFixed(2)], ['운영비(연)', ri.opex],
          ['임대료 상승률(%)', +(ri.rentGrowth * 100).toFixed(2)], ['보유기간(년)', ri.years], ['시세 상승률(%)', +(ri.growth * 100).toFixed(2)],
        ] },
        { name: '가정', cols: [{ h: '내용', w: 110 }], rows: [
          ['들어오는 돈 +, 나가는 돈 −. 월세·이자·운영비는 매월, 건축물분 재산세 7월·토지분 9월·종부세 12월, 양도세는 매각 월에 넣었습니다.'],
          ...r.notes.map(t => [t]),
        ] },
      ],
    });
  }

  function render() {
    const x = { ...K.read(form), kind: 'commercial' };
    const r = Life.calc(x);
    const mm = RM.monthly(r);
    const m = { ...M.metrics(r), irr: mm.irr };
    last = { x, r, m, mm };
    $('#summary').innerHTML = summary(r, m, mm);
    $('#cf-table').innerHTML = cfTable(mm);
    $('#grid').innerHTML = gridTable(x);
    $('#mbar-total').textContent = irrText(mm.irr);
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
