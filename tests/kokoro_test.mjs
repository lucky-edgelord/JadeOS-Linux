// Kokoro for real: the model synthesises speech through jaded's /tts API (the same path the kiosk uses), offline from build/kokoro.
// Checks the audio itself: a WAV of plausible length, with actual signal in it, and that speed changes the length.
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
const dir = path.resolve(process.env.KOKORO_DIR || 'build/kokoro');
if (!fs.existsSync(path.join(dir, 'ready'))) { console.log('FAIL build/kokoro is missing: run tools/fetch_kokoro.sh'); process.exit(1); }
const copies = fs.mkdtempSync(path.join(os.tmpdir(), 'kokoro-wav-'));
process.env.FAKE_COPY = copies; process.env.FAKE_PLAY = '0.05'; process.env.PATH = path.resolve('tests/fake') + ':' + process.env.PATH;
const { start } = await import('../native/jaded.mjs');
const log = [], fail = []; const ok = (c, m) => (c ? log : fail).push((c ? 'PASS ' : 'FAIL ') + m);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jaded-k-'));
const d = await start({ port: 0, root, token: 't', tts: 'kokoro', kokoroDir: dir });
const call = async (p, body) => { const r = await fetch(d.url.slice(0, -1) + p, { method: body ? 'POST' : 'GET', headers: { 'X-Jaded-Token': 't' }, body: body && JSON.stringify(body) }); return r.json(); };

const info = await call('/tts/info');
ok(info.engine === 'kokoro' && info.voices.length >= 2 && info.voices[0].id === 'af_heart', 'engine is Kokoro with voices: ' + info.voices.map(v => v.id).join(','));

function wav(file) {
  const b = fs.readFileSync(file); const rate = b.readUInt32LE(24); const n = (b.length - 44) / 2; let sum = 0, peak = 0;
  for (let i = 0; i < n; i++) { const s = b.readInt16LE(44 + i * 2) / 32768; sum += s * s; peak = Math.max(peak, Math.abs(s)); }
  return { ok: b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WAVE', rate, secs: n / rate, rms: Math.sqrt(sum / n), peak };
}
const latest = () => fs.readdirSync(copies).map(f => path.join(copies, f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
const text = 'Hello from Jade. This is a test of the voice, spoken entirely on this machine.';

const t0 = Date.now();
let r = await call('/tts/speak', { text, voice: 'af_heart', rate: 1 });
const a = r.ok && latest() ? wav(latest()) : null;
console.log(`first request (includes loading the model): ${Date.now() - t0} ms`, JSON.stringify(r));
ok(r.ok === true && r.engine === 'kokoro', 'speak with Kokoro succeeds: ' + JSON.stringify(r));
ok(a && a.ok && a.rate >= 16000 && a.secs > 2 && a.secs < 15, 'a WAV of plausible length: ' + JSON.stringify(a));
ok(a && a.rms > 0.01 && a.peak > 0.1 && a.peak <= 1, 'with real signal in it (rms ' + (a && a.rms.toFixed(3)) + ', peak ' + (a && a.peak.toFixed(2)) + ')');

const t1 = Date.now(); r = await call('/tts/speak', { text, voice: 'af_heart', rate: 1.5 });
const b = r.ok ? wav(latest()) : null;
console.log(`second request, model loaded: ${Date.now() - t1} ms (${b && b.secs.toFixed(1)} s of audio)`);
ok(b && a && b.secs < a.secs * 0.85, 'speed 1.5 is shorter than speed 1: ' + (b && b.secs.toFixed(2)) + ' < ' + (a && a.secs.toFixed(2)));

const other = info.voices.find(v => v.id.startsWith('b') || v.id.startsWith('am_'));
if (other) { r = await call('/tts/speak', { text: 'Another voice.', voice: other.id }); ok(r.ok === true, 'a second voice (' + other.id + ') works'); }

d.close(); fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(copies, { recursive: true, force: true });
for (const l of log) console.log(l); for (const l of fail) console.log(l);
console.log(`kokoro: ${log.length} passed, ${fail.length} failed`); if (!fail.length) console.log('ALL PASS');
process.exit(fail.length ? 1 : 0);
