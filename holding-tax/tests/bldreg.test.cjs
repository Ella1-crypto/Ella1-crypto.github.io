/* 건축물대장 → 건물 입력 변환, 여러 동 계산, 중계 서버 정규화 — node --test tests/bldreg.test.cjs (합성 수치) */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const R = require('../js/bldreg.js');
const C = require('../js/calc.js');
const B = require('../js/building-engine.js');

const relay = () => import(pathToFileURL(path.join(__dirname, '..', '..', '_workers', 'holding-tax-api', 'src', 'building.js')).href);

test('구조 이름: 철골철근콘크리트·경량철골은 철근콘크리트·철골보다 먼저 맞춘다', () => {
  assert.equal(R.structureKey('철골철근콘크리트구조'), 'src');
  assert.equal(R.structureKey('철근콘크리트구조'), 'rc');
  assert.equal(R.structureKey('경량철골구조'), 'lightSteel');
  assert.equal(R.structureKey('일반철골구조'), 'steel');
  assert.equal(R.structureKey('조적구조'), 'brick');
  assert.equal(R.structureKey('기타구조'), null);
});

test('용도 이름: 근린생활·업무·창고·주택·오피스텔', () => {
  assert.equal(R.useKey('제2종근린생활시설', ''), 'retail');
  assert.equal(R.useKey('업무시설', '사무소'), 'office');
  assert.equal(R.useKey('업무시설', '오피스텔'), 'officetel');
  assert.equal(R.useKey('창고시설', '냉동창고'), 'coldStorage');
  assert.equal(R.useKey('공동주택', '아파트'), 'house');
  assert.equal(R.useKey('', ''), null);
});

test('층별개요를 용도별 면적으로 묶고 큰 순으로 정렬한다', () => {
  const d = R.toDong({
    name: '본관', main: true, structure: '철근콘크리트구조', purpose: '업무시설', builtYear: 2008,
    floorsAbove: 7, totalArea: 1500, archArea: 300,
    floors: [
      { purpose: '제1종근린생활시설', area: 200 }, { purpose: '업무시설', area: 300 },
      { purpose: '업무시설', area: 300 }, { purpose: '주차장', area: 250.555 },
    ],
  });
  assert.deepEqual(d.rows, [
    { use: 'office', area: 600, adjust: 1 }, { use: 'parking', area: 250.56, adjust: 1 }, { use: 'retail', area: 200, adjust: 1 },
  ]);
  assert.equal(d.structure, 'rc');
  assert.equal(d.floors, 7);
  assert.equal(d.footprint, 300);
  assert.equal(d.skip, null);
});

test('층별개요가 없으면 표제부 연면적·주용도 한 줄, 주택·오피스텔 동은 건너뛴다', () => {
  assert.deepEqual(R.toDong({ purpose: '창고시설', totalArea: 900, floors: [] }).rows, [{ use: 'warehouse', area: 900, adjust: 1 }]);
  assert.match(R.toDong({ purpose: '공동주택', totalArea: 900 }).skip, /주택/);
  assert.match(R.toDong({ purpose: '업무시설', purposeDetail: '오피스텔', totalArea: 900 }).skip, /오피스텔/);
  const unknown = R.toDong({ structure: '기타구조', purpose: '업무시설', totalArea: 100 });
  assert.equal(unknown.structure, 'rc');
  assert.equal(unknown.notes.length, 1);
});

test('여러 동: 동마다 소방분 누진·배수를 따로 매긴다(한 동으로 합치면 다르다)', () => {
  const dong = (name, floors, area) => ({ name, structure: 'rc', builtYear: 2010, floors, fire: 'auto', rows: [{ use: 'office', area, adjust: 1 }] });
  const parcel = {
    id: 'm', price: 5000000, area: 3000, cls: 'sep', sgg: '11680', urban: true,
    bld: { mode: 'estimate', rate: 'general', fire: 'auto', rows: [], dongs: [dong('A동', 12, 20000), dong('B동', 2, 500)] },
  };
  const r = C.buildingFor(parcel);
  assert.equal(r.error, null);
  assert.equal(r.dongs.length, 2);
  assert.equal(r.dongs[0].fire.fire, 3);
  assert.equal(r.dongs[1].fire.fire, 1);
  assert.equal(r.value, r.dongs[0].value + r.dongs[1].value);
  const each = B.calc({ bldInput: 'value', units: r.dongs.map(d => ({ amount: d.value, rate: 'general', fire: d.fire.fire })) }, { urban: true });
  assert.equal(r.tax.fire, each.fire);
  const merged = B.calc({ bldInput: 'value', units: [{ amount: r.value, rate: 'general', fire: 3 }] }, { urban: true });
  assert.ok(merged.fire > r.tax.fire);
});

test('중계 서버: PNU → 대장 조회 키 (산 필지는 platGbCd 1)', async () => {
  const { pnuParts } = await relay();
  assert.deepEqual(pnuParts('1168010100108250002'), { sigunguCd: '11680', bjdongCd: '10100', platGbCd: '0', bun: '0825', ji: '0002' });
  assert.equal(pnuParts('1168010100208250002').platGbCd, '1');
  assert.equal(pnuParts('123'), null);
});

test('중계 서버: 응답 항목 1건·0건·오류 코드 처리와 동별 층 묶기', async () => {
  const { itemsOf, normalize } = await relay();
  const wrap = item => ({ response: { header: { resultCode: '00' }, body: { items: item === undefined ? '' : { item } } } });
  assert.deepEqual(itemsOf(wrap({ a: 1 })), [{ a: 1 }]);
  assert.deepEqual(itemsOf(wrap()), []);
  assert.throws(() => itemsOf({ response: { header: { resultCode: '30' } } }), /30/);
  const list = normalize(
    [{ mgmBldrgstPk: 'P1', dongNm: '본관', mainAtchGbCdNm: '주건축물', strctCdNm: '철근콘크리트구조', mainPurpsCdNm: '업무시설', grndFlrCnt: '5', totArea: '1000.5', archArea: '200', useAprDay: '20080315' },
      { mgmBldrgstPk: 'P2', bldNm: '창고', mainAtchGbCdNm: '부속건축물', mainPurpsCdNm: '창고시설', totArea: '90', useAprDay: '' }],
    [{ mgmBldrgstPk: 'P1', flrGbCdNm: '지상', flrNo: '1', mainPurpsCdNm: '제1종근린생활시설', area: '200' },
      { mgmBldrgstPk: 'P1', flrGbCdNm: '지하', flrNo: '1', mainPurpsCdNm: '주차장', area: '-5' }],
  );
  assert.equal(list.length, 2);
  assert.equal(list[0].name, '본관');
  assert.equal(list[0].builtYear, 2008);
  assert.equal(list[0].floorsAbove, 5);
  assert.equal(list[0].floors.length, 2);
  assert.equal(list[0].floors[1].under, true);
  assert.equal(list[0].floors[1].area, 0);
  assert.equal(list[1].main, false);
  assert.equal(list[1].builtYear, 0);
  assert.deepEqual(list[1].floors, []);
});

test('저장·공유 링크: 여러 동이 유지되고, 이상한 동 값은 정리된다', () => {
  const vm = require('node:vm');
  const fs = require('node:fs');
  const win = { BuildingTax: B, BuildingValue: require('../js/valuation.js'), HTMRelief: require('../js/relief.js'), HTM: {} };
  const ctx = { window: win, localStorage: { getItem: () => null, setItem() {} }, TextEncoder, TextDecoder, btoa, atob, Uint8Array, Math, Number, Object, Array, JSON, String };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'state.js'), 'utf8'), ctx);
  const S = win.HTM.state;
  const good = { name: 'A동', structure: 'src', builtYear: 2009, floors: 12, fire: 3, rows: [{ use: 'office', area: 1000, adjust: 1 }] };
  const bad = { name: { x: 1 }, structure: '__proto__', builtYear: -5, floors: 'x', fire: 9, rows: Array.from({ length: 50 }, () => ({ use: 'constructor', area: 1 })) };
  const st = S.clean({ parcels: [{ id: 'x', price: 1, area: 1, bld: { mode: 'estimate', dongs: [good, bad] } }] });
  const back = S.decode(S.encode(st)).parcels[0].bld.dongs;
  assert.equal(back.length, 2);
  assert.equal(back[0].name, 'A동');
  assert.equal(back[0].structure, 'src');
  assert.equal(back[0].fire, 3);
  assert.equal(back[1].name, '건물');
  assert.equal(back[1].structure, 'rc');
  assert.equal(back[1].fire, 'auto');
  assert.equal(back[1].rows.length, S.MAX_ROWS);
  assert.ok(back[1].rows.every(r => r.use === 'office'));
  const many = S.clean({ parcels: [{ id: 'y', price: 1, area: 1, bld: { dongs: Array.from({ length: 99 }, () => good) } }] });
  assert.equal(many.parcels[0].bld.dongs.length, S.MAX_DONGS);
});
