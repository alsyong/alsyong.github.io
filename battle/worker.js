// 계산 엔진 실행 담당 (화면이 멈추지 않도록 별도 스레드에서 파이썬 엔진을 돌린다)
const DEFAULT_URL = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';
// 개발 중 로컬 확인용으로만 ?pyodide= 경로를 받는다 (같은 사이트 안의 경로만 허용)
const override = new URLSearchParams(self.location.search).get('pyodide');
const PYODIDE_URL = override && override.startsWith('/') ? override : DEFAULT_URL;
try {
  importScripts(PYODIDE_URL + 'pyodide.js');
} catch (err) {
  postMessage({ type: 'fatal', error: 'pyodide.js 로드 실패' });
  throw err;
}

let bridge = null;

const ready = (async () => {
  postMessage({ type: 'progress', text: '파이썬 엔진 불러오는 중' });
  const py = await loadPyodide({ indexURL: PYODIDE_URL });
  postMessage({ type: 'progress', text: '판단 로직과 데이터 불러오는 중' });
  const res = await fetch('engine.zip?v=1');
  if (!res.ok) throw new Error('engine.zip 로드 실패');
  py.unpackArchive(await res.arrayBuffer(), 'zip', { extractDir: '/app' });
  py.runPython("import sys, os\nsys.path.insert(0, '/app/src')\nos.chdir('/app/src')");
  bridge = py.pyimport('web_bridge');
  postMessage({ type: 'ready' });
})().catch((err) => {
  postMessage({ type: 'fatal', error: String(err && err.message ? err.message : err) });
  throw err;
});

onmessage = async (e) => {
  const { id, fn, args } = e.data;
  try {
    await ready;
    const out = bridge[fn](...(args || []));
    postMessage({ type: 'result', id, ok: true, data: out });
  } catch (err) {
    postMessage({ type: 'result', id, ok: false, error: String(err && err.message ? err.message : err) });
  }
};
