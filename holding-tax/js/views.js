/* 화면 조각 렌더링 — 문자열 HTML. 외부·사용자 문자열은 반드시 esc()를 거친다. */
(function (ns) {
  'use strict';
  const HT = window.HoldingTax;
  const BV = window.BuildingValue;
  const BT = window.BuildingTax;
  const RL = window.HTMRelief;

  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const won = n => Math.round(Number(n) || 0).toLocaleString('ko-KR');
  const fmt = n => (Number(n) > 0 ? Number(n).toLocaleString('ko-KR', { maximumFractionDigits: 2 }) : '');
  const eok = n => {
    const v = Number(n) || 0;
    if (v >= 1e8) return `${(v / 1e8).toLocaleString('ko-KR', { maximumFractionDigits: 2 })}억원`;
    if (v >= 1e4) return `${Math.round(v / 1e4).toLocaleString('ko-KR')}만원`;
    return `${won(v)}원`;
  };
  const opt = (value, label, current) => `<option value="${esc(value)}"${String(value) === String(current) ? ' selected' : ''}>${esc(label)}</option>`;

  const ZONES = ['', '주거지역', '상업지역', '공업지역', '녹지지역', '관리지역', '농림지역', '자연환경보전지역'];
  const CLS_HELP = Object.freeze({
    sep: '건물이 있는 토지(상가·사무실·공장 부속토지 등) — 기준면적 이내',
    jong: '나대지·잡종지, 기준면적 초과 부속토지 등',
    b007: '자경 농지·목장용지·보전 임야',
    b02: '공업지역·산단 공장용지 등',
    b4: '골프장·고급오락장 토지',
  });

  function field(label, inner, hint) {
    return `<label class="fld"><span class="fld-l">${label}</span>${inner}${hint ? `<span class="fld-h">${hint}</span>` : ''}</label>`;
  }
  const numInput = (pid, f, value, unit, extra = '') =>
    `<span class="num"><input type="text" inputmode="decimal" data-pid="${esc(pid)}" data-f="${f}" value="${esc(fmt(value))}" ${extra}><em>${unit}</em></span>`;

  function buildingRows(p) {
    const b = p.bld;
    return b.rows.map((r, i) => `
      <div class="brow">
        ${field('용도', `<select data-pid="${esc(p.id)}" data-f="row.use" data-i="${i}">${Object.entries(BV.USE).map(([k, u]) => opt(k, `${u.label} (${u.index.toFixed(2)})`, r.use)).join('')}</select>`)}
        ${field('면적', numInput(p.id, 'row.area', r.area, '㎡', `data-i="${i}"`))}
        ${field('가감산율', numInput(p.id, 'row.adjust', r.adjust, '배', `data-i="${i}"`), '1층 상가 +0.17 등')}
        ${b.rows.length > 1 ? `<button type="button" class="icon-btn" data-act="row-del" data-pid="${esc(p.id)}" data-i="${i}" aria-label="${i + 1}번째 용도 삭제">×</button>` : ''}
      </div>`).join('');
  }

  function buildingPanel(p, bres) {
    if (!p.bld) {
      return `<button type="button" class="ghost add-bld" data-act="bld-add" data-pid="${esc(p.id)}">＋ 이 땅의 건물(비주거)도 계산</button>`;
    }
    const b = p.bld;
    const est = b.mode === 'estimate';
    const summary = bres && !bres.error
      ? `<p class="bld-sum">시가표준액 <b>${eok(bres.value)}</b> · 소방분 ×${bres.fire.fire} <span class="muted">(${esc(bres.fire.note)})</span></p>
         ${est ? bres.rows.map(r => `<p class="formula">${esc(r.label)}: ${esc(r.est.formula)} = ${won(r.value)}원</p>`).join('') : ''}`
      : `<p class="warn-line">${esc(bres ? bres.error : '')}</p>`;
    return `
    <div class="bld">
      <div class="bld-head">
        <strong>건물분</strong>
        <div class="seg" role="radiogroup" aria-label="건물 가액 입력 방식">
          <button type="button" role="radio" aria-checked="${est}" data-act="bld-mode" data-v="estimate" data-pid="${esc(p.id)}">2026 기준 추정</button>
          <button type="button" role="radio" aria-checked="${!est}" data-act="bld-mode" data-v="direct" data-pid="${esc(p.id)}">시가표준액 직접 입력</button>
        </div>
        <button type="button" class="link-btn" data-act="bld-del" data-pid="${esc(p.id)}">건물 빼기</button>
      </div>
      ${est ? `
      <div class="grid4">
        ${field('구조', `<select data-pid="${esc(p.id)}" data-f="bld.structure">${Object.entries(BV.STRUCTURE).map(([k, s]) => opt(k, `${s.label} (${s.index.toFixed(2)})`, b.structure)).join('')}</select>`)}
        ${field('사용승인연도', `<span class="num"><input type="text" inputmode="numeric" maxlength="4" data-pid="${esc(p.id)}" data-f="bld.builtYear" value="${esc(b.builtYear)}"><em>년</em></span>`)}
        ${field('지상층수', numInput(p.id, 'bld.floors', b.floors, '층'), '소방분 배수 제안')}
        ${field('재산세율', `<select data-pid="${esc(p.id)}" data-f="bld.rate">${Object.entries(BT.RATES).map(([k, r]) => opt(k, r.label, b.rate)).join('')}</select>`)}
      </div>
      ${buildingRows(p)}
      <button type="button" class="ghost sm" data-act="row-add" data-pid="${esc(p.id)}">＋ 용도 구분 추가 (층별 용도가 다를 때)</button>`
    : `<div class="grid4">
        ${field('건축물 시가표준액', numInput(p.id, 'bld.direct', b.direct, '원'), '위택스·고지서의 건축물 시가표준액')}
        ${field('재산세율', `<select data-pid="${esc(p.id)}" data-f="bld.rate">${Object.entries(BT.RATES).map(([k, r]) => opt(k, r.label, b.rate)).join('')}</select>`)}
      </div>`}
      <div class="grid4">
        ${field('건축면적(바닥면적)', numInput(p.id, 'bld.footprint', b.footprint, '㎡'), '별도합산 2%·5% 기준 판정용 (건축물대장)')}
        ${field('작년 건축물 재산세', numInput(p.id, 'bld.prevMain', b.prevMain, '원'), '선택 — 고지서 본세(내 몫), 150% 상한')}
        ${field('작년 소방분', numInput(p.id, 'bld.prevFire', b.prevFire, '원'), '선택 — 지역자원시설세(내 몫), 150% 상한')}
      </div>
      ${field('소방분 배수', `<select data-pid="${esc(p.id)}" data-f="bld.fire">${opt('auto', '자동 제안', b.fire)}${opt(1, '×1 일반', b.fire)}${opt(2, '×2 화재위험(4~10층 등)', b.fire)}${opt(3, '×3 대형 화재위험(11층 이상 등)', b.fire)}</select>`)}
      ${summary}
    </div>`;
  }

  function priceHint(p) {
    if (!(p.price > 0)) return '<a href="https://www.realtyprice.kr" target="_blank" rel="noopener">부동산공시가격알리미</a>에서 확인';
    const stale = p.priceYear && p.priceYear < BV.BASE_YEAR
      ? `<b class="stale">${esc(p.priceYear)}년 값</b> — ${BV.BASE_YEAR}년 공시지가로 고치면 정확합니다. `
      : '';
    return `${stale}공시가격 ${eok(p.price * p.area)}`;
  }

  function reliefPanel(p) {
    const r = p.relief || { key: 'none', region: 'metro' };
    const def = RL.COMMERCIAL[r.key] || RL.COMMERCIAL.none;
    const rule = RL.commercialRule(r.key, r.region, r.custom);
    const pct = rule ? `${Math.round(rule.rate * 1000) / 10}%` : '';
    return `
    <details class="relief"${r.key !== 'none' ? ' open' : ''}>
      <summary>재산세 감면 ${r.key !== 'none' ? `<b>${esc(def.label)} · ${esc(pct)}</b>` : '<span class="muted">— 지식산업센터·산업단지·창업중소기업 등</span>'}</summary>
      <div class="grid4">
        ${field('감면 규정', `<select data-pid="${esc(p.id)}" data-f="relief.key">${Object.entries(RL.COMMERCIAL).map(([k, v]) => opt(k, v.label, r.key)).join('')}</select>`)}
        ${field('소재 지역', `<select data-pid="${esc(p.id)}" data-f="relief.region">${Object.entries(RL.REGIONS).map(([k, v]) => opt(k, v, r.region)).join('')}</select>`, '감면율이 지역별로 다를 때 사용')}
        ${r.key === 'custom' ? field('감면율', numInput(p.id, 'relief.custom', r.custom, '%')) : ''}
        ${r.key !== 'none' ? field('남은 감면 연수', numInput(p.id, 'relief.years', r.years, '년'), '올해 포함 — 비우면 계속 적용(CF·전망)') : ''}
      </div>
      ${rule ? `<p class="law-line"><b>${esc(rule.law)}</b> · ${esc(rule.period)}</p><p class="need-line">요건: ${esc(rule.need)}</p>
        <p class="need-line">재산세 본세${rule.urban ? '·도시지역분' : ''}에 적용하고 지방교육세는 함께 줄어듭니다. 소방분은 감면되지 않습니다.${rule.rate >= 1 ? ' 면제라도 재산세가 50만원을 넘으면 최소납부세제로 85%만 감면됩니다(지특법 §177의2).' : ''}</p>` : ''}
    </details>`;
  }

  function parcelCard(p, i, bres, active) {
    const cls = HT.estimateClass(p.jimok, p.zone, window.HTMApp ? window.HTMApp.ownerType() : '법인');
    const urb = HT.estimateUrban(p.zone);
    const title = p.addr ? `${p.addr}` : `직접 입력한 필지 ${i + 1}`;
    const missing = !p.hasHouse && !(p.price > 0 && p.area > 0);
    return `
    <article class="pcard${active ? ' is-active' : ''}${missing ? ' is-missing' : ''}${p.hasHouse ? ' is-house' : ''}" data-card="${esc(p.id)}">
      <header>
        <span class="pno">${i + 1}</span>
        <div class="ptitle">
          ${p.pnu ? `<h3>${esc(title)}</h3>` : `<input class="addr-in" type="text" maxlength="80" placeholder="주소 또는 메모 (예: 성수동 상가)" aria-label="${i + 1}번 필지 이름" data-pid="${esc(p.id)}" data-f="addr" value="${esc(p.addr)}">`}
          <p>${p.jimok ? `지목 ${esc(p.jimok)}` : '지목 미확인'}${p.priceYear ? ` · ${esc(p.priceYear)}년 공시지가` : ''}${p.pnu ? ' · 지도 조회' : ' · 직접 입력'}</p>
        </div>
        <button type="button" class="icon-btn" data-act="del" data-pid="${esc(p.id)}" aria-label="${i + 1}번 필지 삭제">×</button>
      </header>
      <div class="grid4">
        ${field('내 지분', numInput(p.id, 'share', p.share, '%'), '공유·공동명의면 내 지분')}
        ${field('토지 면적', numInput(p.id, 'area', p.area, '㎡'), p.areaSource === 'polygon' ? '지적도 경계로 추정 — 토지대장 면적으로 고치세요' : p.areaSource === 'register' ? '토지대장 면적(자동)' : '')}
        ${field('개별공시지가', numInput(p.id, 'price', p.price, '원/㎡'), priceHint(p))}
        ${field('용도지역', `<select data-pid="${esc(p.id)}" data-f="zone">${ZONES.map(z => opt(z, z || '선택 안 함', p.zone)).join('')}</select>`, p.zoneName ? esc(p.zoneName) : '')}
        ${field('과세구분', `<select data-pid="${esc(p.id)}" data-f="cls">${HT.CLASS_KEYS.map(k => opt(k, HT.CLASS[k].label, p.cls)).join('')}</select>`,
          esc(p.clsAuto ? `추정: ${cls.note}` : CLS_HELP[p.cls]))}
      </div>
      <label class="chk house-chk"><input type="checkbox" data-pid="${esc(p.id)}" data-f="hasHouse"${p.hasHouse ? ' checked' : ''}> 이 땅에 주택(아파트·빌라·단독주택 등)이 있습니다</label>
      ${p.hasHouse ? `<p class="house-note">주택과 그 부속토지는 토지분이 아니라 <b>주택분</b>(공시가격 60%·주택 세율)으로 과세돼 이 계산에서 뺐습니다. 주택 공시가격으로 <a href="house.html">주택 계산기</a>에서 계산하세요. 상가주택처럼 주택과 상가가 섞여 있으면 주택 부분만 주택 계산기로, 나머지는 이 체크를 풀고 면적을 나눠 넣으세요.</p>` : `
      <label class="chk"><input type="checkbox" data-pid="${esc(p.id)}" data-f="urban"${p.urban ? ' checked' : ''}> 도시지역분(0.14%) 부과 <span class="muted">— ${esc(urb.note)}</span></label>
      ${buildingPanel(p, bres)}
      ${reliefPanel(p)}`}
    </article>`;
  }

  function parcels(state, result, activeId) {
    if (!state.parcels.length) {
      return `<div class="empty">
        <p class="empty-t">아직 담은 필지가 없습니다.</p>
        <p>지도에서 땅을 누르거나, 주소를 검색하거나, <button type="button" class="link-btn" data-act="manual">공시지가를 직접 입력</button>해 시작하세요.</p>
        <button type="button" class="ghost" data-act="demo">예시로 채워 보기 (상가건물 1필지)</button>
      </div>`;
    }
    const byId = new Map(result.buildings.map(b => [b.parcelId, b]));
    return state.parcels.map((p, i) => parcelCard(p, i, byId.get(p.id), p.id === activeId)).join('');
  }

  function warnLines(result) {
    return (result.warnings || []).map(w => `<p class="warn-line">건물 가액이 토지 가액의 ${(w.ratio * 100).toFixed(1)}%로 ${Math.round(w.ratioMin * 100)}% 미만 — ${w.split
      ? `바닥면적 ${w.footprint.toLocaleString('ko-KR')}㎡ 외 토지를 종합합산으로 계산했습니다.`
      : '바닥면적 외 토지가 종합합산될 수 있습니다. 건물 칸에 건축면적을 넣으세요.'}</p>`).join('')
      + (result.mode === '2027reform' ? '<p class="warn-line">정부 개편안(국회 심의 중)의 별도합산 5% 기준을 적용한 미리보기입니다.</p>' : '');
  }

  function summary(result, cfg) {
    const t = result.totals;
    const parts = [
      { k: 'bld', label: '건물분 재산세 등', when: '7월', v: t.building },
      { k: 'land', label: '토지분 재산세 등', when: '9월', v: t.landProp },
      { k: 'cmt', label: '종부세·농특세', when: '12월', v: t.cmt },
    ];
    const total = t.total || 0;
    const bar = total > 0
      ? `<div class="stack" role="img" aria-label="세목 구성">${parts.filter(x => x.v > 0).map(x => `<span class="seg-${x.k}" style="flex:${x.v}"></span>`).join('')}</div>`
      : '';
    const ctas = [
      cfg.CONSULT_URL ? `<a class="btn primary" href="${esc(cfg.CONSULT_URL)}" target="_blank" rel="noopener" data-track="consult">${esc(cfg.CONSULT_LABEL)}</a>` : '',
      cfg.PRO_URL ? `<a class="btn" href="${esc(cfg.PRO_URL)}" target="_blank" rel="noopener" data-track="pro">${esc(cfg.PRO_LABEL)}</a>` : '',
    ].join('');
    return `
      <p class="eyebrow">${result.mode === '2027reform' ? '2027년 개편안 미리보기' : '2026년'} 예상 보유세 (연간)</p>
      <p class="total" aria-live="polite"><span>${won(total)}</span>원</p>
      <p class="total-sub">${total > 0 ? `약 ${eok(total)} · 월 평균 ${eok(total / 12)}` : '필지를 담으면 바로 계산됩니다'}</p>
      ${bar}
      <ul class="parts">${parts.map(x => `<li><i class="dot seg-${x.k}"></i><span>${x.label}<small>${x.when} 납부</small></span><b>${won(x.v)}</b></li>`).join('')}</ul>
      ${result.totals.relief > 0 ? `<p class="relief-line">감면 적용 −${won(result.totals.relief)}원 (계산 근거에 조문별 표시)</p>` : ''}
      ${warnLines(result)}
      ${result.housing ? `<p class="warn-line">주택이 있는 필지 ${result.housing}건은 주택분이라 합계에서 뺐습니다 — <a href="house.html">주택 계산기</a></p>` : ''}
      ${result.missing ? `<p class="warn-line">공시지가·면적이 비어 있는 필지 ${result.missing}건은 합계에서 빠졌습니다.</p>` : ''}
      <div class="actions">
        <button type="button" class="btn" data-act="share">링크 복사</button>
        <button type="button" class="btn" data-act="print">PDF 보고서</button>
        <button type="button" class="btn" data-act="save">계산 기록 저장</button>
        <button type="button" class="btn" data-act="history">기록 보기</button>
      </div>
      ${ctas ? `<div class="cta">${ctas}</div>` : ''}
      <p class="fine">간편 추정치입니다. 감면·조례 세율·전년도 세부담상한·과세구분 판정에 따라 실제 고지액과 다를 수 있습니다.</p>`;
  }

  function landDetail(land) {
    if (!land) return '<p class="muted">계산할 토지가 없습니다.</p>';
    const rows = land.regions.map(r => `
      <tr><th>${esc(r.sggName)}</th>
        <td>${won(r.sepBase)}</td><td>${won(r.sepTax)}</td>
        <td>${won(r.jongBase)}</td><td>${won(r.jongTax)}</td>
        <td>${won(r.bunriBase)}</td><td>${won(r.bunriTax)}</td><td>${won(r.urban)}</td></tr>`).join('');
    const c = land.cmt;
    const cmtRow = (name, x) => `<tr><th>${name}</th><td>${won(x.value)}</td><td>${won(x.deduction)}</td><td>${won(x.base)}</td><td>${won(x.computed)}</td><td>${won(x.credit)}</td><td>${won(x.decided)}</td></tr>`;
    return `
      <h4>토지분 재산세 — 시·군·구별 합산 (과세표준 = 공시가격 × 70%)</h4>
      <div class="tw"><table><thead><tr><th>시·군·구</th><th>별도 과표</th><th>별도 세액</th><th>종합 과표</th><th>종합 세액</th><th>분리 과표</th><th>분리 세액</th><th>도시지역분</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="formula">재산세 ${won(land.prop.main)} + 도시지역분 ${won(land.prop.urban)} + 지방교육세(재산세 × 20%) ${won(land.prop.edu)} → 고지서 끝수 처리 후 <b>${won(land.prop.notice.total)}원</b></p>
      <h4>종합부동산세 — 납세자 전국 합산</h4>
      <div class="tw"><table><thead><tr><th>구분</th><th>공시가격 합계</th><th>공제</th><th>과세표준</th><th>산출세액</th><th>재산세 공제</th><th>결정세액</th></tr></thead>
      <tbody>${cmtRow('별도합산', c.sep)}${cmtRow('종합합산', c.jong)}</tbody></table></div>
      <p class="formula">결정세액 ${won(c.decided)} + 농어촌특별세(× 20%) ${won(c.nong)} = <b>${won(Math.floor(c.decided) + Math.floor(c.nong))}원</b>${c.decided === 0 ? ' — 별도합산 80억원·종합합산 5억원 이하라 과세되지 않습니다.' : ''}</p>`;
  }

  function buildingDetail(buildings, parcelList) {
    const ok = buildings.filter(b => b.tax && !b.error);
    const nameOf = id => {
      const i = parcelList.findIndex(p => p.id === id);
      return i < 0 ? '' : `${i + 1}. ${parcelList[i].addr || '직접 입력'}`;
    };
    if (!ok.length) return '';
    return `<h4>건축물분 — 과세표준 = 시가표준액 × 70%</h4>
      <div class="tw"><table><thead><tr><th>필지</th><th>시가표준액</th><th>과세표준</th><th>재산세</th><th>도시지역분</th><th>지방교육세</th><th>소방분</th><th>합계</th></tr></thead>
      <tbody>${ok.map(b => `<tr><th>${esc(nameOf(b.parcelId))}</th><td>${won(b.value)}</td><td>${won(b.tax.base)}</td><td>${won(b.tax.main)}</td><td>${won(b.tax.urbanTax)}</td><td>${won(b.tax.edu)}</td><td>${won(b.tax.fire)}</td><td><b>${won(b.tax.total)}</b></td></tr>`).join('')}</tbody></table></div>`;
  }

  /** 적용된 감면·중과 근거표 */
  function reliefDetail(result, parcelList) {
    const nameOf = id => {
      const i = parcelList.findIndex(p => p.id === id);
      return i < 0 ? '' : `${i + 1}. ${parcelList[i].addr || '직접 입력'}`;
    };
    const rows = (result.reliefs || []).map(it => `<tr><th>${esc(nameOf(it.parcelId))}</th><td>${esc(it.label)}</td>
      <td>${Math.round((it.land || it.bld || { rate: it.rate }).rate * 1000) / 10}%${(it.land && it.land.minTax) || (it.bld && it.bld.minTax) ? ' (최소납부세제)' : ''}</td>
      <td>${won(it.land ? it.land.total : 0)}</td><td>${won(it.bld ? it.bld.total : 0)}</td><td><b>−${won(it.total)}</b></td><td>${esc(it.law)}</td></tr>`).join('');
    const heavy = result.buildings.filter(b => b.tax && !b.error && b.rate && b.rate !== 'general')
      .map(b => `<tr><th>${esc(nameOf(b.parcelId))}</th><td colspan="5">${esc(BT.RATES[b.rate].label)} — 건축물 재산세 중과·특례세율</td><td>${esc(BT.RATES[b.rate].law)}</td></tr>`).join('');
    const split = (result.warnings || []).filter(w => w.split)
      .map(w => `<tr><th>${esc(nameOf(w.parcelId))}</th><td colspan="5">건물 가액이 토지의 ${(w.ratio * 100).toFixed(1)}% — 바닥면적 외 토지 종합합산</td><td>지방세법 시행령 제101조①1</td></tr>`).join('');
    if (!rows && !heavy && !split) return '';
    return `<h4>감면·중과 적용 내역</h4>
      <div class="tw"><table><thead><tr><th>필지</th><th>규정</th><th>감면율</th><th>토지분 감면</th><th>건축물분 감면</th><th>합계</th><th>근거</th></tr></thead>
      <tbody>${rows}${heavy}${split}</tbody></table></div>`;
  }

  function schedule(result) {
    if (!result.schedule.length) return '<p class="muted">납부할 세금이 계산되면 여기에 일정이 표시됩니다.</p>';
    return `<ol class="timeline">${result.schedule.map(s => `
      <li><span class="m">${s.month}월</span><div><b>${won(s.amount)}원</b><p>${esc(s.item)}</p><small>${esc(s.due)}${s.amount > 2.5e6 ? ' · 250만원 초과 시 분할납부 가능' : ''}</small></div></li>`).join('')}</ol>`;
  }

  function projection(result, growth) {
    const rows = result.projection;
    const max = Math.max(1, ...rows.map(r => r.total));
    return `
      <div class="proj">${rows.map(r => `
        <div class="pcol"><div class="pbar" style="--h:${(r.total / max * 100).toFixed(1)}%"><span class="seg-land" style="flex:${r.land}"></span><span class="seg-bld" style="flex:${r.building}"></span><span class="seg-cmt" style="flex:${r.cmt}"></span></div>
        <b>${eok(r.total)}</b><small>${r.year}</small></div>`).join('')}</div>
      <p class="fine">공시지가 연 ${esc(growth)}% 상승, 세율·공제·신축가격기준액(2026년 값) 유지, 건물 잔가율은 매년 감소한다고 가정합니다. 토지분 세부담상한(150%)은 앞 연도 계산액에 연쇄 적용합니다.</p>`;
  }

  function basis() {
    const extra = [
      { item: '건축물분 재산세', rule: '시가표준액 × 70% × 0.25%(공장 0.5%, 골프장·고급오락장 4%)', law: '지방세법 제110조·제111조①2' },
      { item: '소방분 지역자원시설세', rule: '건축물 과세표준에 0.04~0.12% 누진, 화재위험 ×2 · 대형 화재위험 ×3', law: '지방세법 제146조③' },
      { item: '건물신축가격기준액(2026)', rule: '주거·상업·문화 86만원, 공업 84만원, 공공 85만원, 농수산 64만원(㎡당)', law: '행정안전부고시 제2025-82호(시행 2026.6.1.)' },
      { item: '건축물 시가표준액', rule: '기준액 × 구조·용도·위치지수 × 경과연수별 잔가율(㎡당 1,000원 미만 버림) × 면적 × 가감산율', law: '지방세법 제4조②, 시행령 제4조①1의2' },
      { item: '경과연수별 잔가율(2026)', rule: '1 − 상각률 × 경과연수, 최종 10% (내용연수 50·40·30·20·10년 → 0.018·0.0225·0.030·0.045·0.090)', law: '2026년 지방세 시가표준액 조사·산정 업무요령' },
    ];
    return `<div class="tw"><table class="basis"><thead><tr><th>항목</th><th>기준</th><th>근거</th></tr></thead>
      <tbody>${[...HT.BASIS, ...extra, ...RL.NOTES].map(b => `<tr><th>${esc(b.item)}</th><td>${esc(b.rule)}</td><td>${esc(b.law)}</td></tr>`).join('')}</tbody></table></div>`;
  }

  ns.views = Object.freeze({ esc, won, eok, parcels, summary, landDetail, buildingDetail, reliefDetail, schedule, projection, basis });
})(window.HTM = window.HTM || {});
