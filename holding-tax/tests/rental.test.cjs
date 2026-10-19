/* 임대 CF(보증금·월세·공실·운영비)와 수익률 지표 — node --test tests/rental.test.cjs (합성 수치) */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../js/acquisition-engine.js');
const H = require('../js/house-engine.js');
const L = require('../js/engine.js');
const B = require('../js/building-engine.js');
const T = require('../js/transfer-engine.js');
const Life = require('../js/lifecycle-engine.js')(A, H, L, B, T);
const M = require('../js/rental-metrics.js');

const base = { owner: '개인', kind: 'commercial', price: 2e9, buyDate: '2026-03-02', years: 7, growth: 2, landShare: 60, landRatio: 65, bldStd: 4e8, loan: 1e9, loanRate: 4.5, fee: 0.5 };
const lease = { deposit: 2e8, monthlyRent: 8e6, vacancy: 5, opex: 6e6, rentGrowth: 2 };

test('보증금: 0년차에 받아 자기자본을 줄이고, 매각 때 돌려준다', () => {
  const a = Life.calc(base);
  const b = Life.calc({ ...base, deposit: 2e8 });
  assert.equal(a.invested - b.invested, 2e8);
  assert.equal(b.rows[0].deposit, 2e8);
  assert.equal(b.rows.at(-1).deposit, -2e8);
  assert.equal(a.rows.at(-1).flow - b.rows.at(-1).flow, 2e8);
});

test('월세 × 12 × (1 − 공실률), 해마다 임대료 상승률, 운영비는 따로 빼서 흐름에 반영', () => {
  const r = Life.calc({ ...base, ...lease });
  assert.equal(r.rows[1].rent, Math.floor(8e6 * 12 * 0.95));
  assert.equal(r.rows[2].rent, Math.floor(8e6 * 12 * 1.02 * 0.95 + 1e-6));
  assert.equal(r.rows[1].opex, 6e6);
  const y = r.rows[1];
  assert.equal(y.flow, y.rent - y.opex - y.interest - y.prop - y.cmt);
  assert.match(r.notes.join(), /보증금/);
});

test('월세를 넣으면 연 순임대수입 칸은 쓰지 않는다', () => {
  const r = Life.calc({ ...base, ...lease, rent: 999999999 });
  assert.equal(r.rows[1].rent, Math.floor(8e6 * 12 * 0.95));
  assert.match(r.notes.join(), /연 순임대수입 칸은 쓰지 않았습니다/);
});

test('수익률 지표: 표면·순(Cap)·실투자·이자보상배율 정의대로', () => {
  const r = Life.calc({ ...base, ...lease });
  const m = M.metrics(r);
  const y = r.rows[1];
  assert.equal(m.gross, 96e6);
  assert.equal(m.grossYield, 96e6 / 2e9);
  assert.equal(m.noi, y.rent - y.opex - y.prop - y.cmt);
  assert.equal(m.capRate, m.noi / 2e9);
  assert.equal(m.cashOnCash, (m.noi - y.interest) / r.invested);
  assert.equal(m.dscr, m.noi / y.interest);
  assert.equal(m.irr, r.irr);
  assert.ok(m.irr > -1 && m.irr < 1);
  // 실투자금 = 매입가 − 대출 − 보증금 + 취득세 + 중개수수료
  assert.equal(r.invested, 2e9 - 1e9 - 2e8 + r.taxes.acq + Math.floor(2e9 * 0.005));
});

test('대출이 없으면 이자보상배율은 없음, 전세(월세 0)는 표면수익률 0', () => {
  const m = M.metrics(Life.calc({ ...base, loan: 0, deposit: 5e8 }));
  assert.equal(m.dscr, null);
  assert.equal(m.grossYield, 0);
});
