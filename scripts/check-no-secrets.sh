#!/usr/bin/env bash
# Fails if a tracked file (outside docs/ and .superpowers/) contains a secret or profile value.
set -u
cd "$(dirname "$0")/.."

PATTERN='sk-[A-Za-z0-9]{20,}|the DeepSeek key variable name|[the owner's date of birth]'

hits=$(git ls-files -z -- . ':!docs' ':!.superpowers' ':!scripts/check-no-secrets.sh' \
  | xargs -0 grep -nE -- "$PATTERN" 2>/dev/null || true)

if [ -n "$hits" ]; then
  echo "check-no-secrets: forbidden content found in tracked files:" >&2
  echo "$hits" >&2
  exit 1
fi
echo "check-no-secrets: OK"
