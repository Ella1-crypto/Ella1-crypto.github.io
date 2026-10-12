/* 체험판 계산 엔진 — 브라우저용 파이썬(Pyodide)으로 본 프로그램의 규칙·백테스트 코드를 그대로 실행한다. 화면이 멈추지 않게 별도 스레드에서 돈다. */
importScripts("https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js");

let ready = null;

async function boot(v) {
  const [py, files, bars] = await Promise.all([
    loadPyodide(),
    fetch("engine.json?v=" + v).then((r) => r.json()),
    fetch("bars.json?v=" + v).then((r) => r.text()),
  ]);
  for (const [path, source] of Object.entries(files)) {
    const dir = "/demo/" + path.split("/").slice(0, -1).join("/");
    py.FS.mkdirTree(dir);
    py.FS.writeFile("/demo/" + path, source);
  }
  py.runPython("import sys; sys.path.insert(0, '/demo'); import demo_engine");
  const engine = py.pyimport("demo_engine");
  engine.load_bars(bars);
  return engine;
}

self.onmessage = async (e) => {
  if (e.data.init) { ready = boot(e.data.init); ready.catch(() => {}); return; }
  const { id, kind, body } = e.data;
  try {
    const engine = await ready;
    self.postMessage({ id, out: JSON.parse(engine.handle(kind, JSON.stringify(body))) });
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message ? err.message : err) });
  }
};
