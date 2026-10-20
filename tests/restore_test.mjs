// A backup laid out by tools/prepare_backup.py: vault files on disk, the rest restored by the page on first open.
import pw from 'playwright'; import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
const { start } = await import(process.env.JADED_MJS || '../native/jaded.mjs');
const DATA = process.argv[2], BK = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const log = [], fail = []; const ok = (c, m) => (c ? log : fail).push((c ? 'PASS ' : 'FAIL ') + m);
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-')); fs.cpSync(DATA, work, { recursive: true });
const RESTORE = work + '/etc/jade-restore.json';
const d = await start({ port: 0, root: work + '/home/jade', page: process.env.NATIVE_PAGE || 'build/native-page.html', token: 'rt', restore: RESTORE });
const browser = await pw.chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } }); const page = await ctx.newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.route('**/*', r => { const u = r.request().url(); return (u.startsWith(d.url.slice(0, -1)) || u.startsWith('data:') || u.startsWith('blob:')) ? r.continue() : r.abort(); });
let loads = 0; page.on('framenavigated', f => { if (f === page.mainFrame()) loads++; });
await page.goto(d.url);
for (let i = 0; i < 60 && fs.existsSync(RESTORE); i++) await page.waitForTimeout(500);
ok(!fs.existsSync(RESTORE) && fs.existsSync(RESTORE + '.applied'), 'the restore ran once and was marked applied');
await page.waitForTimeout(3000);
await page.waitForFunction(() => typeof vfs !== 'undefined' && vfs.native && document.querySelector('#tree')?.children.length > 0, null, { timeout: 60000 });
ok(loads >= 2, 'the page reloaded after restoring (' + loads + ' loads)');
const st = await page.evaluate(async () => ({
  groq: S.groqKey, provider: S.provider, n: Object.keys(S).length, hist: (ls.get('hist') || []).length,
  sessions: ((await idb.get('sessions')) || []).length, schedules: ((await idb.get('schedules')) || []).length, flowRuns: ((await idb.get('flowRuns')) || []).length,
  files: [...vfs.nodes.keys()].filter(p => !vfs.nodes.get(p).dir).length,
}));
const bset = BK.settings;
ok(st.groq === bset.groqKey && st.provider === bset.provider, 'settings restored, API keys included');
ok(st.hist === (BK.storage.hist || []).length, `app storage restored (${st.hist} history entries)`);
ok(st.sessions === BK.db.sessions.length && st.schedules === BK.db.schedules.length && st.flowRuns === BK.db.flowRuns.length, `chats ${st.sessions}, schedules ${st.schedules}, flow runs ${st.flowRuns}`);
const want = Object.keys(BK.vault.files).length;
ok(st.files >= want, `the vault shows ${st.files} files (backup has ${want})`);
const sid = BK.db.sessions[0].id; const one = await page.evaluate(async id => (await idb.get('session:' + id))?.messages?.length, sid);
ok(one === BK.db['session:' + sid].messages.length, `chat ${sid} has all ${one} messages`);
// a second open does not restore again
const before = fs.statSync(RESTORE + '.applied').mtimeMs; await page.reload(); await page.waitForTimeout(3000);
ok(!fs.existsSync(RESTORE) && fs.statSync(RESTORE + '.applied').mtimeMs === before, 'later opens do not restore again');
ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
await browser.close(); d.close();
console.log([...log, ...fail].join('\n')); console.log(`${log.length} passed, ${fail.length} failed`); process.exit(fail.length ? 1 : 0);
