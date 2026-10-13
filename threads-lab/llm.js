// (선택) 사용자가 직접 입력한 키로 모델을 브라우저에서 호출한다.
// 키 모양으로 제공자를 고른다: AIza… = Google AI Studio(Gemini, 무료 한도 있음), sk-ant… = Anthropic(유료).
// 폰에서도 쓰려고 Gemini 를 기본으로 둔다. 둘 다 브라우저에서 바로 호출된다(CORS 허용 확인 2026-10-13).
// 키는 인자로만 받고 이 파일에서는 저장하지 않는다. 빌드 없는 정적 페이지라 SDK 대신 fetch 를 쓴다.

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
// gemini-2.5-flash 는 2026-10 기준 신규 사용자에게 닫혔다. 구글이 안내하는 최신 별칭을 쓴다(현재 gemini-3.8-flash).
const GEMINI_MODEL = 'gemini-flash-latest';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const ANTHROPIC_MODEL = 'claude-opus-5-5';
const MAX_TOKENS = 16000;
const GEMINI_MAX_TOKENS = 8192;
const TIMEOUT_MS = 180_000;

const STATUS_MESSAGES = {
  400: '요청 형식 오류입니다.',
  401: 'API 키가 올바르지 않습니다.',
  403: '이 키로는 사용할 수 없습니다.',
  429: '요청 한도를 넘었습니다. 잠시 뒤에 다시 시도해 주세요.',
  529: 'API 가 혼잡합니다. 잠시 뒤에 다시 시도해 주세요.',
};

/** @param {string} apiKey @returns {'anthropic'|'gemini'} 키 모양으로 고른 제공자 */
export function providerFor(apiKey) {
  return (apiKey || '').trim().startsWith('sk-ant') ? 'anthropic' : 'gemini';
}

/** @param {{content?: {type: string, text?: string}[]}} message @returns {string} */
export function extractText(message) {
  return (message.content || [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

/** @param {{candidates?: {content?: {parts?: {text?: string}[]}}[]}} body @returns {string} */
export function extractGeminiText(body) {
  return (body.candidates?.[0]?.content?.parts || [])
    .map((part) => part.text || '')
    .join('\n')
    .trim();
}

/** @param {number} status @param {{error?: {message?: string}}} body @returns {string} */
export function errorMessage(status, body) {
  const base = STATUS_MESSAGES[status] || (status >= 500 ? 'API 서버 오류입니다.' : '요청에 실패했습니다.');
  const detail = body?.error?.message;
  return `${base} (HTTP ${status}${detail ? ` · ${detail}` : ''})`;
}

async function send(url, headers, payload, signal) {
  const response = await fetch(url, { method: 'POST', signal, headers, body: JSON.stringify(payload) });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function callGemini(apiKey, prompt, signal) {
  const { response, body } = await send(
    `${GEMINI_URL}/${GEMINI_MODEL}:generateContent`,
    { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      // 2.5 Flash 는 기본으로 생각 토큰을 쓰는데, 그러면 짧은 답에서 본문이 비어 돌아온다.
      generationConfig: { maxOutputTokens: GEMINI_MAX_TOKENS, thinkingConfig: { thinkingBudget: 0 } },
    },
    signal,
  );
  if (!response.ok) {
    // 구글은 키가 틀려도 400 으로 답해서 기본 문구가 "요청 형식 오류"가 된다. 실제 원인을 알려 준다.
    const detail = body?.error?.message || '';
    if (/API key not valid|API_KEY_INVALID|api key expired/i.test(detail)) {
      return { ok: false, error: 'API 키가 올바르지 않습니다. aistudio.google.com 에서 받은 AIza… 키인지 확인해 주세요.' };
    }
    return { ok: false, error: errorMessage(response.status, body) };
  }
  const blocked = body.promptFeedback?.blockReason;
  if (blocked) return { ok: false, error: `모델이 이 요청을 거절했습니다(${blocked}). 글 내용을 확인해 주세요.` };
  const text = extractGeminiText(body);
  if (!text) return { ok: false, error: '응답에 텍스트가 없습니다. 다시 눌러 주세요.' };
  const cut = body.candidates?.[0]?.finishReason === 'MAX_TOKENS' ? '\n\n(응답이 길이 제한에서 잘렸습니다)' : '';
  return { ok: true, text: text + cut, model: body.modelVersion || GEMINI_MODEL };
}

async function callAnthropic(apiKey, prompt, signal) {
  const { response, body } = await send(
    ANTHROPIC_URL,
    {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': API_VERSION,
      'anthropic-beta': FALLBACK_BETA,
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    { model: ANTHROPIC_MODEL, max_tokens: MAX_TOKENS, fallbacks: 'default', messages: [{ role: 'user', content: prompt }] },
    signal,
  );
  if (!response.ok) return { ok: false, error: errorMessage(response.status, body) };
  if (body.stop_reason === 'refusal') return { ok: false, error: '모델이 이 요청에 응답하지 않았습니다. 글 내용을 확인해 주세요.' };
  const text = extractText(body);
  if (!text) return { ok: false, error: '응답에 텍스트가 없습니다.' };
  const cut = body.stop_reason === 'max_tokens' ? '\n\n(응답이 길이 제한에서 잘렸습니다)' : '';
  return { ok: true, text: text + cut, model: body.model || ANTHROPIC_MODEL };
}

/**
 * @param {string} apiKey Google AI Studio 키(AIza…) 또는 Anthropic 키(sk-ant…)
 * @param {string} prompt
 * @returns {Promise<{ok: true, text: string, model: string} | {ok: false, error: string}>}
 */
export async function requestAnalysis(apiKey, prompt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const call = providerFor(apiKey) === 'anthropic' ? callAnthropic : callGemini;
    return await call(apiKey.trim(), prompt, controller.signal);
  } catch (error) {
    const reason = error.name === 'AbortError' ? '응답 시간이 초과됐습니다.' : '네트워크 오류로 호출하지 못했습니다.';
    return { ok: false, error: reason };
  } finally {
    clearTimeout(timer);
  }
}
