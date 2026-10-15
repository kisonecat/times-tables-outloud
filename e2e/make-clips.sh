#!/usr/bin/env bash
# Generates a spoken clip for every product in the 1–12 tables, for the Whisper
# end-to-end test. Uses Piper (a neural TTS; espeak's robotic voice is too hard even for
# Whisper alone). On NixOS: nix shell nixpkgs#piper-tts -c ./e2e/make-clips.sh
set -euo pipefail
out="${1:-.cache/clips}"
voice=.cache/piper/en_US-lessac-medium.onnx
mkdir -p "$out" .cache/piper
for f in en_US-lessac-medium.onnx en_US-lessac-medium.onnx.json; do
  [ -f ".cache/piper/$f" ] ||
    curl -sfL -o ".cache/piper/$f" "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/$f"
done
for a in $(seq 1 12); do
  for b in $(seq "$a" 12); do
    n=$((a * b))
    [ -f "$out/$n.wav" ] || echo "$n" | piper --model "$voice" --output_file "$out/$n.wav" 2>/dev/null
  done
done
echo "clips in $out"
