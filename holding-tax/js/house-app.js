/* 보유세맵 — 주택 전용 화면. 상태 → HouseTax.calc → 렌더. 공유 링크·계산 기록 포함 */
(function () {
  'use strict';
  const H = window.HouseTax;
  const RL = window.HTMRelief;
  const HP = window.HouseParcel;
  const ns = window.HTM || {};
  const $ = s => document.querySelector(s);
  const STORE = 'htm.house.v1';
  const HISTORY = 'htm.house.history.v1';
  const MAX_HOUSES = 20;
  const MAX_HISTORY = 12;
  const MAX_OUTLINES = 5; // 새로고침 뒤 다시 그릴 필지 경계 수(중계 서버 호출 수)
  const EXAMPLE = Object.freeze({ name: '예시 아파트', price: 1.5e9 });

  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const won = n => Math.round(Number(n) || 0).toLocaleString('ko-KR');
  const eok = n => {
    const v = Number(n) || 0;
    if (v >= 1e8) return `${(v / 1e8).toLocaleString('ko-KR', { maximumFractionDigits: 2 })}억원`;
    if (v >= 1e4) return `${Math.round(v / 1e4).toLocaleString('ko-KR')}만원`;
    return `${won(v)}원`;
  };
  const fmt = n => (Number(n) > 0 ? Number(n).toLocaleString('ko-KR') : '');
  const num = (v, max) => {
    const n = Number(String(v).replace(/[,\s]/g, ''));
    return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : 0;
  };
  const uid = () => Math.random().toString(36).slice(2, 9);
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  /* ---------- 상태 ---------- */
  const newHouse = () => ({ id: uid(), name: '', price: 0, share: 100, urban: true, prevPrice: 0, bldValue: 0, prevFire: 0, kind: 'none', rentalSize: 'none', region: 'metro', construction: false, ...HP.EMPTY_LOC });
  function clean(raw) {
    const s = raw && typeof raw === 'object' ? raw : {};
    const houses = (Array.isArray(s.houses) ? s.houses : []).filter(h => h && typeof h === 'object').slice(0, MAX_HOUSES).map(h => ({
      id: typeof h.id === 'string' ? h.id.slice(0, 12) : uid(),
      name: typeof h.name === 'string' ? h.name.slice(0, 60) : '',
      price: num(h.price, 1e12),
      share: Math.max(0.01, Math.min(100, num(h.share, 100) || 100)),
      urban: h.urban !== false,
      prevPrice: num(h.prevPrice, 1e12),
      bldValue: num(h.bldValue, 1e12),
      prevFire: num(h.prevFire, 1e10),
      kind: own(H.KINDS, h.kind) ? h.kind : 'none',
      rentalSize: own(RL.RENTAL_SIZE, h.rentalSize) ? h.rentalSize : 'none',
      region: h.region === 'local' ? 'local' : 'metro',
      construction: h.construction === true,
      ...HP.cleanLoc(h),
    }));
    return {
      mode: own(H.MODES, s.mode) ? s.mode : '2026',
      ownerType: s.ownerType === '법인' ? '법인' : '개인',
      oneHouse: s.oneHouse !== false,
      resident: s.resident !== false,
      age: Math.round(num(s.age, 120)),
      holdYears: Math.round(num(s.holdYears, 100)),
      houseCount: Math.round(num(s.houseCount, 100)),
      prevTotal: num(s.prevTotal, 1e12),
      cfYears: [1, 3, 5, 10].includes(Number(s.cfYears)) ? Number(s.cfYears) : 5,
      cfInstall: s.cfInstall === true,
      cfGrowth: Math.min(30, num(s.cfGrowth, 30)),
      corpGeneral: s.corpGeneral === true,
      joint: s.joint === true,
      houses: houses.length ? houses : [newHouse()],
    };
  }
  let state = clean({});
  let pointerDown = false;
  let pendingRender = false;
  let activeId = null; // 지도에서 누른 필지를 채울 주택
  let mapReady = false;
  const geoms = new Map(); // 주택 id → 필지 경계(저장·공유하지 않음)
  const lookups = new Map(); // 주택 id → 공시가격 조회 {status, dong, ho, kind, items, item, error, seq} — 화면에서만
  let lookupSeq = 0;
  const drawn = new Map(); // 주택 id → 지도에 그린 경계

  function load() {
    try { const r = localStorage.getItem(STORE); return r ? clean(JSON.parse(r)) : null; } catch (_) { return null; }
  }
  function save() {
    try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (_) { /* 저장 불가 환경 */ }
  }
  const b64 = str => btoa(String.fromCharCode(...new TextEncoder().encode(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unb64 = t => new TextDecoder().decode(Uint8Array.from(atob(t.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)));

  function input() {
    return { ...state, houses: state.houses.map(h => ({ price: h.price, share: h.share, urban: h.urban, prevPrice: h.prevPrice, bldValue: h.bldValue, prevFire: h.prevFire, kind: h.kind, rentalSize: h.rentalSize, region: h.region, construction: h.construction })) };
  }

  /* ---------- 렌더 ---------- */
  function houseRows(r) {
    const byIndex = new Map();
    state.houses.filter(h => h.price > 0).forEach((h, i) => byIndex.set(h.id, r.rows[i]));
    return state.houses.map((h, i) => {
      const row = byIndex.get(h.id);
      return `
      <article class="pcard" data-card="${esc(h.id)}">
        <header>
          <span class="pno">${i + 1}</span>
          <div class="ptitle"><input class="addr-in" type="text" maxlength="60" placeholder="주택 이름 (예: 반포 아파트)" aria-label="${i + 1}번 주택 이름" data-hid="${esc(h.id)}" data-f="name" value="${esc(h.name)}">
            <p>${row ? `과세표준 ${eok(row.base)} (공시가격 × ${Math.round(row.fmv * 100)}%)${row.capped ? ' · 과세표준상한 적용' : ''}${row.special ? ' · 1주택 특례세율' : ''}` : '공시가격을 입력하세요'}</p></div>
          ${state.houses.length > 1 ? `<button type="button" class="icon-btn" data-act="del" data-hid="${esc(h.id)}" aria-label="${i + 1}번 주택 삭제">×</button>` : ''}
        </header>
        ${locLine(h)}
        <div class="grid4">
          <label class="fld"><span class="fld-l">주택 공시가격</span><span class="num"><input type="text" inputmode="numeric" data-hid="${esc(h.id)}" data-f="price" value="${esc(fmt(h.price))}"><em>원</em></span><span class="fld-h">${h.price > 0 ? eok(h.price) : '<a href="https://www.realtyprice.kr" target="_blank" rel="noopener">부동산공시가격알리미</a>'} · 주거용 오피스텔은 건물+토지 시가표준액 합계(위택스)</span></label>
          <label class="fld"><span class="fld-l">내 지분</span><span class="num"><input type="text" inputmode="decimal" data-hid="${esc(h.id)}" data-f="share" value="${esc(h.share)}"><em>%</em></span><span class="fld-h">공동명의면 내 지분</span></label>
          <label class="fld"><span class="fld-l">작년 공시가격</span><span class="num"><input type="text" inputmode="numeric" data-hid="${esc(h.id)}" data-f="prevPrice" value="${esc(fmt(h.prevPrice))}"><em>원</em></span><span class="fld-h">선택 — 과세표준상한(5%) 계산</span></label>
          <label class="fld"><span class="fld-l">재산세</span><span class="fld-h house-tax">${row ? `<b>${won(row.ownTotal)}원</b> (본세 ${won(row.ownMain)} · 도시 ${won(row.ownUrban)} · 교육 ${won(row.ownEdu)}${row.ownFire ? ` · 소방 ${won(row.ownFire)}` : ''})` : '—'}</span></label>
        </div>
        ${houseRelief(h, row)}
        <details class="more"><summary>소방분(지역자원시설세) 넣기 — 건물분 시가표준액</summary>
          <div class="grid4">
            <label class="fld"><span class="fld-l">건물 시가표준액</span><span class="num"><input type="text" inputmode="numeric" data-hid="${esc(h.id)}" data-f="bldValue" value="${esc(fmt(h.bldValue))}"><em>원</em></span><span class="fld-h">재산세 고지서·위택스의 건축물 시가표준액(토지 제외)</span></label>
            <label class="fld"><span class="fld-l">작년 소방분</span><span class="num"><input type="text" inputmode="numeric" data-hid="${esc(h.id)}" data-f="prevFire" value="${esc(fmt(h.prevFire))}"><em>원</em></span><span class="fld-h">선택 — 150% 상한</span></label>
          </div>
        </details>
        <label class="chk"><input type="checkbox" data-hid="${esc(h.id)}" data-f="urban"${h.urban ? ' checked' : ''}> 도시지역분(0.14%) 부과 — 대부분의 시 지역 주택은 해당</label>
      </article>`;
    }).join('');
  }

  const today = () => {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  };

  /** 지도에서 받은 위치 — 계산에는 쓰지 않는 참고 정보 */
  function locLine(h) {
    if (!h.addr) return '';
    const R = window.Regulated;
    const reg = R ? R.check(h.sggName || h.addr, today()) : null;
    const regCls = reg && (reg.status === 'yes' ? 'reg-yes' : reg.status === 'no' ? 'reg-no' : 'reg-unk');
    const regTag = reg && (reg.status === 'yes' ? '조정대상지역' : reg.status === 'no' ? '비조정' : '확인 필요');
    const facts = [h.sggName, h.region === 'local' ? '수도권 밖' : '수도권', h.zone].filter(Boolean).map(esc).join(' · ');
    const land = h.landArea > 0 && h.landPrice > 0
      ? `<p class="need-line">대지 ${h.landArea.toLocaleString('ko-KR')}㎡${h.landAreaApprox ? '(경계 도형 근사)' : ''} × 개별공시지가 ㎡당 ${won(h.landPrice)}원${h.landYear ? `(${h.landYear}년)` : ''} = 토지 ${eok(HP.landValue(h))} — 참고값입니다. 아파트·빌라는 단지 전체 땅이라 내 대지권과 다르고, 세금은 주택 공시가격으로만 계산합니다.</p>`
      : '';
    return `<div class="loc">
          <p class="law-line"><b>${esc(h.addr)}</b>${facts ? ` · ${facts}` : ''} <button type="button" class="link-btn" data-act="unlocate" data-hid="${esc(h.id)}">위치 지우기</button></p>
          ${land}
          ${reg ? `<p class="reg-line ${regCls}"><b>${regTag}</b> — ${esc(reg.note)}. 주택 재산세·종부세 세율과는 무관합니다(취득세·양도세 판단용).</p>` : ''}
          ${priceLookup(h)}
        </div>`;
  }

  /** 공시가격 자동 조회 — 지번(PNU) + 동·호 */
  function priceLookup(h) {
    if (!h.pnu || !ns.vworld || !ns.vworld.registerEnabled || !ns.vworld.registerEnabled()) return '';
    const L = lookups.get(h.id) || {};
    const input = (k, ph, w) => `<input type="text" class="hp-in" maxlength="10" data-hp="${k}" data-hid="${esc(h.id)}" placeholder="${ph}" value="${esc(L[k] || '')}" aria-label="${ph}" style="width:${w}">`;
    let body = '';
    if (L.status === 'loading') body = '<p class="muted">공시가격을 조회하는 중…</p>';
    else if (L.status === 'error') body = `<p class="warn-line">${esc(L.error)}</p>`;
    else if (L.status === 'ok' && L.kind === 'none') body = '<p class="muted">이 지번의 공동주택·개별주택 공시가격을 찾지 못했습니다. 동·호를 비우고 다시 조회하거나 부동산공시가격알리미에서 확인하세요.</p>';
    else if (L.status === 'ok' && L.kind === 'indvd') {
      body = `<p class="need-line">개별주택가격 ${L.item.year}년 <b>${eok(L.item.price)}</b>${L.item.prevPrice ? ` (전년 ${eok(L.item.prevPrice)})` : ''} <button type="button" class="link-btn" data-act="hp-use" data-hid="${esc(h.id)}" data-i="-1">이 값 넣기</button></p>`;
    } else if (L.status === 'ok' && L.kind === 'apart') {
      const rows = L.items.map((it, i) => `<li><button type="button" class="link-btn" data-act="hp-use" data-hid="${esc(h.id)}" data-i="${i}">${esc([it.complex, it.dong && `${it.dong}${/동$/.test(it.dong) ? '' : '동'}`, it.ho && `${it.ho}${/호$/.test(it.ho) ? '' : '호'}`].filter(Boolean).join(' '))}</button> <span class="muted">전용 ${it.area}㎡ · ${it.year}년 ${eok(it.price)}${it.prevPrice ? ` · 전년 ${eok(it.prevPrice)}` : ''}</span></li>`).join('');
      body = `<p class="need-line">공동주택가격 ${L.items.length}건${L.items.length >= 300 ? '(앞 300건)' : ''} — 내 호를 누르면 넣습니다.</p><ul class="hp-list">${rows}</ul>`;
    }
    return `<div class="hp">
            <div class="hp-row">${input('dong', '동', '5.5em')}${input('ho', '호', '5.5em')}<button type="button" class="ghost sm" data-act="hp-load" data-hid="${esc(h.id)}">공시가격 불러오기</button></div>
            <p class="fld-h">아파트·빌라는 동·호(동이 없으면 호만), 단독·다가구는 비워 두고 누르세요. 국토교통부 공시가격(VWorld)입니다.</p>
            ${body}
          </div>`;
  }

  function houseRelief(h, row) {
    const kind = H.KINDS[h.kind] || H.KINDS.none;
    const rental = RL.RENTAL_SIZE[h.rentalSize] || RL.RENTAL_SIZE.none;
    const rel = row && row.relief;
    const opt = (v, l, cur) => `<option value="${esc(v)}"${String(v) === String(cur) ? ' selected' : ''}>${esc(l)}</option>`;
    return `
        <details class="relief"${h.kind !== 'none' || h.rentalSize !== 'none' ? ' open' : ''}>
          <summary>특례·감면 ${h.kind !== 'none' || h.rentalSize !== 'none' ? `<b>${esc([h.kind !== 'none' ? kind.label : '', h.rentalSize !== 'none' ? `임대 ${rental.label}` : ''].filter(Boolean).join(' · '))}</b>` : '<span class="muted">— 임대주택·상속주택·일시적 2주택·지방 저가주택 등</span>'}</summary>
          <div class="grid4">
            <label class="fld"><span class="fld-l">종부세 구분</span><select data-hid="${esc(h.id)}" data-f="kind">${Object.entries(H.KINDS).map(([k, v]) => opt(k, v.label, h.kind)).join('')}</select></label>
            <label class="fld"><span class="fld-l">임대주택 재산세 감면</span><select data-hid="${esc(h.id)}" data-f="rentalSize">${Object.entries(RL.RENTAL_SIZE).map(([k, v]) => opt(k, v.label, h.rentalSize)).join('')}</select><span class="fld-h">장기일반·공공지원민간임대 등록</span></label>
            <label class="fld"><span class="fld-l">소재지</span><select data-hid="${esc(h.id)}" data-f="region">${opt('metro', '수도권', h.region)}${opt('local', '수도권 밖', h.region)}</select></label>
            <label class="chk"><input type="checkbox" data-hid="${esc(h.id)}" data-f="construction"${h.construction ? ' checked' : ''}> 민간건설임대(수도권 9억 기준)</label>
          </div>
          ${h.kind !== 'none' ? `<p class="law-line"><b>${esc(kind.law)}</b></p><p class="need-line">요건: ${esc(kind.need)}</p>` : ''}
          ${rel ? `<p class="law-line"><b>${esc(rel.law)}</b> — ${rel.overCap ? `공시가격이 감면 기준 ${eok(rel.cap)}을 넘어 감면되지 않습니다.` : `재산세 −${won(rel.total)}원 (${Math.round(rel.rate * 1000) / 10}%${rel.minTax ? ', 최소납부세제로 85%' : ''}${rel.urban ? ', 도시지역분 포함' : ''})`}</p>` : ''}
        </details>`;
  }

  function jointCompare() {
    if (!(state.joint && state.ownerType === '개인' && state.houses.length === 1 && state.houses[0].price > 0)) return '';
    const h = input().houses[0];
    const mine = Math.min(100, h.share || 50);
    const spouse = 100 - mine;
    if (spouse <= 0) return '<div class="cmp-card"><p class="warn-line">공동명의 비교: 위 주택의 "내 지분"을 50처럼 넣으세요(배우자 지분 = 100 − 내 지분).</p></div>';
    const base = { ...input(), oneHouse: true, prevTotal: 0 }; // 작년 세액은 부부 합계라 각자 상한 비교에 쓰지 않는다
    const a1 = H.calc({ ...base, jointEach: true, houses: [{ ...h, share: mine }] });
    const a2 = H.calc({ ...base, jointEach: true, houses: [{ ...h, share: spouse }] });
    const b = H.calc({ ...base, houses: [{ ...h, share: 100 }] });
    const A = { prop: a1.prop.total + a2.prop.total, cmt: (a1.cmt ? a1.cmt.total : 0) + (a2.cmt ? a2.cmt.total : 0) };
    const B = { prop: b.prop.total, cmt: b.cmt ? b.cmt.total : 0 };
    const tA = A.prop + A.cmt, tB = B.prop + B.cmt;
    const best = tB < tA ? 'B' : 'A';
    return `<div class="cmp-card">
      <h3>부부 공동명의 1주택 — 어느 쪽이 유리할까</h3>
      <div class="tw"><table><thead><tr><th></th><th>재산세 등</th><th>종부세·농특세</th><th>합계(부부)</th></tr></thead><tbody>
        <tr${best === 'A' ? ' class="win"' : ''}><th>A. 각자 과세 (각 9억 공제)</th><td>${won(A.prop)}</td><td>${won(A.cmt)}</td><td><b>${won(tA)}</b></td></tr>
        <tr${best === 'B' ? ' class="win"' : ''}><th>B. 공동명의 1주택자 특례 (12억 공제·세액공제)</th><td>${won(B.prop)}</td><td>${won(B.cmt)}</td><td><b>${won(tB)}</b></td></tr>
      </tbody></table></div>
      <p class="law-line"><b>${best === 'B' ? `특례 신청이 ${won(tA - tB)}원 유리` : tA === tB ? '차이 없음' : `각자 과세가 ${won(tB - tA)}원 유리`}</b> — 종부세법 제10조의2, 9.16~9.30 관할세무서에 신청</p>
      <p class="need-line">B는 지분이 큰 사람(50:50이면 부부 중 선택한 1인)을 납세의무자로 보고 위 나이·보유기간으로 세액공제를 계산합니다. 세대원 누구도 다른 주택이 없어야 합니다.</p>
    </div>`;
  }

  function summary(r) {
    const c = r.cmt || { total: 0, decided: 0, nong: 0 };
    const parts = [
      { k: 'bld', label: '재산세·도시지역분·교육세', when: '7월·9월', v: r.prop.total },
      { k: 'cmt', label: '종부세·농특세', when: '12월', v: c.total },
    ];
    const total = r.total;
    const cfg = window.HTM_CONFIG || {};
    const ctas = [
      cfg.CONSULT_URL ? `<a class="btn primary" href="${esc(cfg.CONSULT_URL)}" target="_blank" rel="noopener">${esc(cfg.CONSULT_LABEL)}</a>` : '',
    ].join('');
    return `
      <p class="eyebrow">${esc(H.MODES[state.mode].label)} 예상 보유세</p>
      <p class="total" aria-live="polite"><span>${won(total)}</span>원</p>
      <p class="total-sub">${total > 0 ? `약 ${eok(total)} · 월 평균 ${eok(total / 12)}` : '공시가격을 넣으면 바로 계산됩니다'}</p>
      ${total > 0 ? `<div class="stack">${parts.filter(x => x.v > 0).map(x => `<span class="seg-${x.k}" style="flex:${x.v}"></span>`).join('')}</div>` : ''}
      <ul class="parts">${parts.map(x => `<li><i class="dot seg-${x.k}"></i><span>${x.label}<small>${x.when} 납부</small></span><b>${won(x.v)}</b></li>`).join('')}</ul>
      ${state.mode === '2027reform' ? '<p class="warn-line">정부안(국회 심의 중) 중 확정 숫자만 반영한 예상치입니다.</p>' : ''}
      <div class="actions">
        <button type="button" class="btn" data-act="share">링크 복사</button>
        <button type="button" class="btn" data-act="print">PDF 보고서</button>
        <button type="button" class="btn" data-act="save">계산 기록 저장</button>
        <button type="button" class="btn" data-act="history">기록 보기</button>
      </div>
      ${ctas ? `<div class="cta">${ctas}</div>` : ''}
      <p class="fine">간편 추정치입니다. 1세대1주택·주택 수 판정, 합산배제, 감면, 지자체 조례에 따라 실제 고지액과 다를 수 있습니다.</p>`;
  }

  function detail(r) {
    const c = r.cmt;
    if (!c) return '<p class="muted">공시가격을 넣으면 계산 과정이 나옵니다.</p>';
    const rows = [
      ['공시가격 합계(내 지분)', c.value],
      [`공제 (${state.ownerType === '법인' ? '법인 0원' : state.oneHouse ? '1세대1주택' : '개인 9억원'})`, -c.deduction],
      ['과세표준 (× 60%)', c.base],
      [`산출세액 (${state.ownerType === '법인' ? (c.count >= 3 ? '법인 5%' : '법인 2.7%') : c.count >= 3 ? '3주택 이상 세율' : '2주택 이하 세율'})`, c.computed],
      [`공제할 재산세 (${won(c.propActual)} × ${won(Math.round(c.propOnCmt))} ÷ ${won(c.propStd)})`, -c.credit],
      ...(c.creditPct > 0 ? [[`고령자 ${Math.round(c.agePct * 100)}% + 장기보유 ${Math.round(c.holdPct * 100)}% 공제`, -c.seniorCredit]] : []),
      ...(c.capReduction > 0 ? [['세부담상한(150%) 초과분', -c.capReduction]] : []),
      ['종합부동산세 결정세액', c.decided],
      ['농어촌특별세 (× 20%)', c.nong],
    ];
    return `<h4>주택분 종합부동산세 — 납세자별 합산</h4>
      <div class="tw"><table><tbody>${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${v < 0 ? '−' : ''}${won(Math.abs(v))}</td></tr>`).join('')}</tbody></table></div>
      ${c.decided === 0 && c.base === 0 ? `<p class="formula">공시가격 합계가 공제액 ${eok(c.deduction)} 이하라 종부세가 없습니다.</p>` : ''}
      ${r.opt.oneHouse && ((Number(state.age) || 0) >= 60 || (Number(state.holdYears) || 0) >= 5) && c.decided > 1e6
        ? `<p class="formula">종부세가 100만원을 넘어 <b>납부유예</b>를 신청할 수 있습니다 — 직전 연도 총급여 7천만원(종합소득 6천만원) 이하, 담보 제공, 양도·상속 때 이자와 함께 납부(종부세법 제20조의2).</p>` : ''}
      ${c.excluded.length ? `<p class="formula">합산배제 임대주택 ${c.excluded.length}채(${eok(c.excluded.reduce((s, x) => s + x.value, 0))})는 과세표준에서 뺐습니다. 세율 판정 주택 수 ${c.count}채.</p>` : ''}
      ${c.mainShare < 1 ? `<p class="formula">고령자·장기보유 공제는 상속·지방 저가·일시적 2주택 신규주택분을 뺀 ${Math.round(c.mainShare * 100)}%에만 적용했습니다(종부세법 제9조⑦⑨).</p>` : ''}
      ${r.cmtInstallment > 0 ? `<p class="formula">종부세 ${eok(c.decided)}은 250만원을 넘어 ${eok(r.cmtInstallment)}까지 6개월 분납할 수 있습니다.</p>` : ''}`;
  }

  function schedule(r) {
    if (!r.schedule.length) return '<p class="muted">세금이 계산되면 납부 일정이 나옵니다.</p>';
    return `<ol class="timeline">${r.schedule.map(s => `<li><span class="m">${s.month}월</span><div><b>${won(s.amount)}원</b><p>${esc(s.item)}</p><small>${esc(s.due)}</small></div></li>`).join('')}</ol>`;
  }

  function compare() {
    const keys = Object.keys(H.MODES);
    const totals = keys.map(k => ({ k, r: H.calc({ ...input(), mode: k }) }));
    const max = Math.max(1, ...totals.map(t => t.r.total));
    return `<div class="proj cmp">${totals.map(({ k, r }) => `
      <div class="pcol${k === state.mode ? ' is-on' : ''}"><div class="pbar" style="--h:${(r.total / max * 100).toFixed(1)}%"><span class="seg-bld" style="flex:${r.prop.total}"></span><span class="seg-cmt" style="flex:${r.cmt ? r.cmt.total : 0}"></span></div>
      <b>${eok(r.total)}</b><small>${esc(H.MODES[k].label.replace(' — ', ' '))}</small></div>`).join('')}</div>
      <p class="fine">2027년 공시가격은 올해와 같다고 가정합니다. "현행법이 그대로면"은 2026년분까지인 1세대1주택 특례(공정시장가액비율 43~45%, 특례세율)가 끝나는 경우입니다.</p>`;
  }

  function render(keepFocus) {
    const focus = keepFocus && document.activeElement && document.activeElement.dataset ? { ...document.activeElement.dataset } : null;
    const r = H.calc(input());
    $('#houses').innerHTML = houseRows(r);
    $('#summary').innerHTML = summary(r);
    $('#detail').innerHTML = detail(r);
    $('#schedule').innerHTML = schedule(r);
    $('#compare').innerHTML = compare();
    $('#joint-card').innerHTML = jointCompare();
    $('#corp-wrap').hidden = state.ownerType !== '법인';
    $('#corpGeneral').checked = state.corpGeneral;
    $('#joint-wrap').hidden = !(state.ownerType === '개인' && state.houses.length === 1);
    $('#joint').checked = state.joint;
    $('#mbar-total').textContent = `${won(r.total)}원`;
    // cf-view.js가 일시적으로 못 오면(CDN 503 등) 현금흐름 표만 비우고 나머지 계산은 계속 그린다
    $('#cf-table').innerHTML = window.HTMCFView ? window.HTMCFView.render(currentCF()) : '<p class="muted">월별 납부 표를 불러오지 못했습니다. 새로고침하세요.</p>';
    $('#cf-years').value = String(state.cfYears);
    $('#cf-install').checked = state.cfInstall;
    if (document.activeElement !== $('#cf-growth')) $('#cf-growth').value = state.cfGrowth;
    document.querySelectorAll('[data-owner]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.owner === state.ownerType)));
    $('#mode').value = state.mode;
    // 일반 주택 1채(상속·지방 저가·일시적 2주택·합산배제 임대주택은 함께 있어도 됨), 목록 밖 주택 없음
    const regular = state.houses.filter(h => h.price > 0 && !(H.KINDS[h.kind] || {}).keepOneHouse).length;
    const single = state.ownerType === '개인' && regular <= 1 && !(state.houseCount > state.houses.length);
    $('#oneHouse').checked = state.oneHouse && single;
    $('#oneHouse').disabled = !single;
    $('#one-opts').hidden = !(state.oneHouse && single);
    $('#resident-wrap').hidden = state.mode !== '2027reform';
    ['age', 'holdYears', 'houseCount'].forEach(k => { if (document.activeElement !== $(`#${k}`)) $(`#${k}`).value = state[k] || ''; });
    if (document.activeElement !== $('#prevTotal')) $('#prevTotal').value = fmt(state.prevTotal);
    $('#resident').checked = state.resident;
    markActive();
    if (focus && focus.f) {
      const el = document.querySelector(`[data-hid="${CSS.escape(focus.hid || '')}"][data-f="${CSS.escape(focus.f)}"]`);
      if (el) el.focus({ preventScroll: true });
    }
  }

  /* ---------- 지도 ---------- */
  function markActive() {
    if (!state.houses.some(h => h.id === activeId)) activeId = state.houses[0].id;
    document.querySelectorAll('[data-card]').forEach(el => el.classList.toggle('is-active', state.houses.length > 1 && el.dataset.card === activeId));
    syncMap();
  }

  function syncMap() {
    if (!mapReady) return;
    const list = state.houses.map(h => ({ id: h.id, jibun: h.name || '주택', geom: geoms.get(h.id) || null }));
    // 바뀐 게 없으면 다시 그리지 않는다(입력할 때마다 지번 라벨을 다시 붙이지 않도록)
    const sig = JSON.stringify([activeId, list.map(p => [p.id, p.jibun, Boolean(p.geom)])]);
    if (sig === syncMap.sig && list.every(p => (drawn.get(p.id) || null) === p.geom)) return;
    syncMap.sig = sig;
    // map.sync는 이미 그린 경계를 다시 그리지 않으므로 위치가 바뀐 주택은 한 번 빼서 지운다
    const stale = list.filter(p => drawn.has(p.id) && drawn.get(p.id) !== p.geom).map(p => p.id);
    if (stale.length) ns.map.sync(list.filter(p => !stale.includes(p.id)), activeId, selectHouse);
    ns.map.sync(list, activeId, selectHouse);
    drawn.clear();
    list.forEach(p => { if (p.geom) drawn.set(p.id, p.geom); });
  }

  function selectHouse(id) {
    activeId = id;
    markActive();
    if (mapReady && geoms.has(id)) ns.map.focus({ id });
    scrollToCard(id);
  }

  function scrollToCard(id) {
    const el = document.querySelector(`[data-card="${CSS.escape(id)}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /** 누른 곳의 필지 → 고른 주택에 주소·시군구·대지 면적·공시지가 채우기(주택 공시가격은 사용자가 넣는다) */
  async function locateAt(latlng) {
    if (!ns.vworld || !ns.vworld.enabled()) { toast('지도 조회가 아직 준비되지 않았습니다. 공시가격을 직접 넣어 계산하세요.'); return; }
    toast('필지를 조회하는 중…');
    try {
      const found = await ns.vworld.parcelAt(latlng.lat, latlng.lng);
      if (!found) { toast('이 위치에서 필지를 찾지 못했습니다.'); return; }
      const target = state.houses.find(h => h.id === activeId) || state.houses[0];
      const dup = state.houses.find(h => h.id !== target.id && h.pnu && h.pnu === found.pnu);
      if (dup) { selectHouse(dup.id); toast('이미 넣은 주택입니다.'); return; }
      const next = HP.applyParcel(target, HP.fromParcel(found, latlng), EXAMPLE);
      activeId = next.id;
      if (found.geom) geoms.set(next.id, found.geom); else geoms.delete(next.id);
      setState({ ...state, houses: state.houses.map(h => (h.id === next.id ? next : h)) });
      const no = state.houses.findIndex(h => h.id === next.id) + 1;
      toast(next.price > 0 ? `${no}번 주택 위치를 ${next.addr}(으)로 넣었습니다.` : `${no}번 주택 위치: ${next.addr} — 주택 공시가격을 입력하세요.`);
      scrollToCard(next.id);
    } catch (err) {
      toast(err.message);
    }
  }

  async function onSearch(e) {
    e.preventDefault();
    const q = $('#q').value.trim();
    const box = $('#results');
    if (!q) return;
    if (!ns.vworld || !ns.vworld.enabled()) { toast('주소 검색이 아직 준비되지 않았습니다. 공시가격을 직접 넣어 계산하세요.'); return; }
    box.innerHTML = '<li class="muted">검색 중…</li>';
    try {
      const items = await ns.vworld.search(q);
      box.innerHTML = items.length
        ? items.map((it, k) => `<li><button type="button" data-k="${k}">${esc(it.title)}<small>${esc(it.sub)}</small></button></li>`).join('')
        : '<li class="muted">검색 결과가 없습니다. 지번이나 도로명 주소로 다시 검색해 보세요.</li>';
      box.onclick = ev => {
        const b = ev.target.closest('[data-k]');
        if (!b) return;
        const it = items[Number(b.dataset.k)];
        box.innerHTML = '';
        if (mapReady) ns.map.flyTo(it.lat, it.lng);
        locateAt({ lat: it.lat, lng: it.lng });
      };
    } catch (err) {
      box.innerHTML = `<li class="muted">${esc(err.message)}</li>`;
    }
  }

  /** 새로고침·공유 링크로 연 주택의 필지 경계를 다시 받아 그린다(실패해도 입력값은 그대로) */
  async function redrawOutlines() {
    const located = state.houses.filter(h => h.pnu && h.lat !== null).slice(0, MAX_OUTLINES);
    if (!located.length) return;
    ns.map.flyTo(located[0].lat, located[0].lng, 17);
    for (const h of located) {
      try {
        const p = await ns.vworld.parcelAt(h.lat, h.lng);
        const live = state.houses.find(x => x.id === h.id); // 기다리는 동안 위치를 지우거나 바꿨을 수 있다
        if (p && p.geom && live && live.pnu === h.pnu && p.pnu === h.pnu && !geoms.has(h.id)) { geoms.set(h.id, p.geom); syncMap(); }
      } catch (_) { /* 경계만 못 그린다 */ }
    }
  }

  function initMap() {
    const on = Boolean(ns.vworld && ns.vworld.enabled());
    $('#vw-off').hidden = on;
    if (!(window.L && ns.map)) { $('#map').hidden = true; return; } // 지도 라이브러리를 못 받으면 검색만
    ns.map.init($('#map'), { onClick: locateAt });
    mapReady = true;
    if (on) redrawOutlines();
  }

  const currentCF = () => window.HTMCF.house(input(), { years: state.cfYears, installments: state.cfInstall, growth: state.cfGrowth });

  async function downloadXlsx() {
    const r = H.calc(input());
    const cf = currentCF();
    const c = r.cmt || { decided: 0, nong: 0 };
    const summary = [
      ['연간 예상 보유세 합계', r.total, H.MODES[state.mode].label],
      ['주택 재산세 본세', r.prop.main], ['도시지역분', r.prop.urban], ['지방교육세', r.prop.edu], ['소방분 지역자원시설세', r.prop.fire, r.prop.fire ? '' : '건물 시가표준액 미입력'],
      ['종합부동산세 결정세액', c.decided], ['농어촌특별세', c.nong],
      [`${cf.years}년 CF 합계${cf.installments ? ' (분할납부 반영)' : ''}`, cf.total],
    ];
    const inputs = [['소유자', state.ownerType], ['1세대1주택', state.oneHouse ? '예' : '아니오'], ['나이·보유기간', `${state.age || '-'}세 · ${state.holdYears || '-'}년`], ['공시가격 연 상승률', `${state.cfGrowth}%`]]
      .concat(state.houses.map((h, i) => [`주택 ${i + 1} ${h.name || ''}`.trim(), `공시가격 ${h.price.toLocaleString('ko-KR')}원 · 지분 ${h.share}%${h.addr ? ` · ${h.addr}` : ''}`]));
    if (!cf.entries.length) { toast('계산된 세금이 없어 엑셀로 낼 내용이 없습니다.'); return; }
    const btn = document.querySelector('[data-act="xlsx"]');
    if (btn.disabled) return;
    btn.disabled = true;
    toast('엑셀 파일을 만드는 중…');
    try {
      await window.HTMXlsx.download({ fileName: `보유세맵_주택_${r.year}.xlsx`, title: '보유세맵 — 주택 보유세 계산', modeLabel: H.MODES[state.mode].label, summary, inputs, cf, basis: H.BASIS });
      toast('엑셀 파일을 내려받았습니다.');
    } catch (err) {
      toast(err.message);
    } finally {
      btn.disabled = false;
    }
  }

  function setState(next, keepFocus) {
    state = clean(next);
    save();
    render(keepFocus);
  }

  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => el.classList.remove('show'), 2600);
  }

  /* ---------- 계산 기록 ---------- */
  function readHistory() {
    try { const r = JSON.parse(localStorage.getItem(HISTORY) || '[]'); return Array.isArray(r) ? r.slice(0, MAX_HISTORY) : []; } catch (_) { return []; }
  }
  function showHistory() {
    const list = readHistory();
    $('#history').hidden = false;
    $('#history-list').innerHTML = list.length
      ? list.map((h, i) => `<li><button type="button" data-act="restore" data-i="${i}"><b>${esc(h.name)}</b><span>${esc(h.at)} · ${won(h.total)}원</span></button></li>`).join('')
      : '<li class="muted">저장한 계산이 없습니다. "계산 기록 저장"을 누르면 이 기기에 보관됩니다.</li>';
    $('#history').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function loadPrice(hid) {
    const h = state.houses.find(x => x.id === hid);
    if (!h || !h.pnu) return;
    const val = k => { const el = document.querySelector(`[data-hp="${k}"][data-hid="${CSS.escape(hid)}"]`); return el ? el.value.trim().slice(0, 10) : ''; };
    const dong = val('dong');
    const ho = val('ho');
    const seq = ++lookupSeq;
    lookups.set(hid, { status: 'loading', dong, ho, seq });
    render();
    try {
      const res = await ns.vworld.housePriceAt(h.pnu, dong, ho);
      if (!lookups.get(hid) || lookups.get(hid).seq !== seq) return; // 그새 다시 조회했거나 주택을 지움
      lookups.set(hid, { status: 'ok', dong, ho, seq, kind: res.kind, items: res.items || [], item: res.item || null });
      if (res.kind === 'apart' && res.items.length === 1) { usePrice(hid, res.items[0]); return; }
    } catch (err) {
      if (!lookups.get(hid) || lookups.get(hid).seq !== seq) return;
      lookups.set(hid, { status: 'error', dong, ho, seq, error: err.message || '공시가격을 조회하지 못했습니다.' });
    }
    render();
  }

  /** 조회한 공시가격 넣기 — 전년 값이 있으면 작년 공시가격(과세표준상한용)도 */
  function usePrice(hid, it) {
    if (!it || !(it.price > 0)) return;
    const L = lookups.get(hid);
    if (L) lookups.set(hid, { ...L, status: 'done' });
    setState({ ...state, houses: state.houses.map(h => (h.id === hid ? { ...h, price: it.price, prevPrice: it.prevPrice > 0 ? it.prevPrice : h.prevPrice } : h)) });
    toast(`${it.year}년 공시가격 ${eok(it.price)}을 넣었습니다${it.prevPrice > 0 ? `(전년 ${eok(it.prevPrice)}도)` : ''}.`);
  }

  const actions = {
    'hp-load': d => loadPrice(d.hid),
    'hp-use': d => {
      const L = lookups.get(d.hid);
      if (!L || L.status !== 'ok') return;
      usePrice(d.hid, Number(d.i) < 0 ? L.item : L.items[Number(d.i)]);
    },
    add: () => {
      if (state.houses.length >= MAX_HOUSES) return;
      const h = newHouse();
      activeId = h.id;
      setState({ ...state, houses: [...state.houses, h], oneHouse: false });
      scrollToCard(h.id);
    },
    del: d => { geoms.delete(d.hid); setState({ ...state, houses: state.houses.filter(h => h.id !== d.hid) }); },
    unlocate: d => { geoms.delete(d.hid); lookups.delete(d.hid); setState({ ...state, houses: state.houses.map(h => (h.id === d.hid ? { ...h, ...HP.EMPTY_LOC, name: '' } : h)) }); },
    share: async () => {
      // 정확한 좌표·PNU는 링크에 넣지 않는다(주소 표시는 남김)
      const shared = { ...state, houses: state.houses.map(h => ({ ...h, lat: null, lng: null, pnu: '' })) };
      const url = `${location.origin}${location.pathname}#s=${b64(JSON.stringify(shared))}`;
      try { await navigator.clipboard.writeText(url); toast('계산 결과 링크를 복사했습니다.'); } catch (_) { history.replaceState(null, '', url); toast('주소창의 링크를 복사해 공유하세요.'); }
    },
    print: () => window.print(),
    xlsx: () => downloadXlsx(),
    save: () => {
      const r = H.calc(input());
      const name = state.houses.map(h => h.name).filter(Boolean).join(', ') || `주택 ${state.houses.length}채`;
      const entry = { name: name.slice(0, 40), at: new Date().toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }), total: r.total, state };
      try { localStorage.setItem(HISTORY, JSON.stringify([entry, ...readHistory()].slice(0, MAX_HISTORY))); toast('이 기기에 계산을 저장했습니다.'); } catch (_) { toast('이 브라우저에서는 저장할 수 없습니다.'); }
    },
    history: showHistory,
    restore: d => { const h = readHistory()[Number(d.i)]; if (h) { setState(h.state); toast(`"${h.name}" 계산을 불러왔습니다.`); } },
    'history-clear': () => { try { localStorage.removeItem(HISTORY); } catch (_) { /* 무시 */ } showHistory(); },
  };

  function onHouseInput(e) {
    const hp = e.target.closest('[data-hp]');
    if (hp) { // 공시가격 조회용 동·호 — 계산 값이 아니라 다시 그려도 남게 기억만 한다
      const L = lookups.get(hp.dataset.hid) || {};
      lookups.set(hp.dataset.hid, { ...L, [hp.dataset.hp]: hp.value.trim().slice(0, 10) });
      return;
    }
    const el = e.target.closest('[data-f]');
    if (!el || !el.dataset.hid) return;
    const f = el.dataset.f;
    const v = el.type === 'checkbox' ? el.checked : el.value;
    const textual = ['name', 'kind', 'rentalSize', 'region'];
    const bool = ['urban', 'construction'];
    const houses = state.houses.map(h => (h.id !== el.dataset.hid ? h : { ...h, [f]: textual.includes(f) || bool.includes(f) ? v : num(v, 1e12) }));
    state = clean({ ...state, houses });
    save();
    if (e.type === 'change' && pointerDown) pendingRender = true; // 버튼 누르는 중 다시 그리면 클릭이 사라진다
    else if (e.type === 'change') render(true);
    else {
      const r = H.calc(input());
      $('#summary').innerHTML = summary(r);
      $('#detail').innerHTML = detail(r);
      $('#schedule').innerHTML = schedule(r);
      $('#mbar-total').textContent = `${won(r.total)}원`;
    }
  }

  function boot() {
    const m = location.hash.match(/^#s=([A-Za-z0-9_-]+)$/);
    let shared = null;
    if (m) {
      try { shared = clean(JSON.parse(unb64(m[1]))); } catch (_) { shared = null; }
      history.replaceState(null, '', location.pathname);
    }
    state = shared || load() || clean({ houses: [{ ...newHouse(), ...EXAMPLE }] });
    if (m) toast(shared ? '공유된 계산을 불러왔습니다.' : '공유 링크를 읽지 못했습니다.');
    $('#houses').addEventListener('input', onHouseInput);
    $('#houses').addEventListener('change', onHouseInput);
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (b && actions[b.dataset.act]) { actions[b.dataset.act](b.dataset); return; }
      const card = e.target.closest('[data-card]');
      if (card && card.dataset.card !== activeId && !e.target.closest('input,select,button,label,summary')) selectHouse(card.dataset.card);
    });
    // 주택 칸을 고치기 시작하면 그 주택이 지도 대상 — 다시 그리지 않고 표시만 바꾼다(입력 중 포커스 유지)
    $('#houses').addEventListener('focusin', e => {
      const card = e.target.closest('[data-card]');
      if (card && card.dataset.card !== activeId) { activeId = card.dataset.card; markActive(); }
    });
    $('#search').addEventListener('submit', onSearch);
    document.addEventListener('pointerdown', () => { pointerDown = true; }, true);
    const release = () => { pointerDown = false; if (pendingRender) { pendingRender = false; setTimeout(() => render(true), 0); } };
    document.addEventListener('pointerup', release, true);
    document.addEventListener('pointercancel', release, true);
    document.querySelectorAll('[data-owner]').forEach(b => b.addEventListener('click', () => setState({ ...state, ownerType: b.dataset.owner })));
    $('#mode').addEventListener('change', e => setState({ ...state, mode: e.target.value }));
    $('#cf-years').addEventListener('change', e => setState({ ...state, cfYears: Number(e.target.value) }));
    $('#cf-install').addEventListener('change', e => setState({ ...state, cfInstall: e.target.checked }));
    $('#cf-growth').addEventListener('change', e => setState({ ...state, cfGrowth: num(e.target.value, 30) }));
    $('#oneHouse').addEventListener('change', e => setState({ ...state, oneHouse: e.target.checked }));
    $('#corpGeneral').addEventListener('change', e => setState({ ...state, corpGeneral: e.target.checked }));
    $('#joint').addEventListener('change', e => setState({ ...state, joint: e.target.checked }));
    $('#resident').addEventListener('change', e => setState({ ...state, resident: e.target.checked }));
    ['age', 'holdYears', 'houseCount', 'prevTotal'].forEach(k => $(`#${k}`).addEventListener('change', e => setState({ ...state, [k]: num(e.target.value, 1e12) })));
    $('#basis').innerHTML = `<div class="tw"><table class="basis"><thead><tr><th>항목</th><th>기준</th><th>근거</th></tr></thead><tbody>${H.BASIS.map(b => `<tr><th>${esc(b.item)}</th><td>${esc(b.rule)}</td><td>${esc(b.law)}</td></tr>`).join('')}</tbody></table></div>`;
    initMap();
    render(false);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
