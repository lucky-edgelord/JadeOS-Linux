#!/bin/sh
# Kokoro-82M text to speech for the image: kokoro-js (with onnxruntime-node) plus the model and a set of voices, all as plain
# files so the machine needs no internet at run time.    tools/fetch_kokoro.sh   ->  build/kokoro   (installed as /opt/kokoro)
set -e
cd "$(dirname "$0")/.."
REPO=onnx-community/Kokoro-82M-v1.0-ONNX
KOKORO_JS=${KOKORO_JS_VERSION:-1.2.1}
VOICES=${KOKORO_VOICES:-"af_heart af_bella af_nicole af_sarah af_sky am_adam am_michael bf_emma bm_george"}
OUT=build/kokoro
rm -rf "$OUT"; mkdir -p "$OUT/models/$REPO/onnx" "$OUT/models/$REPO/voices"

cat > "$OUT/package.json" <<JSON
{ "name": "jade-kokoro", "private": true, "type": "module", "dependencies": { "kokoro-js": "$KOKORO_JS" } }
JSON
( cd "$OUT" && ONNXRUNTIME_NODE_INSTALL_CUDA=skip npm install --omit=dev --no-audit --no-fund --no-package-lock )

# what the model repository really contains (the file names below must exist)
curl -fsSL "https://huggingface.co/api/models/$REPO" -o "$OUT/repo.json"
python3 - "$OUT/repo.json" <<'PY'
import json, sys
names = [s["rfilename"] for s in json.load(open(sys.argv[1]))["siblings"]]
print(len(names), "files in the model repository; onnx:", [n for n in names if n.startswith("onnx/")])
for need in ("config.json", "tokenizer.json", "tokenizer_config.json", "onnx/model_quantized.onnx", "voices/af_heart.bin"):
    if need not in names:
        sys.exit("the model repository has no " + need)
PY
get() { curl -fL --retry 4 --retry-delay 5 -sS "https://huggingface.co/$REPO/resolve/main/$1" -o "$OUT/models/$REPO/$1"; }
for f in config.json tokenizer.json tokenizer_config.json onnx/model_quantized.onnx; do get "$f"; done
for v in $VOICES; do get "voices/$v.bin" || echo "warning: no voice $v"; done
rm -f "$OUT/repo.json"

# slim: only what Linux x86-64 needs
N="$OUT/node_modules"
rm -rf "$N/onnxruntime-web" "$N/onnxruntime-node/bin/napi-v3/darwin" "$N/onnxruntime-node/bin/napi-v3/win32" "$N/onnxruntime-node/bin/napi-v3/linux/arm64"
find "$N" \( -name '*.map' -o -name '*.md' -o -name '*.d.ts' \) -type f -delete 2>/dev/null || true

cp native/kokoro_worker.mjs "$OUT/kokoro_worker.mjs"
touch "$OUT/ready"
du -sh "$OUT" "$OUT"/models "$OUT"/node_modules
