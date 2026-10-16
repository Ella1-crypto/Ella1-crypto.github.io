/* 생애주기 CF — 취득세·보유세·양도세를 각 엔진과 같은 값으로 잇는지 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../js/acquisition-engine.js');
const H = require('../js/house-engine.js');
const L = require('../js/engine.js');
const B = require('../js/building-engine.js');
const T = require('../js/transfer-engine.js');
const Life = require('../js/lifecycle-engine.js')(A, H, L, B, T);

test('1주택 10억 5년 보유: 0년차 취득세, 해마다 보유세 1번, 매각 시 1주택 비과세', () => {
  const r = Life.calc({ price: 1e9, buyDate: '2026-03-02', years: 5, growth: 0, fee: 0 });
  assert.equal(r.rows.length, 6);
  assert.equal(r.acq.total, A.calc({ buyer: '개인', asset: 'house', cause: 'sale', price: 1e9, houseCount: 1 }).total);
  assert.equal(r.rows[1].label.includes('2026'), true);
  assert.equal(r.rows[5].label.includes('2030'), true);
  assert.equal(r.transfer.exempt, true);
  // 2026년 보유세 = 주택 엔진 그대로
  const h = H.calc({ mode: '2026', ownerType: '개인', oneHouse: true, houseCount: 1, holdYears: 0, houses: [{ price: 6.9e8, share: 100, urban: true }] });
  assert.equal(r.rows[1].prop + r.rows[1].cmt, h.total);
  assert.equal(r.profit, -(r.taxes.total));
});

test('7월에 사면 그해 보유세는 판 사람 몫 — 첫 과세연도는 다음 해', () => {
  const r = Life.calc({ price: 5e8, buyDate: '2026-07-01', years: 2, growth: 0 });
  assert.match(r.rows[1].label, /2027년/);
  assert.match(r.rows[2].label, /2028년/);
});

test('상가 10억 법인: 양도는 법인 처분 세금, 수익률 계산', () => {
  const r = Life.calc({ owner: '법인', kind: 'commercial', price: 1e9, years: 5, growth: 3, rent: 4e7, fee: 0.5 });
  assert.equal(r.transfer.seller, '법인');
  assert.ok(r.taxes.prop > 0);
  assert.ok(r.irr > 0 && r.irr < 0.2);
  const g = Life.grid({ price: 1e9, kind: 'commercial', rent: 4e7 }, [3, 5], [0, 0.03]);
  assert.equal(g.length, 2);
});

test('IRR: −100 → +110 은 10%', () => {
  assert.ok(Math.abs(Life.irr([-100, 110]) - 0.1) < 1e-6);
});
