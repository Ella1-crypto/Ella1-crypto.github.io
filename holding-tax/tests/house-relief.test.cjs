/* 주택 감면·특례 — 임대주택 재산세 감면, 합산배제, 1세대1주택 특례 유지, 주택 수 제외, 공익법인 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('../js/house-engine.js');

test('임대주택 전용 60~85㎡: 재산세 본세 50% 경감, 도시지역분은 그대로(조문에 112조 포함 문구 없음)', () => {
  const plain = H.calc({ houses: [{ price: 5e8, region: 'metro' }] });
  const r = H.calc({ houses: [{ price: 5e8, region: 'metro', rentalSize: 's85' }] });
  assert.equal(plain.prop.main, 570000);
  assert.equal(r.prop.main, 285000);
  assert.equal(r.prop.urban, plain.prop.urban);
  assert.equal(r.prop.edu, 57000);
  assert.equal(r.rows[0].relief.rate, 0.5);
});

test('임대주택 전용 40㎡ 이하 면제 + 최소납부세제: 본세+도시지역분 50만원 초과면 85%만 감면', () => {
  const r = H.calc({ houses: [{ price: 5e8, region: 'metro', rentalSize: 's40' }] });
  assert.equal(r.rows[0].relief.minTax, true);
  assert.equal(r.prop.main, 570000 - Math.floor(570000 * 0.85));
  const small = H.calc({ houses: [{ price: 1e8, region: 'local', rentalSize: 's40' }] });
  assert.equal(small.prop.main, 0);
  assert.equal(small.prop.urban, 0);
});

test('임대주택 감면 제외 가액: 수도권 6억·지방 3억 초과면 감면 없음', () => {
  const r = H.calc({ houses: [{ price: 7e8, region: 'metro', rentalSize: 's85' }] });
  assert.equal(r.rows[0].relief.overCap, true);
  assert.equal(r.relief, 0);
  assert.equal(H.calc({ houses: [{ price: 4e8, region: 'local', rentalSize: 's85' }] }).rows[0].relief.overCap, true);
});

test('합산배제 임대주택은 종부세 과세표준·주택 수에서 빠지고, 거주 1주택은 1세대1주택 공제(12억)를 유지', () => {
  const r = H.calc({ oneHouse: true, houses: [{ price: 1.5e9 }, { price: 5e8, kind: 'rentalExclusion' }] });
  assert.equal(r.opt.oneHouse, true);
  assert.equal(r.cmt.value, 1.5e9);
  assert.equal(r.cmt.deduction, 1.2e9);
  assert.equal(r.cmt.count, 1);
  assert.equal(r.rows[1].fmv, 0.6); // 재산세 1주택 특례는 주된 주택에만
});

test('상속주택과 함께여도 1세대1주택: 12억 공제, 세액공제는 상속주택분을 뺀 비율만', () => {
  const r = H.calc({ oneHouse: true, age: 65, houses: [{ price: 2e9 }, { price: 5e8, kind: 'inherited' }] });
  assert.equal(r.opt.oneHouse, true);
  assert.equal(r.cmt.value, 2.5e9);
  assert.equal(r.cmt.deduction, 1.2e9);
  assert.equal(r.cmt.count, 1);
  assert.equal(r.cmt.mainShare, 0.8);
  assert.equal(r.cmt.seniorCredit, Math.floor(r.cmt.afterCredit * 0.8 * 0.3 + 1e-6));
});

test('일반 주택이 2채면 1세대1주택이 아니고, 소형 신축 등은 세율 판정 주택 수에서만 빠진다', () => {
  const two = H.calc({ oneHouse: true, houses: [{ price: 1e9 }, { price: 1e9 }] });
  assert.equal(two.opt.oneHouse, false);
  const three = H.calc({ houses: [{ price: 1e9 }, { price: 1e9 }, { price: 1e9, kind: 'smallNew' }] });
  assert.equal(three.cmt.count, 2);
  assert.equal(three.cmt.value, 3e9);
  const unlisted = H.calc({ oneHouse: true, houseCount: 2, houses: [{ price: 1.5e9 }] });
  assert.equal(unlisted.opt.oneHouse, false);
});

test('공익법인 등 일반 누진세율 법인: 9억 공제·누진세율, 단일세율 법인은 공제 0·2.7%', () => {
  const flat = H.calc({ ownerType: '법인', houses: [{ price: 1e9 }] });
  const general = H.calc({ ownerType: '법인', corpGeneral: true, houses: [{ price: 1e9 }] });
  assert.equal(flat.cmt.deduction, 0);
  assert.equal(general.cmt.deduction, 9e8);
  assert.equal(general.cmt.computed, Math.floor(1e8 * 0.6 * 0.005));
});
