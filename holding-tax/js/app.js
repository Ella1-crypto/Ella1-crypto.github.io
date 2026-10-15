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

  let state = S.initial();
  let activeId = null;
  let saveTimer = null;
  let pointerDown = false;
  let pendingRender = false;

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
      case 'price': return { ...p, price: parseNum(raw), priceYear: null }; // 사용자가 넣은 값은 연도 경고를 끈다
      case 'addr': return { ...p, addr: String(raw).slice(0, 80) };
      case 'zone': return withZone(p, raw);
      case 'cls': return { ...p, cls: raw, clsAuto: false };
      case 'urban': return { ...p, urban: Boolean(raw) };
      default: break;
    }
    if (f.startsWith('bld.')) {
      const k = f.slice(4);
      const numeric = ['builtYear', 'floors', 'direct'];
      const v = numeric.includes(k) ? parseNum(raw) : (k === 'fire' && raw !== 'auto' ? Number(raw) : raw);
      return { ...p, bld: { ...p.bld, [k]: v } };
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
    $('#detail').innerHTML = V.landDetail(result.land) + V.buildingDetail(result.buildings, state.parcels);
    $('#schedule').innerHTML = V.schedule(result);
    $('#projection').innerHTML = V.projection(result, state.growth);
    $('#mbar-total').textContent = `${V.won(result.totals.total)}원`;
    return result;
  }

  function render() {
    const focus = document.activeElement && document.activeElement.dataset ? { ...document.activeElement.dataset } : null;
    const result = renderResults();
    $('#parcels').innerHTML = V.parcels(state, result, activeId);
    $('#pcount').textContent = state.parcels.length ? `${state.parcels.length}필지` : '';
    document.querySelectorAll('[data-owner]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.owner === state.ownerType)));
    $('#growth').value = state.growth;
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
  };

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
    document.addEventListener('pointerup', () => {
      pointerDown = false;
      if (pendingRender) { pendingRender = false; setTimeout(render, 0); } // click 처리 뒤
    }, true);
    $('#search').addEventListener('submit', onSearch);
    document.querySelectorAll('[data-owner]').forEach(b => b.addEventListener('click', () => setOwner(b.dataset.owner)));
    $('#growth').addEventListener('change', e => setState({ ...state, growth: Math.min(30, parseNum(e.target.value)) }));
    $('#basis').innerHTML = V.basis();
    render();
    initAds();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window.HTM = window.HTM || {});
