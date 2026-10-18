#!/usr/bin/env node
// jaded: the native host for Jade Vault. Serves the Jade Vault page and gives it the machine it runs on:
// a real file tree (the workspace), a real shell (BusyBox sh), real node / micropython / sqlite3 through that shell.
// No dependencies. Meant for a kiosk (JadeOS-Linux): bound to 127.0.0.1, every call needs the per-boot token that
// the served page carries, so no other web page can drive the shell.
//
//   JADED_PAGE=dist/jade-vault.html JADED_ROOT=/home/jade node native/jaded.mjs
//
// env: JADED_PORT (8080) JADED_HOST (127.0.0.1) JADED_ROOT (~/jade) JADED_PAGE (page to serve at /)
//      JADED_TOKEN (fixed token; default random per start) JADED_SHELL (/bin/sh)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const VERSION = '1.0.0';

export function start(opt = {}) {
  const PORT0 = +(opt.port ?? process.env.JADED_PORT ?? 8080); let PORT = PORT0;   // PORT is the real one once listening
  const HOST = opt.host ?? process.env.JADED_HOST ?? '127.0.0.1';
  const ROOT = path.resolve(opt.root ?? process.env.JADED_ROOT ?? path.join(os.homedir(), 'jade'));
  const PAGE = opt.page ?? process.env.JADED_PAGE ?? path.join(HERE, '..', 'dist', 'jade-vault.html');
  const TOKEN = opt.token ?? process.env.JADED_TOKEN ?? crypto.randomBytes(24).toString('hex');
  const SHELL = opt.shell ?? process.env.JADED_SHELL ?? '/bin/sh';
  fs.mkdirSync(ROOT, { recursive: true });

  // wrappers so the real shell can call Jade's own commands (`jade`, `flow`, ...): they relay to the page
  const BIN = fs.mkdtempSync(path.join(os.tmpdir(), 'jaded-bin-'));
  const RPC_CMDS = ['jade', 'flow', 'crontab', 'open', 'links', 'backlinks', 'tags', 'search', 'today', 'mcp'];
  for (const n of RPC_CMDS) {
    fs.writeFileSync(path.join(BIN, n), `#!/bin/sh\nexec "\${JADED_NODE:-node}" "${path.join(HERE, 'jade-cli.mjs')}" ${n} "$@"\n`, { mode: 0o755 });
  }

  // ---- paths: the page speaks workspace paths ("/Notes/a.md"); "/" is ROOT on the machine
  const real = p => {
    const parts = []; for (const s of String(p || '/').split('/')) { if (!s || s === '.') continue; if (s === '..') parts.pop(); else parts.push(s); }
    return path.join(ROOT, ...parts);
  };
  const virt = r => { const rel = path.relative(ROOT, r); return '/' + rel.split(path.sep).filter(Boolean).join('/'); };
  const st2o = s => ({ dir: s.isDirectory(), size: s.isDirectory() ? 4096 : s.size, mtime: Math.round(s.mtimeMs) });

  // ---- events (SSE) and page RPC
  const clients = new Set();
  const send = (res, ev, data) => res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
  const emit = (ev, data) => { for (const c of clients) send(c, ev, data); };
  let fsTimer = null;
  try {
    fs.watch(ROOT, { recursive: true }, () => { clearTimeout(fsTimer); fsTimer = setTimeout(() => emit('fs', { t: Date.now() }), 120); });
  } catch (e) { console.error('jaded: file watching is off:', e.message); }
  const rpcWait = new Map(); let rpcSeq = 0;

  // ---- helpers
  const readBody = (req, max = 256 * 1024 * 1024) => new Promise((ok, no) => {
    const bufs = []; let n = 0;
    req.on('data', b => { n += b.length; if (n > max) { no(new Error('body too large')); req.destroy(); } else bufs.push(b); });
    req.on('end', () => ok(Buffer.concat(bufs))); req.on('error', no);
  });
  const json = (res, code, obj) => { const b = Buffer.from(JSON.stringify(obj)); res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': b.length, 'Cache-Control': 'no-store' }); res.end(b); };
  const fail = (res, e) => json(res, e.code === 'ENOENT' ? 404 : e.code === 'EEXIST' ? 409 : e.code === 'ENOTEMPTY' ? 409 : e.code === 'EISDIR' || e.code === 'ENOTDIR' ? 400 : 500, { error: e.message, code: e.code || null });
  const tool = c => { const r = spawnSync(SHELL, ['-c', `command -v ${c} >/dev/null && ${c} --version 2>&1 | head -1`], { encoding: 'utf8' }); return r.status === 0 ? (r.stdout || '').trim() || true : null; };

  function walkTree(dir, out, max) {
    let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    ents.sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const e of ents) {
      if (out.length >= max) return;
      const f = path.join(dir, e.name); let s; try { s = fs.statSync(f); } catch { continue; }
      out.push([virt(f), s.isDirectory() ? 1 : 0, s.isDirectory() ? 4096 : s.size, Math.round(s.mtimeMs)]);
      if (s.isDirectory() && !e.isSymbolicLink()) walkTree(f, out, max);
    }
  }

  const cpr = (a, b) => { fs.cpSync(a, b, { recursive: true, force: true }); };

  // ---- /exec : a real shell command, streamed as NDJSON {t:'o'|'e', s} ... {t:'x', code, cwd, env}
  function exec(req, res, b) {
    const cwd0 = b.realCwd && fs.existsSync(b.realCwd) ? b.realCwd : real(b.cwd || '/');
    const env = { ...process.env, HOME: ROOT, PWD: cwd0, TERM: 'dumb', PATH: BIN + ':' + (process.env.PATH || '/usr/bin:/bin'),
      JADED_URL: `http://127.0.0.1:${PORT}`, JADED_TOKEN: TOKEN, JADE_ROOT: ROOT, ...Object.fromEntries(Object.entries(b.env || {}).filter(([k]) => /^[A-Za-z_]\w*$/.test(k) && !['HOME', 'PATH', 'PWD', 'JADED_TOKEN', 'JADED_URL', 'JADE_ROOT'].includes(k))) };
    // after the command, report the working directory and exported variables on fds 3 and 4
    const wrapper = `${b.cmd}\n__jc=$?\npwd >&3 2>/dev/null\nexport -p >&4 2>/dev/null\nexit $__jc\n`;
    const p = spawn(SHELL, ['-c', wrapper], { cwd: cwd0, env, stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe'], detached: true });
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
    let cwd = '', exp = '', done = false;
    const line = o => { if (!res.writableEnded) res.write(JSON.stringify(o) + '\n'); };
    p.stdout.on('data', d => line({ t: 'o', s: d.toString('utf8') }));
    p.stderr.on('data', d => line({ t: 'e', s: d.toString('utf8') }));
    p.stdio[3].on('data', d => { cwd += d; }); p.stdio[4].on('data', d => { exp += d; });
    p.stdin.on('error', () => {}); p.stdin.end(b.stdin ? Buffer.from(b.stdin) : undefined);
    const kill = sig => { try { process.kill(-p.pid, sig); } catch { try { p.kill(sig); } catch {} } };
    const timeoutMs = Math.min(Math.max(500, b.timeoutMs || 60000), 3600000);
    const timer = setTimeout(() => { if (!done) { line({ t: 'e', s: `timed out after ${Math.round(timeoutMs / 1000)}s\n` }); kill('SIGKILL'); } }, timeoutMs);
    res.on('close', () => { if (!done) kill('SIGKILL'); });
    p.on('close', (code, sig) => {
      done = true; clearTimeout(timer);
      const vars = {}; for (const l of exp.split('\n')) { const m = /^export ([A-Za-z_]\w*)=(.*)$/.exec(l); if (m) { let v = m[2]; if (/^'.*'$/.test(v)) v = v.slice(1, -1).replace(/'\\''/g, "'"); else if (/^".*"$/.test(v)) v = v.slice(1, -1); if ((m[1] in env ? !/['"\\]/.test(m[2]) : true) && env[m[1]] !== v && m[1] !== 'PWD' && m[1] !== 'OLDPWD' && m[1] !== '_' && m[1] !== 'SHLVL') vars[m[1]] = v; } }
      line({ t: 'x', code: code ?? (sig ? 128 + (os.constants.signals[sig] || 9) : 1), cwd: cwd.trim(), vcwd: cwd.trim() ? (cwd.trim() === ROOT || cwd.trim().startsWith(ROOT + '/') ? virt(cwd.trim()) : null) : null, env: vars });
      res.end();
    });
    p.on('error', e => { line({ t: 'e', s: `jaded: ${e.message}\n` }); line({ t: 'x', code: 127 }); res.end(); });
  }


  // ---- speech: Kokoro (neural, offline) when it is installed, else Flite; the audio is played through ALSA (aplay)
  const KOKORO_DIR = opt.kokoroDir ?? process.env.KOKORO_DIR ?? '/opt/kokoro';
  const KMODEL = path.join(KOKORO_DIR, 'models', 'onnx-community', 'Kokoro-82M-v1.0-ONNX');
  const hasCmd = c => spawnSync('sh', ['-c', `command -v ${c} >/dev/null`]).status === 0;
  const ENGINES = { kokoro: fs.existsSync(path.join(KOKORO_DIR, 'ready')), flite: hasCmd('flite') };
  const wantEngine = opt.tts ?? process.env.JADED_TTS ?? 'auto';
  const ENGINE = wantEngine === 'auto' ? (ENGINES.kokoro ? 'kokoro' : ENGINES.flite ? 'flite' : 'none') : (ENGINES[wantEngine] ? wantEngine : 'none');
  const PLAYER = (opt.ttsPlayer ?? process.env.JADED_TTS_PLAYER ?? 'aplay -q').split(/\s+/).filter(Boolean);
  const FLITE_VOICES = ['slt', 'rms', 'awb', 'kal16'];
  const kokoroVoices = () => { try { return fs.readdirSync(path.join(KMODEL, 'voices')).filter(f => f.endsWith('.bin')).map(f => f.slice(0, -4)).sort(); } catch { return []; } };
  const voiceInfo = (engine, id) => {
    if (engine === 'flite') return { id, name: 'Flite ' + id.toUpperCase(), lang: 'en-US' };
    const m = /^([ab])([fm])_(\w+)$/.exec(id); const nm = m ? m[3][0].toUpperCase() + m[3].slice(1) : id;
    return { id, name: `Kokoro ${nm}${m ? ` (${m[1] === 'a' ? 'US' : 'UK'}, ${m[2] === 'f' ? 'female' : 'male'})` : ''}`, lang: m && m[1] === 'b' ? 'en-GB' : 'en-US' };
  };
  const voicesFor = engine => engine === 'kokoro'
    ? (() => { const v = kokoroVoices(); v.sort((a, b) => (b === 'af_heart') - (a === 'af_heart')); return v.map(id => voiceInfo('kokoro', id)); })()
    : engine === 'flite' ? FLITE_VOICES.map(id => voiceInfo('flite', id)) : [];
  const TTS_INFO = { engine: ENGINE, engines: Object.keys(ENGINES).filter(k => ENGINES[k]), voices: voicesFor(ENGINE) };
  let TTS_JS = ''; try { TTS_JS = fs.readFileSync(path.join(HERE, 'native_tts.js'), 'utf8'); } catch {}

  let kw = null, kwSeq = 0, kwIdle = null; const kwWait = new Map();
  function kokoroWorker() {
    if (kw) return kw;
    const w = spawn(process.execPath, [path.join(KOKORO_DIR, 'kokoro_worker.mjs')], { cwd: KOKORO_DIR, env: { ...process.env, KOKORO_DIR }, stdio: ['pipe', 'pipe', 'inherit'] });
    let buf = '';
    w.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { const r = JSON.parse(l); const f = kwWait.get(r.id); kwWait.delete(r.id); if (f) f(r); } catch {} } });
    const gone = () => { if (kw === w) kw = null; for (const [id, f] of kwWait) { kwWait.delete(id); f({ id, ok: false, error: 'the Kokoro helper stopped' }); } };
    w.on('exit', gone); w.on('error', gone); w.stdin.on('error', () => {});
    return (kw = w);
  }
  function kokoroRun(q) {
    return new Promise(ok => {
      clearTimeout(kwIdle); const id = ++kwSeq; kwWait.set(id, r => { kwIdle = setTimeout(() => { try { kw && kw.kill('SIGTERM'); } catch {} }, 15 * 60 * 1000); kwIdle.unref?.(); ok(r); });
      try { kokoroWorker().stdin.write(JSON.stringify({ id, ...q }) + '\n'); } catch (e) { kwWait.delete(id); ok({ ok: false, error: String(e.message || e) }); }
    });
  }
  const runProc = (job, cmd, args) => new Promise(ok => {
    if (job.cancelled) return ok(1);
    const c = spawn(cmd, args, { stdio: 'ignore' }); job.procs.add(c);
    c.on('error', () => { job.procs.delete(c); ok(127); }); c.on('close', code => { job.procs.delete(c); ok(code ?? 1); });
  });
  const ttsJobs = new Set();
  const ttsStop = () => { for (const j of ttsJobs) { j.cancelled = true; for (const c of j.procs) { try { c.kill('SIGKILL'); } catch {} } } };
  async function ttsSpeak(b) {
    const engine = b.engine && ENGINES[b.engine] ? b.engine : ENGINE;
    if (engine === 'none') return { ok: false, error: 'no speech engine is installed' };
    const text = String(b.text || '').slice(0, 4000).trim(); if (!text) return { ok: true, silent: true };
    const rate = Math.min(2, Math.max(0.5, +b.rate || 1)), pitch = Math.min(2, Math.max(0.5, +b.pitch || 1));
    const job = { cancelled: false, procs: new Set() }; ttsJobs.add(job);
    const wav = path.join(os.tmpdir(), `jaded-tts-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.wav`);
    const t0 = Date.now();
    try {
      let synthMs;
      if (engine === 'kokoro') {
        const vs = kokoroVoices(); const voice = vs.includes(b.voice) ? b.voice : (vs.includes('af_heart') ? 'af_heart' : vs[0]);
        const r = await kokoroRun({ text, voice, speed: rate, out: wav }); if (!r.ok) return { ok: false, error: r.error || 'synthesis failed' };
        synthMs = r.ms;
      } else {
        const voice = FLITE_VOICES.includes(b.voice) ? b.voice : FLITE_VOICES[0];
        const code = await runProc(job, 'flite', ['-voice', voice, '--setf', 'duration_stretch=' + (1 / rate).toFixed(2), '--setf', 'int_f0_mean=' + Math.round(160 * pitch), '-t', text, '-o', wav]);
        if (job.cancelled) return { ok: false, cancelled: true };
        if (code !== 0) return { ok: false, error: 'flite failed (' + code + ')' };
        synthMs = Date.now() - t0;
      }
      if (job.cancelled) return { ok: false, cancelled: true };
      const code = await runProc(job, PLAYER[0], [...PLAYER.slice(1), wav]);
      if (job.cancelled) return { ok: false, cancelled: true };
      return code === 0 ? { ok: true, engine, synthMs, ms: Date.now() - t0 } : { ok: false, error: 'the audio player failed (' + code + ')' };
    } finally { ttsJobs.delete(job); fs.rm(wav, { force: true }, () => {}); }
  }

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x'); const q = u.searchParams; const p = u.pathname;
    try {
      // DNS-rebinding guard: only answer to our own names
      const host = (req.headers.host || '').replace(/:\d+$/, '');
      if (!(host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || opt.anyHost || process.env.JADED_ANY_HOST === '1' || (HOST !== '127.0.0.1' && HOST !== 'localhost'))) { res.writeHead(421, { 'Content-Length': 11, Connection: 'close' }); return res.end('misdirected'); }
      if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
        let html; try { html = fs.readFileSync(PAGE, 'utf8'); } catch { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('jaded: no page at ' + PAGE + ' (build it: python3 app/build.py)'); }
        const boot = `<script>window.__JADED__=${JSON.stringify({ token: TOKEN, root: ROOT, version: VERSION, shell: SHELL, tts: TTS_INFO })};</script>` + (TTS_JS ? `<script>${TTS_JS}</script>` : '');
        if (ENGINE === 'kokoro') { try { kokoroWorker(); } catch {} }   // load the model while the page opens
        const m = /<head[^>]*>|<html[^>]*>/i.exec(html.slice(0, 4096)) || /<!doctype[^>]*>/i.exec(html.slice(0, 4096));   // only the document start: '<head>' also occurs inside scripts
        html = m ? html.slice(0, m.index + m[0].length) + boot + html.slice(m.index + m[0].length) : boot + html;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY' }); return res.end(html);
      }
      if (req.method === 'GET' && p === '/favicon.ico') { res.writeHead(204); return res.end(); }
      if (!(p.startsWith('/fs/') || p.startsWith('/native/') || p.startsWith('/exec') || p.startsWith('/rpc/') || p.startsWith('/tts/'))) { res.writeHead(404); return res.end('not found'); }
      if ((req.headers['x-jaded-token'] || q.get('token')) !== TOKEN) return json(res, 401, { error: 'bad token' });

      // ---- info + events
      if (p === '/native/ping') {
        return json(res, 200, { name: 'jaded', version: VERSION, root: ROOT, platform: process.platform, arch: process.arch, node: process.version, shell: SHELL,
          tts: TTS_INFO.engine, tools: { busybox: tool('busybox'), node: process.version, micropython: tool('micropython'), sqlite3: tool('sqlite3'), python3: tool('python3') }, rpc: RPC_CMDS });
      }
      if (p === '/native/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        res.write(': hi\n\n'); clients.add(res); const ka = setInterval(() => res.write(': ka\n\n'), 20000);
        req.on('close', () => { clients.delete(res); clearInterval(ka); }); return;
      }
      // ---- page RPC: the real shell asks the page to run one of Jade's commands
      if (p.startsWith('/rpc/') && req.method === 'POST') {
        if (!clients.size) return json(res, 503, { error: 'the Jade page is not open' });
        const body = JSON.parse((await readBody(req)).toString() || '{}'); const id = ++rpcSeq;
        const r = await new Promise(ok => { const t = setTimeout(() => { rpcWait.delete(id); ok({ code: 124, err: 'jade: the page did not answer in time\n' }); }, 10 * 60 * 1000); rpcWait.set(id, v => { clearTimeout(t); ok(v); }); emit('rpc', { id, name: p.slice(5), argv: body.argv || [], stdin: body.stdin || '', cwd: body.cwd || '/' }); });
        return json(res, 200, r);
      }
      if (p.startsWith('/native/rpc/') && req.method === 'POST') {
        const id = +p.slice(12); const f = rpcWait.get(id); rpcWait.delete(id);
        if (f) f(JSON.parse((await readBody(req)).toString() || '{}')); return json(res, 200, { ok: !!f });
      }
      if (p === '/tts/info') return json(res, 200, TTS_INFO);
      if (p === '/tts/stop' && req.method === 'POST') { ttsStop(); return json(res, 200, { ok: true }); }
      if (p === '/tts/speak' && req.method === 'POST') {
        const b = JSON.parse((await readBody(req)).toString() || '{}');
        let gone = false; res.on('close', () => { if (!res.writableEnded) { gone = true; ttsStop(); } });
        const r = await ttsSpeak(b); if (gone) return; return json(res, 200, r);
      }
      if (p === '/exec' && req.method === 'POST') { const b = JSON.parse((await readBody(req)).toString() || '{}'); return exec(req, res, b); }

      // ---- files
      const target = real(q.get('p') || '/');
      if (p === '/fs/stat') { try { return json(res, 200, st2o(fs.statSync(target))); } catch (e) { return fail(res, e); } }
      if (p === '/fs/list') {
        try {
          const out = []; for (const e of fs.readdirSync(target, { withFileTypes: true })) { try { const s = fs.statSync(path.join(target, e.name)); out.push({ name: e.name, ...st2o(s) }); } catch {} }
          return json(res, 200, out.sort((a, b) => (a.name < b.name ? -1 : 1)));
        } catch (e) { return fail(res, e); }
      }
      if (p === '/fs/tree') { const out = []; try { const s = fs.statSync(target); out.push([virt(target), 1, 4096, Math.round(s.mtimeMs)]); } catch (e) { return fail(res, e); } walkTree(target, out, +(q.get('max') || 50000)); return json(res, 200, out); }
      if (p === '/fs/read') {
        try { const s = fs.statSync(target); if (s.isDirectory()) return json(res, 400, { error: 'is a directory', code: 'EISDIR' }); const buf = fs.readFileSync(target); res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': buf.length, 'Cache-Control': 'no-store' }); return res.end(buf); }
        catch (e) { return fail(res, e); }
      }
      if (p === '/fs/write' && (req.method === 'PUT' || req.method === 'POST')) {
        const body = await readBody(req);
        try {
          if (q.get('mkdirs') === '1') fs.mkdirSync(path.dirname(target), { recursive: true });
          if (fs.existsSync(target) && fs.statSync(target).isDirectory()) return json(res, 400, { error: 'is a directory', code: 'EISDIR' });
          if (q.get('append') === '1') fs.appendFileSync(target, body);
          else { const tmp = target + '.jaded-' + process.pid + '.tmp'; fs.writeFileSync(tmp, body); fs.renameSync(tmp, target); }
          return json(res, 200, { ok: true });
        } catch (e) { return fail(res, e); }
      }
      if (p === '/fs/mkdir' && req.method === 'POST') { try { fs.mkdirSync(target, { recursive: q.get('parents') === '1' }); return json(res, 200, { ok: true }); } catch (e) { return fail(res, e); } }
      if (p === '/fs/rm' && req.method === 'POST') {
        if (target === ROOT) return json(res, 400, { error: "refusing to remove the workspace root" });
        try { const s = fs.lstatSync(target); if (s.isDirectory()) { if (q.get('r') === '1') fs.rmSync(target, { recursive: true }); else fs.rmdirSync(target); } else fs.unlinkSync(target); return json(res, 200, { ok: true }); } catch (e) { return fail(res, e); }
      }
      if (p === '/fs/mv' && req.method === 'POST') {
        const a = real(q.get('from')), b = real(q.get('to'));
        try { if (b === a || b.startsWith(a + path.sep)) return json(res, 400, { error: 'cannot move into itself' }); fs.mkdirSync(path.dirname(b), { recursive: true }); try { fs.renameSync(a, b); } catch (e) { if (e.code !== 'EXDEV') throw e; cpr(a, b); fs.rmSync(a, { recursive: true }); } return json(res, 200, { ok: true }); } catch (e) { return fail(res, e); }
      }
      if (p === '/fs/cp' && req.method === 'POST') { const a = real(q.get('from')), b = real(q.get('to')); try { fs.mkdirSync(path.dirname(b), { recursive: true }); cpr(a, b); return json(res, 200, { ok: true }); } catch (e) { return fail(res, e); } }
      json(res, 404, { error: 'unknown call ' + p });
    } catch (e) { try { json(res, 500, { error: String(e.message || e) }); } catch {} }
  });
  server.requestTimeout = 0; server.headersTimeout = 30000;
  return new Promise((ok, no) => server.listen(PORT0, HOST, () => { const port = server.address().port; PORT = port; ok({ server, port, token: TOKEN, root: ROOT, url: `http://127.0.0.1:${port}/`, close: () => { ttsStop(); try { kw && kw.kill('SIGKILL'); } catch {} for (const c of clients) c.end(); server.closeAllConnections?.(); server.close(); try { fs.rmSync(BIN, { recursive: true }); } catch {} } }); server.on('error', no); }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  start().then(d => console.log(`jaded ${VERSION}: ${d.url}  workspace ${d.root}`)).catch(e => { console.error('jaded:', e.message); process.exit(1); });
}
