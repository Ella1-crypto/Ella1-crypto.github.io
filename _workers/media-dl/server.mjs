/* 미디어 다운로더 — 내 PC에서 돌리는 yt-dlp 중계 서버
 *
 * YouTube·Instagram은 클라우드 서버 IP를 자주 막는다. 그래서 집 PC(가정용 IP)에서 yt-dlp를 돌리고,
 * Cloudflare Tunnel로 https 주소를 붙여 ella1-crypto.github.io/downloader/ 페이지가 부르게 한다.
 *
 *   ACCESS_TOKEN=아무도모르는긴문자열 node server.mjs      (Node 20 이상, 외부 패키지 없음)
 *
 * 환경변수
 *   ACCESS_TOKEN      (필수) 페이지에 넣는 비밀번호. 16자 이상.
 *   PORT              기본 8790
 *   HOST              기본 127.0.0.1 (터널만 접속하게)
 *   YTDLP             yt-dlp 실행 파일 경로. 기본 'yt-dlp'
 *   COOKIES_BROWSER   예: firefox, chrome, edge — 로그인이 필요한 Instagram 게시물용
 *   COOKIES_FILE      cookies.txt 경로 (COOKIES_BROWSER 대신)
 *   ALLOWED_ORIGINS   쉼표 구분. 기본 https://ella1-crypto.github.io,http://localhost:5178
 *   YTDLP_EXTRA       yt-dlp에 덧붙일 옵션 (예: --js-runtimes node)
 *   FALLBACK_FILE     PC 서버 주소 보관 파일. 기본 ./fallback.json
 *
 * API
 *   POST /api/info      {url}                → 제목·썸네일·길이
 *   GET|POST /api/fallback  {url}     → PC 서버(trycloudflare) 주소 조회·등록 — Oracle 서버가 PC 주소를 알려 주는 용도
 *   GET  /api/download?url=&kind=video|audio&token=  → 파일 (다운로드 링크는 헤더를 못 넣어서 token을 쿼리로 받음)
 */
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, rm, stat, readFile, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT) || 8790;
const HOST = process.env.HOST || '127.0.0.1';
const TOKEN = process.env.ACCESS_TOKEN || '';
const YTDLP = process.env.YTDLP || 'yt-dlp';
const ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://ella1-crypto.github.io,http://localhost:5178')
  .split(',').map(s => s.trim()).filter(Boolean);
const MAX_JOBS = 2;
// PC 서버가 켜질 때 알려 주는 자기 trycloudflare 주소를 보관한다 (Oracle 서버 쪽에서 쓰임)
const FALLBACK_FILE = process.env.FALLBACK_FILE || path.join(path.dirname(fileURLToPath(import.meta.url)), 'fallback.json');
const JOB_TIMEOUT_MS = 10 * 60 * 1000;

if (TOKEN.length < 16) {
  console.error('ACCESS_TOKEN 환경변수를 16자 이상으로 정해 주세요.');
  process.exit(1);
}

// yt-dlp는 파일 경로나 내부망 주소도 받으므로, 지원하는 사이트 주소만 통과시킨다
const ALLOWED_HOSTS = [
  'youtube.com', 'youtu.be', 'youtube-nocookie.com',
  'instagram.com',
  'threads.net', 'threads.com',
  'tiktok.com',
];

export function checkUrl(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (u.username || u.password || u.port) return null;
  const host = u.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.some(h => host === h || host.endsWith('.' + h))) return null;
  u.protocol = 'https:';
  return u.toString();
}

// 예: YTDLP_EXTRA="--js-runtimes node" (YouTube 보안 문제 풀이에 Node를 쓰게 함)
const EXTRA = (process.env.YTDLP_EXTRA || '').split(/\s+/).filter(Boolean);

function cookieArgs() {
  if (process.env.COOKIES_FILE) return ['--cookies', process.env.COOKIES_FILE];
  if (process.env.COOKIES_BROWSER) return ['--cookies-from-browser', process.env.COOKIES_BROWSER];
  return [];
}

function tokenOk(given) {
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

let running = 0;

let fallback = { url: '', at: 0 };
readFile(FALLBACK_FILE, 'utf8').then(t => { fallback = JSON.parse(t); }).catch(() => {});

export function checkFallbackUrl(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port || u.pathname !== '/' || u.search) return null;
  return /^[a-z0-9-]+\.trycloudflare\.com$/.test(u.hostname) ? u.origin : null;
}

function runYtdlp(args, { cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(YTDLP, [...EXTRA, ...cookieArgs(), '--no-playlist', '--no-warnings', ...args], { cwd, windowsHide: true });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('시간 초과')); }, JOB_TIMEOUT_MS);
    child.stdout.on('data', d => { if (out.length < 20e6) out += d; });
    child.stderr.on('data', d => { if (err.length < 20000) err += d; });
    child.on('error', e => { clearTimeout(timer); reject(new Error(e.code === 'ENOENT' ? 'yt-dlp를 찾을 수 없습니다' : e.message)); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(friendlyError(err));
    });
  });
}

function friendlyError(stderr) {
  const s = stderr || '';
  console.error('[yt-dlp]', s.trim().split('\n').slice(-3).join(' | '));
  const fail = (msg, code = 'failed') => Object.assign(new Error(msg), { code });
  // blocked: 이 서버 IP·쿠키로는 안 됨 → 페이지가 PC 서버로 다시 시도한다
  if (/login|sign in|not a bot|cookies|private|rate.?limit|HTTP Error (403|429)/i.test(s)) return fail('로그인이 필요한 게시물이거나 사이트가 막았습니다. 쿠키 설정을 확인하세요.', 'blocked');
  if (/Unsupported URL/i.test(s)) return fail('지원하지 않는 주소입니다.', 'unsupported');
  if (/No video formats|There is no video/i.test(s)) return fail('영상이 없는 게시물입니다(사진만 있는 게시물은 아직 지원하지 않음).', 'novideo');
  if (/unavailable|not available|removed/i.test(s)) return fail('삭제됐거나 볼 수 없는 영상입니다.', 'gone');
  return fail('가져오지 못했습니다. yt-dlp를 최신으로 업데이트해 보세요(yt-dlp -U).');
}

async function info(url) {
  const raw = await runYtdlp(['-J', '--', url]);
  const j = JSON.parse(raw);
  return {
    title: j.title || j.description?.slice(0, 80) || '제목 없음',
    uploader: j.uploader || j.channel || '',
    duration: j.duration || null,
    thumbnail: j.thumbnail || null,
    site: j.extractor_key || '',
  };
}

const FORMATS = {
  video: ['-f', 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b', '--merge-output-format', 'mp4'],
  audio: ['-f', 'ba/b', '-x', '--audio-format', 'mp3', '--audio-quality', '0'],
};

function safeFilename(name) {
  return name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 120) || 'download';
}

async function download(url, kind, res) {
  const dir = await mkdtemp(path.join(tmpdir(), 'media-dl-'));
  try {
    await runYtdlp([...FORMATS[kind], '-o', '%(title).80B [%(id)s].%(ext)s', '--', url], { cwd: dir });
    const files = (await readdir(dir)).filter(f => !f.endsWith('.part') && !f.endsWith('.ytdl'));
    if (!files.length) throw new Error('파일이 만들어지지 않았습니다.');
    const file = path.join(dir, files[0]);
    const { size } = await stat(file);
    const ext = path.extname(file).toLowerCase();
    const type = ext === '.mp3' ? 'audio/mpeg' : ext === '.mp4' ? 'video/mp4' : 'application/octet-stream';
    const name = safeFilename(files[0]);
    res.writeHead(200, {
      ...cors(res.req),
      'Content-Type': type,
      'Content-Length': size,
      'Content-Disposition': `attachment; filename="download${ext}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Cache-Control': 'no-store',
    });
    await new Promise((resolve, reject) => {
      const s = createReadStream(file);
      s.on('error', reject);
      res.on('close', resolve);
      s.pipe(res);
    });
  } finally {
    rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function cors(req) {
  const origin = req.headers.origin;
  if (!origin || !ORIGINS.includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Vary': 'Origin',
  };
}

function json(req, res, status, body) {
  res.writeHead(status, { ...cors(req), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req, limit = 10000) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > limit) { reject(new Error('too big')); req.destroy(); } });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

export const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, cors(req)); return res.end(); }
    if (u.pathname === '/api/health') return json(req, res, 200, { ok: true });

    const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!tokenOk(bearer || u.searchParams.get('token'))) return json(req, res, 401, { error: '비밀번호가 틀렸습니다.' });

    if (u.pathname === '/api/fallback' && req.method === 'GET') return json(req, res, 200, fallback);
    if (u.pathname === '/api/fallback' && req.method === 'POST') {
      let body;
      try { body = JSON.parse(await readBody(req)); } catch { return json(req, res, 400, { error: '요청 형식 오류' }); }
      const url = checkFallbackUrl(body.url);
      if (!url) return json(req, res, 400, { error: 'trycloudflare 주소만 됩니다.' });
      fallback = { url, at: Date.now() };
      writeFile(FALLBACK_FILE, JSON.stringify(fallback)).catch(e => console.error('fallback 저장 실패', e.message));
      console.log('PC 서버 주소 등록:', url);
      return json(req, res, 200, fallback);
    }

    if (u.pathname === '/api/info' && req.method === 'POST') {
      let body;
      try { body = JSON.parse(await readBody(req)); } catch { return json(req, res, 400, { error: '요청 형식 오류' }); }
      const url = checkUrl(body.url);
      if (!url) return json(req, res, 400, { error: 'YouTube·Instagram·Threads·TikTok 주소만 됩니다.' });
      if (running >= MAX_JOBS) return json(req, res, 429, { error: '다른 작업 중입니다. 잠시 뒤 다시 해 주세요.' });
      running++;
      try { return json(req, res, 200, await info(url)); }
      finally { running--; }
    }

    if (u.pathname === '/api/download' && req.method === 'GET') {
      const url = checkUrl(u.searchParams.get('url'));
      const kind = u.searchParams.get('kind') === 'audio' ? 'audio' : 'video';
      if (!url) return json(req, res, 400, { error: '지원하지 않는 주소입니다.' });
      if (running >= MAX_JOBS) return json(req, res, 429, { error: '다른 작업 중입니다. 잠시 뒤 다시 해 주세요.' });
      running++;
      try { return await download(url, kind, res); }
      finally { running--; }
    }

    json(req, res, 404, { error: 'not found' });
  } catch (err) {
    if (!res.headersSent) json(req, res, 502, { error: err.message || '서버 오류', code: err.code || 'failed' });
    else res.destroy();
  }
});

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  server.listen(PORT, HOST, () => console.log(`media-dl on http://${HOST}:${PORT}`));
}
