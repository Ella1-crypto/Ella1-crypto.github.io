/* 주택 공시가격 응답 정리(중계 서버 src/house-price.js) — node --test tests/house-price.test.cjs (합성 수치) */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = () => import(pathToFileURL(path.join(__dirname, '..', '..', '_workers', 'holding-tax-api', 'src', 'house-price.js')).href);

const rows = [
  { aphusNm: '합성빌라', dongNm: '', floorNm: '3', hoNm: '301', prvuseAr: '59.9', pblntfPc: '210000000', stdrYear: '2026' },
  { aphusNm: '합성빌라', dongNm: '', floorNm: '3', hoNm: '302', prvuseAr: '49.5', pblntfPc: '180000000', stdrYear: '2026' },
  { aphusNm: '합성아파트', dongNm: '101동', floorNm: '10', hoNm: '1001', prvuseAr: '84.97', pblntfPc: '612,000,000', stdrYear: '2026' },
  { aphusNm: '합성아파트', dongNm: '102', floorNm: '10', hoNm: '1001호', prvuseAr: '84.97', pblntfPc: '598000000', stdrYear: '2026' },
  { aphusNm: '가격없음', dongNm: '103', hoNm: '1', pblntfPc: '0' },
];

test('동·호 표기가 달라도(101동/101, 1001호/1001) 같은 호를 찾는다', async () => {
  const { apartItems, unitKey } = await load();
  assert.equal(unitKey('101동'), unitKey('101'));
  assert.equal(unitKey('제1001호'), '1001');
  const one = apartItems(rows, '101', '1001호');
  assert.equal(one.length, 1);
  assert.deepEqual(one[0], { complex: '합성아파트', dong: '101동', floor: '10', ho: '1001', area: 84.97, price: 612000000, year: 2026 });
  assert.equal(apartItems(rows, '102동', '1001')[0].price, 598000000);
});

test('동 없는 빌라는 호만으로, 아무것도 안 주면 가격 있는 전체 호', async () => {
  const { apartItems } = await load();
  assert.deepEqual(apartItems(rows, '', '302').map(it => it.price), [180000000]);
  assert.equal(apartItems(rows, '', '').length, 4); // 가격 0인 행은 뺀다
  assert.deepEqual(apartItems(rows, '', '1001').map(it => it.dong), ['101동', '102']); // 동을 안 주면 모든 동에서
});

test('VWorld ned/data 응답: 최상위 키 이름과 상관없이 field 배열, 없으면 빈 배열, 형식 오류면 null', async () => {
  const { fieldsOf, indvdItem } = await load();
  assert.deepEqual(fieldsOf({ apartHousingPrices: { field: [{ a: 1 }] } }), [{ a: 1 }]);
  assert.deepEqual(fieldsOf({ indvdHousingPrices: { field: { housePc: '1' } } }), [{ housePc: '1' }]);
  assert.deepEqual(fieldsOf({ whatever: { resultCode: 'INFO-000', resultMsg: '없음' } }), []);
  assert.equal(fieldsOf({ error: 'x' }), null);
  assert.deepEqual(indvdItem([{ housePc: '0' }, { housePc: '350000000', stdrYear: '2026' }]), { price: 350000000, year: 2026, area: 0 });
  assert.equal(indvdItem([]), null);
});
