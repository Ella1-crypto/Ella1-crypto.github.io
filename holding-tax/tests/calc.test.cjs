/* 화면 상태 → 결과 통합 테스트 — node --test tests/calc.test.cjs */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/calc.js');

// 합성 사례(별도합산 80% · 분리 0.2% 20%) — 토지 28,943,700원
const area = 50154.25;
const cheonan = cls => ({ id: cls, price: 151300, area: area * (cls === 'sep' ? 0.8 : 0.2), cls, sgg: '44131', sggName: '천안시 동남구', urban: true });

test('합성 토지분 금액(28,943,700원)을 원 단위로 재현한다', () => {
  const r = C.compute({ ownerType: '법인', growth: 0, parcels: [cheonan('sep'), cheonan('b02')] });
  assert.equal(r.totals.landProp, 28943700);
  assert.equal(r.totals.cmt, 0); // 별도합산 60.7억 < 80억
  assert.equal(r.schedule.length, 1);
  assert.equal(r.schedule[0].month, 9);
});

test('공시가격·면적이 없는 필지는 계산에서 빼고 개수를 알린다', () => {
  const r = C.compute({ ownerType: '개인', growth: 0, parcels: [{ id: 'a', price: 0, area: 100, cls: 'sep' }] });
  assert.equal(r.totals.total, 0);
  assert.equal(r.missing, 1);
});

test('건물 추정 → 건물분 세액: 시가표준액 × 70% × 0.25% 등 building-engine과 일치', () => {
  const parcel = {
    id: 'b', price: 3000000, area: 500, cls: 'sep', sgg: '11680', urban: true,
    bld: { mode: 'estimate', structure: 'rc', builtYear: 2010, floors: 5, rate: 'general', fire: 'auto', rows: [{ use: 'office', area: 2000, adjust: 1 }] },
  };
  const b = C.buildingFor(parcel);
  assert.equal(b.error, null);
  // 860,000 × 1.00 × 1.12 × 1.15 × 0.64 = 708,915.2 → 708,000 × 2,000㎡
  assert.equal(b.value, 1416000000);
  assert.equal(b.fire.fire, 2); // 4~10층 비주거
  assert.equal(b.tax.main, 2478000); // 991,200,000 × 0.25% (부동소수 오차 없이)
  assert.ok(b.tax.total > 0);
});

test('건물 시가표준액 직접 입력도 계산한다', () => {
  const b = C.buildingFor({ id: 'd', price: 1, area: 1, urban: false, bld: { mode: 'direct', direct: 1e9, rate: 'general', fire: 1 } });
  assert.equal(b.tax.urbanTax, 0);
  assert.equal(b.tax.main, 1750000);
});

test('5년 전망: 잔가율이 매년 내려가 건물분이 줄고, 공시지가 상승률이 토지분에 반영된다', () => {
  const state = {
    ownerType: '법인', growth: 5,
    parcels: [{ id: 'x', price: 5000000, area: 1000, cls: 'sep', sgg: '11', urban: true,
      bld: { mode: 'estimate', structure: 'rc', builtYear: 2000, floors: 3, rate: 'general', fire: 1, rows: [{ use: 'office', area: 3000, adjust: 1 }] } }],
  };
  const p = C.compute(state).projection;
  assert.equal(p.length, 5);
  assert.ok(p[1].land > p[0].land);
  assert.ok(p[4].building < p[0].building);
});

test('용도 구분을 나눠도 소방분 누진세율은 건물 전체 가액에 한 번 적용한다', () => {
  const mk = rows => ({ id: 'f', price: 12500000, area: 330, urban: true,
    bld: { mode: 'estimate', structure: 'rc', builtYear: 2008, floors: 7, rate: 'general', fire: 'auto', rows } });
  const split = C.buildingFor(mk([{ use: 'retail', area: 280, adjust: 1.27 }, { use: 'office', area: 1650, adjust: 1 }]));
  assert.equal(split.value, 1608491200);
  const base = Math.floor(1608491200 * 0.7);
  const fireStd = Math.floor(49100 + (base - 64e6) * 0.0012);
  assert.equal(split.tax.fire, fireStd * 2);
});
