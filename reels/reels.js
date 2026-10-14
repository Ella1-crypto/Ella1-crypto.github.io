// 릴스 분석: 영상 파일 → 장면 이미지 + 받아쓰기 → (복사해서 Claude 로) 또는 (키로 바로 분석).
import { extractScenes, decodeAudio, contactSheet, clock, SCENE_LABELS } from './media.js?v=20261014a';
import { requestAnalysis } from './llm.js?v=20261014a';

const $ = (id) => document.getElementById(id);
const KEY_STORE = 'threads-lab-api-key';      // 스레드 초안 메뉴와 같은 키를 쓴다
const MAX_IMAGES_TO_MODEL = 16;
const STEPS = { read: '영상 읽기', scenes: '장면 추출', model: '받아쓰기 모델 준비', speech: '받아쓰기' };

const state = { file: null, frames: [], transcript: '', duration: 0 };
let worker = null;

function h(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

// ── 진행 표시 ──
function setStep(key, status, detail = '') {
  let row = $('progress').querySelector(`[data-step="${key}"]`);
  if (!row) {
    row = h('li');
    row.dataset.step = key;
    row.append(h('span'), h('b'));
    $('progress').append(row);
  }
  row.className = status;
  row.firstChild.textContent = STEPS[key] + (detail ? ` — ${detail}` : '');
  row.lastChild.textContent = { run: 'RUN', done: 'OK', fail: 'FAIL', skip: 'SKIP' }[status];
}

// ── 파일 고르기 ──
function pickFile(file) {
  if (!file || !file.type.startsWith('video/')) {
    $('file-name').textContent = '영상 파일만 올릴 수 있습니다.';
    return;
  }
  state.file = file;
  $('file-name').textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)}MB`;
  $('drop').classList.add('ready');
  const video = $('video');
  if (video.src) URL.revokeObjectURL(video.src);
  video.src = URL.createObjectURL(file);
  video.hidden = false;
  $('video-empty').hidden = true;
  $('run').disabled = false;
}

$('file').addEventListener('change', (event) => pickFile(event.target.files[0]));
const drop = $('drop');
drop.addEventListener('dragover', (event) => { event.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (event) => {
  event.preventDefault();
  drop.classList.remove('over');
  pickFile(event.dataTransfer.files[0]);
});
$('scene').addEventListener('input', () => { $('scene-out').textContent = SCENE_LABELS[$('scene').value]; });

// ── 받아쓰기 (워커) ──
function transcribe(audio, model) {
  worker ??= new Worker('whisper-worker.js?v=20261014a', { type: 'module' });
  return new Promise((resolve, reject) => {
    const files = new Map();
    worker.onmessage = ({ data }) => {
      if (data.type === 'download') {
        files.set(data.file, data);
        const loaded = [...files.values()].reduce((sum, f) => sum + f.loaded, 0);
        const total = [...files.values()].reduce((sum, f) => sum + f.total, 0);
        setStep('model', 'run', `내려받는 중 ${Math.round(loaded / 1024 / 1024)} / ${Math.round(total / 1024 / 1024)}MB`);
      } else if (data.type === 'transcribing') {
        setStep('model', 'done');
        setStep('speech', 'run', '영상 길이에 따라 1~3분 걸립니다');
      } else if (data.type === 'done') {
        resolve(data);
      } else if (data.type === 'error') {
        reject(new Error(data.message));
      }
    };
    worker.onerror = (event) => reject(new Error(event.message || '워커를 시작하지 못했습니다.'));
    worker.postMessage({ audio, model }, [audio.buffer]);
  });
}

function formatTranscript(result) {
  if (!result.chunks.length) return result.text.trim();
  return result.chunks
    .map((chunk) => `[${clock(chunk.timestamp?.[0] ?? 0)}] ${chunk.text.trim()}`)
    .filter((line) => !/\]\s*$/.test(line))
    .join('\n');
}

// ── 결과 그리기 ──
function drawFrames() {
  $('frames').replaceChildren(...state.frames.map((frame, index) => {
    const figure = h('figure', 'frame');
    const image = h('img');
    image.src = frame.src;
    image.alt = `장면 ${index + 1}, ${clock(frame.time)}`;
    image.loading = 'lazy';
    figure.append(image, h('figcaption', '', `#${index + 1} · ${clock(frame.time)}${index === 0 ? ' · 첫 화면' : ''}`));
    return figure;
  }));
}

function buildPrompt() {
  const times = state.frames.map((frame, index) => `#${index + 1} ${clock(frame.time)}`).join(', ');
  return [
    '아래는 조회수가 높게 나온 릴스(숏폼 영상)를 글자와 장면으로 풀어 놓은 자료입니다.',
    `영상 길이: ${clock(state.duration)} · 장면 이미지 ${state.frames.length}장 (${times})`,
    '이미지의 #번호와 시간은 장면이 바뀐 순간이고, #1 은 첫 화면입니다.',
    '',
    '[받아쓰기]',
    state.transcript || '(말소리 없음 — 음악만 있거나 받아쓰기를 하지 않았습니다. 화면 글자를 중심으로 봐 주세요.)',
    '',
    '다음 순서로 분석해 주세요. 한국어로, 짧은 문장으로 씁니다.',
    '1. 첫 1~3초 훅: 화면 글자와 첫 말이 무엇이고, 왜 스크롤을 멈추게 하는지',
    '2. 화면 글자 정리: 장면마다 화면에 적힌 글자를 그대로 옮기기',
    '3. 전개 구조: 훅 → 전개 → 마무리를 시간대와 함께 나누기',
    '4. 댓글·저장·공유를 부르는 장치 (CTA, 질문, 반전, 정보 밀도 등)',
    '5. 터진 이유 3가지 (추측이면 추측이라고 표시)',
    '6. 내 계정에 가져올 수 있는 구조 2가지 — 문장과 영상을 베끼지 말고 뼈대만, [ ] 자리는 내가 직접 겪은 일로 채우는 형태로',
  ].join('\n');
}

async function run() {
  const button = $('run');
  button.disabled = true;
  $('progress').replaceChildren();
  $('result').hidden = true;
  $('llm').hidden = true;
  const video = $('video');
  const model = document.querySelector('input[name=model]:checked').value;
  try {
    setStep('read', 'run');
    if (video.readyState < 2) await new Promise((ok, fail) => {
      video.addEventListener('loadeddata', ok, { once: true });
      video.addEventListener('error', () => fail(new Error('이 브라우저가 읽을 수 없는 영상 형식입니다. MP4 로 올려 주세요.')), { once: true });
    });
    state.duration = video.duration;
    setStep('read', 'done', clock(state.duration));

    setStep('scenes', 'run');
    state.frames = await extractScenes(video, Number($('scene').value), (ratio) => setStep('scenes', 'run', `${Math.round(ratio * 100)}%`));
    setStep('scenes', 'done', `${state.frames.length}장`);
    drawFrames();
    state.transcript = '';
    $('transcript').textContent = '받아쓰는 중…';
    $('result').hidden = false;

    if (model === 'none') {
      setStep('speech', 'skip');
    } else {
      setStep('model', 'run');
      const audio = await decodeAudio(state.file);
      if (!audio) {
        setStep('model', 'skip');
        setStep('speech', 'skip', '소리가 없는 영상');
      } else {
        state.transcript = formatTranscript(await transcribe(audio, model));
        setStep('speech', 'done');
      }
    }
    $('transcript').textContent = state.transcript || '(말소리 없음)';
    $('llm').hidden = false;
  } catch (error) {
    const running = $('progress').querySelector('.run');
    if (running) setStep(running.dataset.step, 'fail', error.message);
    if ($('transcript').textContent === '받아쓰는 중…') $('transcript').textContent = '(받아쓰기 실패)';
    if (state.frames.length) $('llm').hidden = false;
  } finally {
    button.disabled = false;
  }
}
$('run').addEventListener('click', run);

// ── 복사·저장 ──
function flash(message) {
  $('copy-status').textContent = message;
  setTimeout(() => { $('copy-status').textContent = ''; }, 2500);
}

$('copy-text').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(buildPrompt());
    flash('텍스트를 복사했습니다. Claude 에 붙여 넣고, 장면 모음 이미지도 함께 붙여 넣으세요.');
  } catch (error) { flash('복사하지 못했습니다. 브라우저의 클립보드 권한을 확인해 주세요.'); }
});

const sheetBlob = async () => {
  const canvas = await contactSheet(state.frames);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
};

$('copy-sheet').addEventListener('click', async () => {
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': sheetBlob() })]);
    flash('장면 모음 이미지를 복사했습니다.');
  } catch (error) { flash('이 브라우저는 이미지 복사를 지원하지 않습니다. "이미지 저장"을 눌러 주세요.'); }
});

$('save-sheet').addEventListener('click', async () => {
  const url = URL.createObjectURL(await sheetBlob());
  const link = h('a');
  link.href = url;
  link.download = `${(state.file?.name || 'reel').replace(/\.[^.]+$/, '')}-장면.png`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

// ── 바로 분석 ──
function rememberKey() {
  try {
    if ($('save-key').checked) localStorage.setItem(KEY_STORE, $('api-key').value.trim());
    else localStorage.removeItem(KEY_STORE);
  } catch (error) { /* 저장을 막아 둔 브라우저 */ }
}

function loadKey() {
  let saved = '';
  try { saved = localStorage.getItem(KEY_STORE) || ''; } catch (error) { saved = ''; }
  if (!saved) return;
  $('api-key').value = saved;
  $('save-key').checked = true;
}

$('save-key').addEventListener('change', rememberKey);
$('api-key').addEventListener('input', rememberKey);

$('analyze').addEventListener('click', async () => {
  const apiKey = $('api-key').value.trim();
  if (!apiKey) {
    $('analyze-status').textContent = 'API 키를 먼저 넣어 주세요.';
    return;
  }
  const button = $('analyze');
  button.disabled = true;
  $('analyze-status').textContent = '분석 중입니다… (최대 1~2분)';
  const images = state.frames.slice(0, MAX_IMAGES_TO_MODEL).map((frame) => frame.src.split(',')[1]);
  const result = await requestAnalysis(apiKey, buildPrompt(), images);
  button.disabled = false;
  if (result.ok) {
    $('answer').textContent = result.text;
    $('analyze-status').textContent = `완료 · ${result.model}`;
  } else {
    $('analyze-status').textContent = result.error;
  }
});

loadKey();
