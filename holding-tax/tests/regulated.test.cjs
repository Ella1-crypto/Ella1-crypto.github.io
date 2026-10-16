/* 조정대상지역 판정 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../js/regulated.js');

test('서울: 강남 4구는 계속, 나머지 21개 구는 2023.1.5. 해제 후 2025.10.16. 재지정', () => {
  assert.equal(R.check('서울특별시 강남구 역삼동 825', '2024-03-01').status, 'yes');
  assert.equal(R.check('서울 마포구 합정동', '2024-03-01').status, 'no');
  assert.equal(R.check('서울 마포구 합정동', '2022-06-01').status, 'yes');
  assert.equal(R.check('서울 마포구 합정동', '2025-10-16').status, 'yes');
  assert.equal(R.check('서울시 중구 명동', '2026-01-01').status, 'yes');
  assert.equal(R.check('서울', '2026-01-01').status, 'unknown');
});

test('경기: 12곳은 2025.10.16., 3곳은 2026.7.1.부터 / 그 밖은 아님', () => {
  assert.equal(R.check('경기도 성남시 분당구 정자동', '2025-12-01').status, 'yes');
  assert.equal(R.check('경기 과천시 별양동', '2025-12-01').status, 'yes');
  assert.equal(R.check('경기도 용인시 기흥구 구갈동', '2026-06-30').status, 'no');
  assert.equal(R.check('경기도 용인시 기흥구 구갈동', '2026-07-01').status, 'yes');
  assert.equal(R.check('경기도 용인시 처인구', '2026-08-01').status, 'no');
  assert.equal(R.check('경기도 구리시 인창동', '2026-08-01').status, 'yes');
  assert.equal(R.check('부산광역시 해운대구', '2026-08-01').status, 'no');
});

test('구 없는 일부 지정 시·시도 없는 주소는 확인 필요, 성남은 시만으로 지정', () => {
  assert.equal(R.check('경기도 수원시 정자동', '2026-08-01').status, 'unknown');
  assert.equal(R.check('경기도 화성시 반송동 1', '2026-08-01').status, 'unknown');
  assert.equal(R.check('경기도 수원시 권선구', '2026-08-01').status, 'no');
  assert.equal(R.check('경기도 성남시 정자동', '2026-08-01').status, 'yes');
  assert.equal(R.check('정자동 123', '2026-08-01').status, 'unknown');
  assert.equal(R.check('경기도 고양시 일산동구', '2026-08-01').status, 'no');
});

test('2023년 이전 서울 밖은 확인 필요, 2016.11.3. 이전은 아님', () => {
  assert.equal(R.check('경기도 수원시 영통구', '2021-05-01').status, 'unknown');
  assert.equal(R.check('서울 강남구', '2015-01-01').status, 'no');
  assert.equal(R.check('서울 강남구', '').status, 'unknown');
});
