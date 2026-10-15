/* 감면·중과 — 지특법 조문별 감면율, 최소납부세제, 필지 안분 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/calc.js');
const RL = require('../js/relief.js');

const parcel = extra => ({ id: 'p', addr: '공장', price: 1e6, area: 2000, cls: 'sep', sgg: '1', urban: true, share: 100,
  bld: { mode: 'direct', direct: 3e9, rate: 'general', fire: 1 }, ...extra });
const st = parcels => ({ ownerType: '법인', growth: 0, mode: '2026', prev: {}, parcels });

test('지식산업센터 최초 분양 중소기업 35%: 토지·건축물 재산세 본세의 35%와 교육세가 줄고 도시지역분·소방분은 그대로', () => {
  const base = C.compute(st([parcel()]));
  const r = C.compute(st([parcel({ relief: { key: 'knowledgeTenant' } })]));
  const item = r.reliefs[0];
  assert.equal(item.rate, 0.35);
  assert.equal(item.bld.urbanCut, 0);
  const b0 = base.buildings[0], b1 = r.buildings[0];
  assert.equal(b1.own.fire, b0.own.fire);
  assert.equal(b0.own.total - b1.own.total, item.bld.total);
  assert.equal(item.bld.mainCut, Math.floor(b0.tax.main * 0.35));
  assert.equal(item.bld.eduCut, Math.floor(item.bld.mainCut * 0.2));
  assert.equal(base.totals.total - r.totals.total, item.total);
});

test('산업단지 신·증축 감면율은 지역별 35%·60%·75%', () => {
  assert.equal(RL.commercialRule('industrialComplex', 'metro').rate, 0.35);
  assert.equal(RL.commercialRule('industrialComplex', 'local').rate, 0.6);
  assert.equal(RL.commercialRule('industrialComplex', 'depop').rate, 0.75);
  assert.equal(RL.commercialRule('knowledgeBuilder', 'metro').rate, 0.15);
  assert.equal(RL.commercialRule('knowledgeBuilder', 'local').rate, 0.35);
});

test('최소납부세제: 면제라도 재산세 50만원 초과면 85%만 감면, 50만원 이하면 전액 면제', () => {
  const big = RL.apply({ main: 2e6, urban: 0 }, { rate: 1, urban: false });
  assert.equal(big.minTax, true);
  assert.equal(big.rate, 0.85);
  assert.equal(big.mainCut, 1.7e6);
  const small = RL.apply({ main: 4e5, urban: 0 }, { rate: 1, urban: false });
  assert.equal(small.minTax, false);
  assert.equal(small.mainCut, 4e5);
});

test('토지 감면은 같은 시·군·구 별도합산 안에서 과세표준 비율로 안분한다', () => {
  const a = parcel({ id: 'a', bld: null, relief: { key: 'custom', custom: 100 } });
  const b = parcel({ id: 'b', bld: null });
  const r = C.compute(st([a, b]));
  const allocA = C.landAlloc(r.land, { ...a, share: 100 });
  const allocB = C.landAlloc(r.land, { ...b, share: 100 });
  assert.ok(Math.abs(allocA.main + allocB.main - r.land.prop.sepTax) < 1);
  assert.ok(Math.abs(allocA.main - allocB.main) < 1);
});

test('감면 남은 연수가 지나면 CF·전망에서 감면이 빠진다', () => {
  const r = C.series(st([parcel({ relief: { key: 'knowledgeTenant', years: 2 } })]), 4);
  assert.ok(r[0].r.totals.relief > 0);
  assert.ok(r[1].r.totals.relief > 0);
  assert.equal(r[2].r.totals.relief, 0);
});

test('과밀억제권역 공장 신설·증설: 건축물 재산세 1.25%(0.25%의 5배)', () => {
  const g = C.compute(st([parcel({ bld: { mode: 'direct', direct: 1e9, rate: 'general', fire: 1 } })]));
  const o = C.compute(st([parcel({ bld: { mode: 'direct', direct: 1e9, rate: 'overcrowd', fire: 1 } })]));
  assert.equal(o.buildings[0].tax.main, g.buildings[0].tax.main * 5);
});

test('저장·공유 링크를 거쳐도 과밀억제권역 중과 세율이 유지된다', () => {
  const vm = require('node:vm');
  const fs = require('node:fs');
  const path = require('node:path');
  const win = { BuildingTax: require('../js/building-engine.js'), BuildingValue: require('../js/valuation.js'), HTMRelief: RL };
  const ctx = { window: win, localStorage: { getItem: () => null, setItem() {} }, TextEncoder, TextDecoder, btoa, atob, Uint8Array, Math, Number, Object, Array, JSON, String };
  ctx.window.HTM = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'state.js'), 'utf8'), ctx);
  const S = ctx.window.HTM.state;
  const st = S.clean({ parcels: [{ id: 'x', price: 1, area: 1, bld: { mode: 'direct', direct: 1e9, rate: 'overcrowd' } }] });
  assert.equal(st.parcels[0].bld.rate, 'overcrowd');
  assert.equal(S.decode(S.encode(st)).parcels[0].bld.rate, 'overcrowd');
});
