// data.json(앱에서 내보낸 조사 결과)을 읽어 화면에 그린다. 모든 텍스트는 textContent 로만 넣는다.
const $ = (id) => document.getElementById(id);
const UNKNOWN = '[확인 불가]';
const PICK_KEY = 'threads-lab-items';   // Threads Lab 페이지가 읽어 가는 자리(같은 사이트라 그대로 전달된다)
const MAX_PICKS = 5;                    // 하루 배치가 글 5개라 소재도 5개까지
const picked = new Map();               // keyword -> 소재 한 줄

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

/** 소재 한 줄: `상품명 | 확인한 사실`. 확인한 사실은 네이버에서 실제로 본 숫자만 적는다. */
function materialLine(row, checkedOn) {
  return `${row.keyword} | 네이버 월 검색 ${row.volume}회(${checkedOn} 확인), ${row.category || '미분류'} 분류`;
}

function card(row, checkedOn) {
  const item = h('li', 'glass material');
  const box = h('input');
  box.type = 'checkbox';
  box.className = 'pick';
  box.id = `pick-${row.rank}`;
  box.checked = picked.has(row.keyword);
  box.addEventListener('change', () => toggle(row, checkedOn, box, item));

  const label = h('label', 'material-head');
  label.htmlFor = box.id;
  const head = h('div', 'material-top');
  head.append(h('span', 'rank', String(row.rank ?? '')), h('span', 'volume', `월 ${comma(row.volume)}회`));
  label.append(head, h('h3', '', row.keyword));

  const tags = h('div', 'tags');
  tags.append(h('span', 'tag on', row.category || '미분류'),
              h('span', 'tag', `수수료 ${row.commission || UNKNOWN}`),
              h('span', 'tag', `경쟁 ${row.competition || UNKNOWN}`));
  item.append(box, label, tags, h('p', 'why', row.reason || ''));
  item.classList.toggle('chosen', picked.has(row.keyword));
  return item;
}

function toggle(row, checkedOn, box, item) {
  if (box.checked && !picked.has(row.keyword)) {
    if (picked.size >= MAX_PICKS) {
      box.checked = false;
      bar(`소재는 ${MAX_PICKS}개까지만 고를 수 있습니다. 하나를 빼고 다시 고르세요.`);
      return;
    }
    picked.set(row.keyword, materialLine(row, checkedOn));
  } else if (!box.checked) {
    picked.delete(row.keyword);
  }
  item.classList.toggle('chosen', box.checked);
  bar();
}

/** 아래 고정 막대: 고른 개수와 보내기 버튼. */
function bar(message) {
  const box = $('picked');
  const count = picked.size;
  box.classList.toggle('on', count > 0 || Boolean(message));
  $('picked-count').textContent = `${count} / ${MAX_PICKS}`;
  $('picked-list').textContent = [...picked.keys()].join(' · ');
  $('picked-note').textContent = message || (count ? '보내면 Threads Lab 소재 칸에 들어갑니다. 거기서 고치거나 더 적어도 됩니다.' : '');
  $('picked-send').disabled = count === 0;
}

function send() {
  try {
    localStorage.setItem(PICK_KEY, JSON.stringify([...picked.values()]));
  } catch (error) {
    bar('이 브라우저가 저장을 막고 있어 전달하지 못했습니다. 소재를 직접 적어 주세요.');
    return;
  }
  location.href = '../threads-lab/#draft-heading';
}

function draw(data, category) {
  const rows = category === '전체' ? data.rows : data.rows.filter((row) => row.category === category);
  const list = $('list');
  list.replaceChildren(...rows.map((row) => card(row, data.checked_on)));
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
    $('picked-send').addEventListener('click', send);
    $('picked-clear').addEventListener('click', () => {
      picked.clear();
      document.querySelectorAll('.pick').forEach((box) => { box.checked = false; });
      document.querySelectorAll('.material').forEach((item) => item.classList.remove('chosen'));
      bar();
    });
    bar();
  } catch (error) {
    $('notes').textContent = `조사 결과를 불러오지 못했습니다 (${error.message}). PC 앱에서 다시 내보내 주세요.`;
  }
}

load();
