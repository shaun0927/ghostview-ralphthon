#!/bin/bash
# retry.sh — 명령을 exponential backoff로 재시도
#
# Usage: ./scripts/retry.sh <max-retries> <command...>
# Example: ./scripts/retry.sh 3 gh pr merge 4 --squash

MAX="${1:?Usage: ./scripts/retry.sh <max-retries> <command...>}"
shift

for i in $(seq 1 "$MAX"); do
  if "$@"; then
    exit 0
  fi
  WAIT=$((i * 2))
  echo "[retry] attempt $i/$MAX failed. waiting ${WAIT}s..."
  sleep "$WAIT"
done

echo "[retry] all $MAX attempts failed: $*"
exit 1
