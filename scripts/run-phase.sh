#!/bin/bash
# run-phase.sh — Phase 내 모든 ready 이슈를 순회하는 오케스트레이터
#
# Usage: ./scripts/run-phase.sh <phase-number> [time-budget-minutes]
# Example: ./scripts/run-phase.sh 0 30
#
# 동작:
#   1. 해당 phase의 status:ready 이슈를 찾는다
#   2. 각 이슈에 대해 run-issue.sh를 실행한다
#   3. 실패 시 skip하고 다음 이슈로 진행한다
#   4. 시간 초과 시 중단하고 다음 phase로 진행한다
#   5. 모든 이슈 완료 시 phase-gate.json 업데이트

set -uo pipefail

PHASE="${1:?Usage: ./scripts/run-phase.sh <phase-number> [time-budget-minutes]}"
BUDGET_MIN="${2:-60}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STATE_DIR="$(dirname "$SCRIPT_DIR")/state"

PHASE_LABELS=("phase:0-infra" "phase:1-scan" "phase:2-deepdive" "phase:3-website" "phase:4-deploy")
LABEL="${PHASE_LABELS[$PHASE]}"

START_TIME=$(date +%s)
DEADLINE=$((START_TIME + BUDGET_MIN * 60))

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Phase ${PHASE} 시작 (예산: ${BUDGET_MIN}분)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

COMPLETED=0
FAILED=0
SKIPPED=0

while true; do
  # 시간 확인
  NOW=$(date +%s)
  REMAINING=$(( (DEADLINE - NOW) / 60 ))
  if [ "$NOW" -ge "$DEADLINE" ]; then
    echo ""
    echo "[TIME] 시간 초과 (${BUDGET_MIN}분). Phase ${PHASE} 중단."
    break
  fi

  # 다음 ready 이슈 찾기
  NEXT=$(gh issue list --label "$LABEL" --label "status:ready" --json number -q '.[0].number' 2>/dev/null || true)

  if [ -z "$NEXT" ]; then
    echo ""
    echo "[DONE] Phase ${PHASE}에 더 이상 ready 이슈 없음."
    break
  fi

  echo ""
  echo "[PICK] Issue #${NEXT} (남은 시간: ${REMAINING}분)"

  # run-issue.sh 실행
  if "$SCRIPT_DIR/run-issue.sh" "$NEXT"; then
    COMPLETED=$((COMPLETED + 1))
    echo "[OK] Issue #${NEXT} 완료 (${COMPLETED}개 완료)"
  else
    FAILED=$((FAILED + 1))
    echo "[FAIL] Issue #${NEXT} 실패. skip하고 다음으로."
    # 실패한 이슈에 코멘트
    gh issue comment "$NEXT" --body "run-phase.sh: 자동 실행 실패. 수동 확인 필요." 2>/dev/null || true
    gh issue edit "$NEXT" --remove-label "status:in-progress" --add-label "status:blocked" 2>/dev/null || true
  fi
done

# Phase gate 업데이트
ELAPSED=$(( ($(date +%s) - START_TIME) / 60 ))
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Phase ${PHASE} 결과 (${ELAPSED}분 소요)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  완료: ${COMPLETED}"
echo "  실패: ${FAILED}"
echo ""

# phase-gate.json 업데이트
if [ -f "$STATE_DIR/phase-gate.json" ]; then
  node -e "
    const fs = require('fs');
    const g = JSON.parse(fs.readFileSync('${STATE_DIR}/phase-gate.json'));
    g['phase${PHASE}'] = 'complete';
    if (!g.startedAt) g.startedAt = new Date().toISOString();
    fs.writeFileSync('${STATE_DIR}/phase-gate.json', JSON.stringify(g, null, 2));
    console.log('phase-gate.json updated: phase${PHASE} = complete');
  "
fi
