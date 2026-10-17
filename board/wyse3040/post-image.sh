#!/bin/sh
# Make the bootable disk image: GPT, EFI System Partition (GRUB for 32- and 64-bit UEFI + the kernel), read-only
# root, and a data partition for /home/jade and settings. The root's UUID is put into GRUB's config.
set -e
BOARD=$(dirname "$0")
UUID=$(dumpe2fs "$BINARIES_DIR/rootfs.ext2" 2>/dev/null | sed -n 's/^Filesystem UUID: *\(.*\)/\1/p')
[ -n "$UUID" ] || { echo "post-image: cannot read the root filesystem UUID"; exit 1; }
cp "$BOARD/grub.cfg" "$BINARIES_DIR/efi-part/EFI/BOOT/grub.cfg"
sed -i "s/UUID_TMP/$UUID/g" "$BINARIES_DIR/efi-part/EFI/BOOT/grub.cfg"
sed "s/UUID_TMP/$UUID/g" "$BOARD/genimage.cfg" > "$BINARIES_DIR/genimage.cfg"
support/scripts/genimage.sh -c "$BINARIES_DIR/genimage.cfg"
( cd "$BINARIES_DIR" && gzip -9 -k -f jadeos-wyse3040.img && sha256sum jadeos-wyse3040.img.gz > jadeos-wyse3040.img.gz.sha256 )
