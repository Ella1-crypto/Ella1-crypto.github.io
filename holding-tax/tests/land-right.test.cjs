/* 대지권등록목록 응답 정리(중계 서버 src/land-right.js) — node --test tests/land-right.test.cjs (합성 수치) */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = () => import(pathToFileURL(path.join(__dirname, '..', '..', '_workers', 'holding-tax-api', 'src', 'land-right.js')).href);

test('대지권비율 "분자/분모" → 지분(%)', async () => {
  const { parseRate } = await load();
  assert.deepEqual(parseRate('7/4000'), { num: 7, den: 4000, share: 0.175 });
  assert.equal(parseRate('12.5 / 1000').share, 1.25);
  assert.equal(parseRate('5000/4000'), null); // 분자가 분모보다 크면 형식 오류
  assert.equal(parseRate('abc'), null);
});

test('응답 행 정리: "0000" 동은 빈칸, 비율 없는 행은 빼고, 1건이면 객체로 와도 배열', async () => {
  const { rowsOf, landRights } = await load();
  const one = { ldaregVOList: { ldaregVOList: { buldDongNm: '0000', buldFloorNm: '5', buldHoNm: '501', ldaQotaRate: '8/4000' } } };
  assert.equal(rowsOf(one).length, 1);
  assert.equal(rowsOf({ response: { resultCode: 'x' } }), null);
  const list = landRights([
    { buldDongNm: '0000', buldFloorNm: '5', buldHoNm: '501', ldaQotaRate: '8/4000' },
    { buldDongNm: '101', buldFloorNm: '3', buldHoNm: '301', ldaQotaRate: '' },
    { buldDongNm: '102', buldFloorNm: '3', buldHoNm: '301', ldaQotaRate: '20/4000' },
  ]);
  assert.deepEqual(list.map(x => [x.dong, x.ho, x.share]), [['', '501', 0.2], ['102', '301', 0.5]]);
});

test('호 찾기: "102동"/"102", "301호"/"301" 표기 차이를 무시하고 동까지 맞춘다', async () => {
  const { landRights, findRight } = await load();
  const list = landRights([
    { buldDongNm: '101', buldHoNm: '301', ldaQotaRate: '10/4000' },
    { buldDongNm: '102', buldHoNm: '301', ldaQotaRate: '20/4000' },
    { buldDongNm: '0000', buldHoNm: '501', ldaQotaRate: '8/4000' },
  ]);
  assert.equal(findRight(list, '102동', '301호').share, 0.5);
  assert.equal(findRight(list, '', '501').share, 0.2);
  assert.equal(findRight(list, '103', '301'), null);
});
