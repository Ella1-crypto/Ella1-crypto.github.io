// 스레드 초안을 쇼츠 장면으로 나눈다. 규칙은 PC 앱(src/thread_media.py)과 같다:
// 장면 최대 4개, 첫 장면 3초 이하, 합계 7~15초, 말하는 속도 초당 5.5자(공백 제외).
const $ = (id) => document.getElementById(id);
const DRAFTS_STORE = 'threads-lab-drafts';   // 스레드 초안 페이지가 남겨 둔 글
const MAX_SCENES = 4;
const MIN_SCENE = 2;
const HOOK_MAX = 3;
const TOTAL_MIN = 7;
const TOTAL_MAX = 15;
const CHARS_PER_SECOND = 5.5;
const CAPTION_MAX = 22;

const splitLines = (text) => (text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
const splitPosts = (text) => (text || '').split(/^\s*-{3,}\s*$/m).map((part) => splitLines(part).join('\n')).filter(Boolean);
const spokenSeconds = (text) => text.replace(/\s/g, '').length / CHARS_PER_SECOND;

function h(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** 훅(첫 줄)과 CTA(마지막 줄)는 각자 한 장면, 가운데 줄은 나눠 담는다. */
function groupLines(post) {
  const lines = splitLines(post);
  if (lines.length === 0) return [];
  if (lines.length <= MAX_SCENES) return lines.map((line) => [line]);
  const middle = lines.slice(1, -1);
  const slots = MAX_SCENES - 2;
  const size = Math.ceil(middle.length / slots);
  const groups = [];
  for (let at = 0; at < middle.length; at += size) groups.push(middle.slice(at, at + size));
  return [[lines[0]], ...groups.slice(0, slots), [lines[lines.length - 1]]];
}

function fitDurations(groups) {
  if (groups.length === 0) return [];
  const want = groups.map((group) => Math.max(MIN_SCENE, Math.round(spokenSeconds(group.join(' ')) + 0.5)));
  if (groups.length === 1) return [Math.min(Math.max(want[0], TOTAL_MIN), TOTAL_MAX)];
  const seconds = [Math.min(want[0], HOOK_MAX), ...want.slice(1).map((value) => Math.min(value, 6))];
  const sum = () => seconds.reduce((a, b) => a + b, 0);
  let index = seconds.length - 1;
  while (sum() < TOTAL_MIN) {
    seconds[index] += 1;
    index = index <= 1 ? seconds.length - 1 : index - 1;
  }
  while (sum() > TOTAL_MAX) {
    const longest = seconds.indexOf(Math.max(...seconds));
    if (seconds[longest] <= MIN_SCENE) break;
    seconds[longest] -= 1;
  }
  return seconds;
}

function scenes(post) {
  const groups = groupLines(post);
  return groups.map((group, index) => {
    const narration = group.join(' ');
    const first = group[0];
    return {
      seconds: fitDurations(groups)[index],
      narration,
      caption: first.length <= CAPTION_MAX ? first : `${first.slice(0, CAPTION_MAX - 1)}…`,
    };
  });
}

function sceneRow(scene, number) {
  const row = h('li', 'scene glass');
  const top = h('div', 'scene-top');
  top.append(h('span', 'rank', `컷 ${number}`), h('span', 'volume', `${scene.seconds}초`));
  row.append(top, h('h3', '', scene.caption), h('p', 'why', `읽을 말: ${scene.narration}`));
  return row;
}

function asText(post, list) {
  const total = list.reduce((sum, scene) => sum + scene.seconds, 0);
  const lines = [`[쇼츠 대본] 총 ${total}초 · 컷 ${list.length}개`, ''];
  list.forEach((scene, index) => {
    lines.push(`컷 ${index + 1} (${scene.seconds}초)`, `자막: ${scene.caption}`, `읽을 말: ${scene.narration}`, '');
  });
  lines.push('원문', post);
  return lines.join('\n');
}

function draw(posts) {
  const box = $('shorts-list');
  if (posts.length === 0) {
    box.replaceChildren(h('p', 'empty', '스레드 초안이 없습니다. 2번 메뉴에서 글을 먼저 만드세요.'));
    return;
  }
  box.replaceChildren(...posts.map((post, index) => {
    const list = scenes(post);
    const total = list.reduce((sum, scene) => sum + scene.seconds, 0);
    const card = h('section', 'post-card');
    const head = h('div', 'post-head');
    head.append(h('h3', '', `글 ${index + 1} — ${splitLines(post)[0].slice(0, 24)}`),
                h('span', 'badge', `${total}초 · 컷 ${list.length}`));
    const scenesList = h('ul', 'scenes');
    scenesList.append(...list.map((scene, n) => sceneRow(scene, n + 1)));
    const copy = h('button', 'btn', '대본 복사');
    copy.type = 'button';
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(asText(post, list));
        copy.textContent = '복사됨';
        setTimeout(() => { copy.textContent = '대본 복사'; }, 1500);
      } catch (error) { copy.textContent = '복사 실패'; }
    });
    card.append(head, scenesList, copy);
    return card;
  }));
}

function load() {
  let kept = '';
  try { kept = localStorage.getItem(DRAFTS_STORE) || ''; } catch (error) { kept = ''; }
  $('source').value = kept;
  draw(splitPosts(kept));
}

$('redraw').addEventListener('click', () => draw(splitPosts($('source').value)));
load();
