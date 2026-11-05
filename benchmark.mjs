// Charge synthétique locale uniquement : ne contacte pas le site ni les outils réels.
import { performance } from 'node:perf_hooks';
import { createApp } from './penthouse.js';
import { openDb } from './db.js';
import { ingest, snapshot } from './core.js';
const db = openDb(':memory:'), now = Date.now() / 1000;
for (let i = 0; i < 20; i++) {
  db.create('resident-' + i, 'Resident ' + i, 'unused', 50);
  db.change('resident-' + i, store => {
    for (let j = 0; j < 30; j++) ingest(store, 'codex', 'machine', { hook_event_name: 'UserPromptSubmit', session_id: 's' + j, prompt: 'Benchmark', cwd: '/project' }, now);
  });
}
const app = createApp({ code: 'benchmark', db }).listen(0, '127.0.0.1');
await new Promise(resolve => app.once('listening', resolve));
const url = 'http://127.0.0.1:' + app.address().port;
try {
  const joined = await fetch(url + '/api/join', { method: 'POST', body: JSON.stringify({ name: 'Resident 0', code: 'benchmark' }) });
  const cookie = joined.headers.get('set-cookie').split(';')[0];
  const read = async encoding => { const response = await fetch(url + '/api/state', { headers: { cookie, 'Accept-Encoding': encoding } }); await response.text(); return response; };
  const optimized = db.snapshots;
  const results = {};
  for (const mode of ['previous', 'optimized']) {
    db.snapshots = mode === 'optimized' ? optimized : t => db.all().map(a => ({ slug: a.slug, name: a.name, created: a.created, ...db.change(a.slug, store => snapshot(store, t)) }));
    for (let i = 0; i < 10; i++) await read('identity');
    const start = performance.now();
    for (let i = 0; i < 40; i++) await read('identity');
    results[mode + 'AverageMs'] = +((performance.now() - start) / 40).toFixed(2);
  }
  const compressed = await read('gzip');
  // Tout le code de la page : app.js et ses modules (tour/, tour/floors/, ui/).
  const { readdirSync } = await import('node:fs');
  const paths = ['/app.js', ...['tour', 'tour/floors', 'ui'].flatMap(d => readdirSync(new URL('./public/' + d + '/', import.meta.url)).filter(f => f.endsWith('.js')).map(f => `/${d}/${f}`))];
  let jsRaw = 0, jsGzip = 0;
  for (const path of paths) {
    const r = await fetch(url + path, { headers: { 'Accept-Encoding': 'gzip' } });
    jsRaw += Buffer.byteLength(await r.text()); jsGzip += Number(r.headers.get('content-length'));
  }
  console.log(JSON.stringify({ residents: 20, sessions: 600, ...results, stateGzipBytes: Number(compressed.headers.get('content-length')), jsModules: paths.length, jsRawBytes: jsRaw, jsGzipBytes: jsGzip }, null, 2));
} finally { app.close(); }
