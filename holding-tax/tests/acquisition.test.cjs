/* 취득세·지방교육세·농특세 — 손계산 대조 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../js/acquisition-engine.js');

const house = { buyer: '개인', asset: 'house', cause: 'sale', houseCount: 1 };

test('주택 6억 이하 1%: 5억 → 취득세 500만, 교육세 50만, 85㎡ 이하 농특세 없음', () => {
  const r = A.calc({ ...house, price: 5e8 });
  assert.equal(r.rate, 0.01);
  assert.equal(r.acq, 5e6);
  assert.equal(r.edu, 5e5);
  assert.equal(r.nong, 0);
  assert.equal(r.total, 5.5e6);
});

test('주택 6~9억 구간: 7.5억 → 2%, 85㎡ 초과면 농특세 0.2%', () => {
  const r = A.calc({ ...house, price: 7.5e8, over85: true });
  assert.equal(r.rate, 0.02);
  assert.equal(r.acq, 1.5e7);
  assert.equal(r.edu, 1.5e6);
  assert.equal(r.nong, 1.5e6);
  assert.equal(A.houseRate(9e8), 0.03);
  assert.equal(A.houseRate(7e8), 0.0167);
  assert.equal(A.houseRate(6.5e8), 0.0133);
});

test('다주택 중과: 조정 2주택 8% (교육세 0.4%, 85㎡ 초과 농특세 0.6%) / 일시적 2주택은 일반세율', () => {
  const r = A.calc({ ...house, price: 5e8, houseCount: 2, adjusted: true, over85: true });
  assert.equal(r.rate, 0.08);
  assert.equal(r.acq, 4e7);
  assert.equal(r.edu, 2e6);
  assert.equal(r.nong, 3e6);
  assert.equal(A.calc({ ...house, price: 5e8, houseCount: 2, adjusted: true, temporary2: true }).rate, 0.01);
  assert.equal(A.calc({ ...house, price: 5e8, houseCount: 3 }).rate, 0.08);
  assert.equal(A.calc({ ...house, price: 5e8, houseCount: 4 }).rate, 0.12);
});

test('법인 주택 12%, 상가 4% (교육세 0.4%·농특세 0.2%)', () => {
  const c = A.calc({ ...house, buyer: '법인', price: 5e8 });
  assert.equal(c.acq, 6e7);
  assert.equal(c.edu, 2e6);
  const s = A.calc({ buyer: '개인', asset: 'nonres', cause: 'sale', price: 1e9 });
  assert.equal(s.acq, 4e7);
  assert.equal(s.edu, 4e6);
  assert.equal(s.nong, 2e6);
  assert.equal(s.total, 4.6e7);
});

test('생애최초 5억: 200만 감면, 다주택 중과도 적용하지 않음', () => {
  const r = A.calc({ ...house, price: 5e8, relief: 'firstHome' });
  assert.equal(r.relief.amount, 2e6);
  assert.equal(r.acqFinal, 3e6);
  assert.equal(r.eduFinal, 3e5); // 교육세도 40% 감면 — 부동산계산기.com 대조
  assert.equal(r.total, 3.3e6);
  // 무주택자가 사서 1주택이 되는 경우만 — 2주택이 되면 감면도 없고 중과 그대로
  const h = A.calc({ ...house, price: 5e8, houseCount: 2, adjusted: true, relief: 'firstHome' });
  assert.equal(h.rate, 0.08);
  assert.equal(h.relief, null);
  assert.equal(A.calc({ ...house, price: 1.3e9, relief: 'firstHome' }).relief, null);
  // 감면 요건이 안 되면 중과는 그대로
  assert.equal(A.calc({ ...house, buyer: '법인', price: 1e9, relief: 'firstHome' }).rate, 0.12);
  assert.equal(A.calc({ ...house, price: 1.5e9, houseCount: 3, adjusted: true, relief: 'firstHome' }).rate, 0.12);
  assert.equal(A.calc({ ...house, cause: 'inherit', price: 5e8, relief: 'firstHome' }).relief, null);
});

test('창업중소기업 75%: 교육세도 75% 감면, 감면분 농특세 비과세', () => {
  const r = A.calc({ buyer: '법인', asset: 'nonres', cause: 'sale', price: 1e9, relief: 'startup' });
  assert.equal(r.relief.amount, 3e7);
  assert.equal(r.acqFinal, 1e7);
  assert.equal(r.eduFinal, 1e6);
  assert.equal(r.nong, 2e6);
});

test('임대 면제: 산출세액 200만 초과면 최소납부세제로 85%', () => {
  const r = A.calc({ ...house, price: 3e8, relief: 'rental60' });
  assert.equal(r.relief.minTax, true);
  assert.equal(r.relief.amount, 2.55e6);
});

test('대도시 법인 중과: 4% → 8%, 교육세 ×3', () => {
  const r = A.calc({ buyer: '법인', asset: 'nonres', cause: 'sale', price: 1e9, metroCorp: true });
  assert.equal(r.rate, 0.08);
  assert.equal(r.edu, 1.2e7);
});

test('부동산계산기.com 대조: 증여·상속·원시·비조정 3주택', () => {
  const g = A.calc({ ...house, cause: 'gift', price: 5e8 });
  assert.equal(g.total, 1.9e7);
  const gh = A.calc({ ...house, cause: 'gift', price: 5e8, giftHeavy: true, over85: true });
  assert.equal(gh.total, 6.7e7);
  assert.equal(A.calc({ ...house, price: 5e8, houseCount: 3 }).total, 4.2e7);
  const inh = A.calc({ ...house, cause: 'inherit', price: 5e8, over85: true, inheritOneHouse: true });
  assert.equal(inh.rate, 0.008);
  assert.equal(inh.total, 4.8e6);
  assert.equal(A.calc({ ...house, cause: 'new', price: 5e8, over85: true }).total, 1.58e7);
});

test('시가표준액 1억 이하 주택은 다주택 중과 제외 (정비구역 안은 중과)', () => {
  assert.equal(A.calc({ ...house, price: 1.5e8, houseCount: 3, adjusted: true, stdValue: 9e7 }).rate, 0.01);
  assert.equal(A.calc({ ...house, price: 1.5e8, houseCount: 3, adjusted: true, stdValue: 9e7, redevZone: true }).rate, 0.12);
});

test('신고기한: 유상 60일, 증여 말일+3개월, 상속 말일+6개월', () => {
  assert.equal(A.dueDate('2026-10-15', 'sale'), '2026-12-14');
  assert.equal(A.dueDate('2026-10-15', 'gift'), '2027-01-31');
  assert.equal(A.dueDate('2026-10-15', 'inherit'), '2027-04-30');
});

test('오피스텔: 주거용이어도 매매 4%(합계 4.6%), 다주택 중과 없음, 주택 수 안내', () => {
  const A = require('../js/acquisition-engine.js');
  const o = A.calc({ buyer: '개인', asset: 'officetel', cause: 'sale', price: 3e8, houseCount: 3 });
  const n = A.calc({ buyer: '개인', asset: 'nonres', cause: 'sale', price: 3e8 });
  assert.equal(o.total, 13800000);
  assert.equal(o.total, n.total);
  assert.match(o.notes.join(), /주택 수/);
});
