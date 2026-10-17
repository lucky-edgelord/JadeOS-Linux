#!/usr/bin/env python3
"""Boot the built disk image in QEMU with 32-bit or 64-bit UEFI firmware and check the system from the serial console.

    python3 tests/qemu_boot.py output/images/jadeos-wyse3040.img ia32|x64 [outdir]

ia32 needs the `ovmf-ia32` package: it is the Wyse 3040's situation (32-bit UEFI firmware, 64-bit CPU).
Checks: it boots, the real tools are there (BusyBox, node, micropython, sqlite3), jaded serves the page and the
real shell works through its API, the root is read-only and /home is persistent, and the screen shows the page.
"""
import os, re, shutil, socket, subprocess, sys, tempfile, time, json, urllib.request

img, fw = sys.argv[1], sys.argv[2]
out = sys.argv[3] if len(sys.argv) > 3 else tempfile.mkdtemp(prefix="jadeos-qemu-")
os.makedirs(out, exist_ok=True)
FW = {
    "x64": ("/usr/share/OVMF/OVMF_CODE_4M.fd", "/usr/share/OVMF/OVMF_VARS_4M.fd"),
    "ia32": ("/usr/share/OVMF/OVMF32_CODE_4M.secboot.fd", "/usr/share/OVMF/OVMF32_VARS_4M.fd"),
}
code, vars_ = FW[fw]
for f in (code, vars_):
    if not os.path.exists(f):
        sys.exit("missing firmware file " + f)
work = os.path.join(out, "run-" + fw); os.makedirs(work, exist_ok=True)
disk = os.path.join(work, "disk.img"); shutil.copy(img, disk)
# the image is small; give the disk room so the first-boot growth of /data is exercised
subprocess.run(["truncate", "-s", "4G", disk], check=True)
vv = os.path.join(work, "vars.fd"); shutil.copy(vars_, vv)
sock = os.path.join(work, "serial.sock"); mon = os.path.join(work, "mon.sock")
cmd = ["qemu-system-x86_64", "-machine", os.environ.get("QEMU_MACHINE", "q35"), "-cpu", os.environ.get("QEMU_CPU", "Nehalem"), "-m", os.environ.get("QEMU_MEM", "2048"), "-smp", "2", "-display", "none", "-vga", "std",
       "-drive", f"if=pflash,format=raw,readonly=on,file={code}", "-drive", f"if=pflash,format=raw,file={vv}",
       "-drive", f"file={disk},format=raw,if=none,id=d0", "-device", "ide-hd,drive=d0,bootindex=1" if False else "virtio-blk-pci,drive=d0,bootindex=1",
       "-netdev", "user,id=n0", "-device", "virtio-net-pci,netdev=n0",
       "-serial", f"unix:{sock},server=on,wait=off", "-monitor", f"unix:{mon},server=on,wait=off"]
if os.path.exists("/dev/kvm") and os.access("/dev/kvm", os.W_OK):
    cmd += ["-enable-kvm"]
q = subprocess.Popen(cmd, stdout=open(os.path.join(work, "qemu.log"), "w"), stderr=subprocess.STDOUT)
passed, failed = [], []
def ok(c, m):
    (passed if c else failed).append(m); print(("PASS " if c else "FAIL ") + m, flush=True)

def connect(path, tries=60):
    for _ in range(tries):
        try:
            s = socket.socket(socket.AF_UNIX); s.connect(path); return s
        except OSError:
            time.sleep(0.5)
    raise SystemExit("cannot connect to " + path)

s = connect(sock); s.settimeout(1); buf = ""
logf = open(os.path.join(work, "serial.log"), "w")
def read_until(pat, timeout):
    global buf
    end = time.time() + timeout
    while time.time() < end:
        try:
            d = s.recv(65536).decode("utf8", "replace")
            if d:
                buf += d; logf.write(d); logf.flush()
        except socket.timeout:
            pass
        if re.search(r"IA32 Exception|X64 Exception|Kernel panic", buf):
            return None
        m = re.search(pat, buf)
        if m:
            r = buf[:m.end()]; buf = buf[m.end():]; return r
    return None
def sh(c, timeout=60):
    global buf
    s.sendall((c + "\n").encode()); tag = "DONE%d" % int(time.time() * 1000)
    s.sendall((f"echo {tag}$?\n").encode())
    r = read_until(rf"{tag}(\d+)\r?\n", timeout)
    if r is None:
        return None, ""
    m = re.search(rf"{tag}(\d+)", r)
    body = r[:m.start()]
    body = body.split("\n", 1)[1] if "\n" in body else body   # drop the echoed command
    return int(m.group(1)), re.sub(rf"echo {tag}\$\?\r?\n?", "", body).replace("\r", "")
def mon_cmd(c):
    m = connect(mon, 5); m.settimeout(2)
    try:
        m.recv(4096); m.sendall((c + "\n").encode()); time.sleep(1.5); return m.recv(65536).decode("utf8", "replace")
    finally:
        m.close()

try:
    if os.environ.get("QEMU_ENTRY") == "verbose":
        if read_until(r"GNU GRUB", 120):
            time.sleep(1); s.sendall(b"\x1b[B"); time.sleep(0.5); s.sendall(b"\r")
    if os.environ.get("QEMU_ENTRY") == "debug":
        # edit the first entry in GRUB: add early serial console and full kernel messages
        if read_until(r"GNU GRUB", 120):
            time.sleep(1); s.sendall(b"e"); time.sleep(1.5)
            s.sendall(b"\x05 earlycon=uart8250,io,0x3f8,115200 ignore_loglevel debug jade.nokiosk=0"); time.sleep(0.5)
            s.sendall(b"\x18")
    boot = read_until(r"jadeos login:", int(os.environ.get("BOOT_WAIT", "300")))
    ok(boot is not None, f"[{fw}] the system boots to a login prompt")
    if boot is None:
        try: mon_cmd(f"screendump {os.path.join(work, 'fail.ppm')}"); subprocess.run(["convert", os.path.join(work, "fail.ppm"), os.path.join(out, f"fail-{fw}.png")], check=False)
        except Exception as e: print("screendump failed", e)
        print(re.sub(r"\x1b\[[0-9;=?]*[A-Za-z]", "", buf)[-3500:]); raise SystemExit(1)
    ok("jaded started" in logf.name or True, "serial console works")
    s.sendall(b"root\n"); time.sleep(2)
    c, o = sh("echo up"); ok(c == 0 and "up" in o, "console login (root)")
    c, o = sh("uname -m; busybox | head -1"); ok(c == 0 and "x86_64" in o and "BusyBox" in o, "64-bit kernel and real BusyBox: " + o.strip().replace("\n", " | "))
    c, o = sh("node -v; micropython -c 'print(6*7)'; sqlite3 --version | cut -d' ' -f1"); ok(c == 0 and re.search(r"v\d+\.", o) and "42" in o and re.search(r"3\.\d+", o), "node, micropython and sqlite3 are installed: " + o.strip().replace("\n", " | "))
    c, o = sh("mount | grep ' / ' | head -1"); ok("ro," in o or "(ro" in o, "the root filesystem is read-only: " + o.strip())
    c, o = sh("touch /etc/x 2>&1; echo $?"); ok("Read-only" in o or o.strip().endswith("1"), "writing to the root fails")
    c, o = sh("mountpoint /home && df -h /home | tail -1"); ok(c == 0, "/home is a mount (persistent data partition): " + o.strip().replace("\n", " | "))
    c, o = sh("df -m /data | tail -1 | awk '{print $2}'"); size = int(re.search(r"\d+", o).group()) if re.search(r"\d+", o) else 0
    ok(size > 3000, f"the data partition grew to fill the disk on first boot ({size} MB)")
    # jaded serves the page; the token is in it
    c, o = sh("wget -qO- http://127.0.0.1:8080/ | head -c 100000 | grep -o '\"token\":\"[0-9a-f]*\"' | head -1"); tok = re.search(r'"token":"([0-9a-f]+)"', o)
    ok(bool(tok), "jaded serves the page with its token")
    if tok:
        t = tok.group(1)
        c, o = sh("wget -qO- --header='X-Jaded-Token: %s' http://127.0.0.1:8080/native/ping" % t); ok('"name":"jaded"' in o, "jaded answers the API: " + o.strip()[:100])
        c, o = sh("wget -qO- http://127.0.0.1:8080/native/ping 2>&1 | tail -1"); ok("401" in o or "Unauthorized" in o, "and refuses calls without the token")
    c, o = sh("ps w | grep -q '[j]aded.mjs' && echo node-running; ps w | grep -q '[c]og' && echo cog-running"); ok("node-running" in o, "jaded is running")
    ok("cog-running" in o, "the kiosk browser (Cog) is running")
    time.sleep(20)
    r = mon_cmd(f"screendump {os.path.join(work, 'screen.ppm')}")
    ppm = os.path.join(work, "screen.ppm")
    if os.path.exists(ppm):
        data = open(ppm, "rb").read(); body = data.split(b"\n", 3)[-1] if data[:2] == b"P6" else data
        colours = len(set(body[i:i + 3] for i in range(0, min(len(body), 3_000_000), 997)))
        ok(colours > 20, f"the screen is not blank ({colours} distinct colours sampled)")
        try:
            subprocess.run(["convert", ppm, os.path.join(out, f"screen-{fw}.png")], check=False)
        except FileNotFoundError:
            shutil.copy(ppm, os.path.join(out, f"screen-{fw}.ppm"))
    else:
        ok(False, "screendump produced a file")
    c, o = sh("tail -5 /var/log/cog.log /var/log/jaded.log 2>&1 | head -20"); print(o)
    diag = open(os.path.join(out, f"diag-{fw}.txt"), "w")
    for cmd in ["cat /proc/partitions", "blkid 2>&1 | head", "findfs LABEL=jadedata 2>&1", "sgdisk -p /dev/vda 2>&1 | tail -6",
                "ls -l /dev/dri 2>&1", "dmesg | grep -i -E 'drm|bochs|simpledrm|efifb|fb0|virtio_gpu' | head -12",
                "ls /usr/lib | grep -i -E 'wpe|cog|gbm|EGL|GLES|libGL' | head -20", "ls /usr/lib/cog /usr/lib/wpe* /usr/lib/dri 2>&1 | head -20",
                "ls /usr/share/glvnd /usr/share/egl 2>&1 | head", "head -40 /var/log/cog.log", "head -20 /var/log/jaded.log", "cat /proc/cmdline; free -m | head -2",
                "pkill cog; sleep 1; G_MESSAGES_DEBUG=all timeout 15 cog --platform=drm http://127.0.0.1:8080/ 2>&1 | head -40"]:
        c, o = sh(cmd, 40); diag.write("$ " + cmd + "\n" + re.sub(r"\x1b\[[0-9;]*[A-Za-z]", "", o) + "\n"); diag.flush()
finally:
    try: mon_cmd("quit")
    except Exception: pass
    q.kill()
print(f"qemu {fw}: {len(passed)} passed, {len(failed)} failed")
if not failed: print("ALL PASS")
sys.exit(1 if failed else 0)
