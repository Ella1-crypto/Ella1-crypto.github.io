/* PC용 실행기 — 서버 + Cloudflare Tunnel을 켜고, 새 터널 주소를 Oracle 서버에 알린다
 *
 * trycloudflare 주소는 켤 때마다 바뀐다. 그래서 주소가 나오면 PRIMARY_URL(Oracle 서버)의
 * /api/fallback 에 등록해 두고, 다운로더 페이지는 Oracle이 막혔을 때 그 주소로 다시 시도한다.
 *
 *   node launcher.mjs      (start.bat가 settings.bat를 읽은 뒤 실행)
 *   환경변수: ACCESS_TOKEN(필수), PRIMARY_URL(없으면 등록 생략), PORT(기본 8790), CLOUDFLARED(기본 cloudflared)
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || '8790';
const PRIMARY = (process.env.PRIMARY_URL || '').replace(/\/+$/, '');
const TOKEN = process.env.ACCESS_TOKEN || '';

const children = [];
function run(name, cmd, args) {
  const child = spawn(cmd, args, { cwd: here, env: process.env, windowsHide: true });
  children.push(child);
  child.on('error', e => {
    console.error(`[${name}] 실행 실패: ${e.code === 'ENOENT' ? cmd + ' 를 찾을 수 없습니다(설치 확인)' : e.message}`);
    shutdown(1);
  });
  child.on('exit', code => { console.error(`[${name}] 종료됨 (${code})`); shutdown(code || 1); });
  return child;
}

function shutdown(code) {
  for (const c of children) if (c.exitCode === null) c.kill();
  setTimeout(() => process.exit(code), 300);
}
process.on('SIGINT', () => shutdown(0));

async function register(url) {
  if (!PRIMARY) return console.log('PRIMARY_URL이 없어 Oracle 서버 등록은 건너뜁니다.');
  for (let i = 1; i <= 5; i++) {
    try {
      const r = await fetch(PRIMARY + '/api/fallback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN },
        body: JSON.stringify({ url }),
      });
      if (r.ok) return console.log('Oracle 서버에 PC 주소를 등록했습니다. 페이지가 막힐 때 자동으로 PC를 씁니다.');
      console.error('등록 실패:', r.status, await r.text());
      if (r.status < 500) return;
    } catch (e) { console.error(`등록 실패(${i}/5):`, e.message); }
    await new Promise(r => setTimeout(r, i * 5000));
  }
}

const server = run('서버', process.execPath, ['server.mjs']);
server.stdout.on('data', d => process.stdout.write(d));
server.stderr.on('data', d => process.stderr.write(d));

const tunnel = run('터널', process.env.CLOUDFLARED || 'cloudflared', ['tunnel', '--url', `http://localhost:${PORT}`]);
let found = false;
const scan = d => {
  const m = !found && String(d).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (!m) return;
  found = true;
  console.log(`\n  PC 서버 주소: ${m[0]}\n`);
  register(m[0]);
};
tunnel.stdout.on('data', scan);
tunnel.stderr.on('data', scan); // cloudflared는 안내를 stderr로 출력한다
