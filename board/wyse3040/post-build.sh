#!/bin/sh
# runs on the target tree before the root image is made
set -e
T="$TARGET_DIR"
mkdir -p "$T/data" "$T/home" "$T/opt/jade"
# the root is read-only at run time: anything that must change lives on /data or in tmpfs
rm -f "$T/etc/resolv.conf"; ln -s /tmp/resolv.conf "$T/etc/resolv.conf"
cat > "$T/etc/os-release" <<EOF
NAME="JadeOS-Linux"
ID=jadeos
PRETTY_NAME="JadeOS-Linux (Buildroot)"
HOME_URL="https://github.com/lucky-edgelord/jadeos-linux"
EOF
