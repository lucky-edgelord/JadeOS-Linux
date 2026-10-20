// Cross-origin requests from the page go through jaded: a server with NO CORS headers must still be reachable (streamed, with status and body).
import pw from 'playwright'; import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'; import http from 'node:http';
const { start } = await import(process.env.JADED_MJS || '../native/jaded.mjs');
const log = [], fail = []; const ok = (c, m) => (c ? log : fail).push((c ? 'PASS ' : 'FAIL ') + m);
let seen = null;
const other = http.createServer((q, r) => { let b = ''; q.on('data', c => b += c); q.on('end', () => { seen = { m: q.method, auth: q.headers.authorization, origin: q.headers.origin, b };
  if (q.url === '/nope') { r.writeHead(401, { 'Content-Type': 'application/json' }); return r.end('{"error":"unauthorized"}'); }
  r.writeHead(200, { 'Content-Type': 'application/x-ndjson' }); r.write('{"n":1}\n'); setTimeout(() => { r.write('{"n":2}\n'); r.end(); }, 150); }); });   // no Access-Control-* headers at all
await new Promise(ok => other.listen(0, '127.0.0.1', ok)); const OP = other.address().port;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'px-'));
const d = await start({ port: 0, root, page: process.env.NATIVE_PAGE || 'build/native-page.html', token: 'px' });
const browser = await pw.chromium.launch(); const page = await (await browser.newContext()).newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.route('**/*', r => { const u = r.request().url(); return (u.startsWith(d.url.slice(0, -1)) || u.startsWith('http://127.0.0.1:' + OP) || u.startsWith('data:') || u.startsWith('blob:')) ? r.continue() : r.abort(); });
await page.goto(d.url); await page.waitForFunction(() => typeof vfs !== 'undefined' && vfs.native, null, { timeout: 30000 }); await page.waitForTimeout(500);
const direct = await page.evaluate(async p => { try { await (await fetch('http://127.0.0.1:' + p + '/x')).text(); return 'ok'; } catch (e) { return 'blocked'; } }, OP);
ok(direct === 'ok', 'the page can reach a site with no CORS headers through the proxy (' + direct + ')');
const r = await page.evaluate(async p => { const res = await fetch('http://127.0.0.1:' + p + '/chat', { method: 'POST', headers: { Authorization: 'Bearer k1', 'Content-Type': 'application/json' }, body: JSON.stringify({ hi: 1 }) });
  const rd = res.body.getReader(), dec = new TextDecoder(); let out = '', chunks = 0; for (;;) { const { done, value } = await rd.read(); if (done) break; out += dec.decode(value); chunks++; } return { s: res.status, out, chunks }; }, OP);
ok(r.s === 200 && r.out === '{"n":1}\n{"n":2}\n', 'POST body and a streamed answer come back whole: ' + JSON.stringify(r.out));
ok(r.chunks >= 2, 'the answer arrives in pieces (' + r.chunks + ')');
ok(seen && seen.m === 'POST' && seen.auth === 'Bearer k1' && seen.b === '{"hi":1}' && !seen.origin, 'method, Authorization and body are passed on, no Origin header: ' + JSON.stringify(seen));
const e = await page.evaluate(async p => { const res = await fetch('http://127.0.0.1:' + p + '/nope'); return [res.status, await res.text()]; }, OP);
ok(e[0] === 401 && /unauthorized/.test(e[1]), 'an error status from the other site is passed on (' + e[0] + ')');
const same = await page.evaluate(async () => (await fetch(location.href)).status); ok(same === 200, 'requests to its own origin are untouched (' + same + ')');
const noTok = await fetch(d.url + 'native/proxy', { method: 'POST', headers: { 'X-Proxy-Url': 'http://127.0.0.1:' + OP + '/x' } }); ok(noTok.status === 401, 'the proxy needs the page token');
ok(!errs.length, 'no page errors ' + errs.join('|'));
console.log([...log, ...fail].join('\n')); console.log(`${log.length} passed, ${fail.length} failed`);
await browser.close(); d.close(); other.close(); process.exit(fail.length ? 1 : 0);
