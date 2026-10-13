// 바이럴 글 구조 분석 — 순수 함수만 둔다(브라우저·Node 테스트 공용).
// 붙여 넣은 글의 '구조'만 뽑는다. 원문 문장은 변형안이나 저장용 출력에 넣지 않는다.

const HOOK_RULES = [
  { type: '리스트·저장형', hook: '정보형', pattern: /(\d+\s?(가지|개|단계|곳|종|번째)|리스트|총정리|체크리스트)/ },
  { type: '도발·명령형', hook: '논쟁형', pattern: /(하지\s?마|사지\s?마|명심해|걸러|버려|그만해|절대)/ },
  { type: '내부자 고백', hook: '정보형', pattern: /(대표|사장|운영|업계|직원|현직|\d+\s?년\s?차|했었|해본|하던)/ },
  { type: '취약 고백', hook: '공감형', pattern: /(망했|망할|폐업|실패|후회|못\s?하겠|못\s?샀|솔직히|고백|아까워|아까운)/ },
  { type: '상식파괴', hook: '정보형', pattern: /(아니라|안\s?되는\s?이유|사실은|알고\s?보니|오해|반대로|의외로)/ },
  { type: '선택 질문', hook: '논쟁형', pattern: /(\svs\s|vs\.|아니면|둘\s?중|너라면)/i },
  { type: '공감 질문', hook: '공감형', pattern: /(나만|저만|다들|너네|너넨).*\?|\?$/ },
];

const TURN_PATTERN = /(근데|그런데|알고\s?보니|제일|충격|사실|반전|정작|오히려)/;
const CTA_PATTERN = /(\?|추천해|알려\s?줘|도와\s?줘|어때|댓글|저장|공유|너네|너넨|다들)/;
const DISCOVERY_PATTERN = /(알고\s?보니|발견|써\s?보니|해\s?보니|해결|찾았|정착)/;
const EMPATHY_PATTERN = /(나만|저만|공감|다들\s?그래|우리)/;
const NUMBER_PATTERN = /\d/;
const LIST_LINE_PATTERN = /^\s*(\d+[.)]|[-•·▪✔✅])\s*/;
const EMOJI_PATTERN = /\p{Extended_Pictographic}/gu;
const MOBILE_LINE_LENGTH = 15;
const LONG_LINE_LENGTH = 25;
const LIST_MIN_LINES = 3;

/** @param {string} text @returns {string[]} */
export function splitLines(text) {
  return String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

/** @param {string[]} lines @returns {{type: string, hook: string, evidence: string}[]} */
export function detectHookTypes(lines) {
  const first = lines[0] || '';
  const listLines = lines.filter((line) => LIST_LINE_PATTERN.test(line)).length;
  const found = [];
  for (const rule of HOOK_RULES) {
    const match = first.match(rule.pattern);
    if (match) found.push({ type: rule.type, hook: rule.hook, evidence: match[0].trim() });
  }
  if (listLines >= LIST_MIN_LINES && !found.some((item) => item.type === '리스트·저장형')) {
    found.push({ type: '리스트·저장형', hook: '정보형', evidence: `번호·기호 줄 ${listLines}개` });
  }
  return found;
}

/** @param {string[]} lines @returns {{key: string, label: string, reason: string}} */
export function guessStructure(lines) {
  const body = lines.join('\n');
  const endsWithAsk = CTA_PATTERN.test(lines[lines.length - 1] || '');
  if (EMPATHY_PATTERN.test(lines.slice(0, 2).join(' ')) && endsWithAsk) {
    return { key: 'C', label: '공감 → 감정 → 의견 요청', reason: '앞부분에 공감 표현, 마지막 줄에 의견 요청' };
  }
  if (DISCOVERY_PATTERN.test(body) && !endsWithAsk) {
    return { key: 'B', label: '문제 → 발견 → 감탄', reason: '발견·해결 표현이 있고 질문 없이 끝남' };
  }
  if (endsWithAsk) {
    return { key: 'A', label: '상황 → 갈등 → 질문', reason: '마지막 줄이 질문·요청으로 끝남' };
  }
  return { key: '기타', label: '규칙으로 분류되지 않음', reason: '질문·발견 표현이 뚜렷하지 않음' };
}

/** @param {string[]} lines @returns {{role: string, lineNumbers: number[], note: string}[]} */
export function splitSections(lines) {
  if (!lines.length) return [];
  const last = lines.length - 1;
  const hasCta = last > 0 && CTA_PATTERN.test(lines[last]);
  const bodyEnd = hasCta ? last - 1 : last;
  const turn = lines.findIndex((line, index) => index > 0 && index <= bodyEnd && TURN_PATTERN.test(line));
  const middle = [];
  for (let index = 1; index <= bodyEnd; index += 1) if (index !== turn) middle.push(index + 1);
  const sections = [{ role: '① 훅 (첫줄)', lineNumbers: [1], note: `${lines[0].length}자` }];
  if (middle.length) sections.push({ role: '② 전개', lineNumbers: middle, note: `${middle.length}줄` });
  if (turn > 0) sections.push({ role: '③ 반전·디테일', lineNumbers: [turn + 1], note: '전환 표현이 있는 줄' });
  if (hasCta) sections.push({ role: '④ 댓글 유도 (CTA)', lineNumbers: [last + 1], note: '질문·요청으로 마무리' });
  return sections;
}

/** @param {string[]} lines */
export function measure(lines) {
  const lengths = lines.map((line) => line.length);
  const total = lengths.reduce((sum, length) => sum + length, 0);
  return {
    lineCount: lines.length,
    averageLength: lines.length ? Math.round(total / lines.length) : 0,
    longLines: lengths.filter((length) => length > LONG_LINE_LENGTH).length,
    numberLines: lines.filter((line) => NUMBER_PATTERN.test(line)).length,
    listLines: lines.filter((line) => LIST_LINE_PATTERN.test(line)).length,
    emojiCount: (lines.join('').match(EMOJI_PATTERN) || []).length,
    mobileTarget: MOBILE_LINE_LENGTH,
  };
}

/** @param {string} text @param {{bannedWords?: string[], bannedHooks?: string[]}} rules @returns {string[]} */
export function findWarnings(text, rules = {}) {
  const compact = String(text || '').replace(/\s/g, '');
  const warnings = [];
  for (const word of rules.bannedWords || []) {
    if (compact.includes(word)) warnings.push(`중단 소재 '${word}' — 구조만 참고하고 이 소재로 변형하지 않기`);
  }
  for (const hook of rules.bannedHooks || []) {
    const key = hook.replace(/\s/g, '');
    if (key.length <= 8 && compact.includes(key)) warnings.push(`금지 훅 '${hook}' — 이 첫줄 형태는 쓰지 않기`);
  }
  return warnings;
}

/** 내 계정용 변형 뼈대. 원문 문장은 넣지 않고 자리표시자만 둔다. */
export function variationFrame(structureKey) {
  const closings = {
    A: '[도움을 구하는 질문 1줄 — 너넨 어떻게 해?]',
    B: '[내가 정착한 기준 1줄]',
    C: '[의견을 묻는 질문 1줄 — 나만 그래?]',
  };
  return [
    '[내 고민·비용 한 줄 — 실제로 겪은 것]',
    '[그 고민이 반복되는 상황 1~2줄]',
    '',
    '[그래서 실제로 한 행동 1줄]',
    '',
    '[결과 — 직접 확인한 숫자 1개]',
    '[아쉬운 점 1개]',
    '',
    closings[structureKey] || closings.A,
  ].join('\n');
}

/** @param {string} text @param {object} rules */
export function analyze(text, rules = {}) {
  const lines = splitLines(text);
  if (!lines.length) return null;
  const structure = guessStructure(lines);
  return {
    lines,
    hookTypes: detectHookTypes(lines),
    structure,
    sections: splitSections(lines),
    metrics: measure(lines),
    warnings: findWarnings(text, rules),
    variation: variationFrame(structure.key),
  };
}

/** LLM 에 붙여 넣을 프롬프트. 계정 규칙을 먼저 고정하고 원문은 분석 대상으로만 준다. */
export function buildPrompt(text, rules = {}) {
  const banned = (rules.bannedWords || []).join(', ') || '없음';
  const bannedHooks = (rules.bannedHooks || []).join(' / ') || '없음';
  return [
    '당신은 스레드 글의 구조를 분석하는 편집자입니다.',
    '',
    '[내 계정]',
    `- 타깃: ${rules.persona || '(타깃을 적어 주세요)'}`,
    '- 역할: 쇼핑몰 운영 경험이 있는 현직 직장인. 판매자가 아니라 구매 실패를 줄여 주는 쇼핑 동료.',
    `- 쓰지 않는 소재: ${banned}`,
    `- 쓰지 않는 첫줄 형태: ${bannedHooks}`,
    '',
    '[규칙]',
    '1) 아래 글은 분석 대상일 뿐입니다. 문장·표현·고유한 사례를 그대로 쓰거나 살짝 바꿔 쓰지 마세요. 구조만 가져옵니다.',
    '2) 내가 하지 않은 구매·사용·착용 경험, 수치, 가격, 효과를 지어내지 마세요. 필요한 자리는 [실제 경험], [직접 확인한 숫자]처럼 대괄호 자리표시자로 남기세요.',
    '3) 과장·단정·최상급 표현, 효능을 단정하는 표현은 쓰지 마세요.',
    '4) 링크와 상품명은 넣지 마세요.',
    '',
    '[할 일]',
    '1) 이 글을 ① 훅(첫줄) ② 전개 ③ 반전·디테일 ④ 댓글 유도로 나누고, 각 부분이 하는 역할을 한 줄씩 설명해 주세요.',
    '2) 훅 유형(공감형/정보형/논쟁형)과 구조(A 상황→갈등→질문 / B 문제→발견→감탄 / C 공감→감정→의견 요청)를 판단하고 근거를 한 줄로 적어 주세요.',
    '3) 반응이 나온 이유를 [추론]이라고 표시해 2~3개 적어 주세요.',
    '4) 같은 구조를 유지한 내 계정용 변형 뼈대 1개와 첫줄 후보 3개를 써 주세요. 한 줄 15자 안팎, 6~10줄.',
    '5) 발행 전에 내가 채워야 할 사실 목록을 따로 정리해 주세요.',
    '',
    '[분석할 글]',
    '"""',
    String(text || '').trim(),
    '"""',
  ].join('\n');
}

/** benchmarks.csv 에 붙일 한 줄. 원문은 넣지 않는다. */
export function benchmarkRow(fields) {
  const escape = (value) => {
    const text = String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
    // 스프레드시트에서 수식으로 실행되지 않게 막는다.
    const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
    return /[",]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const order = ['date', 'account', 'pillar', 'hook_type', 'structure', 'likes', 'replies', 'reposts', 'shares', 'note'];
  return order.map((key) => escape(fields[key])).join(',');
}
