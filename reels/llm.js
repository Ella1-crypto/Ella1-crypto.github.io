// (선택) 사용자가 직접 입력한 키로 모델을 브라우저에서 호출한다. threads-lab/llm.js 와 같은 규칙에
// 장면 이미지를 함께 보내는 부분만 더했다. 키는 인자로만 받고 이 파일에서는 저장하지 않는다.
// AIza… = Google AI Studio(Gemini, 무료 한도 있음), sk-ant… = Anthropic(유료).

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_MODELS = ['gemini-flash-latest', 'gemini-3.1-flash-lite'];
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const RETRY_WAIT_MS = 3000;
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
  413: '이미지가 너무 큽니다. 장면 민감도를 높여 장면 수를 줄여 주세요.',
  429: '요청 한도를 넘었습니다. 잠시 뒤에 다시 시도해 주세요.',
  529: 'API 가 혼잡합니다. 잠시 뒤에 다시 시도해 주세요.',
};

/** @param {string} apiKey @returns {'anthropic'|'gemini'} */
export function providerFor(apiKey) {
  return (apiKey || '').trim().startsWith('sk-ant') ? 'anthropic' : 'gemini';
}

function errorMessage(status, body) {
  const base = STATUS_MESSAGES[status] || (status >= 500 ? 'API 서버 오류입니다.' : '요청에 실패했습니다.');
  const detail = body?.error?.message;
  return `${base} (HTTP ${status}${detail ? ` · ${detail}` : ''})`;
}

async function send(url, headers, payload, signal) {
  const response = await fetch(url, { method: 'POST', signal, headers, body: JSON.stringify(payload) });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const keyProblem = (body) => /API key not valid|API_KEY_INVALID|api key expired/i.test(body?.error?.message || '');

function readGemini(body, model) {
  const blocked = body.promptFeedback?.blockReason;
  if (blocked) return { ok: false, error: `모델이 이 요청을 거절했습니다(${blocked}).` };
  const text = (body.candidates?.[0]?.content?.parts || []).map((part) => part.text || '').join('\n').trim();
  if (!text) return { ok: false, error: '응답에 텍스트가 없습니다. 다시 눌러 주세요.' };
  const cut = body.candidates?.[0]?.finishReason === 'MAX_TOKENS' ? '\n\n(응답이 길이 제한에서 잘렸습니다)' : '';
  return { ok: true, text: text + cut, model: body.modelVersion || model };
}

async function callGemini(apiKey, prompt, images, signal) {
  const parts = [
    ...images.map((data) => ({ inline_data: { mime_type: 'image/jpeg', data } })),
    { text: prompt },
  ];
  const payload = {
    contents: [{ role: 'user', parts }],
    generationConfig: { maxOutputTokens: GEMINI_MAX_TOKENS, thinkingConfig: { thinkingBudget: 0 } },
  };
  let last = '요청에 실패했습니다.';
  for (const model of GEMINI_MODELS) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { response, body } = await send(`${GEMINI_URL}/${model}:generateContent`,
        { 'content-type': 'application/json', 'x-goog-api-key': apiKey }, payload, signal);
      if (response.ok) return readGemini(body, model);
      if (keyProblem(body)) {
        return { ok: false, error: 'API 키가 올바르지 않습니다. aistudio.google.com 에서 받은 AIza… 키인지 확인해 주세요.' };
      }
      last = errorMessage(response.status, body);
      if (!RETRY_STATUS.has(response.status)) break;
      if (attempt === 0) await wait(RETRY_WAIT_MS);
    }
  }
  return { ok: false, error: `${last} 자동으로 다시 시도했지만 실패했습니다 — 잠시 뒤 한 번 더 눌러 주세요.` };
}

async function callAnthropic(apiKey, prompt, images, signal) {
  const content = [
    ...images.map((data) => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } })),
    { type: 'text', text: prompt },
  ];
  const { response, body } = await send(
    ANTHROPIC_URL,
    {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': API_VERSION,
      'anthropic-beta': FALLBACK_BETA,
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    { model: ANTHROPIC_MODEL, max_tokens: MAX_TOKENS, fallbacks: 'default', messages: [{ role: 'user', content }] },
    signal,
  );
  if (!response.ok) return { ok: false, error: errorMessage(response.status, body) };
  if (body.stop_reason === 'refusal') return { ok: false, error: '모델이 이 요청에 응답하지 않았습니다.' };
  const text = (body.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  if (!text) return { ok: false, error: '응답에 텍스트가 없습니다.' };
  const cut = body.stop_reason === 'max_tokens' ? '\n\n(응답이 길이 제한에서 잘렸습니다)' : '';
  return { ok: true, text: text + cut, model: body.model || ANTHROPIC_MODEL };
}

/**
 * @param {string} apiKey Google AI Studio 키(AIza…) 또는 Anthropic 키(sk-ant…)
 * @param {string} prompt
 * @param {string[]} images JPEG base64 (data: 접두어 없이)
 * @returns {Promise<{ok: true, text: string, model: string} | {ok: false, error: string}>}
 */
export async function requestAnalysis(apiKey, prompt, images) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const call = providerFor(apiKey) === 'anthropic' ? callAnthropic : callGemini;
    return await call(apiKey.trim(), prompt, images, controller.signal);
  } catch (error) {
    const reason = error.name === 'AbortError' ? '응답 시간이 초과됐습니다.' : '네트워크 오류로 호출하지 못했습니다.';
    return { ok: false, error: reason };
  } finally {
    clearTimeout(timer);
  }
}
