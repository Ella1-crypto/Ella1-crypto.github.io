/* 2026 건축물 시가표준액 추정 — node --test tests/ */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const BV = require('../js/valuation.js');

// 업무요령 2026 제3장 제7절 「상업용 일반건축물」 산정사례(강남대로, 1998년, SRC, 위치지수 1.50)
const GANGNAM = { structure: 'src', builtYear: 1998, landPrice: 35370000 };
const rows = [
  { use: 'parking', area: 1660, adjust: 1.10, expect: 995170000 },
  { use: 'retail', area: 56, adjust: 0.90, expect: 43293600 },
  { use: 'office', area: 406, adjust: 1.51, expect: 526618540 },
  { use: 'office', area: 682, adjust: 1.15, expect: 673713700 },
  { use: 'office', area: 1364, adjust: 1.10, expect: 1288843600 },
  { use: 'office', area: 5115, adjust: 1.05, expect: 4613474250 },
];

test('업무요령 산정사례 6개 구분과 합계 8,141,113,690원을 원 단위까지 재현한다', () => {
  const values = rows.map(r => BV.estimate({ ...GANGNAM, ...r }));
  values.forEach((v, i) => assert.equal(v.value, rows[i].expect, `${i + 1}번째 구분`));
  assert.equal(values.reduce((s, v) => s + v.value, 0), 8141113690);
  assert.equal(values[0].residual, 0.496);
  assert.equal(values[0].locationIndex, 1.5);
});

test('잔가율: 2026 신축연도별 표와 일치하고 최종잔가율 10%에서 멈춘다', () => {
  assert.equal(BV.residualRate(2026, 50), 1);
  assert.equal(BV.residualRate(2025, 50), 0.982);
  assert.equal(BV.residualRate(2000, 40), 0.415);
  assert.equal(BV.residualRate(2010, 30), 0.52);
  assert.equal(BV.residualRate(2015, 20), 0.505);
  assert.equal(BV.residualRate(2017, 10), 0.19);
  assert.equal(BV.residualRate(1976, 50), 0.1);
  assert.equal(BV.residualRate(1950, 50), 0.1);
  assert.equal(BV.residualRate(2016, 10), 0.1);
});

test('위치지수: 구간 경계는 "이하"로 포함한다', () => {
  assert.equal(BV.locationIndex(10000), 0.8);
  assert.equal(BV.locationIndex(10001), 0.82);
  assert.equal(BV.locationIndex(1000000), 1.0);
  assert.equal(BV.locationIndex(1000001), 1.03);
  assert.equal(BV.locationIndex(840000), 1.0); // 업무요령 3필지 평균 사례
  assert.equal(BV.locationIndex(90000000), 1.69);
});

test('㎡당 금액은 1,000원 미만 버림, 1,000원 미만이면 1,000원', () => {
  assert.equal(BV.perM2Round(859944.96), 859000);
  assert.equal(BV.perM2Round(420), 1000);
});

test('입력 누락은 오류 메시지를 돌려준다', () => {
  assert.match(BV.estimate({ use: 'office', builtYear: 2000, area: 10 }).error, /구조/);
  assert.match(BV.estimate({ structure: 'rc', use: 'office', builtYear: 2030, area: 10 }).error, /사용승인연도/);
  assert.match(BV.estimate({ structure: 'rc', use: 'office', builtYear: 2000, area: 0 }).error, /연면적/);
});

test('공업용 용도는 공업용 신축가격기준액(84만원)을 쓴다', () => {
  const v = BV.estimate({ structure: 'steel', use: 'warehouse', builtYear: 2020, area: 1000, landPrice: 151300 });
  assert.equal(v.newPrice, 840000);
  assert.equal(v.residual, 0.82); // 30년 내용연수, 경과 6년
  assert.equal(v.locationIndex, 0.9);
});

test('프로토타입 키(constructor·__proto__)는 용도·구조로 받지 않는다', () => {
  for (const k of ['constructor', '__proto__', 'toString']) {
    assert.match(BV.estimate({ structure: 'rc', use: k, builtYear: 2000, area: 10 }).error, /용도/);
    assert.match(BV.estimate({ structure: k, use: 'office', builtYear: 2000, area: 10 }).error, /구조/);
  }
});
