/* 취득세 화면 — 폼 → AcqTax.calc → 요약·계산 과정 */
(function () {
  'use strict';
  const A = window.AcqTax;
  const K = window.TaxKit;
  const { esc, won, pct, eok } = K;
  const $ = s => document.querySelector(s);
  const form = $('#form');
  const saved = K.store('acq-tax:v1');

  function fillReliefs() {
    $('#relief-sel').innerHTML = Object.entries(A.RELIEFS).map(([k, v]) => `<option value="${esc(k)}">${esc(v.label)}</option>`).join('');
  }

  function setOwner(v) {
    form.querySelector('[data-f="buyer"]').value = v;
    form.querySelectorAll('[data-owner]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.owner === v)));
  }

  function toggles(x) {
    const house = x.asset === 'house';
    $('#house-opts').hidden = !house;
    $('#gift-wrap').hidden = !(house && x.cause === 'gift');
    $('#metro-wrap').hidden = x.buyer !== '법인';
    $('#abroad-wrap').hidden = x.cause !== 'inherit';
    $('#custom-wrap').hidden = x.relief !== 'custom';
    // 주택 전용 감면은 주택일 때만 고를 수 있다
    [...$('#relief-sel').options].forEach(o => { o.disabled = Boolean(A.RELIEFS[o.value].house) && !house; });
  }

  function reliefInfo(x, r) {
    const rel = A.RELIEFS[x.relief];
    if (!rel || x.relief === 'none') return '';
    const res = r.relief;
    const amount = res ? `취득세 −${won(res.amount)}원${res.edu ? ` · 지방교육세 −${won(res.edu)}원` : ''}${r.reliefNong ? ` · 감면분 농특세 +${won(r.reliefNong)}원` : ''}` : '이 물건에는 적용되지 않습니다';
    return `<p class="law-line"><b>${esc(rel.law)}</b> — ${esc(amount)}</p><p class="need-line">요건: ${esc(rel.need)}</p>`;
  }

  function summary(x, r) {
    const parts = [
      { k: 'land', label: '취득세', v: r.acqFinal, when: r.relief && r.relief.amount ? `감면 −${won(r.relief.amount)}` : pct(r.rate) },
      { k: 'bld', label: '지방교육세', v: r.eduFinal, when: '취득세와 함께' },
      { k: 'cmt', label: '농어촌특별세', v: r.nong, when: r.nong ? '취득세와 함께' : '비과세' },
    ];
    const due = x.date ? A.dueDate(x.date, x.cause, x.abroad) : '';
    return `
      <p class="eyebrow">${esc(A.CAUSES[x.cause])} · ${esc(A.ASSETS[x.asset])} · ${esc(x.buyer)}</p>
      <p class="total" aria-live="polite"><span>${won(r.total)}</span>원</p>
      <p class="total-sub">${r.total > 0 ? `실효세율 ${pct(r.effective)} · ${esc(r.rule)} ${pct(r.rate)}` : '취득가액을 넣으면 바로 계산됩니다'}</p>
      ${r.total > 0 ? `<div class="stack">${parts.filter(p => p.v > 0).map(p => `<span class="seg-${p.k}" style="flex:${p.v}"></span>`).join('')}</div>` : ''}
      <ul class="parts">${parts.map(p => `<li><i class="dot seg-${p.k}"></i><span>${p.label}<small>${esc(p.when)}</small></span><b>${won(p.v)}</b></li>`).join('')}</ul>
      ${r.relief && r.relief.amount ? `<p class="relief-line">${esc(r.relief.law)} — 세금 순감 ${won(r.relief.amount + r.relief.edu - r.reliefNong)}원${r.reliefNong ? ' (감면분 농특세 차감 후)' : ''}</p>` : ''}
      ${r.notes.map(n => `<p class="warn-line">${esc(n)}</p>`).join('')}
      <p class="fine">신고·납부: ${esc(r.due)}${due ? ` → <b>${esc(due)}</b>까지` : ''} (${esc(r.dueLaw)})</p>
      ${K.cta(window.HTM_CONFIG)}
      <p class="fine">간편 추정치입니다. 주택 수·조정대상지역·감면 요건 판정에 따라 실제 세액이 달라질 수 있습니다.</p>`;
  }

  function detail(x, r) {
    const rows = [
      ['과세표준(취득가액)', `${won(r.price)}원`],
      ['표준세율', `${pct(r.standard, 3)} (지방세법 제11조①)`],
      ['적용세율', `${pct(r.rate, 3)} — ${r.rule} (${r.law})`],
      ['취득세 산출', `${won(r.acq)}원`],
      ...(r.relief ? [['취득세 감면', `−${won(r.relief.amount)}원 (${r.relief.law}${r.relief.minTax ? ', 최소납부세제 85%' : ''})`]] : []),
      ['취득세 납부', `${won(r.acqFinal)}원`],
      ['지방교육세', `${won(r.edu)}원${r.relief && r.relief.edu ? ` − 감면 ${won(r.relief.edu)}원 = ${won(r.eduFinal)}원` : ''} (지방세법 제151조①1)`],
      ['농어촌특별세', r.nong || r.nongAcq ? `${won(r.nongAcq)}원 (취득세분)${r.reliefNong ? ` + ${won(r.reliefNong)}원 (감면세액 20%)` : ''} = ${won(r.nong)}원` : '비과세'],
      ['합계', `${won(r.total)}원 (${eok(r.total)})`],
    ];
    return `<div class="tw"><table><tbody>${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function render() {
    const x = K.read(form);
    toggles(x);
    const r = A.calc({ ...x, houseCount: Math.max(1, x.houseCount) });
    $('#summary').innerHTML = summary(x, r);
    $('#detail').innerHTML = detail(x, r);
    $('#relief-info').innerHTML = reliefInfo(x, r);
    $('#mbar-total').textContent = `${won(r.total)}원`;
    saved.save(x);
  }

  function init() {
    fillReliefs();
    $('#basis').innerHTML = K.basisTable(A.BASIS);
    const prev = saved.load();
    if (prev && typeof prev === 'object') K.write(form, prev);
    setOwner(prev && prev.buyer === '법인' ? '법인' : '개인');
    if (!form.querySelector('[data-f="date"]').value) form.querySelector('[data-f="date"]').value = K.today();
    K.moneyInputs(form);
    form.addEventListener('input', render);
    form.addEventListener('change', render);
    form.querySelectorAll('[data-owner]').forEach(b => b.addEventListener('click', () => { setOwner(b.dataset.owner); render(); }));
    render();
  }

  init();
}());
