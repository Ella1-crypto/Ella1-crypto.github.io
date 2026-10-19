/* 임대수익률 지표 — 생애주기 엔진(Lifecycle.calc) 결과에서 임대 투자자가 보는 숫자를 뽑는다.
 * 브라우저: window.RentalMetrics / Node: module.exports
 *
 *  · 표면수익률     = 연 임대료(월세 × 12, 공실 전) ÷ 매입가
 *  · 순수익률(Cap)  = 1년차 순영업소득(NOI) ÷ 매입가        NOI = 임대수입(공실 반영) − 운영비 − 보유세
 *  · 실투자 수익률  = (1년차 NOI − 이자) ÷ 실투자금           실투자금 = 매입가 − 대출 − 보증금 + 취득세 + 중개수수료
 *  · 이자보상배율   = 1년차 NOI ÷ 이자                         (1 미만이면 임대료로 이자를 못 낸다)
 *  · 세후 IRR       = 취득세·보유세·양도세를 넣은 연도별 순현금흐름의 내부수익률(임대소득세 제외)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RentalMetrics = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ratio = (a, b) => (b > 0 && Number.isFinite(a) ? a / b : null);

  /** 첫해 연 임대료(공실 전) */
  function grossRent(x) {
    return x.monthlyRent > 0 ? x.monthlyRent * 12 : x.rent;
  }

  /**
   * @param {object} r Lifecycle.calc 결과 (rows[0] 매입, rows[1] 1년차)
   */
  function metrics(r) {
    const x = r.input;
    const y1 = r.rows[1] || { rent: 0, opex: 0, prop: 0, cmt: 0, interest: 0 };
    const gross = grossRent(x);
    const noi = y1.rent - y1.opex - y1.prop - y1.cmt;
    const cash1 = noi - y1.interest;
    // 누적 현금흐름이 처음 0 이상이 되는 해(매각 전 임대만으로 회수되지 않으면 매각 연도)
    let cum = 0;
    let payback = null;
    for (const row of r.rows) {
      cum += row.flow;
      if (cum >= 0 && row.year > 0) { payback = row.year; break; }
    }
    return {
      gross,
      noi,
      cash1,
      invested: r.invested,
      grossYield: ratio(gross, x.price),
      capRate: ratio(noi, x.price),
      cashOnCash: ratio(cash1, r.invested),
      dscr: y1.interest > 0 ? noi / y1.interest : null,
      irr: r.irr,
      preTaxIrr: r.preTaxIrr,
      multiple: r.multiple,
      profit: r.profit,
      payback,
    };
  }

  return Object.freeze({ metrics, grossRent });
}));
