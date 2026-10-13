// lab-core.js 의 규칙을 화면에 연결한다. 모든 텍스트는 textContent 로만 넣는다(innerHTML 미사용).
import {
  BATCH_SIZE as MAX_ITEMS, DISCLOSURE, buildBlogPrompt, SHORTS_SLOT, SLOTS, buildDraftPrompt, checkBatch, checkPost, dayNumber, findConflicts,
  kstDateString, parseDrafts, parseItems, parseTimes, phaseFor, splitBatch, splitLines,
} from './lab-core.js?v=20261013g';
import { requestAnalysis } from './llm.js?v=20261013g';

const LEVEL_LABEL = { pass: '통과', warn: '확인', fail: '수정' };
const SAMPLE_NAMES = '건조대, 선 정리함, 거치대, 회전 트레이';
const SAMPLE_BODIES = [
  ['퇴근하고 설거지통 보면 한숨부터 나오지', '물 빠지는 접이식 건조대가 요즘 자주 보이더라', '안 쓸 땐 말아서 서랍에 넣는 방식이래', '싱크대 좁은 집이면 눈여겨볼 만해'],
  ['책상 밑 멀티탭 선 엉킨 거 볼 때마다 못 본 척하게 돼', '해외 데스크 셋업 계정에서 선 정리함이 계속 올라오더라', '멀티탭째 넣고 뚜껑만 덮는 구조래'],
  ['아침마다 텀블러 뚜껑 찾다가 지각할 뻔한 적 있지', '해외 정리 계정들은 뚜껑만 따로 세워 두는 거치대를 쓰더라', '서랍 한 칸에 들어가는 크기라길래 눈에 띄었어'],
  ['냉장고 문 열 때마다 소스통 쓰러지는 집', '회전 트레이 하나로 뒤쪽 병까지 꺼낸다는 글을 봤어', '지름만 재 보고 맞는지 보면 된대'],
];
const SAMPLE_BAD = ['실리콘 건조대 이거 진짜 난리야', '해외 주방 계정에서 다들 쓰더라', '나도 한 달 써봤는데 9,900원에 이 정도면 무조건 사야 해',
  '로켓배송이라 내일 와', '색도 세 가지', 'https://example.com/item'];

const $ = (id) => document.getElementById(id);

function h(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function currentPhase() {
  const day = dayNumber($('date-input').value);
  return { day, phase: day === null ? null : phaseFor(day) };
}

function isLinkAllowed() {
  const mode = document.querySelector('input[name="mode"]:checked').value;
  if (mode !== 'auto') return mode === 'link';
  const { phase } = currentPhase();
  return Boolean(phase && phase.linkAllowed);
}

function renderToday() {
  const { day, phase } = currentPhase();
  $('dday-value').textContent = day === null ? 'D—' : `D${day < 1 ? day - 1 : day}`;
  $('phase-label').textContent = phase ? phase.label : '날짜를 골라 주세요';
  $('phase-detail').textContent = phase ? phase.detail : '';
  $('mode-auto').textContent = phase ? `기준일 따라 (${phase.linkAllowed ? '링크 버전' : '링크 없는 버전'})` : '기준일 따라';
  document.querySelectorAll('#track li').forEach((item) => {
    item.classList.toggle('on', Boolean(phase) && item.dataset.phase === phase.id);
  });
}

function renderSlots() {
  const { minutes, invalid } = parseTimes($('main-times').value);
  const conflicts = findConflicts(minutes);
  const rows = [...SLOTS.map((slot, index) => ({ slot, label: `글 ${index + 1}` })), { slot: SHORTS_SLOT, label: '쇼츠 1개' }];

  $('slots').replaceChildren(...rows.map(({ slot, label }) => {
    const hit = conflicts.find((conflict) => conflict.slot === slot);
    const row = h('li', hit ? 'glass slot clash' : 'glass slot');
    row.append(h('b', '', slot), h('span', 'slot-label', label),
      h('span', 'slot-state', hit ? `메인 ${hit.main}과 ${hit.gap}분 차이` : (minutes.length ? '간격 충분' : '')));
    return row;
  }));

  const messages = [];
  if (invalid.length) messages.push(`읽지 못한 값: ${invalid.join(', ')} (07:30 처럼 적어 주세요)`);
  if (minutes.length && conflicts.length) messages.push(`겹치는 시간대 ${conflicts.length}곳 — 이 글은 30분 이상 밀어서 올립니다.`);
  if (minutes.length && !conflicts.length) messages.push('모든 시간대가 메인 계정과 30분 이상 떨어져 있습니다.');
  if (!minutes.length && !invalid.length) messages.push('메인 계정이 글을 올리는 시각을 넣으면 겹치는 시간대를 표시합니다.');
  $('slots-result').textContent = messages.join(' ');
}

function findingItem(item) {
  const row = h('li', `finding ${item.level}`);
  row.append(h('span', 'level', LEVEL_LABEL[item.level]), h('span', 'msg', item.message));
  if (item.evidence) row.append(h('q', 'evidence', item.evidence));
  return row;
}

function resultCard(title, findings, preview) {
  const fails = findings.filter((f) => f.level === 'fail').length;
  const warns = findings.filter((f) => f.level === 'warn').length;
  const summary = fails ? `수정 ${fails}` : (warns ? `확인 ${warns}` : '통과');
  const card = h('article', `glass result ${fails ? 'fail' : (warns ? 'warn' : 'pass')}`);
  const head = h('header', 'result-head');
  head.append(h('h3', '', title), h('span', 'badge', summary));
  const list = h('ul', 'findings');
  list.append(...findings.map(findingItem));
  card.append(head);
  if (preview) card.append(h('p', 'preview', preview));
  card.append(list);
  return card;
}

function wireCopy(button, getText) {
  const label = button.textContent;
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(getText());
      button.textContent = '복사됨';
    } catch (error) {
      button.textContent = '복사 실패 — 직접 선택해 복사';
    }
    setTimeout(() => { button.textContent = label; }, 1800);
  });
}

function disclosureCard() {
  const card = h('article', 'glass result');
  const button = h('button', 'btn', '고지문 복사');
  button.type = 'button';
  wireCopy(button, () => DISCLOSURE);
  card.append(h('h3', '', '댓글 고지문'), h('p', 'preview', DISCLOSURE), button);
  return card;
}

function runCheck() {
  const posts = splitBatch($('draft').value);
  const root = $('results');
  if (posts.length === 0) {
    root.replaceChildren(h('p', 'empty', '확인할 글이 없습니다. 글을 붙여 넣은 뒤 다시 눌러 주세요.'));
    return;
  }
  const linkAllowed = isLinkAllowed();
  const productNames = $('names').value.split(',');
  const cards = posts.map((post, index) => resultCard(
    `글 ${index + 1}`, checkPost(post, { linkAllowed, productNames }), splitLines(post)[0],
  ));
  const batch = posts.length > 1 ? [resultCard('배치 전체', checkBatch(posts))] : [];
  root.replaceChildren(
    h('p', 'mode-line', `${linkAllowed ? '링크 버전' : '링크 없는 버전'} 기준으로 확인했습니다.`),
    ...batch, ...cards, ...(linkAllowed ? [disclosureCard()] : []),
  );
}

function fillSample() {
  const cta = isLinkAllowed() ? '링크 댓글에' : '써본 사람 있으면 알려줘';
  const posts = [...SAMPLE_BODIES.map((lines) => [...lines, cta]), SAMPLE_BAD];
  $('draft').value = posts.map((lines) => lines.join('\n')).join('\n---\n');
  $('names').value = SAMPLE_NAMES;
  runCheck();
}

const KEY_STORE = 'threads-lab-api-key';
const PICK_STORE = 'threads-lab-items';   // 소재 찾기 페이지가 넣어 둔 소재 (같은 사이트라 그대로 읽는다)

const ITEMS_STORE = 'threads-lab-draft-items';   // 소재 찾기 페이지에 다녀와도 적어 둔 소재가 남도록

function rememberItems() {
  try { localStorage.setItem(ITEMS_STORE, $('items').value); } catch (error) { /* 저장을 막아 둔 브라우저 */ }
}

function loadSavedItems() {
  try {
    const saved = localStorage.getItem(ITEMS_STORE) || '';
    if (saved && !$('items').value.trim()) $('items').value = saved;
  } catch (error) { /* 저장을 막아 둔 브라우저 */ }
}

/** 소재 찾기에서 고른 소재를 소재 칸에 넣는다. 직접 적어 둔 줄은 지우지 않고 뒤에 붙인다. */
function loadPickedMaterials() {
  let raw = '';
  try { raw = localStorage.getItem(PICK_STORE) || ''; localStorage.removeItem(PICK_STORE); } catch (error) { return; }
  if (!raw) return;
  let lines = [];
  try { lines = JSON.parse(raw); } catch (error) { return; }
  const sent = (Array.isArray(lines) ? lines : []).filter((line) => typeof line === 'string' && line.trim());
  if (sent.length === 0) return;
  const merged = [...new Set([...splitLines($('items').value), ...sent])].slice(0, MAX_ITEMS);
  $('items').value = merged.join('\n');
  $('generate-status').textContent = `소재 찾기에서 ${sent.length}개를 받았습니다. 고치거나 더 적은 뒤 초안을 만드세요.`;
}


/** 켜 두면 이 기기 브라우저에만 키를 남긴다(폰에서 매번 입력하지 않으려고). 끄면 바로 지운다. */
function rememberKey() {
  try {
    if ($('save-key').checked) localStorage.setItem(KEY_STORE, $('api-key').value.trim());
    else localStorage.removeItem(KEY_STORE);
  } catch (error) { /* 저장소를 막아 둔 브라우저에서는 그냥 저장하지 않는다 */ }
}

function loadSavedKey() {
  let saved = '';
  try { saved = localStorage.getItem(KEY_STORE) || ''; } catch (error) { saved = ''; }
  if (!saved) return;
  $('api-key').value = saved;
  $('save-key').checked = true;
}

async function generateDrafts() {
  const status = $('generate-status');
  const button = $('generate');
  const apiKey = $('api-key').value.trim();
  const { items, dropped } = parseItems($('items').value);
  if (items.length === 0) { status.textContent = '소재를 한 줄 이상 적어 주세요.'; return; }
  if (!apiKey) { status.textContent = 'API 키를 입력해 주세요.'; return; }

  button.disabled = true;
  status.textContent = `글 ${items.length}개를 쓰는 중입니다…`;
  const result = await requestAnalysis(apiKey, buildDraftPrompt(items, { linkAllowed: isLinkAllowed() }));
  button.disabled = false;
  if (!result.ok) { status.textContent = result.error; return; }

  const posts = parseDrafts(result.text);
  if (posts.length === 0) { status.textContent = '응답에서 글을 찾지 못했습니다. 다시 눌러 주세요.'; return; }
  $('draft').value = posts.join('\n---\n');
  $('names').value = items.map((item) => item.name).join(', ');
  runCheck();
  const extra = dropped ? ` 소재는 5개까지만 써서 ${dropped}개는 뺐습니다.` : '';
  status.textContent = `스레드 글 ${posts.length}개를 검수기에 넣었습니다. 이어서 블로그 초안을 쓰는 중입니다…${extra}`;
  $('check-heading').scrollIntoView({ block: 'start' });

  // 블로그는 글이 길어 한 번 더 부른다. 스레드 글은 이미 나왔으므로 여기서 실패해도 그대로 쓸 수 있다.
  button.disabled = true;
  const blog = await requestAnalysis(apiKey, buildBlogPrompt(items));
  button.disabled = false;
  if (!blog.ok) {
    status.textContent = `스레드 글 ${posts.length}개는 나왔습니다. 블로그 초안은 실패했습니다 — ${blog.error}`;
    return;
  }
  $('blog-draft').value = blog.text.trim();
  status.textContent = `스레드 글 ${posts.length}개와 블로그 초안 한 편을 만들었습니다.${extra}`;
}

function clearAll() {
  $('draft').value = '';
  $('names').value = '';
  $('results').replaceChildren(h('p', 'empty', '아직 검수한 글이 없습니다.'));
}

$('date-input').value = kstDateString(new Date());
$('date-input').addEventListener('input', renderToday);
$('main-times').addEventListener('input', renderSlots);
$('run').addEventListener('click', runCheck);
$('sample').addEventListener('click', fillSample);
$('clear').addEventListener('click', clearAll);
$('generate').addEventListener('click', generateDrafts);
$('save-key').addEventListener('change', rememberKey);
$('api-key').addEventListener('input', rememberKey);
loadSavedKey();
loadSavedItems();
loadPickedMaterials();
$('items').addEventListener('input', rememberItems);
wireCopy($('copy-draft'), () => $('draft').value);
wireCopy($('copy-blog'), () => $('blog-draft').value);
renderToday();
renderSlots();
