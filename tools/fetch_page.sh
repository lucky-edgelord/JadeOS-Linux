#!/bin/sh
# Download Jade Vault's offline page (a pinned commit of lucky-edgelord/jade-vault) and make the native-host page.
#   tools/fetch_page.sh [ref]        -> build/native-page.html
set -e
cd "$(dirname "$0")/.."
REF=${1:-${JADE_VAULT_REF:-4db1d6267e116da0bf7dd0fdc65e550da7bbfeff}}
mkdir -p build
curl -fsSL "https://raw.githubusercontent.com/lucky-edgelord/jade-vault/$REF/docs/index.html" -o build/jade-vault-base.html
python3 tools/make_native_page.py build/jade-vault-base.html build/native-page.html
