/* 합성 사례 대사: 별도합산 80% · 분리과세 20% 토지 (실제 고지서 아님)
 * 입력값은 임의로 정한 공시지가·면적 (합성 수치) */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const load = file => {
  const sandbox = { module: { exports: {} } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'js', file), 'utf8'), sandbox);
  return sandbox.module.exports;
};
const HT = load('engine.js');

test('합성 토지 28,943,700원: 별도합산 40,123.4㎡ + 분리 0.2% 10,030.85㎡, 공시지가 151,300원', () => {
  const base = { sgg: '44131', price: 151300, urban: true, share: 100 };
  const r = HT.calcTaxpayer([{ ...base, cls: 'sep', area: 40123.4 }, { ...base, cls: 'b02', area: 10030.85 }]);
  assert.equal(Math.round(r.prop.sepBase), 4249469294);
  assert.equal(Math.round(r.prop.bunriBase), 1062367323);
  assert.equal(Math.floor(r.prop.sepTax), 15797877);
  assert.equal(Math.floor(r.prop.bunriTax), 2124734);
  assert.equal(Math.floor(r.prop.urban), 7436571);
  assert.equal(r.prop.notice.prop, 25359180);
  assert.equal(r.prop.notice.edu, 3584520);
  assert.equal(r.prop.notice.total, 28943700);
  assert.equal(r.cmt.total, 0); // 별도합산 공시가격 60.7억 < 공제 80억
});

test('한 필지를 같은 소유자의 과세구분 80:20 지분 행으로 나눠도 같은 금액', () => {
  const p = { sgg: '44131', price: 151300, area: 50154.25, urban: true, owners: [{ tp: 'a', share: 80, cls: 'sep' }, { tp: 'a', share: 20, cls: 'b02' }] };
  const r = HT.calcPortfolio([p], [{ id: 'a', name: '법인A', type: '법인', prev: {} }]);
  assert.equal(r.rows[0].result.prop.notice.total, 28943700);
});
