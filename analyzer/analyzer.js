// 구조 분석기 화면. 분석 로직은 analyze-core.js, LLM 호출은 llm.js 에 있다.
import { h, fill, chip, copyButton } from './dom.js';
import { analyze, buildPrompt, benchmarkRow } from './analyze-core.js';
import { requestAnalysis } from './llm.js?v=20261013k';

const PLAN_URL = 'data/plan.json';
const MAX_INPUT_CHARS = 5000;
const DEFAULT_RULES = { persona: '', bannedWords: [], bannedHooks: [], lanes: [] };
const $ = (id) => document.getElementById(id);
const well = (label, ...children) => h('div', { class: 'well' }, h('span', { class: 'label', text: label }), ...children);

let rules = DEFAULT_RULES;

async function loadRules() {
  try {
    const response = await fetch(PLAN_URL, { cache: 'no-store' });
    if (!response.ok) return DEFAULT_RULES;
    const plan = await response.json();
    return {
      persona: plan.persona || '',
      bannedWords: plan.rules?.banned_subjects?.words || [],
      bannedHooks: plan.rules?.banned_hooks || [],
      lanes: plan.rules?.lanes || [],
    };
  } catch (error) {
    return DEFAULT_RULES; // 규칙 파일이 없어도 분석은 동작한다
  }
}

function showInputError(message) {
  const box = $('input-error');
  box.textContent = message;
  box.hidden = !message;
}

function renderResult(result) {
  const hooks = result.hookTypes.length
    ? result.hookTypes.map((item) => chip(`${item.type} · ${item.hook} (근거: ${item.evidence})`))
    : [chip('규칙에 걸리는 훅 유형 없음', 'warn')];
  const sections = result.sections.map((section) => h('tr', {},
    h('td', { text: section.role }),
    h('td', { class: 'mono', text: section.lineNumbers.length > 1 ? `${section.lineNumbers[0]}~${section.lineNumbers.at(-1)}줄` : `${section.lineNumbers[0]}줄` }),
    h('td', { class: 'wrap', text: section.note })));
  const m = result.metrics;
  fill($('result'),
    h('h2', { id: 'result-heading', text: '분석 결과 (규칙 기반 추정)' }),
    h('div', { class: 'stack-lg' },
      result.warnings.map((warning) => h('p', { class: 'notice stop', text: warning })),
      well('훅 유형', h('div', { class: 'chips' }, hooks)),
      well(`구조 ${result.structure.key}`, h('p', { text: result.structure.label }), h('p', { class: 'small dim', text: result.structure.reason })),
      well('구성', h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, ['부분', '위치', '메모'].map((name) => h('th', { scope: 'col', text: name })))),
        h('tbody', {}, sections)))),
      well('형식', h('div', { class: 'chips' },
        chip(`${m.lineCount}줄`), chip(`한 줄 평균 ${m.averageLength}자 (권장 ${m.mobileTarget}자 안팎)`),
        chip(`긴 줄 ${m.longLines}개`), chip(`숫자 있는 줄 ${m.numberLines}개`), chip(`목록 줄 ${m.listLines}개`), chip(`이모지 ${m.emojiCount}개`))),
      h('p', { class: 'small dim', text: '키워드 규칙으로 추정한 결과입니다. 반응이 나온 이유까지 보려면 아래 프롬프트를 사용하세요.' })));
}

function renderVariation(result) {
  const box = $('variation');
  fill(box,
    h('h2', { id: 'variation-heading', text: '내 계정용 변형 뼈대' }),
    h('div', { class: 'stack' },
      h('pre', { class: 'output', text: result.variation }),
      h('div', { class: 'chips' }, copyButton(() => result.variation, '뼈대 복사')),
      h('p', { class: 'small dim', text: '원문 문장은 들어 있지 않습니다. [ ] 안은 실제로 겪은 일과 직접 확인한 사실로만 채우고, 채울 사실이 없으면 발행을 보류합니다.' })));
  box.hidden = false;
}

function renderRecord(result) {
  const today = new Date().toLocaleDateString('sv-SE');
  const account = h('input', { class: 'field', id: 'bench-account', placeholder: '계정 이름 (선택)' });
  const lane = h('input', { class: 'field', id: 'bench-lane', placeholder: '레인', list: 'lanes', value: rules.lanes[0] || '' });
  const likes = h('input', { class: 'field', id: 'bench-likes', inputmode: 'numeric', placeholder: '좋아요' });
  const replies = h('input', { class: 'field', id: 'bench-replies', inputmode: 'numeric', placeholder: '댓글' });
  const digits = (input) => input.value.replace(/[^\d]/g, '');
  const row = () => benchmarkRow({
    date: today,
    account: account.value,
    pillar: lane.value,
    hook_type: result.hookTypes[0]?.type || '',
    structure: result.structure.key === '기타' ? '' : result.structure.key,
    likes: digits(likes),
    replies: digits(replies),
    note: result.sections.map((section) => section.role.slice(2)).join(' → '),
  });
  const box = $('record');
  fill(box,
    h('h2', { id: 'record-heading', text: '벤치마크 기록에 추가' }),
    h('div', { class: 'stack' },
      h('datalist', { id: 'lanes' }, rules.lanes.map((name) => h('option', { value: name }))),
      h('div', { class: 'split' }, account, lane, likes, replies),
      h('div', { class: 'chips' }, copyButton(row, 'CSV 한 줄 복사')),
      h('p', { class: 'small dim', text: 'data/benchmarks.csv 맨 아래에 붙여 넣으면 대시보드에 반영됩니다. 글 본문은 기록에 포함되지 않습니다.' })));
  box.hidden = false;
}

function renderLlm(text) {
  const prompt = buildPrompt(text, rules);
  const key = h('input', { class: 'field', id: 'api-key', type: 'password', autocomplete: 'off', placeholder: 'API 키 — Google AI Studio 무료 키 AIza… (이 탭의 메모리에만 있고 저장되지 않음)' });
  const output = h('pre', { class: 'output', hidden: true });
  const status = h('p', { class: 'small dim', role: 'status' });
  const send = h('button', { class: 'btn', type: 'button', text: '내 키로 바로 분석' });
  send.addEventListener('click', async () => {
    if (!key.value.trim()) { status.textContent = 'API 키를 입력해 주세요.'; return; }
    send.disabled = true;
    status.textContent = '분석 중… (길게는 1분 정도 걸립니다)';
    const result = await requestAnalysis(key.value.trim(), prompt);
    send.disabled = false;
    status.textContent = result.ok ? `완료 · 모델 ${result.model}` : result.error;
    output.textContent = result.ok ? result.text : '';
    output.hidden = !result.ok;
  });
  const box = $('llm');
  fill(box,
    h('h2', { id: 'llm-heading', text: 'LLM 으로 더 깊게 분석' }),
    h('div', { class: 'stack-lg' },
      well('방법 1 — 프롬프트를 복사해 Claude·ChatGPT 에 붙여 넣기 (권장)',
        h('div', { class: 'stack' }, h('pre', { class: 'output', text: prompt }), h('div', { class: 'chips' }, copyButton(() => prompt, '프롬프트 복사')))),
      well('방법 2 — 내 API 키로 이 페이지에서 호출 (선택)',
        h('div', { class: 'stack' },
          h('p', { class: 'small dim', text: 'aistudio.google.com 에서 받은 무료 키(AIza…)를 넣습니다. Anthropic 키(sk-ant…)를 넣으면 그쪽으로 가고 요금이 청구됩니다. 키는 고른 모델의 API 로만 전송되고 어디에도 저장되지 않습니다. 공용 PC 에서는 쓰지 마세요.' }),
          key, h('div', { class: 'chips' }, send), status, output))));
  box.hidden = false;
}

function run() {
  const text = $('source').value;
  if (!text.trim()) { showInputError('분석할 글을 붙여 넣어 주세요.'); return; }
  if (text.length > MAX_INPUT_CHARS) { showInputError(`글이 너무 깁니다 (${text.length.toLocaleString()}자). ${MAX_INPUT_CHARS.toLocaleString()}자 이하로 나눠서 분석해 주세요.`); return; }
  showInputError('');
  const result = analyze(text, rules);
  renderResult(result);
  renderVariation(result);
  renderRecord(result);
  renderLlm(text);
}

function clear() {
  $('source').value = '';
  showInputError('');
  ['variation', 'record', 'llm'].forEach((id) => { $(id).hidden = true; fill($(id)); });
  fill($('result'), h('h2', { id: 'result-heading', text: '분석 결과 (규칙 기반 추정)' }), h('p', { class: 'dim', text: '왼쪽에 글을 붙여 넣고 구조 분석을 누르세요.' }));
}

async function main() {
  rules = await loadRules();
  $('run').addEventListener('click', run);
  $('clear').addEventListener('click', clear);
}

main();
