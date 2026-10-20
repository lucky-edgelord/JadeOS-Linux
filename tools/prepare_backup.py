#!/usr/bin/env python3
"""Lay a Jade Vault backup out for JadeOS: vault files as real files, the rest as a one-time restore for the page.
   prepare_backup.py BACKUP.json OUTDIR  ->  OUTDIR/home/jade/<vault files>, OUTDIR/etc/jade-restore.json, OUTDIR/etc/<backup copy>
   (OUTDIR is the root of the data partition: /data)"""
import base64, json, os, shutil, sys
src, out = sys.argv[1], sys.argv[2]
d = json.load(open(src, encoding='utf-8'))
assert d.get('app') == 'jade-vault' and 'vault' in d, 'not a Jade Vault backup'
home = os.path.join(out, 'home', 'jade'); etc = os.path.join(out, 'etc')
os.makedirs(home, exist_ok=True); os.makedirs(etc, exist_ok=True)
def real(p): return os.path.join(home, *[s for s in p.split('/') if s and s not in ('.', '..')])
for p in d['vault'].get('dirs', []): os.makedirs(real(p), exist_ok=True)
n = 0
for p, v in d['vault']['files'].items():
    f = real(p); os.makedirs(os.path.dirname(f), exist_ok=True)
    if isinstance(v, str): data = v.encode('utf-8')
    elif isinstance(v, dict) and 'base64' in v: data = base64.b64decode(v['base64'])
    else: data = json.dumps(v).encode('utf-8')
    open(f, 'wb').write(data); n += 1
rest = {k: d.get(k) for k in ('app', 'format', 'kind', 'exportedAt', 'includesKeys', 'settings', 'storage', 'db')}
json.dump(rest, open(os.path.join(etc, 'jade-restore.json'), 'w', encoding='utf-8'), ensure_ascii=False)
shutil.copy(src, os.path.join(etc, os.path.basename(src)))
print(f"{n} files, {len(d['vault'].get('dirs', []))} folders, {len((d.get('db') or {}).get('sessions', []))} chats, "
      f"{len((d.get('db') or {}).get('schedules', []))} schedules, {len(d.get('settings') or {})} settings")
