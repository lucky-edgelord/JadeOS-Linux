#!/usr/bin/env python3
"""Turn Jade Vault's offline page (jade-vault's docs/index.html) into the native-host page: the vault becomes the
machine's real filesystem and the shell its real sh (see native/native_vfs.js and native/native_shell.js).

    python3 tools/make_native_page.py <jade-vault index.html> <out.html>

Both edits are exact-match replacements that must hit exactly once, so a changed upstream page fails loudly.
"""
import os, sys

D = os.path.dirname(os.path.abspath(__file__))
N = os.path.join(os.path.dirname(D), "native")
BOOT = "/* =====================================================================\n   BOOT"


def rd(n):
    return open(os.path.join(N, n), encoding="utf-8").read()


def once(s, old, new):
    n = s.count(old)
    if n != 1:
        sys.exit("make_native_page: expected exactly one %r in the page, found %d" % (old[:60], n))
    return s.replace(old, new)


def make(src):
    s = open(src, encoding="utf-8").read()
    s = once(s, "const vfs = new VFS();", rd("native_vfs.js") + "\nconst vfs = JADED ? new NativeVFS() : new VFS();")
    s = once(s, BOOT, rd("native_shell.js") + "\n" + BOOT)
    return s


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    out = make(sys.argv[1])
    open(sys.argv[2], "w", encoding="utf-8").write(out)
    print("wrote %s (%.1f MB)" % (sys.argv[2], len(out) / 1e6))
