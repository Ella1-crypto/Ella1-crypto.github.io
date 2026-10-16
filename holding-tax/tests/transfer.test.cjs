/* 양도소득세·법인 처분세 — 손계산 대조 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../js/transfer-engine.js');

const base = { seller: '개인', expense: 0, acqDate: '2016-05-01', saleDate: '2026-06-01' };

test('1세대1주택 12억 이하: 비과세(세금 0)', () => {
  const r = T.calc({ ...base, asset: 'house', price: 1e9, cost: 5e8, oneHouse: true });
  assert.equal(r.exempt, true);
  assert.equal(r.total, 0);
});

test('1세대1주택 고가주택 20억(10년 보유·거주): 12억 초과분 40%만 과세, 장특공 80% → 산출 12,840,000', () => {
  const r = T.calc({ ...base, asset: 'house', price: 2e9, cost: 1e9, oneHouse: true, residenceYears: 10 });
  assert.equal(r.years, 10);
  assert.equal(r.taxableGain, 4e8);
  assert.equal(r.lt.rate, 0.8);
  assert.equal(r.base, 8e7 - 2.5e6);
  assert.equal(r.computed, 12840000);
  assert.equal(r.local, 1284000);
});

test('일반 토지 5년 보유: 장특공 10% → 산출 15,240,000 / 비사업용 토지는 +10%p → 23,990,000', () => {
  const t = { ...base, acqDate: '2021-05-01', asset: 'land', price: 3e8, cost: 2e8 };
  assert.equal(T.calc(t).computed, 15240000);
  const nb = T.calc({ ...t, nonBusinessLand: true });
  assert.equal(nb.computed, 23990000);
  assert.equal(nb.longTerm, 1e7); // 비사업용도 장특공 적용
});

test('조정대상지역 2주택 중과: +20%p, 장특공 배제 → 38,185,000', () => {
  const r = T.calc({ ...base, acqDate: '2021-05-01', asset: 'house', price: 6e8, cost: 5e8, houseCount: 2, adjustedNow: true });
  assert.equal(r.heavyAdd, 0.2);
  assert.equal(r.longTerm, 0);
  assert.equal(r.computed, 38185000);
  const off = T.calc({ ...base, acqDate: '2021-05-01', asset: 'house', price: 6e8, cost: 5e8, houseCount: 2, adjustedNow: true, heavyExcluded: true });
  assert.equal(off.heavyAdd, 0);
});

test('단기 양도: 주택 1년 미만 70%, 상가 1년 이상 2년 미만 40%, 미등기 70%·기본공제 없음', () => {
  const h = T.calc({ ...base, acqDate: '2025-12-01', asset: 'house', price: 6e8, cost: 5e8 });
  assert.equal(h.computed, Math.floor(9.75e7 * 0.7));
  const b = T.calc({ ...base, acqDate: '2025-01-15', asset: 'building', price: 6e8, cost: 5e8 });
  assert.equal(b.rateLabel, '보유 2년 미만 40%');
  const u = T.calc({ ...base, asset: 'land', price: 6e8, cost: 5e8, unregistered: true });
  assert.equal(u.basic, 0);
  assert.equal(u.computed, 7e7);
});

test('8년 자경농지 감면: 100%·연 1억 한도, 농특세 없음 / 공익사업 현금보상 15%는 감면세액 20% 농특세', () => {
  const farm = T.calc({ ...base, asset: 'land', price: 1e9, cost: 2e8, relief: 'farm8' });
  assert.equal(farm.relief.amount, Math.min(farm.computed, 1e8));
  assert.equal(farm.nong, 0);
  const ex = T.calc({ ...base, asset: 'land', price: 1e9, cost: 2e8, relief: 'expropCash' });
  assert.equal(ex.relief.amount, Math.floor(ex.computed * 0.15));
  assert.equal(ex.nong, Math.floor(ex.relief.amount * 0.2));
});

test('법인 주택 처분: 법인세(10%/20%) + 추가과세 20% + 법인지방소득세 10%', () => {
  const r = T.calc({ seller: '법인', asset: 'house', price: 1e9, cost: 5e8 });
  assert.equal(r.corpTax, 2e8 * 0.1 + 3e8 * 0.2);
  assert.equal(r.extra, 1e8);
  assert.equal(r.local, 8e6 + 1e7);
  assert.equal(r.total, 1.98e8);
  const shop = T.calc({ seller: '법인', asset: 'building', price: 1e9, cost: 5e8 });
  assert.equal(shop.extra, 0);
});

test('날짜가 없거나 뒤바뀌면 단기세율로 추정하지 않고 0원 + 안내', () => {
  const r = T.calc({ seller: '개인', asset: 'house', price: 1e9, cost: 0, acqDate: '', saleDate: '2026-06-01' });
  assert.equal(r.missingDates, true);
  assert.equal(r.total, 0);
  assert.equal(T.calc({ ...base, acqDate: '2027-01-01', asset: 'land', price: 3e8, cost: 2e8 }).total, 0);
});

test('거주기간은 보유기간까지만, 자경농지 감면은 토지에만', () => {
  const r = T.calc({ ...base, acqDate: '2023-05-01', asset: 'house', price: 2e9, cost: 1e9, oneHouse: true, residenceYears: 10 });
  assert.equal(r.years, 3);
  assert.equal(r.lt.live, 0.12);
  const h = T.calc({ ...base, asset: 'house', price: 1e9, cost: 2e8, relief: 'farm8' });
  assert.equal(h.relief, null);
});

test('같은 해 두 번째 양도: 먼저 판 과세표준 1억에 합산해 누진 증가분만', () => {
  const t = { ...base, acqDate: '2021-05-01', asset: 'land', price: 3e8, cost: 2e8 };
  const r = T.calc({ ...t, priorBase: 1e8, basicUsed: true });
  // 과세표준 9,000만(장특 10%, 기본공제 없음) → basic(1.9억) − basic(1억)
  assert.equal(r.base, 9e7);
  assert.equal(r.computed, Math.floor(T.basicTax(1.9e8) - T.basicTax(1e8)));
});

test('환산취득가액: 양도가 × 취득 기준시가/양도 기준시가 + 개산공제 3%', () => {
  const r = T.calc({ ...base, asset: 'land', price: 5e8, useConversion: true, acqStd: 1e8, saleStd: 2.5e8 });
  assert.equal(r.cost, 2e8);
  assert.equal(r.expense, 3e6);
});

test('이월과세: 증여자 취득가액으로 더 큰 세금이면 적용, 증여세는 필요경비', () => {
  const t = { ...base, asset: 'land', acqDate: '2023-03-01', cost: 5e8, price: 6e8, carryover: true, donorAcqDate: '2010-01-01', donorCost: 1e8, giftTax: 5e7 };
  const r = T.calc(t);
  assert.equal(r.carryoverApplied, true);
  assert.equal(r.gain, 6e8 - 1e8 - 5e7);
  assert.equal(r.years, 16);
  const off = T.calc({ ...t, carryover: false });
  assert.ok(r.total > off.total);
  // 2022년 이전 증여는 5년 — 7년 뒤 양도면 적용하지 않는다
  const old = T.calc({ ...t, acqDate: '2020-03-01', saleDate: '2027-03-01' });
  assert.equal(old.carryoverApplied, undefined);
});

test('일시적 2주택 종전주택: 1세대1주택 비과세, 입주권은 인가 전 차익만 장특공', () => {
  const r = T.calc({ ...base, asset: 'house', price: 1e9, cost: 5e8, houseCount: 2, temporary2: true, adjustedNow: true });
  assert.equal(r.exempt, true);
  const m = T.calc({ ...base, asset: 'membership', price: 1e9, cost: 3e8, approvalDate: '2022-05-01', rightValue: 6e8 });
  assert.equal(m.preGain, 3e8);
  assert.equal(m.lt.rate, 0.12);
  assert.equal(m.longTerm, 3.6e7);
});

test('예정신고 기한: 양도일이 속하는 달의 말일부터 2개월, 지방소득세는 4개월', () => {
  assert.equal(T.monthEndPlus('2026-06-15', 2), '2026-08-31');
  assert.equal(T.monthEndPlus('2026-12-03', 2), '2027-02-28');
  assert.equal(T.monthEndPlus('2026-06-15', 4), '2026-10-31');
});
