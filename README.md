# JadeOS-Linux

[Jade Vault](https://github.com/lucky-edgelord/jade-vault) as an appliance: a small Buildroot Linux that boots straight
into Jade full screen, with the real machine behind it. Built for thin clients and mini PCs: the **Dell Wyse 3040** and
any ordinary 64-bit UEFI x86 box such as the **Dell OptiPlex 3020 Micro**.

**Site:** <https://lucky-edgelord.github.io/JadeOS-Linux/> &nbsp;·&nbsp; **Download:** [latest release](../../releases/latest)

## What you get

- **Real filesystem.** The vault is a folder on the disk (`/home/jade`), not a copy in the browser. Anything else on the
  machine can read and write the same files, and changes show up in the app live.
- **Real shell and tools.** The Shell tab and the agent's shell tool run the real BusyBox `sh`: pipes, redirects, globbing,
  `cd` outside the vault, everything installed. **Real Node.js**, **real MicroPython**, **real SQLite** (`sqlite3`),
  `curl`, `nano`, `iw`, `wpa_supplicant`. No WebAssembly, no browser file system.
- **Jade's own commands** (`jade`, `flow`, `crontab`, `search`, `tags`, …) work from that shell too.
- **Screen.** WPE WebKit (Cog) straight on KMS/DRM, WebGL from Mesa (Intel GPU drivers, software fallback in VMs), so the
  Live2D avatar runs on the GPU.
- **Appliance basics.** Read-only root, a data partition that grows to fill the disk on first boot, wired networking on
  any port, USB Wi-Fi with `jade-wifi SSID PASSWORD`.

## Install

1. Take `jadeos-wyse3040.img.gz` (and `.sha256`) from the latest [release](../../releases/latest).
2. Write it to a USB stick or disk:

       gunzip -c jadeos-wyse3040.img.gz | sudo dd of=/dev/sdX bs=4M status=progress conv=fsync

   On Windows use balenaEtcher or Rufus in DD mode. Check the right device first; `dd` overwrites it.
3. Boot from it (usually F12). **Turn Secure Boot off**: the image is not signed.
   - **OptiPlex 3020 Micro and other 64-bit UEFI PCs:** pick the USB/disk entry in the boot menu.
   - **Dell Wyse 3040:** the firmware is 32-bit UEFI on a 64-bit CPU, and the image carries GRUB for both
     (`bootia32.efi`, `bootx64.efi`). If the BIOS asks for a password, the Dell Wyse default is `Fireport`.
4. First boot grows the data partition to fill the stick or disk (about a minute). To install permanently, boot a live
   Linux and `dd` the image onto the internal drive, or just keep running from the stick.

Everything you save lives on the data partition (`/data`, mounted as `/home`). The root filesystem is read-only.

### Networking

- **Ethernet:** nothing to do. Every wired interface (`eth0`, `enp0s25`, `eno1`, …) asks for an address with DHCP at boot.
- **Wi-Fi:** use a USB adapter. Realtek (`rtl8xxxu`, `rtw88`, `rtl8187`, `rtl8192cu`), MediaTek (`mt7601u`, `mt76x0u`,
  `mt76x2u`), Atheros (`ath9k_htc`) and Ralink (`rt2800usb`) drivers and firmware are included, as are Intel `iwlwifi`
  cards. Broadcom is not. In the Shell tab: `jade-wifi "My network" "password"` (saved on the data partition, used on
  every boot). Run it again after plugging an adapter in later.

### Troubleshooting

- Debug shell: serial console at 115200 baud, or the second boot menu entry (no kiosk, console on screen).
  Root has no password on the console.
- Logs: `/var/log/jaded.log` (the daemon) and `/var/log/cog.log` (the browser).
- No picture: try the second boot entry; it shows kernel messages on screen.

## How it fits together

```
Cog (WebKit, KMS)  ──http://127.0.0.1:8080──▶  jaded (Node.js, native/jaded.mjs)
                                                 ├─ /fs/*   real files under /home/jade
                                                 ├─ /exec   real /bin/sh (BusyBox), output streamed
                                                 └─ /rpc/*  jade, flow, crontab… relayed to the page
```

`tools/make_native_page.py` turns Jade Vault's normal offline page into the native one by swapping two things: the
`VFS` class (same API, backed by the daemon with synchronous XHR) and `Shell.run` (one request to `/exec`). Nothing else
in Jade Vault changes. jaded binds to 127.0.0.1, refuses foreign `Host` headers, and every call needs a per-boot token
that only the page it serves carries, so another web page cannot drive the shell.

The image: Buildroot 2025.02, Linux 6.12, GRUB (32- and 64-bit EFI), eudev, BusyBox init, WPE WebKit 2.48 + Cog, Mesa,
Node.js, MicroPython, SQLite. GPT disk: EFI system partition, read-only ext4 root, ext4 data partition.

| Path | What |
|---|---|
| `native/` | `jaded.mjs` daemon, `jade-cli.mjs` shim, `native_vfs.js` / `native_shell.js` injected into the page |
| `tools/` | `fetch_page.sh`, `make_native_page.py` |
| `board/wyse3040/` | kernel fragment, GRUB, genimage, init scripts and overlay |
| `configs/wyse3040_defconfig` | the Buildroot configuration (the name is historical: it runs on any x86-64 UEFI PC) |
| `package/jadeos/` | installs the daemon and page into `/opt/jade` |
| `tests/` | daemon and browser tests, QEMU boot test |
| `docs/` | the project site (GitHub Pages) |

## Build it yourself

CI does it (`.github/workflows/ci.yml`): a Buildroot build (about 4–5 hours on a GitHub runner; ccache and the download
cache are saved so a re-run is faster), then the image is booted in QEMU and checked over the serial console. A pull
request whose title contains `[release]` publishes the image as a GitHub release.

    git clone --depth 1 -b 2025.02.6 https://github.com/buildroot/buildroot ../buildroot
    tools/fetch_page.sh                                   # build/native-page.html from Jade Vault
    make -C ../buildroot BR2_EXTERNAL=$PWD O=$PWD/output wyse3040_defconfig
    make -C ../buildroot BR2_EXTERNAL=$PWD O=$PWD/output   # output/images/jadeos-wyse3040.img(.gz)

Fast tests (no Buildroot): `npm install && tools/fetch_page.sh && node tests/jaded_test.mjs && node tests/native_test.mjs`.

## Status

| Tested | How |
|---|---|
| Daemon, file API, real shell, page integration | 40 + 32 checks, headless Chromium, every CI run |
| Boot on 64-bit UEFI | QEMU in CI, 17 checks: login, BusyBox, Node, MicroPython, SQLite, read-only root, data partition growth, DHCP and gateway, jaded and its token, Cog running, the page on screen (read back with OCR) |

**Not tested:**

- **Real hardware.** Nothing has run on a physical Wyse 3040 or OptiPlex yet. Drivers are configured from the documented
  chipsets.
- **32-bit UEFI boot** (the Wyse 3040). Debian's 32-bit OVMF crashes inside QEMU before it reaches the image, so this path
  is untested. The files and kernel support (`CONFIG_EFI_MIXED`) are there.
- **Wi-Fi.** QEMU has no Wi-Fi hardware, so the drivers and `jade-wifi` are untested.
- The page still loads highlight.js, the terminal and fonts from CDNs; offline it falls back to plain text and system fonts.

Please report what happens on real hardware in an issue.
