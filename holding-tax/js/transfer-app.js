/* 양도소득세 화면 — 폼 → TransferTax.calc → 요약·계산 과정 */
(function () {
  'use strict';
  const T = window.TransferTax;
  const K = window.TaxKit;
  const { esc, won, pct, eok } = K;
  const $ = s => document.querySelector(s);
  const form = $('#form');
  const saved = K.store('transfer-tax:v1');

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
    $('#cost-l').textContent = corp ? '장부가액' : '취득가액';
    $('#cost-h').textContent = corp ? '취득가액 − 감가상각누계액' : '실거래가';
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
      ${r.missingDates ? "" : `<p class="fine">세후 손에 남는 돈: <b>${won(r.price - r.total)}원</b> (양도가액 − 세금)</p>`}
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
      ${K.cta(window.HTM_CONFIG)}
      <p class="fine">법인세는 사업연도 종료 후 3개월(12월 결산이면 다음 해 3월) 안에 신고합니다.</p>`;
  }

  function detailInd(r) {
    const rows = [
      ['양도가액', r.price], ['취득가액', -r.cost], ['필요경비', -r.expense], ['양도차익', r.gain],
      ...(r.highRatio < 1 ? [[`고가주택 과세 비율 (양도가액−12억)÷양도가액 = ${pct(r.highRatio)}`, r.taxableGain]] : []),
      [`장기보유특별공제 ${r.lt.table === 2 ? `표2 (보유 ${pct(r.lt.hold, 0)} + 거주 ${pct(r.lt.live, 0)})` : r.lt.table === 1 ? '표1' : '미적용'} ${pct(r.lt.rate, 0)}`, -r.longTerm],
      ['양도소득금액', r.income], ['기본공제', -r.basic], ['과세표준', r.base],
      [`산출세액 — ${r.rateLabel || '—'}`, r.computed],
      ...(r.relief ? [[`감면 ${r.relief.law}`, -r.relief.amount]] : []),
      ['결정세액', r.decided], ['지방소득세 (10%)', r.local], ['농어촌특별세', r.nong], ['합계', r.total],
    ];
    const cands = r.candidates.length > 1
      ? `<p class="formula">세율 비교 — ${r.candidates.map(c => `${esc(c.label)} ${won(c.tax)}원`).join(' · ')} → 큰 쪽 적용(소득세법 제104조①)</p>` : '';
    return `<div class="tw"><table><tbody>${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${v < 0 ? '−' : ''}${won(Math.abs(v))}</td></tr>`).join('')}</tbody></table></div>${cands}`;
  }

  function detailCorp(r) {
    const rows = [
      ['양도가액', r.price], ['장부가액', -r.book], ['필요경비', -r.expense], ['처분이익', r.gain],
      [`법인세 증가분 (다른 과세표준 ${won(r.other)}원에 합산)`, r.corpTax],
      [`토지등 양도소득 법인세 (${Math.round(r.addRate * 100)}%)`, r.extra],
      ['법인지방소득세', r.local], ['합계', r.total],
    ];
    return `<div class="tw"><table><tbody>${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${v < 0 ? '−' : ''}${won(Math.abs(v))}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function render() {
    const x = K.read(form);
    toggles(x);
    const r = T.calc({ ...x, houseCount: Math.max(1, x.houseCount) });
    const corp = r.seller === '법인';
    $('#summary').innerHTML = corp ? summaryCorp(x, r) : summaryInd(x, r);
    $('#detail').innerHTML = corp ? detailCorp(r) : detailInd(r);
    $('#relief-info').innerHTML = reliefInfo(x, r);
    $('#mbar-total').textContent = `${won(r.total)}원`;
    saved.save(x);
  }

  function init() {
    $('#relief-sel').innerHTML = Object.entries(T.RELIEFS).map(([k, v]) => `<option value="${esc(k)}">${esc(v.label)}</option>`).join('');
    $('#basis').innerHTML = K.basisTable(T.BASIS);
    const prev = saved.load();
    if (prev && typeof prev === 'object') K.write(form, prev);
    setOwner(prev && prev.seller === '법인' ? '법인' : '개인');
    const sale = form.querySelector('[data-f="saleDate"]');
    if (!sale.value) sale.value = K.today();
    K.moneyInputs(form);
    form.addEventListener('input', render);
    form.addEventListener('change', render);
    form.querySelectorAll('[data-owner]').forEach(b => b.addEventListener('click', () => { setOwner(b.dataset.owner); render(); }));
    render();
  }

  init();
}());
