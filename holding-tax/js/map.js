/* Leaflet 지도 — VWorld 배경(키가 있을 때) 또는 OSM, 담은 필지 경계 표시 */
(function (ns) {
  'use strict';
  const DEFAULT_CENTER = [37.4979, 127.0276]; // 강남역
  let map = null;
  const layers = new Map(); // parcel id → L.Polygon

  function init(el, { onClick }) {
    map = L.map(el, { zoomControl: true, zoomSnap: 0.5, wheelPxPerZoomLevel: 90 }).setView(DEFAULT_CENTER, 17);
    const key = ns.vworld.tileKey();
    const tiles = key
      ? L.tileLayer(`https://api.vworld.kr/req/wmts/1.0.0/${encodeURIComponent(key)}/Base/{z}/{y}/{x}.png`, { maxZoom: 19, attribution: '© VWorld' })
      : L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' });
    tiles.addTo(map);
    map.on('click', e => onClick(e.latlng));
    return map;
  }

  function labelEl(text) {
    const el = document.createElement('span'); // 툴팁에 문자열을 넣으면 innerHTML이 되므로 텍스트 노드로 전달
    el.textContent = String(text || '');
    return el;
  }

  /** 담은 필지 목록과 지도 레이어를 맞춘다 */
  function sync(parcels, activeId, onSelect) {
    if (!map) return;
    const ids = new Set(parcels.map(p => p.id));
    for (const [id, ly] of layers) {
      if (!ids.has(id)) { map.removeLayer(ly); layers.delete(id); }
    }
    parcels.forEach((p, i) => {
      if (!p.geom) return;
      let ly = layers.get(p.id);
      if (!ly) {
        try {
          ly = L.polygon(p.geom, { className: 'parcel-path', weight: 2, bubblingMouseEvents: false }).addTo(map);
        } catch (_) {
          return; // 경계가 깨진 필지는 지도에만 안 그린다
        }
        ly.on('click', () => onSelect(p.id));
        layers.set(p.id, ly);
      }
      ly.unbindTooltip();
      ly.bindTooltip(labelEl(`${i + 1}. ${p.jibun}`), { permanent: true, direction: 'center', className: 'jibun' });
      const path = ly.getElement();
      if (path) path.classList.toggle('is-active', p.id === activeId);
    });
  }

  function flyTo(lat, lng, zoom = 18) {
    if (map) map.flyTo([lat, lng], zoom, { duration: 0.6 });
  }

  function focus(parcel) {
    const ly = parcel && layers.get(parcel.id);
    if (ly && map) map.flyToBounds(ly.getBounds(), { maxZoom: 18, duration: 0.6 });
  }

  function invalidate() { if (map) map.invalidateSize(); }

  ns.map = Object.freeze({ init, sync, flyTo, focus, invalidate });
})(window.HTM = window.HTM || {});
