/* 보유세맵 공개판 — 이벤트 연결과 렌더링 순서 */
(function (ns) {
  'use strict';
  const HT = window.HoldingTax;
  const C = window.HTMCalc;
  const S = ns.state;
  const V = ns.views;
  const cfg = window.HTM_CONFIG || {};
  const $ = sel => document.querySelector(sel);
  const SAVE_DELAY_MS = 400;
  const HISTORY_KEY = 'htm.public.history.v1';
  const MAX_HISTORY = 12;

  let state = S.initial();
  let activeId = null;
  let saveTimer = null;
  let pointerDown = false;
  let pendingRender = false;
  const register = new Map(); // 필지 id → 건축물대장 목록 {status, list, picked, error} — 화면에서만 쓰고 저장하지 않는다
  let regSeq = 0; // 늦게 온 응답이 닫았거나 다시 연 목록을 덮지 않게 요청마다 번호를 붙인다

  window.HTMApp = Object.freeze({ ownerType: () => state.ownerType });

  /* ---------- 상태 갱신(새 객체로 교체) ---------- */
  function setState(next, { full = true } = {}) {
    state = next;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => S.save(state), SAVE_DELAY_MS);
    if (full) render(); else renderResults();
  }

  const mapParcel = (id, fn) => ({ ...state, parcels: state.parcels.map(p => (p.id === id ? fn(p) : p)) });
  const parseNum = v => {
    const n = Number(String(v).replace(/[,\s]/g, ''));
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };

  function withZone(p, zone) {
    const urban = HT.estimateUrban(zone);
    const cls = p.clsAuto ? HT.estimateClass(p.jimok, zone, state.ownerType).cls : p.cls;
    return { ...p, zone, cls, urban: urban.known ? urban.urban : p.urban };
  }

  /** data-f 필드 하나를 반영한 새 필지 */
  function applyField(p, f, raw, i) {
    switch (f) {
      case 'area': return { ...p, area: parseNum(raw), areaSource: 'manual' };
      case 'share': return { ...p, share: Math.max(0.01, Math.min(100, parseNum(raw) || 100)) };
      case 'price': return { ...p, price: parseNum(raw), priceYear: null }; // 사용자가 넣은 값은 연도 경고를 끈다
      case 'addr': return { ...p, addr: String(raw).slice(0, 80) };
      case 'zone': return withZone(p, raw);
      case 'cls': return { ...p, cls: raw, clsAuto: false };
      case 'urban': return { ...p, urban: Boolean(raw) };
      case 'hasHouse': return { ...p, hasHouse: Boolean(raw) };
      case 'relief.key': case 'relief.region': return { ...p, relief: { ...p.relief, [f.slice(7)]: raw } };
      case 'relief.custom': case 'relief.years': return { ...p, relief: { ...p.relief, [f.slice(7)]: parseNum(raw) } };
      default: break;
    }
    if (f.startsWith('bld.')) {
      const k = f.slice(4);
      const numeric = ['builtYear', 'floors', 'direct', 'footprint', 'prevMain', 'prevFire', 'overcrowdFrom', 'fireShare', 'fireBase'];
      const blank = String(raw).trim() === '';
      const blankShare = k === 'fireShare' && blank; // 비우면 건물 전체 중과(100%)
      const blankFireBase = k === 'fireBase' && blank; // 비우면 재산세 과세표준 사용
      const v = blankShare ? 100 : blankFireBase ? null : numeric.includes(k) ? parseNum(raw) : (k === 'fire' && raw !== 'auto' ? Number(raw) : raw);
      return { ...p, bld: { ...p.bld, [k]: v } };
    }
    if (f === 'dong.fire') {
      const v = raw === 'auto' ? 'auto' : Number(raw);
      return { ...p, bld: { ...p.bld, dongs: p.bld.dongs.map((d, j) => (j === i ? { ...d, fire: v } : d)) } };
    }
    if (f.startsWith('row.')) {
      const k = f.slice(4);
      const v = k === 'use' ? raw : parseNum(raw);
      return { ...p, bld: { ...p.bld, rows: p.bld.rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)) } };
    }
    return p;
  }

  /* ---------- 렌더링 ---------- */
  function renderResults() {
    const result = C.compute(state);
    $('#summary').innerHTML = V.summary(result, cfg);
    $('#detail').innerHTML = V.reliefDetail(result, state.parcels) + V.landDetail(result.land) + V.buildingDetail(result.buildings, state.parcels);
    $('#schedule').innerHTML = V.schedule(result);
    $('#projection').innerHTML = V.projection(result, state.growth);
    $('#mbar-total').textContent = `${V.won(result.totals.total)}원`;
    $('#cf-table').innerHTML = window.HTMCFView.render(currentCF());
    return result;
  }

  const currentCF = () => window.HTMCF.commercial(state, { years: state.cfYears, installments: state.cfInstall });

  async function downloadXlsx() {
    const r = C.compute(state);
    const cf = currentCF();
    const t = r.totals;
    const summary = [
      ['연간 예상 보유세 합계', t.total, `${r.year}년 기준`],
      ['건축물분 재산세·교육세·소방분 (7월)', t.building],
      ['토지분 재산세·도시지역분·교육세 (9월)', t.landProp],
      ['종합부동산세 결정세액 (12월)', t.cmtMain],
      ['농어촌특별세', t.nong],
      ['감면 적용액', -t.relief, r.reliefs.map(x => `${x.label}(${x.law})`).join(' / ')],
      [`${cf.years}년 CF 합계${cf.installments ? ' (분할납부 반영)' : ''}`, cf.total],
    ];
    const inputs = [['소유자', state.ownerType], ['공시지가 연 상승률', `${state.growth}%`]].concat(state.parcels.map((p, i) => [
      `필지 ${i + 1} ${p.addr || ''}`.trim(),
      p.hasHouse ? '주택 — 제외' : `${(p.area || 0).toLocaleString('ko-KR')}㎡ × ${(p.price || 0).toLocaleString('ko-KR')}원 · ${HT.CLASS[p.cls].label} · 지분 ${p.share}%${p.bld ? ' · 건물 있음' : ''}`,
    ]));
    const extra = [
      { item: '건축물분 재산세', rule: '시가표준액 × 70% × 0.25%(공장 0.5%, 골프장·고급오락장 4%)', law: '지방세법 제110조·제111조①2' },
      { item: '소방분 지역자원시설세', rule: '건축물 과세표준 0.04~0.12% 누진, 화재위험 ×2·대형 ×3, 150% 상한', law: '지방세법 제146조③·제147조②' },
      { item: '분할납부', rule: '재산세 250만원 초과: 500만원 이하는 초과분, 초과는 50% 이하를 3개월 이내 / 종부세 6개월 이내 분납', law: '지방세법 제118조, 시행령 제116조, 종부세법 제20조' },
    ];
    if (!cf.entries.length) { toast('계산된 세금이 없어 엑셀로 낼 내용이 없습니다.'); return; }
    const btn = document.querySelector('[data-act="xlsx"]');
    if (btn.disabled) return;
    btn.disabled = true;
    toast('엑셀 파일을 만드는 중…');
    try {
      extra.push(...window.HTMRelief.NOTES);
      await window.HTMXlsx.download({ fileName: `보유세맵_상업용_${r.year}.xlsx`, title: '보유세맵 — 상업용 부동산 보유세 계산', modeLabel: C.MODES[state.mode].label, summary, inputs, cf, basis: [...HT.BASIS, ...extra] });
      toast('엑셀 파일을 내려받았습니다.');
    } catch (err) {
      toast(err.message);
    } finally {
      btn.disabled = false;
    }
  }

  function render() {
    const focus = document.activeElement && document.activeElement.dataset ? { ...document.activeElement.dataset } : null;
    const result = renderResults();
    $('#parcels').innerHTML = V.parcels(state, result, activeId, register);
    $('#pcount').textContent = state.parcels.length ? `${state.parcels.length}필지` : '';
    document.querySelectorAll('[data-owner]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.owner === state.ownerType)));
    $('#growth').value = state.growth;
    $('#mode').value = state.mode;
    $('#cf-years').value = String(state.cfYears);
    $('#cf-install').checked = state.cfInstall;
    document.querySelectorAll('[data-prev]').forEach(el => {
      if (document.activeElement !== el) el.value = state.prev[el.dataset.prev] > 0 ? Number(state.prev[el.dataset.prev]).toLocaleString('ko-KR') : '';
    });
    ns.map.sync(state.parcels, activeId, select);
    restoreFocus(focus);
  }

  /** 다시 그린 뒤 입력하던 칸으로 포커스를 돌려준다 */
  function restoreFocus(d) {
    if (!d || !d.f) return;
    const sel = `[data-pid="${CSS.escape(d.pid || '')}"][data-f="${CSS.escape(d.f)}"]${d.i != null ? `[data-i="${CSS.escape(d.i)}"]` : ''}`;
    const el = document.querySelector(sel);
    if (el) el.focus({ preventScroll: true });
  }

  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => el.classList.remove('show'), 2600);
  }

  /* ---------- 다시 조회 ---------- */
  /** 필지 경계 안의 한 점 — 꼭짓점 평균이 경계 밖이면(ㄷ자 등) 경계 안쪽 꼭짓점 근처로 */
  function innerPoint(geom) {
    const ring = geom && geom[0] && geom[0][0];
    if (!ring || !ring.length) return null;
    const inside = (lat, lng) => {
      let hit = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [ya, xa] = ring[i];
        const [yb, xb] = ring[j];
        if ((ya > lat) !== (yb > lat) && lng < ((xb - xa) * (lat - ya)) / (yb - ya) + xa) hit = !hit;
      }
      return hit;
    };
    const lat = ring.reduce((t, pt) => t + pt[0], 0) / ring.length;
    const lng = ring.reduce((t, pt) => t + pt[1], 0) / ring.length;
    if (inside(lat, lng)) return { lat, lng };
    for (const [a, b] of ring) {
      const c = { lat: a + (lat - a) * 0.05, lng: b + (lng - b) * 0.05 };
      if (inside(c.lat, c.lng)) return c;
    }
    return null;
  }

  /** 저장된 필지의 공시지가·면적·지목·용도지역을 지금 값으로 — 지분·건물·감면 입력은 그대로 */
  async function refreshParcel(pid) {
    const p = state.parcels.find(x => x.id === pid);
    const pt = p && innerPoint(p.geom);
    if (!pt) { toast('경계 정보가 없어 다시 조회할 수 없습니다. 지도에서 다시 담아 주세요.'); return; }
    toast('필지를 다시 조회하는 중…');
    try {
      const found = await ns.vworld.parcelAt(pt.lat, pt.lng);
      if (!found || found.pnu !== p.pnu) { toast('같은 필지를 찾지 못했습니다. 지도에서 다시 담아 주세요.'); return; }
      const keep = { price: found.price, priceYear: found.priceYear, area: found.area, areaSource: found.areaSource, jimok: found.jimok, zoneName: found.zoneName, geom: found.geom || p.geom };
      setState(mapParcel(pid, x => (found.zone ? withZone({ ...x, ...keep }, found.zone) : { ...x, ...keep })));
      toast(found.priceYear >= window.BuildingValue.BASE_YEAR ? `${found.priceYear}년 공시지가로 바꿨습니다.` : `아직 ${found.priceYear}년 공시지가만 조회됩니다.`);
    } catch (err) {
      toast(err.message);
    }
  }

  /* ---------- 건축물대장 ---------- */
  async function loadRegister(pid) {
    const p = state.parcels.find(x => x.id === pid);
    if (!p || !p.pnu) return;
    const seq = ++regSeq;
    register.set(pid, { status: 'loading', seq });
    render();
    const current = () => register.get(pid) && register.get(pid).seq === seq;
    try {
      const list = (await ns.vworld.buildingsAt(p.pnu)).map(window.HTMBldReg.toDong);
      if (!current()) return;
      // 처음에는 계산할 수 있는 주건축물을 골라 둔다(없으면 계산 가능한 첫 동)
      const usable = list.map((x, i) => (x.skip ? -1 : i)).filter(i => i >= 0);
      const mains = usable.filter(i => list[i].main);
      register.set(pid, { status: 'ok', seq, list, picked: new Set(mains.length ? mains : usable.slice(0, 1)) });
    } catch (err) {
      if (!current()) return;
      register.set(pid, { status: 'error', seq, error: err.message || '건축물대장을 불러오지 못했습니다.' });
    }
    render();
  }

  /** 집합건축물 동의 호 목록 */
  async function loadUnits(pid, i) {
    const p = state.parcels.find(x => x.id === pid);
    const r = register.get(pid);
    if (!p || !r || r.status !== 'ok' || !r.list[i]) return;
    if (r.units && r.units.i === i && r.units.status === 'loading') return;
    const title = r.list[i];
    // 예전 응답(동 원래 이름 없음): 동이 하나면 이름 없이, 여러 개면 표시 이름으로 조회
    const dong = title.rawDong !== undefined ? title.rawDong : r.list.length === 1 || title.name === '건물' ? '' : title.name;
    const seq = ++regSeq;
    register.set(pid, { ...r, units: { i, seq, status: 'loading' } });
    render();
    const live = () => {
      const cur = register.get(pid);
      return cur && cur.units && cur.units.seq === seq ? cur : null;
    };
    try {
      const res = await ns.vworld.unitsAt(p.pnu, dong);
      const cur = live();
      if (!cur) return;
      const list = (res.units || []).map(u => window.HTMBldReg.toUnit(u, title.raw));
      register.set(pid, { ...cur, units: { i, seq, status: 'ok', list, picked: new Set(), truncated: Boolean(res.truncated) } });
    } catch (err) {
      const cur = live();
      if (!cur) return;
      register.set(pid, { ...cur, units: { i, seq, status: 'error', error: err.message || '호 목록을 불러오지 못했습니다.' } });
    }
    render();
  }

  /** 고른 호를 각각 한 '동' 입력으로 — 호마다 따로 계산 */
  function applyUnits(pid) {
    const r = register.get(pid);
    const u = r && r.units;
    if (!u || u.status !== 'ok') return;
    const picked = u.list.filter((x, j) => u.picked.has(j) && !x.skip).slice(0, S.MAX_DONGS);
    if (!picked.length) return;
    const dongs = picked.map(x => ({ name: x.name, structure: x.structure, builtYear: x.builtYear || 2010, floors: x.floors, fire: 'auto', rows: x.rows }));
    register.delete(pid);
    setState(mapParcel(pid, p => ({ ...p, bld: { ...(p.bld || S.newBuilding()), mode: 'estimate', dongs } })));
    toast(`${picked.length}개 호를 넣었습니다. 토지 '내 지분'은 대지권 비율로 고치세요.`);
  }

  /** 고른 동을 건물 입력에 넣는다 — 한 동이면 기존 입력칸에, 여러 동이면 동 목록으로 */
  function applyRegister(pid) {
    const r = register.get(pid);
    if (!r || r.status !== 'ok') return;
    const picked = r.list.filter((d, i) => r.picked.has(i) && !d.skip);
    if (!picked.length) return;
    const footprint = picked.reduce((s, d) => s + d.footprint, 0);
    const dong = d => ({ name: d.name, structure: d.structure, builtYear: d.builtYear || 2010, floors: d.floors, fire: 'auto', rows: d.rows });
    register.delete(pid);
    setState(mapParcel(pid, p => {
      const base = { ...(p.bld || S.newBuilding()), mode: 'estimate', footprint: footprint || (p.bld && p.bld.footprint) || 0 };
      if (picked.length === 1) {
        const { name, ...one } = dong(picked[0]); // eslint-disable-line no-unused-vars — 한 동은 기존 입력칸 그대로
        return { ...p, bld: { ...base, ...one, dongs: [] } };
      }
      return { ...p, bld: { ...base, dongs: picked.map(dong) } };
    }));
    const notes = picked.flatMap(d => d.notes);
    toast(notes.length ? notes[0] : `건축물대장 ${picked.length}개 동을 넣었습니다. 가감산율은 직접 확인하세요.`);
  }

  /* ---------- 필지 추가 ---------- */
  function addParcel(fields) {
    if (state.parcels.length >= S.MAX_PARCELS) { toast(`공개판은 ${S.MAX_PARCELS}필지까지 담을 수 있습니다.`); return null; }
    const base = S.cleanParcel({ ...fields, id: S.uid() });
    const est = HT.estimateClass(base.jimok, base.zone, state.ownerType);
    const p = { ...base, cls: fields.cls || est.cls };
    activeId = p.id;
    setState({ ...state, parcels: [...state.parcels, p] });
    return p;
  }

  async function addAt(latlng) {
    if (!ns.vworld.enabled()) {
      toast('지도 조회용 VWorld 키가 아직 설정되지 않았습니다. 아래 “직접 입력”으로 계산하세요.');
      return;
    }
    toast('필지를 조회하는 중…');
    try {
      const found = await ns.vworld.parcelAt(latlng.lat, latlng.lng);
      if (!found) { toast('이 위치에서 필지를 찾지 못했습니다.'); return; }
      const dup = state.parcels.find(p => p.pnu === found.pnu);
      if (dup) { select(dup.id); toast('이미 담은 필지입니다.'); return; }
      const added = addParcel(found);
      if (added && found.zone) setState(mapParcel(added.id, x => withZone(x, found.zone))); // 용도지역 → 도시지역분·과세구분 추정
      toast(`${found.jibun} 필지를 담았습니다 — 면적·과세구분을 확인하세요.`);
      scrollToCard(activeId);
    } catch (err) {
      toast(err.message);
    }
  }

  function select(id) {
    activeId = id;
    render();
    ns.map.focus(state.parcels.find(p => p.id === id));
    scrollToCard(id);
  }

  function scrollToCard(id) {
    const el = document.querySelector(`[data-card="${CSS.escape(id)}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function demo() {
    const p = addParcel({
      addr: '예시 · 서울 마포구 상가건물', jibun: '예시', jimok: '대', zone: '상업지역', area: 330, price: 12500000, priceYear: 2026,
      sgg: 'demo', sggName: '서울특별시 마포구',
      bld: { mode: 'estimate', structure: 'rc', builtYear: 2008, floors: 7, rate: 'general', fire: 'auto',
        rows: [{ use: 'retail', area: 280, adjust: 1.27 }, { use: 'office', area: 1650, adjust: 1 }] },
    });
    if (p) setState(mapParcel(p.id, x => withZone(x, '상업지역')));
  }

  /* ---------- 이벤트 ---------- */
  function onParcelsEvent(e) {
    const el = e.target.closest('[data-f]');
    if (!el || !el.dataset.pid) return;
    const i = el.dataset.i != null ? Number(el.dataset.i) : null;
    const raw = el.type === 'checkbox' ? el.checked : el.value;
    const text = el.tagName === 'INPUT' && el.type === 'text';
    const live = e.type === 'input' && text;
    // 입력 중 다른 버튼을 누르면 blur→change 재렌더가 그 버튼을 지워 클릭이 사라진다 → 포인터를 뗀 뒤 그린다
    if (e.type === 'change' && text && pointerDown) {
      state = mapParcel(el.dataset.pid, p => applyField(p, el.dataset.f, raw, i));
      S.save(state);
      pendingRender = true;
      return;
    }
    setState(mapParcel(el.dataset.pid, p => applyField(p, el.dataset.f, raw, i)), { full: !live });
  }

  const actions = {
    del: d => { setState({ ...state, parcels: state.parcels.filter(p => p.id !== d.pid) }); },
    manual: () => { addParcel({ area: 0, price: 0, sggName: '직접 입력' }); scrollToCard(activeId); },
    demo,
    'bld-add': d => setState(mapParcel(d.pid, p => ({ ...p, bld: S.newBuilding() }))),
    'bld-del': d => setState(mapParcel(d.pid, p => ({ ...p, bld: null }))),
    refresh: d => refreshParcel(d.pid),
    'reg-load': d => loadRegister(d.pid),
    'reg-pick': d => {
      const r = register.get(d.pid);
      if (!r || r.status !== 'ok') return;
      const picked = new Set(r.picked);
      const i = Number(d.i);
      if (picked.has(i)) picked.delete(i); else picked.add(i);
      register.set(d.pid, { ...r, picked });
      render();
    },
    'reg-apply': d => applyRegister(d.pid),
    'reg-close': d => { register.delete(d.pid); render(); },
    'unit-load': d => loadUnits(d.pid, Number(d.i)),
    'unit-pick': d => {
      const r = register.get(d.pid);
      if (!r || !r.units || r.units.status !== 'ok') return;
      const picked = new Set(r.units.picked);
      const j = Number(d.i);
      if (picked.has(j)) picked.delete(j);
      else if (picked.size < S.MAX_DONGS) picked.add(j);
      else toast(`호는 한 번에 ${S.MAX_DONGS}개까지 넣을 수 있습니다.`);
      register.set(d.pid, { ...r, units: { ...r.units, picked } });
      render();
    },
    'unit-apply': d => applyUnits(d.pid),
    'unit-close': d => { const r = register.get(d.pid); if (r) { register.set(d.pid, { ...r, units: null }); render(); } },
    'dong-del': d => setState(mapParcel(d.pid, p => ({ ...p, bld: { ...p.bld, dongs: p.bld.dongs.filter((_, j) => j !== Number(d.i)) } }))),
    'dong-clear': d => setState(mapParcel(d.pid, p => ({ ...p, bld: { ...p.bld, dongs: [] } }))),
    'bld-mode': d => setState(mapParcel(d.pid, p => ({ ...p, bld: { ...p.bld, mode: d.v } }))),
    'row-add': d => setState(mapParcel(d.pid, p => (p.bld.rows.length >= S.MAX_ROWS ? p
      : { ...p, bld: { ...p.bld, rows: [...p.bld.rows, { use: 'retail', area: 0, adjust: 1 }] } }))),
    'row-del': d => setState(mapParcel(d.pid, p => ({ ...p, bld: { ...p.bld, rows: p.bld.rows.filter((_, j) => j !== Number(d.i)) } }))),
    share: async () => {
      const url = `${location.origin}${location.pathname}#s=${S.encode(state)}`;
      try {
        await navigator.clipboard.writeText(url);
        toast('계산 결과 링크를 복사했습니다. 받는 사람도 같은 값으로 봅니다.');
      } catch (_) {
        history.replaceState(null, '', url);
        toast('주소창의 링크를 복사해 공유하세요.');
      }
    },
    print: () => window.print(),
    xlsx: () => downloadXlsx(),
    save: () => {
      const r = C.compute(state);
      const name = state.parcels.map(p => p.addr).filter(Boolean).slice(0, 2).join(', ') || `필지 ${state.parcels.length}개`;
      const entry = { name: name.slice(0, 40), at: new Date().toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }), total: r.totals.total, state: { ...state, parcels: state.parcels.map(p => ({ ...p, geom: null })) } };
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify([entry, ...readHistory()].slice(0, MAX_HISTORY)));
        toast('이 기기에 계산을 저장했습니다.');
      } catch (_) { toast('이 브라우저에서는 저장할 수 없습니다.'); }
    },
    history: showHistory,
    restore: d => {
      const h = readHistory()[Number(d.i)];
      if (!h) return;
      activeId = null;
      setState(S.clean(h.state));
      toast(`"${h.name}" 계산을 불러왔습니다.`);
    },
    'history-clear': () => { try { localStorage.removeItem(HISTORY_KEY); } catch (_) { /* 무시 */ } showHistory(); },
  };

  function readHistory() {
    try {
      const r = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
      return Array.isArray(r) ? r.slice(0, MAX_HISTORY) : [];
    } catch (_) { return []; }
  }

  function showHistory() {
    const list = readHistory();
    $('#history').hidden = false;
    $('#history-list').innerHTML = list.length
      ? list.map((h, i) => `<li><button type="button" data-act="restore" data-i="${i}"><b>${V.esc(h.name)}</b><span>${V.esc(h.at)} · ${V.won(h.total)}원</span></button></li>`).join('')
      : '<li class="muted">저장한 계산이 없습니다. "계산 기록 저장"을 누르면 이 기기에 보관됩니다.</li>';
    $('#history').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function onClick(e) {
    const btn = e.target.closest('[data-act]');
    if (btn && actions[btn.dataset.act]) { actions[btn.dataset.act](btn.dataset); return; }
    const card = e.target.closest('[data-card]');
    if (card && !e.target.closest('input,select,button,label') && card.dataset.card !== activeId) select(card.dataset.card);
  }

  async function onSearch(e) {
    e.preventDefault();
    const q = $('#q').value.trim();
    const box = $('#results');
    if (!q) return;
    if (!ns.vworld.enabled()) { toast('주소 검색은 VWorld 키 설정 후 사용할 수 있습니다. 직접 입력으로 계산하세요.'); return; }
    box.innerHTML = '<li class="muted">검색 중…</li>';
    try {
      const items = await ns.vworld.search(q);
      box.innerHTML = items.length
        ? items.map((it, k) => `<li><button type="button" data-k="${k}">${V.esc(it.title)}<small>${V.esc(it.sub)}</small></button></li>`).join('')
        : '<li class="muted">검색 결과가 없습니다. 지번 주소로 다시 검색해 보세요.</li>';
      box.onclick = ev => {
        const b = ev.target.closest('[data-k]');
        if (!b) return;
        const it = items[Number(b.dataset.k)];
        box.innerHTML = '';
        ns.map.flyTo(it.lat, it.lng);
        addAt({ lat: it.lat, lng: it.lng });
      };
    } catch (err) {
      box.innerHTML = `<li class="muted">${V.esc(err.message)}</li>`;
    }
  }

  function setOwner(type) {
    const ownerType = type === '개인' ? '개인' : '법인';
    const parcels = state.parcels.map(p => (p.clsAuto ? { ...p, cls: HT.estimateClass(p.jimok, p.zone, ownerType).cls } : p));
    setState({ ...state, ownerType, parcels });
  }

  function initAds() {
    if (!cfg.ADSENSE_CLIENT || !cfg.ADSENSE_SLOT) return;
    const s = document.createElement('script');
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(cfg.ADSENSE_CLIENT)}`;
    document.head.appendChild(s);
    document.querySelectorAll('.ad-slot').forEach(slot => {
      slot.hidden = false;
      slot.innerHTML = `<ins class="adsbygoogle" style="display:block" data-ad-client="${V.esc(cfg.ADSENSE_CLIENT)}" data-ad-slot="${V.esc(cfg.ADSENSE_SLOT)}" data-ad-format="auto" data-full-width-responsive="true"></ins>`;
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    });
  }

  function boot() {
    const m = location.hash.match(/^#s=([A-Za-z0-9_-]+)$/);
    const shared = m ? S.decode(m[1]) : null;
    state = shared || S.load() || S.initial();
    if (m) history.replaceState(null, '', location.pathname); // 이후 편집이 새로고침에도 유지되도록 공유 해시 제거
    if (shared) toast('공유된 계산을 불러왔습니다.');
    else if (m) toast('공유 링크를 읽지 못했습니다. 저장된 계산을 표시합니다.');
    $('#vw-off').hidden = ns.vworld.enabled();
    ns.map.init($('#map'), { onClick: addAt });
    $('#parcels').addEventListener('input', onParcelsEvent);
    $('#parcels').addEventListener('change', onParcelsEvent);
    document.addEventListener('click', onClick);
    document.addEventListener('pointerdown', () => { pointerDown = true; }, true);
    const release = () => {
      pointerDown = false;
      if (pendingRender) { pendingRender = false; setTimeout(render, 0); } // click 처리 뒤
    };
    document.addEventListener('pointerup', release, true);
    document.addEventListener('pointercancel', release, true);
    $('#search').addEventListener('submit', onSearch);
    document.querySelectorAll('[data-owner]').forEach(b => b.addEventListener('click', () => setOwner(b.dataset.owner)));
    $('#cf-years').addEventListener('change', e => setState({ ...state, cfYears: Number(e.target.value) }));
    $('#cf-install').addEventListener('change', e => setState({ ...state, cfInstall: e.target.checked }));
    $('#mode').addEventListener('change', e => setState({ ...state, mode: e.target.value === '2027reform' ? '2027reform' : '2026' }));
    document.querySelectorAll('[data-prev]').forEach(el => el.addEventListener('change', () => setState({ ...state, prev: { ...state.prev, [el.dataset.prev]: parseNum(el.value) } })));
    $('#growth').addEventListener('change', e => setState({ ...state, growth: Math.min(30, parseNum(e.target.value)) }));
    $('#basis').innerHTML = V.basis();
    render();
    initAds();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window.HTM = window.HTM || {});
