/* 비주거 건물분 재산세·소방분 테스트 (조문 확인 2026-09-14) */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sandbox = { module: { exports: {} } };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'building-engine.js'), 'utf8'), sandbox);
const B = sandbox.module.exports;
const near = (actual, expected, tol, msg) => assert.ok(Math.abs(actual - expected) <= tol, `${msg}: ${actual} vs ${expected}`);

test('소방분 누진 구간 경계 (§146③1)', () => {
  assert.equal(B.fireProgressive(6e6), 2400);
  assert.equal(B.fireProgressive(13e6), 5900);
  assert.equal(B.fireProgressive(26e6), 13700);
  assert.equal(B.fireProgressive(39e6), 24100);
  assert.equal(B.fireProgressive(64e6), 49100);
});

test('시가표준액 10억 일반 건축물: 70% · 0.25% · 도시지역분 · 교육세는 도시지역분 제외', () => {
  const r = B.calc({ units: [{ name: '본동', amount: 1e9, rate: 'general', fire: 1 }] }, { urban: true });
  assert.equal(r.base, 7e8);
  assert.equal(r.main, 1750000);
  assert.equal(r.urbanTax, 980000);
  assert.equal(r.prop, 2730000);
  assert.equal(r.edu, 350000);
  assert.equal(r.fire, 812300);
  assert.equal(r.total, 3892300);
});

test('합성 대형 건축물 ×3: 재산세·도시지역분·교육세', () => {
  const r = B.calc({ bldInput: 'base', units: [{ name: '전체', amount: 61234567891, rate: 'general', fire: 3 }] }, { urban: true });
  near(r.main, 153086419, 10, '재산세 본세');
  near(r.urbanTax, 85728395, 20, '도시지역분');
  assert.equal(r.edu, 30617280);
  // 한 건물로 ×3을 매기면 동별 계산보다 약 128만원 많다 → 동별 과세표준·배수가 필요
  assert.ok(r.fire - 219080308 > 1e6);
});

test('소방분은 동별 누진 후 배수: 주건축물 ×3 + 부속 ×1로 나눈 동별 계산', () => {
  const r = B.calc({ bldInput: 'base', units: [
    { name: '주건축물', amount: 60712345678, rate: 'general', fire: 3 },
    { name: '부속건축물', amount: 522222213, rate: 'general', fire: 1 },
  ] }, { urban: true });
  near(r.fire, 219080308, 10, '소방분');
});

test('세 부담 상한: 본세·도시지역분 각각 직전 연도 150%, 교육세는 상한 적용 후 본세 기준', () => {
  const r = B.calc({ bldPrevMain: 1e6, bldPrevUrban: 1e6, units: [{ amount: 1e9, rate: 'general', fire: 1 }] }, { urban: true });
  assert.equal(r.main, 1500000);
  assert.equal(r.urbanTax, 980000);
  assert.equal(r.capReduced, 250000);
  assert.equal(r.edu, 300000);
});

test('주택 용도 동은 제외, 전부 주택이면 오류', () => {
  const mixed = B.calc({ units: [{ name: '상가', amount: 1e9 }, { name: '주택동', use: '공동주택', amount: 5e8 }] }, { urban: false });
  assert.equal(mixed.rows.length, 1);
  assert.equal(mixed.excluded.length, 1);
  assert.match(B.calc({ units: [{ use: '아파트', amount: 5e8 }] }, {}).error, /주택분/);
});

test('구버전 buildingValue만 있으면 한 동으로 계산, 입력 없으면 안내', () => {
  assert.equal(B.calc({ buildingValue: 1e9 }, { urban: false }).main, 1750000);
  assert.ok(B.calc({}, {}).empty);
});

test('소유지분 안분과 분할납부', () => {
  const r = B.calc({ units: [{ amount: 4e9, rate: 'general', fire: 1 }] }, { urban: true });
  const [a, b] = B.forOwners(r, [{ tp: 'a', share: 60 }, { tp: 'b', share: 40 }]);
  assert.equal(a.prop, Math.floor(r.prop * 0.6));
  assert.equal(b.fire, Math.floor(r.fire * 0.4));
  const pay = B.payments(a, 2027, true);
  assert.equal(pay[0].month, '2027-07');
  assert.equal(pay[1].month, '2027-10');
  assert.equal(pay[0].amount + pay[1].amount, a.total);
});

test('소방분 배수 제안: 층수·창고 연면적', () => {
  assert.equal(B.suggestFire({ purpose: '업무시설', floorsAbove: 12 }).fire, 3);
  assert.equal(B.suggestFire({ purpose: '근린생활시설', floorsAbove: 5 }).fire, 2);
  const wh = B.suggestFire({ purpose: '창고시설', floorsAbove: 4, totalArea: 167612.82 });
  assert.equal(wh.fire, 2);
  assert.match(wh.note, /×3/);
  assert.equal(B.suggestFire({ purpose: '아파트', floorsAbove: 20 }).fire, 1);
});
