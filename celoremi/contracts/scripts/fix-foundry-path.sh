#!/usr/bin/env bash
set -euo pipefail
FOUNDRY_BIN="/c/Users/njoya/.foundry/bin"

if [[ ! -x "$FOUNDRY_BIN/forge" && ! -x "$FOUNDRY_BIN/forge.exe" ]]; then
  echo "forge not found in $FOUNDRY_BIN — run foundryup first"
  exit 1
fi

LINE='export PATH="$PATH:/c/Users/njoya/.foundry/bin"'

for f in "$HOME/.bashrc" "$HOME/.bash_profile"; do
  touch "$f"
  if grep -Fq '.foundry/bin' "$f"; then
    echo "already configured: $f"
  else
    printf '\n# Foundry\n%s\n' "$LINE" >> "$f"
    echo "added Foundry PATH to $f"
  fi
done

export PATH="$PATH:$FOUNDRY_BIN"
echo "forge version:"
forge --version
