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
  // 실제 대장 층별개요 형태: 주용도는 세부 명칭, 기타용도에 분류·실제 쓰임
  assert.equal(R.useKey('기타일반업무시설', '주차장'), 'parking');
  assert.equal(R.useKey('소매점', '제1종근린생활시설(소매점)'), 'retail');
  assert.equal(R.useKey('기타일반업무시설', '기계실, 전기실, 휀룸'), 'office');
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

test('1층 상가는 따로 떼고 층수에 따라 가감산율(5층 미만 1.17, 5~10층 1.27)을 채운다', () => {
  const floors = [
    { under: false, no: 1, purpose: '소매점', purposeDetail: '제1종근린생활시설(소매점)', area: 300 },
    { under: false, no: 2, purpose: '소매점', purposeDetail: '제1종근린생활시설(소매점)', area: 300 },
    { under: true, no: 1, purpose: '일반음식점', purposeDetail: '제2종근린생활시설', area: 200 },
    { under: false, no: 3, purpose: '사무소', purposeDetail: '업무시설', area: 900 },
  ];
  const seven = R.toDong({ purpose: '업무시설', floorsAbove: 7, totalArea: 1700, floors });
  assert.deepEqual(seven.rows[0], { use: 'retail', area: 300, adjust: 1.27, memo: '1층 상가' });
  assert.deepEqual(seven.rows.slice(1).map(r => [r.use, r.area, r.adjust]), [['office', 900, 1], ['retail', 500, 1]]);
  assert.equal(R.toDong({ purpose: '업무시설', floorsAbove: 3, totalArea: 1700, floors }).rows[0].adjust, 1.17);
  const tall = R.toDong({ purpose: '업무시설', floorsAbove: 15, totalArea: 1700, floors });
  assert.equal(tall.rows[0].adjust, 1);
  assert.match(tall.notes.join(), /11층 이상/);
});

test('집합건축물 호: 전유+공용 면적, 1층 상가 가감산, 층수는 표제부(1동) 기준', () => {
  const title = { structure: '철근콘크리트구조', builtYear: 2015, floorsAbove: 8 };
  const shop = R.toUnit({ dong: '', ho: '101', under: false, floor: 1, purpose: '소매점', detail: '제1종근린생활시설', excl: 40.5, common: 20.25 }, title);
  assert.equal(shop.name, '101호');
  assert.deepEqual(shop.rows, [{ use: 'retail', area: 60.75, adjust: 1.27, memo: '1층 상가' }]);
  assert.equal(shop.floors, 8);
  assert.equal(shop.structure, 'rc');
  const office = R.toUnit({ dong: 'A동', ho: '702호', under: false, floor: 7, purpose: '사무소', detail: '업무시설', excl: 100, common: 30 }, title);
  assert.equal(office.name, 'A동 702호');
  assert.deepEqual(office.rows, [{ use: 'office', area: 130, adjust: 1 }]);
  assert.match(R.toUnit({ ho: '1', purpose: '업무시설', detail: '오피스텔', excl: 30 }, title).skip, /오피스텔/);
});

test('여러 호: 호마다 소방분 누진을 따로 한다(시행규칙 §75③ 각 구별)', () => {
  const title = { structure: '철근콘크리트구조', builtYear: 2015, floorsAbove: 8 };
  const units = [701, 702, 703].map(n => R.toUnit({ ho: String(n), floor: 7, purpose: '사무소', detail: '업무시설', excl: 300, common: 100 }, title));
  const parcel = { id: 'u', price: 5000000, area: 1000, cls: 'sep', sgg: '11680', urban: true, bld: { mode: 'estimate', rate: 'general', rows: [], dongs: units } };
  const r = C.buildingFor(parcel);
  assert.equal(r.error, null);
  assert.ok(r.dongs.every(d => d.fire.fire === 2)); // 4~10층 비주거
  const each = r.dongs.reduce((t, d) => t + B.calc({ bldInput: 'value', units: [{ amount: d.value, rate: 'general', fire: 2 }] }, { urban: true }).fire, 0);
  assert.equal(r.tax.fire, each);
});

test('중계 서버: 전유공용면적 → 호별 합계(공용 더하기, 복층은 낮은 지상층)', async () => {
  const { unitsOf } = await relay();
  const list = unitsOf([
    { dongNm: '', hoNm: '101', exposPubuseGbCdNm: '전유', flrGbCdNm: '지상', flrNo: '1', mainPurpsCdNm: '소매점', etcPurps: '근린생활시설', area: '40.5' },
    { dongNm: '', hoNm: '101', exposPubuseGbCdNm: '공용', flrGbCdNm: '지상', flrNo: '1', mainPurpsCdNm: '계단실', area: '12.1' },
    { dongNm: '', hoNm: '101', exposPubuseGbCdNm: '공용', flrGbCdNm: '지하', flrNo: '1', mainPurpsCdNm: '주차장', area: '8.15' },
    { dongNm: '', hoNm: '201', exposPubuseGbCdNm: '전유', flrGbCdNm: '지상', flrNo: '3', mainPurpsCdNm: '사무소', area: '50' },
    { dongNm: '', hoNm: '201', exposPubuseGbCdNm: '전유', flrGbCdNm: '지상', flrNo: '2', mainPurpsCdNm: '사무소', area: '50' },
    { dongNm: '', hoNm: '999', exposPubuseGbCdNm: '공용', area: '5' },
  ]);
  assert.deepEqual(list.map(u => [u.ho, u.floor, u.excl, u.common]), [['101', 1, 40.5, 20.25], ['201', 2, 100, 0]]);
});

test('표제부 동 → 호 조회용 원래 동 이름과 원자료(구조·연도·층수)를 남긴다', () => {
  const d = R.toDong({ name: '본관', dong: '', regKind: '집합건축물', structure: '철근콘크리트구조', purpose: '업무시설', builtYear: 2015, floorsAbove: 8, totalArea: 900, floors: [] });
  assert.equal(d.collective, true);
  assert.equal(d.rawDong, '');
  assert.deepEqual(d.raw, { structure: '철근콘크리트구조', builtYear: 2015, floorsAbove: 8, archArea: 0 });
  assert.equal(R.toUnit({ ho: '301', floor: 3, purpose: '사무소', excl: 10 }, d.raw).floors, 8);
});

test('집합건축물 판별: 대장구분 집합, 또는 종류명 표제부(예전 응답)', () => {
  assert.equal(R.toDong({ regKind: '집합', purpose: '업무시설', totalArea: 1 }).collective, true);
  assert.equal(R.toDong({ regKind: '표제부', purpose: '업무시설', totalArea: 1 }).collective, true);
  assert.equal(R.toDong({ regKind: '일반건축물', purpose: '업무시설', totalArea: 1 }).collective, false);
  assert.equal(R.toDong({ regKind: '일반', purpose: '업무시설', totalArea: 1 }).collective, false);
});
