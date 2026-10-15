/* CF 표 렌더링(상업용·주택 공통) — 연도별 요약 + 월별 납부 일정 */
(function () {
  'use strict';
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const won = n => Math.round(Number(n) || 0).toLocaleString('ko-KR');
  const KIND = Object.freeze({ bld: '건축물분', land: '토지분', house: '주택분', cmt: '종부세·농특세' });

  function render(cf) {
    if (!cf || !cf.entries.length) return '<p class="muted">세금이 계산되면 현금흐름이 나옵니다.</p>';
    const kinds = Object.keys(KIND).filter(k => cf.entries.some(e => e.kind === k));
    const yearly = `
      <div class="tw"><table class="cf-year"><thead><tr><th>과세연도</th>${kinds.map(k => `<th>${KIND[k]}</th>`).join('')}<th>합계</th></tr></thead>
      <tbody>${cf.byTaxYear.map(y => `<tr><th>${y.year}</th>${kinds.map(k => `<td>${won(y[k])}</td>`).join('')}<td><b>${won(y.total)}</b></td></tr>`).join('')}</tbody>
      <tfoot><tr><th>합계</th>${kinds.map(k => `<td>${won(cf.byTaxYear.reduce((s, y) => s + y[k], 0))}</td>`).join('')}<td><b>${won(cf.total)}</b></td></tr></tfoot></table></div>`;
    let cum = 0;
    const monthly = `
      <div class="tw cf-month-wrap"><table class="cf-month"><thead><tr><th>납부월</th><th>내역</th><th>납기</th><th>금액</th><th>누적</th></tr></thead>
      <tbody>${cf.months.map(m => m.items.map((e, i) => {
        cum += e.amount;
        return `<tr${i === 0 ? ' class="m-first"' : ''}><th>${i === 0 ? esc(m.ym.replace('-', '. ')) : ''}</th>
          <td><i class="dot seg-${e.kind === 'house' ? 'bld' : esc(e.kind)}"></i>${esc(e.label)}${e.deferred ? ' <span class="tag-defer">분할</span>' : ''}${e.taxYear !== e.year ? ` <small>(${e.taxYear}년분)</small>` : ''}</td>
          <td>${esc(e.due)}</td><td>${won(e.amount)}</td><td>${won(cum)}</td></tr>`;
      }).join('')).join('')}</tbody></table></div>`;
    return `${yearly}<h4>월별 납부 일정</h4>${monthly}
      <p class="fine">${cf.installments ? '분할납부를 신청한다고 가정했습니다(재산세 250만원 초과분 3개월 이내, 종부세 250만원 초과분 6개월 이내 분납). 교육세·소방분·농특세도 같은 비율로 옮겼습니다.' : '분할납부 없이 납기에 전액 낸다고 가정했습니다.'} 이후 연도는 공시가격 상승률을 적용하고(건물 시가표준액은 상업용은 잔가율 감소 반영, 주택 건물분은 올해 값 유지), 세부담상한은 앞 연도 계산액으로 연쇄 적용합니다.</p>`;
  }

  window.HTMCFView = Object.freeze({ render, KIND });
})();
