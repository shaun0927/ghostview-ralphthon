#!/bin/bash
# run-auto.sh — 완전 자율 실행 (tmux + 대화형 claude + autopilot)
#
# hang 감지: 출력이 변하고 있으면 작업 중, 2분간 변화 없으면 hang
#
# Usage: ./scripts/run-auto.sh [max-restarts] [hang-timeout-sec]
# Example: ./scripts/run-auto.sh 10 120

set -uo pipefail

MAX_RESTARTS="${1:-10}"
HANG_TIMEOUT="${2:-60}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SESSION_NAME="ghostview-auto"
RESTARTS=0
LAST_SCREEN=""
LAST_CHANGE_TIME=$(date +%s)
PREV_COMPLETED_PHASES=""
PREV_CLOSED_ISSUES=""
HANG_COUNT=0

PROMPT='gv_resume로 상태 확인하고 다음 ready 이슈를 gv_start로 시작해. 코드 작성 후 gv_finish로 완료해. nextReady가 있으면 계속 진행해. autopilot으로 진행해줘.'

echo "╔═══════════════════════════════════════╗"
echo "║  GhostView Auto Runner (tmux)         ║"
echo "║  Max restarts: ${MAX_RESTARTS}                     ║"
echo "║  Hang timeout: ${HANG_TIMEOUT}s                   ║"
echo "╚═══════════════════════════════════════╝"

# Phase별 이슈 자동 생성 (없으면)
echo "Phase 이슈 확인..."
"$ROOT/scripts/create-phase-issues.sh"

tmux send-keys -t "$SESSION_NAME" C-c 2>/dev/null; sleep 1; tmux send-keys -t "$SESSION_NAME" "exit" Enter 2>/dev/null; sleep 2

restart_claude() {
  # 기존 claude 프로세스 종료 (세션은 유지)
  tmux send-keys -t "$SESSION_NAME" C-c 2>/dev/null
  sleep 1
  tmux send-keys -t "$SESSION_NAME" C-c 2>/dev/null
  sleep 1
  tmux send-keys -t "$SESSION_NAME" "exit" Enter 2>/dev/null
  sleep 2
}

start_claude_session() {
  RESTARTS=$((RESTARTS + 1))
  echo ""
  echo "┌─── Session start (#${RESTARTS}/${MAX_RESTARTS}) $(date +%H:%M:%S) ───┐"

  if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    # 세션 유지, claude만 재시작
    restart_claude
  else
    # 첫 실행: 새 세션 생성
    tmux new-session -d -s "$SESSION_NAME" -c "$ROOT"
    sleep 2
  fi

  tmux send-keys -t "$SESSION_NAME" "cd ${ROOT} && claude --dangerously-skip-permissions" Enter
  sleep 10  # claude 초기화 대기

  tmux send-keys -t "$SESSION_NAME" "$PROMPT" Enter
  LAST_CHANGE_TIME=$(date +%s)
  LAST_SCREEN=""
  echo "  프롬프트 전송 완료"
}

check_phase_gate() {
  node -p "
    const g=JSON.parse(require('fs').readFileSync('${ROOT}/state/phase-gate.json','utf8'));
    Object.entries(g).filter(([k,v])=>k.startsWith('phase')&&v!=='complete').length
  " 2>/dev/null || echo "5"
}

get_screen() {
  tmux capture-pane -t "$SESSION_NAME" -p 2>/dev/null | tail -20
}

start_claude_session

while [ "$RESTARTS" -le "$MAX_RESTARTS" ]; do
  sleep 10

  # 1. phase-gate 확인
  PENDING=$(check_phase_gate)
  if [ "$PENDING" -eq 0 ]; then
    echo ""
    echo "━━━ 모든 Phase 완료! $(date +%H:%M:%S) ━━━"
    node -p "JSON.stringify(JSON.parse(require('fs').readFileSync('${ROOT}/state/phase-gate.json','utf8')),null,2)"
        tmux send-keys -t "$SESSION_NAME" C-c 2>/dev/null
    exit 0
  fi

  # 2. 세션 생존 확인
  if ! tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    echo "  [DEAD] 세션 죽음 $(date +%H:%M:%S)"
    if [ "$RESTARTS" -ge "$MAX_RESTARTS" ]; then
      echo "  Max restarts 도달."
      exit 1
    fi
    start_claude_session
    continue
  fi

  # 3. 이슈 종료 감지 → 세션 강제 재시작 (context 초기화)
  CURRENT_SCREEN=$(get_screen)
  NOW=$(date +%s)

  # 방법 1: phase-gate.json 변화 감지
  COMPLETED_PHASES=$(node -p "
    const g=JSON.parse(require('fs').readFileSync('${ROOT}/state/phase-gate.json','utf8'));
    Object.entries(g).filter(([k,v])=>k.startsWith('phase')&&v==='complete').length
  " 2>/dev/null || echo "0")

  # 방법 2: GitHub 닫힌 이슈 수 변화 감지 (AI가 수동 close해도 감지)
  CLOSED_ISSUES=$(gh issue list --state closed --json number -q 'length' 2>/dev/null || echo "0")

  CHANGE_DETECTED=0
  if [ -n "$PREV_COMPLETED_PHASES" ] && [ "$COMPLETED_PHASES" -gt "$PREV_COMPLETED_PHASES" ] 2>/dev/null; then
    echo "  [PHASE DONE] phase-gate ${PREV_COMPLETED_PHASES}→${COMPLETED_PHASES} → 세션 재시작"
    CHANGE_DETECTED=1
  elif [ -n "$PREV_COMPLETED_PHASES" ] && [ "$COMPLETED_PHASES" -lt "$PREV_COMPLETED_PHASES" ] 2>/dev/null; then
    echo "  [WARN] phase-gate 역행 ${PREV_COMPLETED_PHASES}→${COMPLETED_PHASES} (무시, 재시작 안 함)"
  fi
  if [ -n "$PREV_CLOSED_ISSUES" ] && [ "$CLOSED_ISSUES" -gt "$PREV_CLOSED_ISSUES" ] 2>/dev/null; then
    echo "  [ISSUE CLOSED] issues ${PREV_CLOSED_ISSUES}→${CLOSED_ISSUES} → 세션 재시작"
    CHANGE_DETECTED=1
  fi
  PREV_COMPLETED_PHASES="$COMPLETED_PHASES"
  PREV_CLOSED_ISSUES="$CLOSED_ISSUES"

  if [ "$CHANGE_DETECTED" -eq 1 ]; then
    tmux send-keys -t "$SESSION_NAME" C-c 2>/dev/null; sleep 1; tmux send-keys -t "$SESSION_NAME" "exit" Enter 2>/dev/null; sleep 2
    sleep 3
    if [ "$RESTARTS" -ge "$MAX_RESTARTS" ]; then exit 1; fi
    start_claude_session
    continue
  fi

  # 4. 화면 변화 감지 (hang 감지)
  if [ "$CURRENT_SCREEN" != "$LAST_SCREEN" ]; then
    LAST_SCREEN="$CURRENT_SCREEN"
    LAST_CHANGE_TIME=$NOW
    HANG_COUNT=0
  else
    STALE_SEC=$((NOW - LAST_CHANGE_TIME))

    if [ "$STALE_SEC" -ge "$HANG_TIMEOUT" ]; then
      HANG_COUNT=$((HANG_COUNT + 1))
      echo "  [HANG #${HANG_COUNT}] ${STALE_SEC}초간 출력 변화 없음 $(date +%H:%M:%S)"

      if [ "$HANG_COUNT" -le 10 ]; then
        # 1-2회: "continue" 주입 (대부분 이걸로 해결됨)
        echo "  → continue 주입"
        tmux send-keys -t "$SESSION_NAME" "continue" Enter
      elif echo "$CURRENT_SCREEN" | grep -qE "^[❯>%\$] *$"; then
        # 셸 프롬프트: claude가 종료됨 → 재시작
        echo "  → 셸 프롬프트 감지 → claude 재시작"
        HANG_COUNT=0
        if [ "$RESTARTS" -ge "$MAX_RESTARTS" ]; then exit 1; fi
        start_claude_session
      else
        # 3회+: continue로 안 되면 세션 재시작
        echo "  → continue ${HANG_COUNT}회 실패 → 세션 재시작"
        HANG_COUNT=0
        if [ "$RESTARTS" -ge "$MAX_RESTARTS" ]; then exit 1; fi
        start_claude_session
      fi

      LAST_CHANGE_TIME=$(date +%s)
      LAST_SCREEN=""
    else
      # 출력이 변하지 않지만 아직 timeout 아님 → hang count 유지
      :
    fi
  fi

  # 4. 진행 상황 (1분마다)
  if [ $((NOW % 60)) -lt 10 ]; then
    SCAN=$(node -p "require('${ROOT}/state/scan-progress.json').completed" 2>/dev/null || echo "?")
    echo "  [$(date +%H:%M)] pending:${PENDING} scan:${SCAN} restarts:${RESTARTS}"
  fi
done

echo "━━━ Max restarts 도달. ━━━"
tmux send-keys -t "$SESSION_NAME" C-c 2>/dev/null; sleep 1; tmux send-keys -t "$SESSION_NAME" "exit" Enter 2>/dev/null; sleep 2
exit 1
