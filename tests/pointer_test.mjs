// The kiosk mouse: jaded reads a (fake) /dev/input mouse, the page draws a pointer and clicks, focuses and scrolls.
import pw from 'playwright'; import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'; import { execSync } from 'node:child_process';
const { start } = await import(process.env.JADED_MJS || '../native/jaded.mjs');
const log = [], fail = []; const ok = (c, m) => (c ? log : fail).push((c ? 'PASS ' : 'FAIL ') + m);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ptr-')); const fifo = path.join(tmp, 'event7'); execSync(`mkfifo ${fifo}`);
fs.writeFileSync(path.join(tmp, 'devices'), 'I: Bus=0011 Vendor=0001 Product=0001\nN: Name="AT Keyboard"\nH: Handlers=sysrq kbd event3 leds\n\nI: Bus=0003 Vendor=046d Product=c077\nN: Name="Logitech USB Optical Mouse"\nH: Handlers=event7\nB: EV=17\nB: KEY=1f0000 0 0 0 0\nB: REL=903\n\n');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ptr-ws-'));
const d = await start({ port: 0, root, page: process.env.NATIVE_PAGE || 'build/native-page.html', token: 'pt', pointer: true, inputDevices: path.join(tmp, 'devices'), inputDir: tmp });
const w = fs.openSync(fifo, 'w');   // opens once jaded is reading
const ev = (type, code, value) => { const b = Buffer.alloc(24); b.writeUInt16LE(type, 16); b.writeUInt16LE(code, 18); b.writeInt32LE(value, 20); return b; };
const send = (...evs) => fs.writeSync(w, Buffer.concat([...evs, ev(0, 0, 0)]));
const browser = await pw.chromium.launch(); const page = await (await browser.newContext({ viewport: { width: 1200, height: 800 } })).newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.route('**/*', r => { const u = r.request().url(); return (u.startsWith(d.url.slice(0, -1)) || u.startsWith('data:') || u.startsWith('blob:')) ? r.continue() : r.abort(); });
await page.goto(d.url);
await page.waitForFunction(() => typeof vfs !== 'undefined' && vfs.native && window.__jadePointer, null, { timeout: 30000 }); await page.waitForTimeout(800);
const pos = () => page.evaluate(() => window.__jadePointer.pos());
async function moveTo(sel) {
  const [tx, ty] = await page.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, sel);
  for (let i = 0; i < 6; i++) { const [x, y] = await pos(); const dx = Math.round((tx - x) / 1.5), dy = Math.round((ty - y) / 1.5); if (Math.abs(dx) < 1 && Math.abs(dy) < 1) break; send(ev(2, 0, dx), ev(2, 1, dy)); await page.waitForTimeout(250); }
}
const click = async () => { send(ev(1, 0x110, 1)); await page.waitForTimeout(80); send(ev(1, 0x110, 0)); await page.waitForTimeout(400); };
send(ev(2, 0, 40), ev(2, 1, -20)); await page.waitForTimeout(400);
ok(await page.evaluate(() => { const c = document.getElementById('__jadePointer'); return c && c.style.display === 'block'; }), 'a pointer appears when the mouse moves');
const p1 = await pos(); ok(p1[0] === 600 + 60 && p1[1] === 400 - 30, 'it moves with the mouse (' + p1 + ')');
await moveTo('.tab[data-tab="files"]'); await click();
ok(await page.evaluate(() => document.querySelector('.tab[data-tab="files"]').getAttribute('aria-selected') === 'true'), 'clicking the Notes tab opens it');
await moveTo('.tab[data-tab="chat"]'); await click();
ok(await page.evaluate(() => document.querySelector('.tab[data-tab="chat"]').getAttribute('aria-selected') === 'true'), 'clicking the Chat tab goes back');
await moveTo('#input'); await click();
ok(await page.evaluate(() => document.activeElement && document.activeElement.id === 'input'), 'clicking the message box focuses it, ready to type');
await page.keyboard.type('hi from the keyboard'); ok(await page.evaluate(() => document.getElementById('input').value) === 'hi from the keyboard', 'and the keyboard types into it');
// wheel: scroll whatever is scrollable under the pointer (the chat log after some text)
const scrolled = await page.evaluate(() => { const el = document.querySelector('#input'); let s = document.elementFromPoint(...window.__jadePointer.pos()); return !!s; });
send(ev(2, 1, -5000)); await page.waitForTimeout(300);
ok((await pos())[1] === 0, 'the pointer stops at the screen edge');
await page.evaluate(() => { const b = document.createElement('div'); b.id = 'sc'; b.style.cssText = 'position:fixed;left:0;top:0;width:300px;height:200px;overflow:auto;z-index:99999;background:#222'; b.innerHTML = '<div style="height:2000px">x</div>'; document.body.appendChild(b); });
await moveTo('#sc'); send(ev(2, 8, -3)); await page.waitForTimeout(300);
ok(await page.evaluate(() => document.getElementById('sc').scrollTop) > 100, 'the wheel scrolls what is under the pointer');
send(ev(1, 0x111, 1)); send(ev(1, 0x111, 0)); await page.waitForTimeout(200);
ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
fs.closeSync(w); await browser.close(); d.close();
console.log([...log, ...fail].join('\n')); console.log(`${log.length} passed, ${fail.length} failed`); process.exit(fail.length ? 1 : 0);
