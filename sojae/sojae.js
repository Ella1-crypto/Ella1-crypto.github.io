// data.json(앱에서 내보낸 조사 결과)을 읽어 화면에 그린다. 모든 텍스트는 textContent 로만 넣는다.
const $ = (id) => document.getElementById(id);
const UNKNOWN = '[확인 불가]';

/** @param {string} tag @param {string} cls @param {string} text */
function h(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** '19310' -> '19,310'. 범위나 미확인 값은 그대로 둔다. */
function comma(value) {
  const text = String(value ?? '');
  return /^\d+$/.test(text) ? Number(text).toLocaleString('ko-KR') : text;
}

function card(row) {
  const item = h('li', 'glass material');
  const head = h('div', 'material-top');
  head.append(h('span', 'rank', String(row.rank ?? '')), h('span', 'volume', `월 ${comma(row.volume)}회`));
  const tags = h('div', 'tags');
  tags.append(h('span', 'tag on', row.category || '미분류'),
              h('span', 'tag', `수수료 ${row.commission || UNKNOWN}`),
              h('span', 'tag', `경쟁 ${row.competition || UNKNOWN}`));
  item.append(head, h('h3', '', row.keyword), tags, h('p', 'why', row.reason || ''));
  return item;
}

function draw(data, category) {
  const rows = category === '전체' ? data.rows : data.rows.filter((row) => row.category === category);
  const list = $('list');
  list.replaceChildren(...rows.map(card));
  if (rows.length === 0) list.replaceChildren(h('li', 'empty', '이 분류에는 후보가 없습니다.'));
}

function filters(data) {
  const names = ['전체', ...new Set(data.rows.map((row) => row.category))];
  const box = $('filters');
  const buttons = names.map((name) => {
    const button = h('button', 'chip', name);
    button.type = 'button';
    button.addEventListener('click', () => {
      buttons.forEach((other) => other.classList.toggle('on', other === button));
      draw(data, name);
    });
    return button;
  });
  buttons[0].classList.add('on');
  box.replaceChildren(...buttons);
}

async function load() {
  try {
    const response = await fetch(`data.json?t=${Date.now()}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    $('count').textContent = String(data.rows.length);
    $('checked').textContent = `확인일 ${data.checked_on}`;
    $('seeds').textContent = `기초 낱말 ${data.seeds.join(', ')} · 연관 ${comma(data.found)}개를 걸렀습니다`;
    $('notes').textContent = (data.notes || []).join(' ');
    $('source').textContent = `출처: ${(data.sources || []).join(' / ')} · 확인일 ${data.checked_on}`;
    filters(data);
    draw(data, '전체');
  } catch (error) {
    $('notes').textContent = `조사 결과를 불러오지 못했습니다 (${error.message}). PC 앱에서 다시 내보내 주세요.`;
  }
}

load();
