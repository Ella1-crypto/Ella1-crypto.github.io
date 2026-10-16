/* 취득세 화면 — 폼 → AcqTax.calc → 요약·계산 과정·감면 비교·공유·엑셀 */
(function () {
  'use strict';
  const A = window.AcqTax;
  const K = window.TaxKit;
  const { esc, won, pct, eok } = K;
  const $ = s => document.querySelector(s);
  const form = $('#form');
  const saved = K.store('acq-tax:v1');
  const HOME_RELIEFS = ['firstHome', 'firstHomeSmall', 'birth'];
  let last = null; // 마지막 계산 { x, r }

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
    $('#inh1-wrap').hidden = !(x.cause === 'inherit' && house);
    $('#custom-wrap').hidden = x.relief !== 'custom';
    // 주택 전용 감면은 주택일 때만 고를 수 있다
    [...$('#relief-sel').options].forEach(o => { o.disabled = Boolean(A.RELIEFS[o.value].house) && !house; });
  }

  const input = x => ({ ...x, houseCount: Math.max(1, x.houseCount) });

  function reliefInfo(x, r) {
    const rel = A.RELIEFS[x.relief];
    if (!rel || x.relief === 'none') return '';
    const res = r.relief;
    const amount = res ? `취득세 −${won(res.amount)}원${res.edu ? ` · 지방교육세 −${won(res.edu)}원` : ''}${r.reliefNong ? ` · 감면분 농특세 +${won(r.reliefNong)}원` : ''}` : '이 물건에는 적용되지 않습니다';
    return `<p class="law-line"><b>${esc(rel.law)}</b> — ${esc(amount)}</p><p class="need-line">요건: ${esc(rel.need)}</p>`;
  }

  /** 생애최초·소형·출산 감면 중 어느 쪽이 유리한지 — 중복 적용은 안 되므로 하나만 고른다 */
  function homeCompare(x) {
    if (!(x.asset === 'house' && x.cause === 'sale' && x.buyer === '개인' && x.price > 0)) return '';
    if (!(x.relief === 'none' || HOME_RELIEFS.includes(x.relief))) return '';
    const rows = ['none', ...HOME_RELIEFS].map(k => ({ k, r: A.calc(input({ ...x, relief: k })) }));
    const best = rows.slice(1).filter(o => o.r.relief).reduce((a, b) => (b.r.total < a.r.total ? b : a), rows[0]);
    const cur = rows.find(o => o.k === x.relief);
    return `<div class="cmp-card">
      <h3>주택 감면 비교 — 중복 적용은 안 돼 하나만 고릅니다</h3>
      <div class="tw"><table><thead><tr><th>감면</th><th>세금 합계</th><th>절감액</th></tr></thead><tbody>
        ${rows.map(o => `<tr${o.k === best.k && best.k !== 'none' ? ' class="win"' : ''}><th>${esc(A.RELIEFS[o.k].label)}</th><td>${o.k !== 'none' && !o.r.relief ? '요건 안 됨' : `${won(o.r.total)}원`}</td><td>${o.k === 'none' || !o.r.relief ? '—' : `${won(rows[0].r.total - o.r.total)}원`}</td></tr>`).join('')}
      </tbody></table></div>
      ${best.k !== 'none' && best.k !== x.relief ? `<p class="law-line"><b>${esc(A.RELIEFS[best.k].label)}</b>이 ${won(cur.r.total - best.r.total)}원 더 유리합니다 — 요건(아래)을 갖추는지 확인한 뒤 감면 선택을 바꾸세요.</p><p class="need-line">${esc(A.RELIEFS[best.k].need)}</p>` : ''}
    </div>`;
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
      ${K.toolbar()}
      <p class="fine"><a href="lifecycle.html" style="color:inherit"><b>취득 → 보유 → 양도 한 번에 보기 →</b></a></p>
      ${K.cta(window.HTM_CONFIG)}
      <p class="fine">간편 추정치입니다. 주택 수·조정대상지역·감면 요건 판정에 따라 실제 세액이 달라질 수 있습니다.</p>`;
  }

  function detailRows(r) {
    return [
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
  }

  const detail = r => `<div class="tw"><table><tbody>${detailRows(r).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</tbody></table></div>`;

  function render(ev) {
    const reg = K.regulatedSync(form, 'addr', [['date', 'adjusted']], ev || null);
    const x = K.read(form);
    toggles(x);
    const r = A.calc(input(x));
    last = { x, r };
    $('#reg-info').innerHTML = x.asset === 'house' && x.addr ? reg.map(o => K.regLine('취득일 기준', o.res)).join('') : '';
    $('#summary').innerHTML = summary(x, r);
    $('#detail').innerHTML = detail(r);
    $('#relief-info').innerHTML = reliefInfo(x, r);
    $('#home-compare').innerHTML = homeCompare(x);
    $('#mbar-total').textContent = `${won(r.total)}원`;
    saved.save(x);
  }

  function apply(st) {
    form.reset();
    K.write(form, st);
    setOwner(st && st.buyer === '법인' ? '법인' : '개인');
    render(null);
  }

  function xlsx() {
    const { x, r } = last;
    const inputs = [
      ['취득자', x.buyer], ['취득 원인', A.CAUSES[x.cause]], ['물건', A.ASSETS[x.asset]], ['취득가액', x.price], ['취득일', x.date],
      ['소재지', x.addr || ''], ['취득 후 주택 수', x.houseCount], ['조정대상지역', x.adjusted ? '예' : '아니오'], ['감면', A.RELIEFS[x.relief] ? A.RELIEFS[x.relief].label : ''],
    ];
    return window.HTMXlsx.downloadSheets({
      fileName: `취득세_${x.date || K.today()}.xlsx`,
      title: '보유세맵 취득세 계산',
      sheets: [
        { name: '요약', cols: [{ h: '항목', w: 22 }, { h: '금액(원)', w: 18, money: true }, { h: '비고', w: 50 }], rows: [
          ['취득세', r.acqFinal, `${r.rule} ${pct(r.rate, 3)} (${r.law})`],
          ['지방교육세', r.eduFinal, '지방세법 제151조①1'],
          ['농어촌특별세', r.nong, r.nong ? '' : '비과세'],
          ['합계', r.total, `실효세율 ${pct(r.effective)}`],
          ['신고·납부 기한', null, `${r.due}${x.date ? ` → ${A.dueDate(x.date, x.cause, x.abroad)}` : ''}`],
        ] },
        { name: '입력값', cols: [{ h: '항목', w: 22 }, { h: '값', w: 40 }], rows: inputs },
        { name: '계산 과정', cols: [{ h: '단계', w: 22 }, { h: '내용', w: 80 }], rows: detailRows(r) },
      ],
      basis: A.BASIS,
    });
  }

  function init() {
    fillReliefs();
    $('#basis').innerHTML = K.basisTable(A.BASIS);
    const t = K.tools({
      key: 'acq-tax', form, apply,
      state: () => K.read(form),
      label: () => { const x = K.read(form); return `${A.ASSETS[x.asset] || ''} ${eok(x.price)} ${x.addr || ''}`.trim(); },
      total: () => (last ? last.r.total : 0),
      xlsx,
    });
    const prev = t.shared || saved.load();
    if (prev && typeof prev === 'object') K.write(form, prev);
    setOwner(prev && prev.buyer === '법인' ? '법인' : '개인');
    if (!form.querySelector('[data-f="date"]').value) form.querySelector('[data-f="date"]').value = K.today();
    K.moneyInputs(form);
    form.addEventListener('input', render);
    form.querySelectorAll('[data-owner]').forEach(b => b.addEventListener('click', () => { setOwner(b.dataset.owner); render(null); }));
    render(null);
  }

  init();
}());
