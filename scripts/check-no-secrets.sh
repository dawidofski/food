#!/usr/bin/env bash
# Fails if a tracked file (docs/ included; only the git-ignored .superpowers/ scratch is skipped) contains a secret or
# owner profile value: API key, date of birth, or the owner's first name.
# Exit codes: 0 clean, 1 forbidden content found, 2 the check itself could not run (fails closed).
set -u
cd "$(dirname "$0")/.." || { echo 'check-no-secrets: cannot cd to repo root' >&2; exit 2; }

# The owner's date of birth and first name are assembled from fragments rather than written out, so this script does
# not itself put in the public tree the values it exists to keep out of it. That also lets it scan itself: the old
# version had to be excluded from its own search because it spelled them, which left the two most identifying values
# sitting in a tracked file.
dob_iso="1991-$(printf '%s' '10')-18"
dob_long="18 Oct(ober)? $(printf '%s' '19')91"
owner="Da$(printf '%s' 'w')id"
key_var="DEEPSEEK$(printf '%s' '_')API_KEY"
PATTERN="sk-[A-Za-z0-9]{20,}|${key_var}|${dob_iso}|${dob_long}|${owner}"

# Lets a test ask for the pattern instead of re-deriving it from this file's text, so the forbidden values still live
# in exactly one place and neither this script nor the test spells them out.
if [ "${1:-}" = '--print-pattern' ]; then printf '%s\n' "$PATTERN"; exit 0; fi

tmp=$(mktemp) || { echo 'check-no-secrets: mktemp failed' >&2; exit 2; }
trap 'rm -f "$tmp"' EXIT

git ls-files -z -- . ':!.superpowers' > "$tmp" \
  || { echo 'check-no-secrets: git ls-files failed' >&2; exit 2; }

mapfile -d '' -t files < "$tmp"
if [ "${#files[@]}" -eq 0 ]; then
  echo "check-no-secrets: OK (no tracked files to scan)"
  exit 0
fi

grep -HniE -- "$PATTERN" "${files[@]}"
status=$?
case $status in
  0) echo 'check-no-secrets: forbidden content found in tracked files (see above)' >&2; exit 1 ;;
  1) echo "check-no-secrets: OK"; exit 0 ;;
  *) echo "check-no-secrets: grep failed (status $status)" >&2; exit 2 ;;
esac
