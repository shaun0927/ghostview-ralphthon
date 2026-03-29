#!/bin/bash
# run-pipeline.sh — 전체 Ralphthon 파이프라인 오케스트레이터
#
# Usage: ./scripts/run-pipeline.sh [total-budget-minutes]
# Example: ./scripts/run-pipeline.sh 300   (5시간)
#
# 동작:
#   1. phase-gate.json에서 현재 상태 확인
#   2. 첫 번째 미완료 phase부터 시작
#   3. 각 phase에 시간 예산 배분
#   4. phase 완료 또는 시간 초과 시 다음 phase로
#   5. 모든 phase 완료 시 최종 보고
#
# 재개: 스크립트를 다시 실행하면 phase-gate.json의 상태에서 이어서 진행

set -uo pipefail

TOTAL_BUDGET="${1:-300}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STATE_DIR="$(dirname "$SCRIPT_DIR")/state"
GATE_FILE="$STATE_DIR/phase-gate.json"

# Phase별 시간 예산 (분)
PHASE_BUDGETS=(30 150 60 45 15)
PHASE_NAMES=("Infrastructure" "Mass Scan" "Deep Dive" "Website" "Deploy")

START_TIME=$(date +%s)
PIPELINE_DEADLINE=$((START_TIME + TOTAL_BUDGET * 60))

echo "╔═══════════════════════════════════════╗"
echo "║  GhostView Ralphthon Pipeline         ║"
echo "║  총 예산: ${TOTAL_BUDGET}분                       ║"
echo "╚═══════════════════════════════════════╝"
echo ""

# phase-gate.json 초기화 (없으면 생성)
if [ ! -f "$GATE_FILE" ]; then
  echo '{"phase0":"pending","phase1":"pending","phase2":"pending","phase3":"pending","phase4":"pending","startedAt":null,"completedAt":null}' > "$GATE_FILE"
fi

# 시작 시간 기록
node -e "
  const fs = require('fs');
  const g = JSON.parse(fs.readFileSync('${GATE_FILE}'));
  if (!g.startedAt) g.startedAt = new Date().toISOString();
  fs.writeFileSync('${GATE_FILE}', JSON.stringify(g, null, 2));
"

for PHASE in 0 1 2 3 4; do
  # 시간 확인
  NOW=$(date +%s)
  if [ "$NOW" -ge "$PIPELINE_DEADLINE" ]; then
    echo ""
    echo "[PIPELINE] 전체 시간 초과. 중단."
    break
  fi

  # 이미 완료된 phase는 skip
  STATUS=$(node -p "JSON.parse(require('fs').readFileSync('${GATE_FILE}')).phase${PHASE}")
  if [ "$STATUS" = "complete" ]; then
    echo "[SKIP] Phase ${PHASE} (${PHASE_NAMES[$PHASE]}): 이미 완료"
    continue
  fi

  # 남은 시간 계산
  REMAINING_SEC=$((PIPELINE_DEADLINE - NOW))
  REMAINING_MIN=$((REMAINING_SEC / 60))
  BUDGET=${PHASE_BUDGETS[$PHASE]}

  # 남은 시간이 예산보다 적으면 남은 시간 전부 할당
  if [ "$BUDGET" -gt "$REMAINING_MIN" ]; then
    BUDGET=$REMAINING_MIN
  fi

  echo ""
  echo "┌─── Phase ${PHASE}: ${PHASE_NAMES[$PHASE]} (예산: ${BUDGET}분) ───┐"

  # Phase 1 (Mass Scan)은 전용 스크립트 사용
  if [ "$PHASE" -eq 1 ] && [ -f "$SCRIPT_DIR/run-scan.sh" ]; then
    "$SCRIPT_DIR/run-scan.sh" "$BUDGET" || true
  else
    "$SCRIPT_DIR/run-phase.sh" "$PHASE" "$BUDGET" || true
  fi

  echo "└─── Phase ${PHASE} 완료 ─────────────────────────┘"
done

# 최종 보고
echo ""
echo "╔═══════════════════════════════════════╗"
echo "║  Pipeline 최종 결과                   ║"
echo "╚═══════════════════════════════════════╝"

node -e "
  const fs = require('fs');
  const g = JSON.parse(fs.readFileSync('${GATE_FILE}'));
  const phases = ['Infrastructure','Mass Scan','Deep Dive','Website','Deploy'];
  let allComplete = true;
  for (let i = 0; i < 5; i++) {
    const status = g['phase'+i];
    const icon = status === 'complete' ? '✓' : status === 'pending' ? '·' : '✗';
    console.log('  ' + icon + ' Phase ' + i + ': ' + phases[i] + ' — ' + status);
    if (status !== 'complete') allComplete = false;
  }
  console.log('');
  if (allComplete) {
    g.completedAt = new Date().toISOString();
    fs.writeFileSync('${GATE_FILE}', JSON.stringify(g, null, 2));
    console.log('  모든 Phase 완료!');
    if (fs.existsSync('${STATE_DIR}/deploy-url.txt')) {
      console.log('  URL: ' + fs.readFileSync('${STATE_DIR}/deploy-url.txt','utf8').trim());
    }
  } else {
    console.log('  미완료 Phase 있음. 스크립트를 다시 실행하면 이어서 진행.');
  }
"

ELAPSED=$(( ($(date +%s) - START_TIME) / 60 ))
echo "  소요: ${ELAPSED}분 / ${TOTAL_BUDGET}분"
