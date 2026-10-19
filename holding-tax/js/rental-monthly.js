/* 임대 월별 현금흐름 — 생애주기 엔진(Lifecycle.calc)의 연 금액을 실제 오가는 달로 나눈다.
 * 브라우저: window.RentalMonthly / Node: module.exports
 *
 *  · 0개월(매입 월): −매입가 + 대출 + 보증금 − 취득세 − 중개수수료
 *  · 1~12N개월: + 월세(공실 반영) − 이자 − 운영비 — 연 금액을 12로 나누고 끝수는 그해 12번째 달에 넣는다
 *  · 보유세: 건축물분 재산세 7월, 토지분 재산세 9월, 종부세 12월(그해 6월 1일 보유분). 매각 뒤에 오는 납기는 매각 월에 넣는다
 *  · 12N개월(매각 월): + 매각가 − 대출상환 − 보증금 반환 − 중개수수료 − 양도세(신고·납부 시차는 무시)
 *  · 월 IRR → 연 환산 (1 + 월 IRR)^12 − 1
 * 들어오는 돈 +, 나가는 돈 −. 각 달의 금액 칸을 더하면 순현금흐름(flow)이다.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RentalMonthly = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const KEYS = Object.freeze(['trade', 'loan', 'deposit', 'rent', 'opex', 'interest', 'prop', 'cmt', 'acqTax', 'transferTax', 'fee']);
  const PAY_MONTH = Object.freeze({ propBld: 7, propLand: 9, cmt: 12 });
  const pad = n => String(n).padStart(2, '0');

  /** 연 금액을 12달로 — 11달은 버림 몫, 마지막 달에 나머지 */
  function spread(amount) {
    const m = Math.floor((Number(amount) || 0) / 12);
    return Array.from({ length: 12 }, (_, i) => (i === 11 ? amount - m * 11 : m));
  }

  /** 월 IRR(이분법) */
  function irr(flows) {
    const npv = r => flows.reduce((s, f, i) => s + f / (1 + r) ** i, 0);
    let lo = -0.5, hi = 0.5;
    if (npv(lo) * npv(hi) > 0) return null;
    for (let i = 0; i < 200; i += 1) {
      const mid = (lo + hi) / 2;
      if (npv(lo) * npv(mid) <= 0) hi = mid; else lo = mid;
    }
    return (lo + hi) / 2;
  }

  /**
   * @param {object} r Lifecycle.calc 결과
   * @returns {{ months: object[], monthlyIrr: number|null, irr: number|null, years: object[] }}
   */
  function monthly(r) {
    const x = r.input;
    const N = r.rows.length - 1;
    const total = N * 12;
    const [by, bm] = x.buyDate.split('-').map(Number);
    const base = by * 12 + (bm - 1);
    const months = Array.from({ length: total + 1 }, (_, k) => {
      const t = base + k;
      const o = { idx: k, ym: `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`, flow: 0 };
      KEYS.forEach(key => { o[key] = 0; });
      return o;
    });
    const add = (k, key, v) => { if (v) months[Math.min(Math.max(k, 0), total)][key] += v; };

    // 매입 월
    const y0 = r.rows[0];
    add(0, 'trade', -x.price);
    add(0, 'loan', x.loan);
    add(0, 'deposit', x.deposit);
    add(0, 'acqTax', -y0.acqTax);
    add(0, 'fee', -y0.fee);

    // 보유 — 연차 i의 12달(1..12) + 그해 보유세 납기
    for (let i = 1; i <= N; i += 1) {
      const row = r.rows[i];
      const rent = spread(row.rent);
      const interest = spread(row.interest);
      const opex = spread(row.opex);
      for (let j = 0; j < 12; j += 1) {
        const k = (i - 1) * 12 + j + 1;
        add(k, 'rent', rent[j]);
        add(k, 'interest', -interest[j]);
        add(k, 'opex', -opex[j]);
      }
      const due = month => row.calYear * 12 + (month - 1) - base;
      add(due(PAY_MONTH.propBld), 'prop', -(row.propBld || 0));
      add(due(PAY_MONTH.propLand), 'prop', -(row.propLand || 0));
      add(due(PAY_MONTH.cmt), 'cmt', -(row.cmt || 0));
    }

    // 매각 월
    const yl = r.rows[N];
    add(total, 'trade', yl.value);
    add(total, 'loan', -x.loan);
    add(total, 'deposit', -x.deposit);
    add(total, 'fee', -yl.fee);
    add(total, 'transferTax', -yl.transferTax);

    months.forEach(m => { m.flow = KEYS.reduce((s, key) => s + m[key], 0); });
    const mIrr = irr(months.map(m => m.flow));

    // 연차별 합계(0년차 = 매입 월, i년차 = i번째 12개월)
    const years = Array.from({ length: N + 1 }, (_, i) => {
      const o = { year: i, label: i === 0 ? `0년차 (${months[0].ym} 매입)` : `${i}년차 (${months[(i - 1) * 12 + 1].ym} ~ ${months[i * 12].ym})`, flow: 0 };
      KEYS.forEach(key => { o[key] = 0; });
      return o;
    });
    months.forEach(m => {
      const i = m.idx === 0 ? 0 : Math.ceil(m.idx / 12);
      KEYS.forEach(key => { years[i][key] += m[key]; });
      years[i].flow += m.flow;
    });

    return { months, years, monthlyIrr: mIrr, irr: mIrr == null ? null : (1 + mIrr) ** 12 - 1 };
  }

  return Object.freeze({ KEYS, PAY_MONTH, monthly, spread, irr });
}));
