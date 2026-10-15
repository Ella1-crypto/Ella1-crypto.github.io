/* 엔진 단위 테스트 — node --test tests/engine.test.cjs */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadEngine() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'engine.js'), 'utf8');
  const sandbox = { module: { exports: {} }, Math, Object, Number, Map, Array, Infinity };
  vm.runInNewContext(src, sandbox);
  return sandbox.module.exports;
}
const HT = loadEngine();
const near = (a, b, eps = 0.5) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b}`);
// vm 컨텍스트 배열은 프로토타입이 달라 deepStrictEqual이 실패하므로 현재 realm 배열로 복사
const local = arr => Array.from(arr);

/* v0.1 프로토타입 엔진(원본 그대로) — 회귀 기준 */
function v01(parcels, urbanOn) {
  const landtaxSep = b => (b <= 2e8 ? b * 0.002 : b <= 1e9 ? 4e5 + (b - 2e8) * 0.003 : 2.8e6 + (b - 1e9) * 0.004);
  const cmtTaxSep = b => (b <= 2e10 ? b * 0.005 : b <= 4e10 ? 1e8 + (b - 2e10) * 0.006 : 2.2e8 + (b - 4e10) * 0.007);
  const val = cls => parcels.filter(p => p.cls === cls).reduce((s, p) => s + p.price * p.area, 0);
  const sep = val('sep');
  const bunri = val('b02');
  const sepBase = sep * 0.7;
  const sepTax = landtaxSep(sepBase);
  const bunriBase = bunri * 0.7;
  const bunriTax = bunriBase * 0.002;
  const u = urbanOn ? (sepBase + bunriBase) * 0.0014 : 0;
  const edu = (sepTax + bunriTax) * 0.2;
  const propTotal = sepTax + bunriTax + u + edu;
  const cBase = Math.max(0, sep - 8e9);
  const cOut = cmtTaxSep(cBase);
  const credit = cBase > 0 && sepBase > 0 ? Math.min(cOut, sepTax * Math.min(1, (cBase * 0.7) / sepBase)) : 0;
  const cAll = Math.max(0, cOut - credit) * 1.2;
  return { propTotal, cAll };
}

const P = (o) => ({ sgg: '11590', share: 100, urban: true, ...o });

test('누진세율 구간 경계값', () => {
  assert.equal(HT.progressive(1e9, HT.BRACKETS.propSep), 2.8e6);
  assert.equal(HT.progressive(2e10, HT.BRACKETS.cmtSep), 1e8);
  near(HT.progressive(4e10, HT.BRACKETS.cmtSep), 2.2e8);
  near(HT.progressive(4.5e9, HT.BRACKETS.cmtJong), 7.5e7);
  near(HT.progressive(1e8, HT.BRACKETS.propJong), 2.5e5);
});

test('재산세 등은 v0.1(엑셀 v1.1 대사) 결과와 일치 — 종부세 공제는 시행령 누진방식으로 변경', () => {
  const samples = [
    [P({ cls: 'sep', price: 7.8e6, area: 1650 })],
    [P({ cls: 'sep', price: 7.8e6, area: 1650 }), P({ cls: 'sep', price: 9.2e6, area: 5200 }), P({ cls: 'b02', price: 5.2e6, area: 740 })],
    [P({ cls: 'sep', price: 3e7, area: 3000 }), P({ cls: 'sep', price: 2.5e7, area: 2800 })],
  ];
  for (const s of samples) {
    const r = HT.calcTaxpayer(s);
    const o = v01(s, true);
    near(r.prop.total, o.propTotal);
  }
});

test('공제할 재산세액 = 누진(종부세 과표 × 70%) — 보유세_검토용 131행과 동일(상한·지자체 분할 없음)', () => {
  const r = HT.calcTaxpayer([P({ cls: 'sep', price: 1e7, area: 1000 })]); // 공시가격 100억
  near(r.cmt.sep.base, 2e9);
  near(r.cmt.sep.propOnCmt, HT.progressive(2e9 * 0.7, HT.BRACKETS.propSep)); // 440만
  near(r.cmt.sep.credit, 4.4e6);
  near(r.cmt.sep.decided, 1e7 - 4.4e6);
});

test('재산세는 시·군·구별로 합산 — 다른 지자체 토지는 누진 합산하지 않음', () => {
  const same = HT.calcTaxpayer([P({ cls: 'sep', price: 5e5, area: 1000 }), P({ cls: 'sep', price: 5e5, area: 1000 })]);
  const split = HT.calcTaxpayer([P({ cls: 'sep', price: 5e5, area: 1000 }), P({ sgg: '11680', cls: 'sep', price: 5e5, area: 1000 })]);
  near(same.prop.sepTax, 1.9e6);
  near(split.prop.sepTax, 1.7e6);
});

test('종합합산 재산세·종부세·재산세액 공제·농특세', () => {
  const r = HT.calcTaxpayer([P({ cls: 'jong', price: 1e6, area: 1000, urban: false })]);
  near(r.prop.jongTax, 3.25e6);
  near(r.cmt.jong.base, 5e8);
  near(r.cmt.jong.computed, 5e6);
  near(r.cmt.jong.credit, 1.5e6);   // 누진(3.5억) = 25만 + 2.5억 × 0.5%
  near(r.cmt.jong.decided, 3.5e6);
  near(r.cmt.nong, 7e5);
});

test('분리과세 세율 0.07% / 4%', () => {
  const r = HT.calcTaxpayer([P({ cls: 'b007', price: 1e5, area: 1000, urban: false }), P({ cls: 'b4', price: 1e5, area: 1000, urban: false })]);
  near(r.prop.bunriTax, 1e8 * 0.7 * 0.0007 + 1e8 * 0.7 * 0.04);
});

test('지분율은 공시가격에 비례 반영', () => {
  const full = HT.calcTaxpayer([P({ cls: 'sep', price: 1e6, area: 1000 })]);
  const half = HT.calcTaxpayer([P({ cls: 'sep', price: 1e6, area: 1000, share: 50 })]);
  near(half.values.total, full.values.total / 2);
});

test('세부담상한 — 재산세 150% / 종부세 (재산세+종부세) 150%', () => {
  const sep7 = [P({ cls: 'sep', price: 1e6, area: 1000 })];
  near(HT.calcTaxpayer(sep7, { propSep: 1e6 }).prop.sepTax, 1.5e6);

  const sep100 = [P({ cls: 'sep', price: 1e7, area: 1000 })];
  const free = HT.calcTaxpayer(sep100);
  near(free.prop.sepTax, 2.68e7);
  near(free.cmt.sep.beforeCap, 1e7 - 4.4e6);
  const capped = HT.calcTaxpayer(sep100, { cmtSep: 2e7 });
  near(capped.cmt.sep.decided, 3.2e6); // 한도 3,000만 − 재산세 2,680만
});

test('분납 가능액', () => {
  assert.equal(HT.installmentPortion(2e6), 0);
  assert.equal(HT.installmentPortion(4e6), 1.5e6);
  assert.equal(HT.installmentPortion(1e7), 5e6);
});

test('CF — 납부월·분납·연쇄 상한·현금합계 정합', () => {
  const tp = { id: 't1', name: 'A', type: '법인', prev: {} };
  const parcels = [P({ tp: 't1', cls: 'sep', price: 1e7, area: 1000 })];
  const cf = HT.projectCashflow({ parcels, taxpayers: [tp], startYear: 2026, years: 2, growthPct: 0, installments: true, shieldPct: 0, taxpayerId: 'all' });
  assert.equal(cf.annual.length, 2);
  const months = cf.schedule.filter(s => s.taxYear === 2026).map(s => s.ym);
  assert.deepEqual(local(months), ['2026-09', '2026-12', '2026-12', '2027-06']);
  const accrual = cf.annual.reduce((s, r) => s + r.total, 0);
  const cash = cf.schedule.reduce((s, x) => s + x.amount, 0);
  near(cash, accrual, 1);
  near(cf.annual[0].cash + cf.annual[1].cash + cf.beyond, accrual, 1);
});

test('CF — 절세효과는 법인 3월 / 개인 5월 유입(음수)', () => {
  const corp = { id: 'c', name: 'C', type: '법인', prev: {} };
  const indiv = { id: 'i', name: 'I', type: '개인', prev: {} };
  const parcels = [P({ tp: 'c', cls: 'sep', price: 1e6, area: 100 }), P({ tp: 'i', cls: 'sep', price: 1e6, area: 100 })];
  const cf = HT.projectCashflow({ parcels, taxpayers: [corp, indiv], startYear: 2026, years: 1, growthPct: 0, installments: false, shieldPct: 20, taxpayerId: 'all' });
  const shields = cf.schedule.filter(s => s.kind === 'shield');
  assert.deepEqual(local(shields.map(s => s.ym)).sort(), ['2027-03', '2027-05']);
  assert.ok(shields.every(s => s.amount < 0));
});

test('과세구분 추정 — 법인 농지·도시지역 농지는 종합합산', () => {
  assert.equal(HT.estimateClass('전', '제3종일반주거지역', '개인').cls, 'jong');
  assert.equal(HT.estimateClass('답', '', '법인').cls, 'jong');
  assert.equal(HT.estimateClass('답', '자연녹지지역', '개인').cls, 'b007');
  assert.equal(HT.estimateClass('대', '일반상업지역', '법인').cls, 'sep');
  assert.equal(HT.estimateClass('공장용지', '일반공업지역', '법인').cls, 'b02');
});

test('도시지역분 자동판정 — 주거·상업·공업·녹지는 적용, 관리·농림·자연환경보전은 제외', () => {
  assert.equal(HT.estimateUrban('일반상업지역').urban, true);
  assert.equal(HT.estimateUrban('자연녹지지역').urban, true);
  assert.equal(HT.estimateUrban('계획관리지역').urban, false);
  assert.equal(HT.estimateUrban('농림지역').urban, false);
  assert.equal(HT.estimateUrban('').urban, true);
  assert.equal(HT.estimateUrban('').known, false);
});

test('PNU 생성 — 법정동코드 + 산 + 본번 4 + 부번 4', () => {
  assert.equal(HT.makePnu('1159010700', '1023-1'), '1159010700110230001');
  assert.equal(HT.makePnu('4113510300', '산 12'), '4113510300200120000');
  assert.equal(HT.makePnu('123', '1-1'), '');
});
