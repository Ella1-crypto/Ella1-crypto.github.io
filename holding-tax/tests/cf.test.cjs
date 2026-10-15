/* 현금흐름(CF) — 납부월·분할납부·합계 정합 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const CF = require('../js/cf.js');
const C = require('../js/calc.js');

const demo = {
  ownerType: '법인', growth: 0, mode: '2026', prev: {},
  parcels: [{ id: 'd', addr: '예시', price: 12500000, area: 330, cls: 'sep', sgg: '1', sggName: '마포구', urban: true, share: 100,
    bld: { mode: 'estimate', structure: 'rc', builtYear: 2008, floors: 7, rate: 'general', fire: 'auto',
      rows: [{ use: 'retail', area: 280, adjust: 1.27 }, { use: 'office', area: 1650, adjust: 1 }] } }],
};

test('분할납부 없이: 첫해 CF 합계 = 화면 연간 합계, 건축물 7월·토지 9월', () => {
  const cf = CF.commercial(demo, { years: 1 });
  const r = C.compute(demo);
  assert.equal(cf.byTaxYear[0].total, r.totals.total);
  assert.deepEqual(cf.entries.map(e => e.month), [7, 9]);
});

test('분할납부: 토지분 1,646만원(본세+도시 1,439만원 > 500만원) → 50%를 12월로, 합계는 그대로', () => {
  const cf = CF.commercial(demo, { years: 1, installments: true });
  const land = cf.entries.filter(e => e.kind === 'land');
  assert.equal(land.length, 2);
  assert.equal(land[0].month, 9);
  assert.equal(land[1].month, 12);
  assert.equal(land[0].amount + land[1].amount, 16462500);
  assert.equal(land[1].amount, Math.floor(16462500 * 7196250 / 14392500));
  const bld = cf.entries.filter(e => e.kind === 'bld');
  assert.deepEqual(bld.map(e => e.month), [7, 10]); // 건축물 본세+도시 > 250만 → 10월 분할
  assert.equal(cf.byTaxYear[0].total, C.compute(demo).totals.total);
});

test('종부세 분납: 250만원 초과분은 다음 해 6월로(농특세도 같은 비율)', () => {
  const big = { ownerType: '법인', growth: 0, prev: {}, parcels: [{ id: 'b', price: 1e7, area: 1000, cls: 'sep', sgg: '1', urban: true }] }; // 100억
  const cf = CF.commercial(big, { years: 1, installments: true });
  const cmt = cf.entries.filter(e => e.kind === 'cmt');
  assert.equal(cmt.length, 2);
  assert.equal(cmt[1].ym, '2027-06');
  const r = C.compute(big);
  assert.equal(cmt[0].amount + cmt[1].amount, r.totals.cmt);
  assert.equal(cf.byCashYear.find(y => y.year === 2027).cash, cmt[1].amount);
});

test('다년 CF: 공시지가 상승 시 매년 늘고, 세부담상한은 앞 연도 계산액으로 연쇄', () => {
  const cf = CF.commercial({ ...demo, growth: 10 }, { years: 5 });
  assert.equal(cf.byTaxYear.length, 5);
  for (let i = 1; i < 5; i += 1) assert.ok(cf.byTaxYear[i].land >= cf.byTaxYear[i - 1].land);
});

test('주택 CF: 재산세 7월·9월 반씩, 20만원 이하는 7월 한 번, 종부세 12월', () => {
  const H = require('../js/house-engine.js');
  const input = { oneHouse: true, houses: [{ price: 2e9 }] };
  const cf = CF.house(input, { years: 1 });
  assert.deepEqual(cf.entries.map(e => e.month), [7, 9, 12]);
  assert.equal(cf.total, H.calc(input).total); // 7,099,200
  const small = CF.house({ oneHouse: true, houses: [{ price: 2e8 }] }, { years: 1 });
  assert.deepEqual(small.entries.map(e => e.month), [7]);
});

test('주택 CF 분할납부: 각 납기 본세+도시지역분이 250만원을 넘으면 7월분 → 10월, 9월분 → 12월', () => {
  const input = { houses: [{ price: 4e9 }] }; // 개인 1채(1세대1주택 아님), 재산세 본세 약 924만원
  const cf = CF.house(input, { years: 1, installments: true });
  const months = cf.entries.filter(e => e.kind === 'house').map(e => e.month);
  assert.deepEqual(months, [7, 10, 9, 12]);
  const H = require('../js/house-engine.js');
  const r = H.calc(input);
  assert.equal(cf.entries.filter(e => e.kind === 'house').reduce((s, e) => s + e.amount, 0), r.prop.total);
});

test('주택 소방분: 건물 시가표준액 × 공정시장가액비율에 누진, 150% 상한', () => {
  const H = require('../js/house-engine.js');
  const r = H.calc({ houses: [{ price: 1e9, bldValue: 2e8 }] });
  // 과표 2억 × 60% = 1.2억 → 49,100 + 5,600만 × 0.12% = 116,300
  assert.equal(r.prop.fire, 116300);
  const capped = H.calc({ houses: [{ price: 1e9, bldValue: 2e8, prevFire: 50000 }] });
  assert.equal(capped.prop.fire, 75000);
});
