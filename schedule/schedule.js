// PC 앱에서 내보낸 schedule.json 을 읽어 예약 목록을 보여 준다. 여기서는 아무것도 올리지 않는다(게시는 PC 앱의 자동 발행).
const $ = (id) => document.getElementById(id);
const STATUS_MARK = { '예약': '⏳', '올리는 중': '📤', '올림': '✅' };

function h(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function row(item) {
  const line = h('li', 'queue-row glass');
  const when = item.time.replace('T', ' ').slice(5, 16);
  line.append(h('span', 'when', when),
              h('span', 'mark', STATUS_MARK[item.status] || item.status),
              h('span', 'title', item.title || '(제목 없음)'),
              h('span', 'tag', item.has_link ? '링크 댓글' : '링크 없음'));
  return line;
}

async function load() {
  try {
    const response = await fetch(`schedule.json?t=${Date.now()}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    $('count').textContent = String(data.total ?? (data.items || []).length);
    $('updated').textContent = `갱신 ${(data.updated_at || '').replace('T', ' ').slice(0, 16)}`;
    const days = Object.entries(data.by_day || {}).map(([day, count]) => `${day.slice(5)} ${count}건`).join(' · ');
    $('days').textContent = days ? `날짜별 ${days}` : '예약된 글이 없습니다';
    const failed = data.failed ? ` 실패 ${data.failed}건은 PC 앱 7번 탭에서 확인하세요.` : '';
    $('notes').textContent = `⏳ 예약 · 📤 올리는 중 · ✅ 올림. 글 내용은 첫 줄만 싣고, 취소한 글은 싣지 않습니다.${failed}`;
    $('queue').replaceChildren(...(data.items || []).map(row));
    if ((data.items || []).length === 0) $('queue').replaceChildren(h('li', 'empty', '예약된 글이 없습니다.'));
  } catch (error) {
    $('notes').textContent = `예약 목록을 불러오지 못했습니다 (${error.message}). PC 앱 7번 탭에서 "사이트에 반영하기"를 눌러 주세요.`;
  }
}

load();
