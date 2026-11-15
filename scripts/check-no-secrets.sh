#!/usr/bin/env bash
# Fails if a tracked file (outside docs/ and .superpowers/) contains a secret or profile value.
# Exit codes: 0 clean, 1 forbidden content found, 2 the check itself could not run (fails closed).
set -u
cd "$(dirname "$0")/.." || { echo 'check-no-secrets: cannot cd to repo root' >&2; exit 2; }

PATTERN='sk-[A-Za-z0-9]{20,}|the DeepSeek key variable name|[the owner's date of birth]'

tmp=$(mktemp) || { echo 'check-no-secrets: mktemp failed' >&2; exit 2; }
trap 'rm -f "$tmp"' EXIT

git ls-files -z -- . ':!docs' ':!.superpowers' ':!scripts/check-no-secrets.sh' > "$tmp" \
  || { echo 'check-no-secrets: git ls-files failed' >&2; exit 2; }

mapfile -d '' -t files < "$tmp"
if [ "${#files[@]}" -eq 0 ]; then
  echo "check-no-secrets: OK (no tracked files to scan)"
  exit 0
fi

grep -HnE -- "$PATTERN" "${files[@]}"
status=$?
case $status in
  0) echo 'check-no-secrets: forbidden content found in tracked files (see above)' >&2; exit 1 ;;
  1) echo "check-no-secrets: OK"; exit 0 ;;
  *) echo "check-no-secrets: grep failed (status $status)" >&2; exit 2 ;;
esac
