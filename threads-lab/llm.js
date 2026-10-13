// (선택) 사용자가 직접 입력한 키로 Claude Messages API 를 브라우저에서 호출한다.
// 키는 인자로만 받고 저장하지 않는다. 빌드 없는 정적 페이지라 SDK 대신 fetch 를 쓴다.

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const MODEL = 'claude-opus-5-5';
const MAX_TOKENS = 16000;
const TIMEOUT_MS = 180_000;

const STATUS_MESSAGES = {
  400: '요청 형식 오류입니다.',
  401: 'API 키가 올바르지 않습니다.',
  403: '이 키로는 사용할 수 없습니다.',
  429: '요청 한도를 넘었습니다. 잠시 뒤에 다시 시도해 주세요.',
  529: 'API 가 혼잡합니다. 잠시 뒤에 다시 시도해 주세요.',
};

/** @param {{content?: {type: string, text?: string}[]}} message @returns {string} */
export function extractText(message) {
  return (message.content || [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

/** @param {number} status @param {{error?: {message?: string}}} body @returns {string} */
export function errorMessage(status, body) {
  const base = STATUS_MESSAGES[status] || (status >= 500 ? 'API 서버 오류입니다.' : '요청에 실패했습니다.');
  const detail = body?.error?.message;
  return `${base} (HTTP ${status}${detail ? ` · ${detail}` : ''})`;
}

/**
 * @param {string} apiKey
 * @param {string} prompt
 * @returns {Promise<{ok: true, text: string, model: string} | {ok: false, error: string}>}
 */
export async function requestAnalysis(apiKey, prompt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': API_VERSION,
        'anthropic-beta': FALLBACK_BETA,
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        fallbacks: 'default',
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, error: errorMessage(response.status, body) };
    if (body.stop_reason === 'refusal') return { ok: false, error: '모델이 이 요청에 응답하지 않았습니다. 글 내용을 확인해 주세요.' };
    const text = extractText(body);
    if (!text) return { ok: false, error: '응답에 텍스트가 없습니다.' };
    const cut = body.stop_reason === 'max_tokens' ? '\n\n(응답이 길이 제한에서 잘렸습니다)' : '';
    return { ok: true, text: text + cut, model: body.model || MODEL };
  } catch (error) {
    const reason = error.name === 'AbortError' ? '응답 시간이 초과됐습니다.' : '네트워크 오류로 호출하지 못했습니다.';
    return { ok: false, error: reason };
  } finally {
    clearTimeout(timer);
  }
}
