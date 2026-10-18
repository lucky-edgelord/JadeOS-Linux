// Kokoro-82M text to speech, run as a long-lived helper of jaded (so the model is loaded once).
// Lives next to its node_modules (installed by tools/fetch_kokoro.sh), by default /opt/kokoro, and works fully offline:
// the model and voices are plain files under <dir>/models/onnx-community/Kokoro-82M-v1.0-ONNX/.
//
// stdin: one JSON per line {id, text, voice, speed, out}      stdout: one JSON per line {id, ok, secs, ms} or {id, ok:false, error}
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.KOKORO_DIR || HERE;
const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const DTYPE = process.env.KOKORO_DTYPE || 'q8';

const { env } = await import('@huggingface/transformers');
env.allowRemoteModels = false; env.allowLocalModels = true;
env.localModelPath = path.join(BASE, 'models') + '/';
env.cacheDir = path.join(BASE, 'cache');
const { KokoroTTS } = await import('kokoro-js');

function wav16(samples, rate) {
  const n = samples.length, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) { const s = Math.max(-1, Math.min(1, samples[i])); b.writeInt16LE(Math.round(s < 0 ? s * 32768 : s * 32767), 44 + i * 2); }
  return b;
}

let tts = null;
const load = async () => tts || (tts = await KokoroTTS.from_pretrained(MODEL, { dtype: DTYPE, device: 'cpu' }));

const rl = readline.createInterface({ input: process.stdin });
let chain = Promise.resolve();
rl.on('line', line => {
  chain = chain.then(async () => {
    let q; try { q = JSON.parse(line); } catch { return; }
    const t0 = Date.now();
    try {
      const m = await load();
      const a = await m.generate(String(q.text || ''), { voice: q.voice || 'af_heart', speed: Math.min(2, Math.max(0.5, +q.speed || 1)) });
      fs.writeFileSync(q.out, wav16(a.audio, a.sampling_rate || 24000));
      process.stdout.write(JSON.stringify({ id: q.id, ok: true, secs: a.audio.length / (a.sampling_rate || 24000), ms: Date.now() - t0 }) + '\n');
    } catch (e) {
      process.stdout.write(JSON.stringify({ id: q.id, ok: false, error: String(e && e.message || e) }) + '\n');
    }
  });
});
rl.on('close', () => process.exit(0));
