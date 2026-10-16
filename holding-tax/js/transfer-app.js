/* 양도소득세 화면 — 폼 → TransferTax.calc → 요약·계산 과정·공유·엑셀 */
(function () {
  'use strict';
  const T = window.TransferTax;
  const K = window.TaxKit;
  const { esc, won, pct, eok } = K;
  const $ = s => document.querySelector(s);
  const form = $('#form');
  const saved = K.store('transfer-tax:v1');
  let last = null; // 마지막 계산 { x, r }

  function setOwner(v) {
    form.querySelector('[data-f="seller"]').value = v;
    form.querySelectorAll('[data-owner]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.owner === v)));
  }

  function toggles(x) {
    const corp = x.seller === '법인';
    $('#ind-opts').hidden = corp;
    $('#corp-opts').hidden = !corp;
    $('#date-opts').hidden = corp;
    $('#house-opts').hidden = x.asset !== 'house';
    $('#res-wrap').hidden = x.asset !== 'house';
    $('#nb-wrap').hidden = x.asset !== 'land';
    $('#right-opts').hidden = x.asset !== 'membership';
    $('#temp2-wrap').hidden = x.houseCount !== 2;
    $('#cost-l').textContent = corp ? '장부가액' : x.carryover ? '취득가액(증여가액)' : '취득가액';
    $('#cost-h').textContent = corp ? '취득가액 − 감가상각누계액' : x.useConversion ? '환산취득가액을 쓰면 무시합니다' : '실거래가';
  }

  /** 주택 수 1채로 바꾸면 1세대1주택을 켠다(사용자가 다시 끌 수 있다) */
  function houseCountSync(ev) {
    if (!ev || !ev.target || ev.target.dataset.f !== 'houseCount') return;
    const n = parseInt(ev.target.value, 10) || 0;
    const box = form.querySelector('[data-f="oneHouse"]');
    if (n === 1) box.checked = true;
    if (n >= 2) box.checked = false;
  }

  function reliefInfo(x, r) {
    const rel = T.RELIEFS[x.relief];
    if (!rel || x.relief === 'none' || r.seller === '법인') return '';
    const amt = r.relief ? `양도소득세 −${won(r.relief.amount)}원${r.nong ? ` · 감면세액 20% 농특세 +${won(r.nong)}원` : ' · 농특세 비과세'}` : '';
    return `<p class="law-line"><b>${esc(rel.law)}</b>${amt ? ` — ${esc(amt)}` : ''}</p><p class="need-line">${x.relief === 'farm8' ? '요건: 농지 소재지(연접 시군구·30km 이내) 거주, 8년 이상 직접 경작, 근로·사업소득 3,700만원 이상인 해는 경작기간 제외. 5년 합계 2억 한도.' : '요건: 사업인정고시일부터 2년 이전 취득, 공익사업 수용·협의매수. 2026.12.31. 양도분까지.'}</p>`;
  }

  function summaryInd(x, r) {
    const parts = [
      { k: 'land', label: '양도소득세', v: r.decided, when: `예정신고 ${r.due.national || '양도일 입력'}` },
      { k: 'bld', label: '지방소득세', v: r.local, when: `신고 ${r.due.local || '—'}` },
      { k: 'cmt', label: '농어촌특별세', v: r.nong, when: r.nong ? '감면세액 20%' : '해당 없음' },
    ];
    return `
      <p class="eyebrow">${esc(T.ASSETS[x.asset])} · 개인 · 보유 ${r.years}년</p>
      <p class="total" aria-live="polite"><span>${won(r.total)}</span>원</p>
      <p class="total-sub">${r.missingDates ? '취득일·양도일을 넣으면 계산됩니다' : r.exempt ? '1세대1주택 비과세' : r.total > 0 ? `${esc(r.rateLabel)} · 양도차익의 ${pct(r.gain ? r.total / r.gain : 0, 1)}` : '양도가액·취득가액·날짜를 넣으면 계산됩니다'}</p>
      ${r.total > 0 ? `<div class="stack">${parts.filter(p => p.v > 0).map(p => `<span class="seg-${p.k}" style="flex:${p.v}"></span>`).join('')}</div>` : ''}
      <ul class="parts">${parts.map(p => `<li><i class="dot seg-${p.k}"></i><span>${p.label}<small>${esc(p.when)}</small></span><b>${won(p.v)}</b></li>`).join('')}</ul>
      ${r.exempt ? '<p class="relief-line">소득세법 제89조①3 — 1세대1주택 비과세</p>' : ''}
      ${r.relief && r.relief.amount ? `<p class="relief-line">${esc(r.relief.law)} −${won(r.relief.amount)}원</p>` : ''}
      ${r.heavyAdd ? `<p class="warn-line">조정대상지역 다주택 중과 +${Math.round(r.heavyAdd * 100)}%p, 장기보유특별공제 배제 (소득세법 제104조⑦)</p>` : ''}
      ${r.notes.filter(n => !/^1세대1주택 비과세/.test(n)).map(n => `<p class="warn-line">${esc(n)}</p>`).join('')}
      ${r.missingDates ? '' : `<p class="fine">세후 손에 남는 돈: <b>${won(r.price - r.total)}원</b> (양도가액 − 세금)</p>`}
      ${K.toolbar()}
      <p class="fine"><a href="lifecycle.html" style="color:inherit"><b>취득 → 보유 → 양도 한 번에 보기 →</b></a></p>
      ${K.cta(window.HTM_CONFIG)}
      <p class="fine">간편 추정치입니다. 1세대1주택·중과 제외 판정, 같은 해 다른 양도, 감면 요건에 따라 실제 세액이 달라질 수 있습니다.</p>`;
  }

  function summaryCorp(x, r) {
    const parts = [
      { k: 'land', label: '법인세 증가분', v: r.corpTax, when: '각 사업연도 소득' },
      { k: 'cmt', label: '토지등 양도소득 법인세', v: r.extra, when: r.addRate ? `차익 × ${Math.round(r.addRate * 100)}%` : '해당 없음' },
      { k: 'bld', label: '법인지방소득세', v: r.local, when: '각 10%' },
    ];
    return `
      <p class="eyebrow">${esc(T.ASSETS[x.asset])} · 법인 처분</p>
      <p class="total" aria-live="polite"><span>${won(r.total)}</span>원</p>
      <p class="total-sub">${r.total > 0 ? `처분이익 ${eok(r.gain)}의 ${pct(r.gain > 0 ? r.total / r.gain : 0, 1)}` : '양도가액·장부가액을 넣으면 계산됩니다'}</p>
      ${r.total > 0 ? `<div class="stack">${parts.filter(p => p.v > 0).map(p => `<span class="seg-${p.k}" style="flex:${p.v}"></span>`).join('')}</div>` : ''}
      <ul class="parts">${parts.map(p => `<li><i class="dot seg-${p.k}"></i><span>${p.label}<small>${esc(p.when)}</small></span><b>${won(p.v)}</b></li>`).join('')}</ul>
      ${r.notes.map(n => `<p class="warn-line">${esc(n)}</p>`).join('')}
      ${K.toolbar()}
      ${K.cta(window.HTM_CONFIG)}
      <p class="fine">법인세는 사업연도 종료 후 3개월(12월 결산이면 다음 해 3월) 안에 신고합니다.</p>`;
  }

  function rowsInd(r) {
    return [
      ['양도가액', r.price], ['취득가액', -r.cost], ['필요경비', -r.expense], ['양도차익', r.gain],
      ...(r.highRatio < 1 ? [[`고가주택 과세 비율 (양도가액−12억)÷양도가액 = ${pct(r.highRatio)}`, r.taxableGain]] : []),
      ...(r.preGain ? [['관리처분인가 전 양도차익 (장특공 대상)', r.preGain]] : []),
      [`장기보유특별공제 ${r.lt.table === 2 ? `표2 (보유 ${pct(r.lt.hold, 0)} + 거주 ${pct(r.lt.live, 0)})` : r.lt.table === 1 ? '표1' : '미적용'} ${pct(r.lt.rate, 0)}`, -r.longTerm],
      ['양도소득금액', r.income], ['기본공제', -r.basic], ['과세표준', r.base],
      [`산출세액 — ${r.rateLabel || '—'}`, r.computed],
      ...(r.relief ? [[`감면 ${r.relief.law}`, -r.relief.amount]] : []),
      ['결정세액', r.decided], ['지방소득세 (10%)', r.local], ['농어촌특별세', r.nong], ['합계', r.total],
    ];
  }

  function rowsCorp(r) {
    return [
      ['양도가액', r.price], ['장부가액', -r.book], ['필요경비', -r.expense], ['처분이익', r.gain],
      [`법인세 증가분 (다른 과세표준 ${won(r.other)}원에 합산)`, r.corpTax],
      [`토지등 양도소득 법인세 (${Math.round(r.addRate * 100)}%)`, r.extra],
      ['법인지방소득세', r.local], ['합계', r.total],
    ];
  }

  const table = rows => `<div class="tw"><table><tbody>${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${v < 0 ? '−' : ''}${won(Math.abs(v))}</td></tr>`).join('')}</tbody></table></div>`;

  function detailInd(r) {
    const cands = r.candidates.length > 1
      ? `<p class="formula">세율 비교 — ${r.candidates.map(c => `${esc(c.label)} ${won(c.tax)}원`).join(' · ')} → 큰 쪽 적용(소득세법 제104조①)</p>` : '';
    return table(rowsInd(r)) + cands;
  }

  function regInfo(x, reg) {
    if (x.seller === '법인' || x.asset !== 'house' || !x.addr) return '';
    return K.regLine('취득 당시', reg[0].res) + K.regLine('양도 당시', reg[1].res);
  }

  function render(ev) {
    houseCountSync(ev);
    const reg = K.regulatedSync(form, 'addr', [['acqDate', 'adjustedAtAcq'], ['saleDate', 'adjustedNow']], ev || null);
    const x = K.read(form);
    toggles(x);
    const r = T.calc({ ...x, houseCount: Math.max(1, x.houseCount) });
    last = { x, r };
    const corp = r.seller === '법인';
    $('#reg-info').innerHTML = regInfo(x, reg);
    $('#summary').innerHTML = corp ? summaryCorp(x, r) : summaryInd(x, r);
    $('#detail').innerHTML = corp ? table(rowsCorp(r)) : detailInd(r);
    $('#relief-info').innerHTML = reliefInfo(x, r);
    $('#mbar-total').textContent = `${won(r.total)}원`;
    saved.save(x);
  }

  function apply(st) {
    form.reset();
    K.write(form, st);
    setOwner(st && st.seller === '법인' ? '법인' : '개인');
    render(null);
  }

  function xlsx() {
    const { x, r } = last;
    const corp = r.seller === '법인';
    const rows = (corp ? rowsCorp(r) : rowsInd(r)).map(([k, v]) => [k, v]);
    const inputs = [
      ['양도자', x.seller], ['물건', T.ASSETS[x.asset]], ['소재지', x.addr || ''], ['양도가액', x.price], ['취득가액', x.cost], ['필요경비', x.expense],
      ['취득일', x.acqDate], ['양도일', x.saleDate], ['거주기간(년)', x.residenceYears], ['주택 수', x.houseCount],
      ['1세대1주택', x.oneHouse ? '예' : '아니오'], ['양도 당시 조정대상지역', x.adjustedNow ? '예' : '아니오'],
    ];
    return window.HTMXlsx.downloadSheets({
      fileName: `양도세_${x.saleDate || K.today()}.xlsx`,
      title: '보유세맵 양도소득세 계산',
      sheets: [
        { name: '계산 과정', cols: [{ h: '단계', w: 48 }, { h: '금액(원)', w: 20, money: true }], rows },
        { name: '입력값', cols: [{ h: '항목', w: 24 }, { h: '값', w: 30 }], rows: inputs },
        { name: '안내', cols: [{ h: '내용', w: 110 }], rows: r.notes.map(n => [n]) },
      ],
      basis: T.BASIS,
    });
  }

  function init() {
    $('#relief-sel').innerHTML = Object.entries(T.RELIEFS).map(([k, v]) => `<option value="${esc(k)}">${esc(v.label)}</option>`).join('');
    $('#basis').innerHTML = K.basisTable(T.BASIS);
    const t = K.tools({
      key: 'transfer-tax', form, apply,
      state: () => K.read(form),
      label: () => { const x = K.read(form); return `${T.ASSETS[x.asset] || ''} ${eok(x.price)} ${x.addr || ''}`.trim(); },
      total: () => (last ? last.r.total : 0),
      xlsx,
    });
    const prev = t.shared || saved.load();
    if (prev && typeof prev === 'object') K.write(form, prev);
    setOwner(prev && prev.seller === '법인' ? '법인' : '개인');
    const sale = form.querySelector('[data-f="saleDate"]');
    if (!sale.value) sale.value = K.today();
    K.moneyInputs(form);
    form.addEventListener('input', render);
    form.querySelectorAll('[data-owner]').forEach(b => b.addEventListener('click', () => { setOwner(b.dataset.owner); render(null); }));
    render(null);
  }

  init();
}());
