/* 엑셀(.xlsx) 내보내기 — 요약 · 월별 CF · 연도별 CF · 계산 근거.
 * ExcelJS는 버튼을 누를 때만 불러온다(무결성 해시 검증). 연도별 시트의 합계는 월별 CF를 SUMIFS로 다시 더하는 수식이라
 * 사용자가 월별 금액을 고치면 연도 합계도 따라 바뀐다.
 */
(function () {
  'use strict';
  const LIB = 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js';
  const SRI = 'sha512-dlPw+ytv/6JyepmelABrgeYgHI0O+frEwgfnPdXDTOIZz+eDgfW07QXG02/O8COfivBdGNINy+Vex+lYmJ5rxw==';
  const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const WON = '#,##0;[Red]-#,##0;"-"';
  const FONT = { name: '맑은 고딕', size: 10 };
  const NAVY = 'FF1F3A5F';
  const KIND = Object.freeze({ bld: '건축물분', land: '토지분', house: '주택분', cmt: '종부세·농특세' });

  let loading = null;
  function loadLib() {
    if (window.ExcelJS) return Promise.resolve();
    if (!loading) {
      loading = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = LIB;
        s.integrity = SRI;
        s.crossOrigin = 'anonymous';
        s.referrerPolicy = 'no-referrer';
        s.onload = () => (window.ExcelJS ? resolve() : reject(new Error('엑셀 모듈 초기화 실패')));
        s.onerror = () => { loading = null; reject(new Error('엑셀 모듈을 불러오지 못했습니다. 네트워크를 확인하세요.')); };
        document.head.appendChild(s);
      });
    }
    return loading;
  }

  const fill = argb => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
  function header(ws, cols) {
    ws.columns = cols.map(c => ({ header: c.h, key: c.k, width: c.w }));
    const row = ws.getRow(1);
    row.font = { ...FONT, bold: true, color: { argb: 'FFFFFFFF' } };
    row.fill = fill(NAVY);
    row.alignment = { vertical: 'middle' };
    row.height = 20;
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  }
  const styleBody = ws => ws.eachRow((r, i) => { if (i > 1) r.font = { ...FONT, ...(r.font && r.font.bold ? { bold: true } : {}) }; });

  function summarySheet(wb, d) {
    const ws = wb.addWorksheet('요약');
    ws.columns = [{ width: 34 }, { width: 22 }, { width: 50 }];
    ws.addRow([d.title]).font = { ...FONT, size: 14, bold: true };
    ws.addRow([`기준: ${d.modeLabel}`, '', `작성: ${new Date().toLocaleString('ko-KR')} · 보유세맵(ella1-crypto.github.io/holding-tax)`]).font = { ...FONT, color: { argb: 'FF68737F' } };
    ws.addRow([]);
    ws.addRow(['항목', '금액(원)', '비고']).font = { ...FONT, bold: true };
    for (const [label, value, note] of d.summary) {
      const r = ws.addRow([label, value, note || '']);
      r.getCell(2).numFmt = WON;
    }
    ws.addRow([]);
    ws.addRow(['입력값']).font = { ...FONT, bold: true };
    for (const [label, value] of d.inputs) ws.addRow([label, value]);
    ws.addRow([]);
    ws.addRow(['본 자료는 입력값과 공개된 기준에 따른 추정치이며 세무 자문이 아닙니다. 실제 부과세액은 과세구분·감면·조례·전년도 과세내역에 따라 달라질 수 있습니다.']).font = { ...FONT, italic: true, color: { argb: 'FF68737F' } };
  }

  function monthlySheet(wb, cf) {
    const ws = wb.addWorksheet('월별 CF');
    header(ws, [
      { h: '납부연월', k: 'ym', w: 11 }, { h: '납부연도', k: 'year', w: 9 }, { h: '과세연도', k: 'taxYear', w: 9 },
      { h: '구분', k: 'kind', w: 13 }, { h: '내역', k: 'label', w: 46 }, { h: '납기', k: 'due', w: 16 },
      { h: '분할·분납', k: 'deferred', w: 10 }, { h: '금액(원)', k: 'amount', w: 15 }, { h: '누적(원)', k: 'cum', w: 16 },
    ]);
    const sorted = [...cf.entries].sort((a, b) => (a.ym < b.ym ? -1 : a.ym > b.ym ? 1 : 0));
    let cum = 0;
    sorted.forEach((e, i) => {
      cum += e.amount;
      const n = i + 2;
      const r = ws.addRow({ ym: e.ym, year: e.year, taxYear: e.taxYear, kind: KIND[e.kind] || e.kind, label: e.label, due: e.due, deferred: e.deferred ? '예' : '', amount: e.amount });
      // 수식 + 계산값(result)을 함께 넣어 미리보기 뷰어에서도 숫자가 보이게 한다
      r.getCell('cum').value = { formula: n === 2 ? `H${n}` : `I${n - 1}+H${n}`, result: cum };
      r.getCell('amount').numFmt = WON;
      r.getCell('cum').numFmt = WON;
    });
    const last = sorted.length + 1;
    const t = ws.addRow({ label: '합계', amount: { formula: `SUM(H2:H${last})`, result: cum } });
    t.font = { ...FONT, bold: true };
    t.getCell('amount').numFmt = WON;
    styleBody(ws);
    return last;
  }

  function yearlySheet(wb, cf, last) {
    const ws = wb.addWorksheet('연도별 CF');
    const kinds = Object.keys(KIND).filter(k => cf.entries.some(e => e.kind === k));
    header(ws, [{ h: '과세연도', k: 'y', w: 10 }, ...kinds.map(k => ({ h: KIND[k], k, w: 15 })), { h: '합계', k: 'total', w: 16 }]);
    const range = c => `'월별 CF'!$${c}$2:$${c}$${last}`;
    cf.byTaxYear.forEach((y, i) => {
      const n = i + 2;
      const row = { y: y.year };
      kinds.forEach(k => { row[k] = { formula: `SUMIFS(${range('H')},${range('C')},$A${n},${range('D')},"${KIND[k]}")`, result: y[k] }; });
      const r = ws.addRow(row);
      const lastCol = String.fromCharCode(65 + kinds.length);
      r.getCell('total').value = { formula: `SUM(B${n}:${lastCol}${n})`, result: y.total };
      r.eachCell((c, col) => { if (col > 1) c.numFmt = WON; });
    });
    ws.addRow([]);
    const hr = ws.addRow(['납부연도', '현금 유출', '누적']);
    hr.font = { ...FONT, bold: true };
    const start = ws.rowCount + 1;
    cf.byCashYear.forEach((y, i) => {
      const n = start + i;
      const r = ws.addRow([y.year, { formula: `SUMIFS(${range('H')},${range('B')},A${n})`, result: y.cash }, { formula: i === 0 ? `B${n}` : `C${n - 1}+B${n}`, result: y.cumulative }]);
      r.getCell(2).numFmt = WON;
      r.getCell(3).numFmt = WON;
    });
    styleBody(ws);
  }

  function basisSheet(wb, basis) {
    const ws = wb.addWorksheet('계산 근거');
    header(ws, [{ h: '항목', k: 'item', w: 26 }, { h: '기준', k: 'rule', w: 80 }, { h: '근거', k: 'law', w: 40 }]);
    basis.forEach(b => { ws.addRow(b).alignment = { wrapText: true, vertical: 'top' }; });
    styleBody(ws);
  }

  /**
   * @param {{fileName:string, title:string, modeLabel:string, summary:Array, inputs:Array, cf:object, basis:Array}} d
   */
  async function download(d) {
    await loadLib();
    const wb = new window.ExcelJS.Workbook();
    wb.creator = '보유세맵';
    wb.created = new Date();
    summarySheet(wb, d);
    const last = monthlySheet(wb, d.cf);
    yearlySheet(wb, d.cf, last);
    basisSheet(wb, d.basis);
    const buf = await wb.xlsx.writeBuffer();
    const url = URL.createObjectURL(new Blob([buf], { type: MIME }));
    const a = document.createElement('a');
    a.href = url;
    a.download = d.fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  window.HTMXlsx = Object.freeze({ download, KIND });
})();
