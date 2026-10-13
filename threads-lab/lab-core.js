// 실험 계정 데일리 배치의 규칙을 코드로 옮긴 것. DOM 을 쓰지 않는다(테스트는 tests/js/lab-core.test.js).

export const D1 = '2026-09-17';
export const SLOTS = Object.freeze(['08:00', '10:30', '13:00', '15:30', '18:00']);
export const SHORTS_SLOT = '20:30';
export const MIN_GAP_MINUTES = 30;
export const MAX_LINES = 5;
export const BATCH_SIZE = 5;
export const MIN_VARIED_ENTRIES = 2;
export const LINK_FREE_UNTIL = 10;
export const LINK_PHASE_UNTIL = 20;
export const DISCLOSURE = '이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.';

const DAY_MS = 86_400_000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

const EXPERIENCE_RE = /써\s?봤|써\s?보니|사\s?봤|샀어|샀는데|샀더니|구매했|구입했|주문했|쓰고\s?있|쓰는\s?중|사용해\s?봤|사용\s?중|받아\s?봤|내돈내산|직접\s?써/;
const URL_RE = /https?:\/\/|www\.|coupa\.ng|\b[\w-]+\.(?:com|kr|net|co|ly|me)\b/i;
const QUESTION_RE = /[?？]\s*$|알려\s?줘|궁금|어때|있어\s*$|있나\s*$|있을까\s*$/;
const CLAIM_RE = /\$\s?\d[\d,.]*|\d[\d,.]*\s?(?:만\s?)?원|\d[\d,.]*\s?(?:달러|불)|\d+\s?%|무조건|최저가|역대급|1위|완벽|보장|품절|로켓배송|무료\s?배송|당일\s?배송|하루\s?만에/g;

const PHASES = Object.freeze({
  before: { id: 'before', label: '시작 전', linkAllowed: false, detail: 'D1 이전이라 게시하지 않습니다.' },
  nolink: { id: 'nolink', label: '링크 없는 버전', linkAllowed: false, detail: '마지막 줄은 질문형. 링크·고지문 없이 반응만 봅니다.' },
  link: { id: 'link', label: '링크 버전', linkAllowed: true, detail: '마지막 줄 "링크 댓글에" + 댓글 고지문. CPC 글 1개를 섞습니다.' },
  expand: { id: 'expand', label: '확장', linkAllowed: true, detail: '링크 버전을 유지하면서 반응이 좋았던 소재 유형을 넓힙니다.' },
});

/** @param {Date} now @returns {string} 서울 기준 YYYY-MM-DD */
export function kstDateString(now) {
  return new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

function toUtcDay(dateString) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString || '');
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const time = Date.UTC(year, month - 1, day);
  const back = new Date(time);
  const isReal = back.getUTCFullYear() === year && back.getUTCMonth() === month - 1 && back.getUTCDate() === day;
  return isReal ? time : null;
}

/** @param {string} dateString @param {string} [start] @returns {number|null} 시작일이 1. 날짜가 아니면 null */
export function dayNumber(dateString, start = D1) {
  const day = toUtcDay(dateString);
  const first = toUtcDay(start);
  if (day === null || first === null) return null;
  return Math.round((day - first) / DAY_MS) + 1;
}

/** @param {number} day @returns {{id: string, label: string, linkAllowed: boolean, detail: string}} */
export function phaseFor(day) {
  if (day < 1) return PHASES.before;
  if (day <= LINK_FREE_UNTIL) return PHASES.nolink;
  if (day <= LINK_PHASE_UNTIL) return PHASES.link;
  return PHASES.expand;
}

const toMinutes = (clock) => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(clock);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
};

const toClock = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** @param {string} text 쉼표·공백으로 나눈 HH:MM @returns {{minutes: number[], invalid: string[]}} */
export function parseTimes(text) {
  const tokens = (text || '').split(/[\s,]+/).filter(Boolean);
  const parsed = tokens.map((token) => ({ token, value: toMinutes(token) }));
  return {
    minutes: parsed.filter((p) => p.value !== null).map((p) => p.value),
    invalid: parsed.filter((p) => p.value === null).map((p) => p.token),
  };
}

/**
 * 메인 계정 게시 시각과 30분 안으로 붙는 실험 계정 시간대를 찾는다. 시간대마다 가장 가까운 시각 하나만 돌려준다.
 * @param {number[]} mainMinutes @param {string[]} [slots] @param {number} [minGap]
 * @returns {{slot: string, main: string, gap: number}[]}
 */
export function findConflicts(mainMinutes, slots = [...SLOTS, SHORTS_SLOT], minGap = MIN_GAP_MINUTES) {
  return slots.flatMap((slot) => mainMinutes
    .map((main) => ({ slot, main: toClock(main), gap: Math.abs(toMinutes(slot) - main) }))
    .filter((pair) => pair.gap < minGap)
    .sort((a, b) => a.gap - b.gap)
    .slice(0, 1));
}

export const splitLines = (text) => (text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

/** @param {string} text `---` 줄로 나눈 여러 글 @returns {string[]} */
export function splitBatch(text) {
  return (text || '').split(/^\s*-{3,}\s*$/m).map((post) => splitLines(post).join('\n')).filter(Boolean);
}

const finding = (id, level, message, evidence = '') => ({ id, level, message, evidence });

function checkCta(lastLine, linkAllowed) {
  if (linkAllowed) {
    return /링크/.test(lastLine) && /댓글/.test(lastLine)
      ? finding('cta', 'pass', '마지막 줄이 댓글 링크를 가리킵니다.')
      : finding('cta', 'fail', '링크 허용 기간에는 마지막 줄이 "링크 댓글에" 형태여야 합니다.', lastLine);
  }
  if (/링크/.test(lastLine)) return finding('cta', 'fail', '링크 없는 기간인데 마지막 줄이 링크를 말합니다.', lastLine);
  return QUESTION_RE.test(lastLine)
    ? finding('cta', 'pass', '마지막 줄이 질문형입니다.')
    : finding('cta', 'fail', '링크 없는 기간에는 마지막 줄을 "써본 사람 있으면 알려줘" 같은 질문형으로 끝냅니다.', lastLine);
}

/**
 * 글 하나를 규칙으로 확인한다. 통과한 항목도 돌려준다.
 * @param {string} text
 * @param {{linkAllowed: boolean, productNames?: string[]}} options
 * @returns {{id: string, level: 'pass'|'warn'|'fail', message: string, evidence: string}[]}
 */
export function checkPost(text, { linkAllowed, productNames = [] }) {
  const lines = splitLines(text);
  const body = lines.join('\n');
  const names = productNames.map((name) => name.trim()).filter(Boolean);
  const experience = EXPERIENCE_RE.exec(body);
  const url = URL_RE.exec(body);
  const claims = [...new Set(body.match(CLAIM_RE) || [])];
  const namedInFirstLine = names.find((name) => (lines[0] || '').includes(name));

  return [
    lines.length <= MAX_LINES
      ? finding('lines', 'pass', `${lines.length}줄 — ${MAX_LINES}줄 이내입니다.`)
      : finding('lines', 'fail', `${lines.length}줄입니다. ${MAX_LINES}줄 이내로 줄입니다.`),
    ...(names.length === 0 ? [] : [namedInFirstLine
      ? finding('firstLine', 'fail', '첫 줄에 상품명이 있습니다. 첫 줄은 상황만 씁니다.', namedInFirstLine)
      : finding('firstLine', 'pass', '첫 줄에 상품명이 없습니다.')]),
    experience
      ? finding('experience', 'fail', '직접 써 본 것처럼 읽히는 표현입니다. 발견·비교·전언으로 바꿉니다.', experience[0])
      : finding('experience', 'pass', '개인 사용 경험 표현이 없습니다.'),
    url
      ? finding('url', 'fail', '본문에 주소가 있습니다. 링크는 계정 주인이 댓글에 직접 답니다.', url[0])
      : finding('url', 'pass', '본문에 주소가 없습니다.'),
    checkCta(lines[lines.length - 1] || '', linkAllowed),
    claims.length > 0
      ? finding('claims', 'warn', '가격·효과·배송 표현입니다. 확인한 것만 남깁니다.', claims.join(' · '))
      : finding('claims', 'pass', '확인이 필요한 가격·효과·배송 표현이 없습니다.'),
  ];
}

/**
 * 배치 전체를 본다: 글 수와 둘째 줄 진입 방식의 반복.
 * @param {string[]} posts
 * @returns {{id: string, level: 'pass'|'warn'|'fail', message: string, evidence: string}[]}
 */
export function checkBatch(posts) {
  // 5개가 안 되는 배치는 절반만 달라도 된다.
  const needed = Math.min(MIN_VARIED_ENTRIES, Math.ceil(posts.length / 2));
  const varied = posts.filter((post) => !/^해외/.test(splitLines(post)[1] || '')).length;
  return [
    posts.length === BATCH_SIZE
      ? finding('count', 'pass', `글 ${BATCH_SIZE}개가 모두 있습니다.`)
      : finding('count', 'warn', `글이 ${posts.length}개입니다. 하루 배치는 ${BATCH_SIZE}개입니다.`),
    varied >= needed
      ? finding('entry', 'pass', `둘째 줄을 "해외 …"로 시작하지 않는 글이 ${varied}개입니다.`)
      : finding('entry', 'fail', `둘째 줄이 거의 다 "해외 …"로 시작합니다. 최소 ${needed}개는 진입 방식을 바꿉니다.`, `다른 진입 ${varied}개`),
  ];
}

/**
 * 소재 입력을 읽는다. 한 줄에 하나, `상품명 | 확인한 사실`.
 * @param {string} text
 * @returns {{items: {name: string, facts: string}[], dropped: number}}
 */
export function parseItems(text) {
  const all = splitLines(text).map((line) => {
    const [name, ...rest] = line.split('|');
    return { name: name.trim(), facts: rest.join('|').trim() };
  }).filter((item) => item.name);
  return { items: all.slice(0, BATCH_SIZE), dropped: Math.max(0, all.length - BATCH_SIZE) };
}

/**
 * 글 초안을 요청하는 프롬프트. 규칙은 checkPost 가 확인하는 것과 같다.
 * @param {{name: string, facts: string}[]} items
 * @param {{linkAllowed: boolean}} options
 * @returns {string}
 */
export function buildDraftPrompt(items, { linkAllowed }) {
  const cta = linkAllowed
    ? '마지막 줄은 정확히 "링크 댓글에" 로 끝낸다. 본문에 주소는 쓰지 않는다.'
    : '마지막 줄은 "써본 사람 있으면 알려줘" 같은 질문형으로 끝낸다. 링크라는 말은 쓰지 않는다.';
  const list = items.map((item, index) => `${index + 1}. ${item.name} — ${item.facts || '확인된 사실 없음(상품 종류에서 당연한 것만 쓴다)'}`);
  return [
    '너는 한국어 스레드(Threads) 글을 쓰는 보조다. 독자는 30~40대 바쁜 직장인 여성이고, 말투는 친한 언니가 카톡 하듯 반말이다.',
    `아래 소재 ${items.length}개마다 글을 하나씩, 같은 순서로 쓴다.`,
    '',
    '규칙:',
    `- 글 하나는 ${MAX_LINES}줄 이내. 한 줄은 짧게.`,
    '- 첫 줄은 상품명 없이 공감되는 상황만 쓴다.',
    '- 직접 써 본 것처럼 쓰지 않는다("써봤어", "샀어", "쓰고 있어" 금지). 발견·비교·전언("~한다길래", "~더라")만 쓴다.',
    '- 소재에 적힌 사실만 쓴다. 가격·할인·효과·배송·순위는 적혀 있지 않으면 절대 넣지 않는다.',
    `- 둘째 줄을 "해외 …"로 시작하는 글은 전체의 절반 이하로 하고, 최소 ${MIN_VARIED_ENTRIES}개는 다른 방식으로 들어간다.`,
    `- ${cta}`,
    '- 해시태그, 이모지, 번호, 제목, 설명을 붙이지 않는다.',
    '',
    '출력 형식: 글만 쓴다. 글과 글 사이에는 --- 한 줄만 둔다.',
    '',
    '소재:',
    ...list,
  ].join('\n');
}

const stripLabel = (line) => line.replace(/^\s*(?:\d+[.)]\s+|[-*]\s+)/, '');
const isNoise = (line) => /^```/.test(line) || /^\*\*.*\*\*$/.test(line) || /^#+\s/.test(line) || /^글\s?\d+\s*[:.]?$/.test(line);

/** @param {string} reply 모델 응답 @returns {string[]} 글 목록(번호·코드 울타리·소제목 제거) */
export function parseDrafts(reply) {
  return splitBatch(splitLines(reply).filter((line) => !isNoise(line)).join('\n'))
    .map((post) => splitLines(post).map(stripLabel).join('\n'));
}
