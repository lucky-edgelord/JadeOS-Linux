# JadeOS-Linux

[Jade Vault](https://github.com/lucky-edgelord/jade-vault) as an appliance: a small Buildroot Linux for the **Dell Wyse 3040**
(Atom x5-Z8350, 2 GB RAM, 8/16 GB eMMC) that boots straight into Jade full screen, with the real machine behind it.

- **Real filesystem.** The vault is a folder on the disk (`/home/jade`), not a copy in the browser. Anything else on the
  machine can read and write the same files, and changes show up in the app live.
- **Real shell and tools.** The Shell tab and the agent's shell tool run the real BusyBox `sh`: pipes, redirects, globbing,
  `cd` outside the vault, everything installed. **Real Node.js**, **real MicroPython**, **real SQLite** (`sqlite3`). No WebAssembly.
- **Jade's own commands** (`jade`, `flow`, `crontab`, `search`, `tags`, …) work from that shell too.
- **Screen:** WPE WebKit (Cog) straight on KMS/DRM, WebGL from Mesa, so the Live2D avatar runs on the GPU.
- Read-only root, a data partition that grows to fill the disk on first boot, Wi-Fi with `jade-wifi SSID PASSWORD`.

## Get it on a Wyse 3040
1. Take `jadeos-wyse3040.img.gz` from the latest [release](../../releases) (or the `jadeos-wyse3040` artifact of a CI run).
2. Write it to a USB stick: `gunzip -c jadeos-wyse3040.img.gz | sudo dd of=/dev/sdX bs=4M status=progress conv=fsync`
   (on Windows use balenaEtcher or Rufus in DD mode).
3. Boot the 3040 from the stick (F12 boot menu; if the BIOS asks for a password, the Dell Wyse default is `Fireport`).
   Then either keep running from the stick, or boot a Linux live system and `dd` the image onto the internal eMMC.
   The firmware is **32-bit UEFI on a 64-bit CPU**; the image carries GRUB for both (`bootia32.efi`, `bootx64.efi`).

First boot grows the data partition to fill the stick/eMMC (about a minute). Debug shell: serial console 115200 or the
second boot menu entry (no kiosk, console on screen). Root has no password on the console.

## How it fits together
```
Cog (WebKit, KMS)  ──http://127.0.0.1:8080──▶  jaded (Node.js, native/jaded.mjs)
                                                 ├─ /fs/*   real files under /home/jade
                                                 ├─ /exec   real /bin/sh (BusyBox), output streamed
                                                 └─ /rpc/*  jade, flow, crontab… relayed to the page
```
`tools/make_native_page.py` turns Jade Vault's normal offline page into the native one by swapping two things: the
`VFS` class (same API, backed by the daemon with synchronous XHR) and `Shell.run` (one request to `/exec`). Nothing else
in Jade Vault changes. jaded binds to 127.0.0.1, refuses foreign `Host` headers, and every call needs a per-boot token that
only the page it serves carries, so another web page cannot drive the shell.

## Build it yourself
CI does it (`.github/workflows/ci.yml`): a Buildroot build (hours on a GitHub runner; ccache and the download cache are
saved so a re-run continues), then the image is booted in QEMU with 32-bit and 64-bit UEFI firmware and checked over the
serial console (kernel, BusyBox, node, micropython, sqlite3, read-only root, data growth, jaded, Cog, a non-blank screen).

    git clone --depth 1 -b 2025.02.6 https://github.com/buildroot/buildroot ../buildroot
    tools/fetch_page.sh                                   # build/native-page.html from Jade Vault
    make -C ../buildroot BR2_EXTERNAL=$PWD O=$PWD/output wyse3040_defconfig
    make -C ../buildroot BR2_EXTERNAL=$PWD O=$PWD/output   # output/images/jadeos-wyse3040.img(.gz)

Fast tests (no Buildroot): `npm install && tools/fetch_page.sh && node tests/jaded_test.mjs && node tests/native_test.mjs`.

## Status
The daemon and the page are tested (headless Chromium against the real shell and filesystem). The image's boot is tested
in QEMU in CI. **Not yet tested on a real Wyse 3040**: the eMMC controller and graphics drivers are configured from
the hardware's documented chipset, and Wi-Fi depends on which card your unit has.
