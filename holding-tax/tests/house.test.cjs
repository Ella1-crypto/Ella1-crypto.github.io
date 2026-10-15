/* 주택 엔진 — 부동산계산기.com 보유세 계산기(2026-10-15 조회)와 원 단위 대조 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('../js/house-engine.js');

const one = (price, extra = {}) => H.calc({ oneHouse: true, houses: [{ price }], ...extra });

test('[대조] 1세대1주택 8억: 45% · 특례세율 0.35% → 재산세 630,000 · 총 1,260,000 (종부세 없음)', () => {
  const r = one(8e8);
  assert.equal(r.rows[0].base, 3.6e8);
  assert.equal(r.prop.main, 630000);
  assert.equal(r.prop.urban, 504000);
  assert.equal(r.prop.edu, 126000);
  assert.equal(r.cmt.decided, 0);
  assert.equal(r.total, 1260000);
});

test('[대조] 1세대1주택 20억: 재산세 2,970,000 · 종부세 1,896,000 · 농특세 379,200 · 총 7,099,200', () => {
  const r = one(2e9);
  assert.equal(r.prop.main, 2970000);
  assert.equal(r.prop.urban, 1260000);
  assert.equal(r.prop.edu, 594000);
  assert.equal(r.cmt.base, 4.8e8);
  assert.equal(r.cmt.computed, 2760000);
  assert.equal(r.cmt.credit, 864000);
  assert.equal(r.cmt.decided, 1896000);
  assert.equal(r.cmt.nong, 379200);
  assert.equal(r.total, 7099200);
});

test('[대조] 1세대1주택 30억 · 65세 · 12년 보유: 공제 70% → 종부세 1,936,800 · 총 9,938,160', () => {
  const r = one(3e9, { age: 65, holdYears: 12 });
  assert.equal(r.prop.main, 4770000);
  assert.equal(r.cmt.computed, 8400000);
  assert.equal(r.cmt.credit, 1944000);
  assert.equal(r.cmt.creditPct, 0.7);
  assert.equal(r.cmt.decided, 1936800);
  assert.equal(r.cmt.nong, 387360);
  assert.equal(r.total, 9938160);
});

test('[대조] 개인 2주택 10억+8억: 60% · 공제 9억 · 공제할 재산세 1,074,732(±1) · 총 7,710,322(±1)', () => {
  const r = H.calc({ houses: [{ price: 1e9 }, { price: 8e8 }] });
  assert.equal(r.prop.main, 1770000 + 1290000);
  assert.equal(r.cmt.base, 5.4e8);
  assert.equal(r.cmt.computed, 3180000);
  assert.equal(r.cmt.propStd, 3690000); // 합산 과세표준 10.8억의 표준세율 재산세
  assert.ok(Math.abs(r.cmt.credit - 1074732) <= 1);
  assert.ok(Math.abs(r.total - 7710322) <= 2);
});

test('[대조] 개인 3주택 각 10억: 3주택 이상 세율 → 종부세 산출 10,800,000 · 총 18,919,134(±2)', () => {
  const r = H.calc({ houses: [{ price: 1e9 }, { price: 1e9 }, { price: 1e9 }] });
  assert.equal(r.cmt.base, 1.26e9);
  assert.equal(r.cmt.computed, 10800000);
  assert.equal(r.cmt.propStd, 6570000);
  assert.ok(Math.abs(r.cmt.credit - 2444055) <= 1);
  assert.ok(Math.abs(r.total - 18919134) <= 2);
});

test('[대조] 법인 1주택 10억: 공제 0 · 2.7% → 종부세 14,760,000 · 총 20,676,000', () => {
  const r = H.calc({ ownerType: '법인', houses: [{ price: 1e9 }] });
  assert.equal(r.cmt.deduction, 0);
  assert.equal(r.cmt.computed, 16200000);
  assert.equal(r.cmt.credit, 1440000);
  assert.equal(r.cmt.decided, 14760000);
  assert.equal(r.total, 20676000);
});

test('공동명의 50%: 재산세는 주택 전체 세율 적용 후 지분 안분, 종부세는 내 지분 공시가격으로', () => {
  const full = H.calc({ houses: [{ price: 1e9 }] });
  const half = H.calc({ houses: [{ price: 1e9, share: 50 }] });
  assert.equal(half.prop.main, full.prop.main / 2);
  assert.equal(half.cmt.value, 5e8);
  assert.equal(half.cmt.decided, 0); // 5억 < 9억 공제
});

test('과세표준상한: 직전 연도 공시가격 기준 + 올해 과표의 5%까지만', () => {
  const r = H.calc({ houses: [{ price: 1e9, prevPrice: 8e8 }] });
  assert.equal(r.rows[0].rawBase, 6e8);
  assert.equal(r.rows[0].base, 8e8 * 0.6 + 6e8 * 0.05); // 5.1억
  assert.equal(r.rows[0].capped, true);
});

test('세부담상한(개인): 재산세+종부세가 직전 연도의 150%를 넘지 않는다', () => {
  const free = H.calc({ houses: [{ price: 3e9 }] });
  const capped = H.calc({ houses: [{ price: 3e9 }], prevTotal: 8e6 }); // 한도 1,200만 − 재산세 657만
  assert.ok(free.cmt.decided > capped.cmt.decided);
  assert.equal(capped.cmt.decided, 1.2e7 - capped.cmt.propActual);
  const corp = H.calc({ ownerType: '법인', houses: [{ price: 3e9 }], prevTotal: 1e6 });
  assert.equal(corp.cmt.capReduction, 0);
});

test('2027 모드: 현행법이면 1주택 특례(43~45%·특례세율)가 끝나고, 정부안이면 이어지며 공제 14억·6~12억 1.3%', () => {
  const law = one(8e8, { mode: '2027law' });
  assert.equal(law.rows[0].fmv, 0.6);
  assert.equal(law.rows[0].special, false);
  const reform = one(8e8, { mode: '2027reform' });
  assert.equal(reform.rows[0].fmv, 0.45);
  assert.equal(reform.rows[0].special, true);
  const big = one(3e9, { mode: '2027reform' });
  assert.equal(big.cmt.deduction, 1.4e9);
  assert.equal(big.cmt.base, 9.6e8);
  assert.equal(big.cmt.computed, 3600000 + 3.6e8 * 0.013);
  assert.equal(one(3e9, { mode: '2027reform', resident: false }).cmt.deduction, 9e8);
});

test('주택 재산세 20만원 이하는 7월에 한 번, 넘으면 7·9월 반씩', () => {
  assert.equal(one(2e8).schedule.length, 1);
  const s = H.calc({ houses: [{ price: 1e9 }] }).schedule;
  assert.deepEqual(s.map(x => x.month), [7, 9, 12]); // 10억 > 9억 공제라 종부세도 있다
});

test('목록 밖 주택이 있어 총 주택 수가 2채 이상이면 1세대1주택 공제·특례를 쓰지 않는다', () => {
  const r = H.calc({ oneHouse: true, houseCount: 3, houses: [{ price: 1.5e9 }] });
  assert.equal(r.rows[0].fmv, 0.6);
  assert.equal(r.cmt.deduction, 9e8);
  assert.equal(r.cmt.creditPct, 0);
});
