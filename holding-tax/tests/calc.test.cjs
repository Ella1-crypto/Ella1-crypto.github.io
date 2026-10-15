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

test('지분 50%: 토지·건물 세액이 절반(건물은 전체 세액을 계산한 뒤 지분 안분)', () => {
  const mk = share => ({ ownerType: '법인', growth: 0, parcels: [{ id: 's', price: 3e6, area: 500, cls: 'sep', sgg: '1', urban: true, share,
    bld: { mode: 'direct', direct: 2e9, rate: 'general', fire: 1 } }] });
  const full = C.compute(mk(100));
  const half = C.compute(mk(50));
  assert.ok(Math.abs(half.totals.building - full.totals.building / 2) <= 3);
  assert.ok(half.totals.landProp < full.totals.landProp);
  assert.equal(half.buildings[0].tax.total, full.buildings[0].tax.total); // 건물 전체 세액은 같다
});

test('별도합산 부속토지 2% 기준: 건물 가액이 토지 가액의 2% 미만이면 바닥면적 외 토지는 종합합산', () => {
  const parcel = { id: 'o', price: 1e7, area: 1000, cls: 'sep', sgg: '1', urban: true,
    bld: { mode: 'direct', direct: 1.5e8, rate: 'general', fire: 1, footprint: 200 } }; // 1.5억 / 100억 = 1.5%
  const r = C.compute({ ownerType: '법인', growth: 0, parcels: [parcel] });
  assert.equal(r.warnings.length, 1);
  assert.equal(r.warnings[0].split, true);
  assert.equal(r.land.values.sep, 1e7 * 200);
  assert.equal(r.land.values.jong, 1e7 * 800);
  const noFoot = C.compute({ ownerType: '법인', growth: 0, parcels: [{ ...parcel, bld: { ...parcel.bld, footprint: 0 } }] });
  assert.equal(noFoot.warnings[0].split, false); // 건축면적이 없으면 경고만
  assert.equal(noFoot.land.values.jong, 0);
});

test('2027 개편안 미리보기: 기준이 5%로 올라 3% 건물도 종합합산 대상이 된다', () => {
  const parcel = { id: 'r', price: 1e7, area: 1000, cls: 'sep', sgg: '1', urban: true,
    bld: { mode: 'direct', direct: 3e8, rate: 'general', fire: 1, footprint: 300 } }; // 3%
  assert.equal(C.compute({ ownerType: '법인', growth: 0, parcels: [parcel] }).warnings.length, 0);
  const reform = C.compute({ ownerType: '법인', growth: 0, mode: '2027reform', parcels: [parcel] });
  assert.equal(reform.year, 2027);
  assert.equal(reform.warnings.length, 1);
  assert.ok(reform.land.values.jong > 0);
});

test('작년 세액을 넣으면 토지분 재산세 세부담상한(150%)이 적용된다', () => {
  const st = prev => ({ ownerType: '법인', growth: 0, prev, parcels: [{ id: 'c', price: 1e6, area: 1000, cls: 'sep', sgg: '1', urban: false }] });
  const free = C.compute(st({}));
  const capped = C.compute(st({ propSep: 1e6 }));
  assert.equal(capped.land.prop.sepTax, 1.5e6);
  assert.ok(capped.totals.landProp < free.totals.landProp);
});
