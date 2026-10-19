/* 주택 화면 지도 — 필지 → 주택 입력값 변환 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../js/house-parcel.js');

const GANGNAM = {
  pnu: '1168010100108250002', addr: '서울특별시 강남구 역삼동 825-2', jibun: '825-2', jimok: '대',
  price: 72000000, priceYear: 2026, area: 512.3, areaSource: 'register', sgg: '11680', sggName: '서울특별시 강남구', zone: '상업지역',
};
const AT = { lat: 37.4979, lng: 127.0276 };
const EXAMPLE = { name: '예시 아파트', price: 1.5e9 };
const house = extra => ({ id: 'h1', name: '', price: 0, share: 100, urban: true, region: 'metro', kind: 'none', ...extra });

test('isMetro: 서울·인천·경기만 수도권, 주소가 없으면 null', () => {
  assert.equal(P.isMetro('서울특별시 강남구'), true);
  assert.equal(P.isMetro('인천광역시 연수구'), true);
  assert.equal(P.isMetro('경기도 성남시 분당구'), true);
  assert.equal(P.isMetro('부산광역시 해운대구'), false);
  assert.equal(P.isMetro('충청남도 천안시 동남구'), false);
  assert.equal(P.isMetro(''), null);
});

test('isUrbanZone: 도시지역(주거·상업·공업·녹지)만 true, 관리·농림·자연환경보전은 false, 모르면 null', () => {
  assert.equal(P.isUrbanZone('제2종일반주거지역'), true);
  assert.equal(P.isUrbanZone('자연녹지지역'), true);
  assert.equal(P.isUrbanZone('계획관리지역'), false);
  assert.equal(P.isUrbanZone('농림지역'), false);
  assert.equal(P.isUrbanZone('자연환경보전지역'), false);
  assert.equal(P.isUrbanZone(''), null);
});

test('shortLabel: 시·군·구를 뗀 동·지번, 시·군·구가 앞에 없으면 주소 그대로', () => {
  assert.equal(P.shortLabel('서울특별시 강남구 역삼동 825-2', '서울특별시 강남구'), '역삼동 825-2');
  assert.equal(P.shortLabel('경기도 성남시 분당구 정자동 1', '경기도 성남시 분당구'), '정자동 1');
  assert.equal(P.shortLabel('역삼동 825-2', '서울특별시 강남구'), '역삼동 825-2');
  assert.equal(P.shortLabel('', ''), '');
});

test('fromParcel: 주소·시군구·대지 면적·공시지가·좌표와 수도권·도시지역 판정', () => {
  const f = P.fromParcel(GANGNAM, AT);
  assert.equal(f.addr, GANGNAM.addr);
  assert.equal(f.pnu, GANGNAM.pnu);
  assert.equal(f.sggName, '서울특별시 강남구');
  assert.equal(f.landArea, 512.3);
  assert.equal(f.landAreaApprox, false);
  assert.equal(f.landPrice, 72000000);
  assert.equal(f.landYear, 2026);
  assert.equal(f.region, 'metro');
  assert.equal(f.urban, true);
  assert.equal(f.lat, AT.lat);
  assert.equal(f.lng, AT.lng);
  assert.equal('price' in f, false, '주택 공시가격은 필지에서 채우지 않는다');
});

test('fromParcel: 경계 도형 면적은 근사로 표시, 수도권 밖·용도지역 미상 판정', () => {
  const f = P.fromParcel({ addr: '충청남도 천안시 동남구 목천읍 1', sggName: '충청남도 천안시 동남구', area: 300.04, areaSource: 'polygon', price: 50000 }, AT);
  assert.equal(f.landAreaApprox, true);
  assert.equal(f.landArea, 300);
  assert.equal(f.region, 'local');
  assert.equal(f.urban, null);
  assert.equal(f.landYear, 0);
});

test('applyParcel: 빈 주택은 이름을 주소로, 예시 주택은 예시 공시가격까지 비운다', () => {
  const f = P.fromParcel(GANGNAM, AT);
  const blank = house({ price: 9e8 });
  const a = P.applyParcel(blank, f, EXAMPLE);
  assert.equal(a.name, '역삼동 825-2');
  assert.equal(a.price, 9e8, '사용자가 넣은 공시가격은 그대로');
  assert.equal(blank.name, '', '원본은 바뀌지 않는다');

  const b = P.applyParcel(house({ name: '예시 아파트', price: 1.5e9 }), f, EXAMPLE);
  assert.equal(b.name, '역삼동 825-2');
  assert.equal(b.price, 0);

  const c = P.applyParcel(house({ name: '예시 아파트', price: 2e9 }), f, EXAMPLE);
  assert.equal(c.price, 2e9, '예시 이름이어도 고친 공시가격은 남긴다');
});

test('applyParcel: 사용자가 붙인 이름 유지, 판정 못 한 소재지·도시지역분은 기존 선택 유지', () => {
  const f = P.fromParcel({ addr: '', area: 100, price: 1000 }, null);
  const h = P.applyParcel(house({ name: '우리 집', region: 'local', urban: false }), f, EXAMPLE);
  assert.equal(h.name, '우리 집');
  assert.equal(h.region, 'local');
  assert.equal(h.urban, false);
  assert.equal(h.lat, null);

  const g = P.applyParcel(house({ region: 'local', urban: true }), P.fromParcel({ ...GANGNAM, zone: '계획관리지역' }, AT), EXAMPLE);
  assert.equal(g.region, 'metro');
  assert.equal(g.urban, false);
});

test('cleanLoc: 공유 링크의 잘못된 값은 버린다', () => {
  const c = P.cleanLoc({ addr: 1, pnu: '123', landArea: -5, landPrice: 'x', landYear: 1800, lat: 51.5, lng: -0.1, landAreaApprox: 'yes' });
  assert.deepEqual(c, P.EMPTY_LOC);
  assert.equal(P.cleanLoc({ landArea: 1e12 }).landArea, 1e8);
  assert.equal(P.cleanLoc({ addr: 'a'.repeat(200) }).addr.length, 80);
  assert.equal(P.cleanLoc(null).pnu, '');
});

test('landValue: 대지 면적 × 개별공시지가', () => {
  assert.equal(P.landValue({ landArea: 512.3, landPrice: 72000000 }), 36885600000);
  assert.equal(P.landValue({}), 0);
});

test('applyParcel: 이름이 예전 주소에서 자동으로 만든 것이면 새 주소로 바뀌고, 직접 쓴 이름은 그대로', () => {
  const first = P.applyParcel(house({}), P.fromParcel(GANGNAM, AT), EXAMPLE);
  const other = { ...GANGNAM, addr: '서울특별시 용산구 용산동2가 34-7', pnu: '1117012500100340007', sggName: '서울특별시 용산구' };
  const moved = P.applyParcel(first, P.fromParcel(other, AT), EXAMPLE);
  assert.equal(moved.name, P.shortLabel(other.addr, other.sggName));
  assert.notEqual(moved.name, first.name);
  const typed = P.applyParcel({ ...first, name: '우리집' }, P.fromParcel(other, AT), EXAMPLE);
  assert.equal(typed.name, '우리집');
});
