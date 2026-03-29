#!/bin/bash
# issue-finish.sh — 이슈 실행 후반부 (Steps 6-11)
# 결정적: 커밋, PR, 머지, 종료, 언블록
#
# Usage: ./scripts/issue-finish.sh <issue-number>
# Precondition: AI가 코드를 작성하고 검증을 통과한 상태

set -euo pipefail

N="${1:?Usage: ./scripts/issue-finish.sh <issue-number>}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

TITLE=$(gh issue view "$N" --json title -q '.title')
BRANCH=$(git branch --show-current)

echo "━━━ Issue #${N} FINISH ━━━"

# Step 6: 커밋 + 푸시
echo "[6/11] 커밋 + 푸시..."
git add -A
if git diff --cached --quiet; then
  echo "  변경사항 없음. 중단."
  exit 1
fi
git commit -m "feat: ${TITLE} (#${N})

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
"$SCRIPT_DIR/retry.sh" 3 git push origin "$BRANCH"

# Step 6.3: 자동 업로드 (Phase 1/2 결과를 Supabase에 업로드)
echo "[6.3/11] Supabase 업로드..."
# env 자동 복구 (없으면 Supabase CLI로 생성)
if [ ! -f .env.local ]; then
  echo "  .env.local 없음 — Supabase CLI로 복구..."
  PROJ_REF=$(supabase projects list 2>/dev/null | grep "|" | grep -v "LINKED\|---" | head -1 | awk -F'|' '{print $3}' | tr -d ' ')
  if [ -n "$PROJ_REF" ]; then
    ANON_KEY=$(supabase projects api-keys --project-ref "$PROJ_REF" 2>/dev/null | grep "anon" | awk -F'|' '{print $2}' | tr -d ' ')
    SUPA_URL="https://${PROJ_REF}.supabase.co"
    mkdir -p config
    echo "{\"SUPABASE_URL\": \"${SUPA_URL}\", \"SUPABASE_ANON_KEY\": \"${ANON_KEY}\"}" > config/env.json
    echo "NEXT_PUBLIC_SUPABASE_URL=$SUPA_URL" > .env.local
    echo "NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON_KEY" >> .env.local
    echo "  복구 완료: $PROJ_REF"
  fi
fi
if [ -f .env.local ]; then
  set -a && source .env.local && set +a
  if [ -f state/upload-ready.json ]; then
    echo "  Phase 1 업로드: state/upload-ready.json"
    node scripts/upload-results.js state/upload-ready.json && echo "  업로드 완료" || echo "  WARN: 업로드 실패 (계속 진행)"
  fi
  if [ -f state/deepdive-reports.json ]; then
    echo "  Phase 2 업로드: deepdive reports"
    node scripts/upload-deepdive.js && echo "  업로드 완료" || echo "  WARN: 업로드 실패 (계속 진행)"
  fi
else
  echo "  WARN: .env.local 복구 실패 — 업로드 건너뜀"
fi

# Step 6.5: Phase Gate Check — 누적 (현재 phase 이하 전부 체크)
PHASE_LABEL=$(gh issue view "$N" --json labels -q '.labels[].name' 2>/dev/null | grep "^phase:" | head -1)
PHASE_NUM=""
if [ -n "$PHASE_LABEL" ]; then
  PHASE_NUM=$(echo "$PHASE_LABEL" | sed 's/phase:\([0-9]\).*/\1/')
  echo "[6.5/11] 누적 gate check (Phase 0~${PHASE_NUM})..."
  GATE_FAILED=0
  for p in $(seq 0 "$PHASE_NUM"); do
    echo "  --- Phase ${p} ---"
    if ! "$SCRIPT_DIR/verify-gate.sh" "$p"; then
      GATE_FAILED=1
      break
    fi
  done
  if [ "$GATE_FAILED" -eq 1 ]; then
    echo ""
    echo "  GATE FAILED. merge를 차단합니다."
    echo "  위 FAIL 항목을 수정한 후 다시 issue-finish.sh를 실행하세요."
    "$SCRIPT_DIR/retry.sh" 3 gh pr create --base develop --title "feat: ${TITLE} (#${N})" --body "Closes #${N} — GATE FAILED" 2>/dev/null || true
    exit 1
  fi
fi

# Step 7: PR 생성
echo "[7/11] PR 생성..."
PR_URL=$("$SCRIPT_DIR/retry.sh" 3 gh pr create --base develop --title "feat: ${TITLE} (#${N})" --body "Closes #${N}")
PR_NUM=$(echo "$PR_URL" | grep -oE '[0-9]+$')
echo "  PR #${PR_NUM}"

# Step 8: PR 머지
echo "[8/11] PR 머지..."
"$SCRIPT_DIR/retry.sh" 3 gh pr merge "$PR_NUM" --squash --delete-branch
git checkout develop && git pull origin develop

# Step 8.5: Phase gate 자동 업데이트 (로컬 전용 — git에 커밋하지 않음)
# phase-gate.json을 git에 커밋하면 checkout/pull 시 덮어써져서 상태가 꼬임
if [ -n "$PHASE_NUM" ] && [ -f "state/phase-gate.json" ]; then
  echo "[8.5/11] Phase gate 업데이트 (local only)..."
  node -e "
    const fs=require('fs');
    const g=JSON.parse(fs.readFileSync('state/phase-gate.json','utf8'));
    // 단조 증가 보장: 이전 phase가 complete 아니면 같이 완료 처리
    for(let i=0;i<=${PHASE_NUM};i++) g['phase'+i]='complete';
    const allDone=Object.entries(g).filter(([k])=>k.startsWith('phase')).every(([,v])=>v==='complete');
    if(allDone) g.completedAt=new Date().toISOString();
    fs.writeFileSync('state/phase-gate.json',JSON.stringify(g,null,2));
    console.log('  phase0~${PHASE_NUM} → complete' + (allDone ? ' (ALL COMPLETE)' : ''));
  "
fi

# Step 9: 이슈 종료
echo "[9/11] 이슈 종료..."
"$SCRIPT_DIR/retry.sh" 3 gh issue close "$N"
gh issue edit "$N" --remove-label "status:in-progress" --add-label "status:done" 2>/dev/null || true

# Step 10: 후속 언블록
echo "[10/11] 후속 이슈 언블록..."
UNBLOCKED=0
for issue in $(gh issue list --state open --label "status:blocked" --json number,body \
  -q ".[] | select(.body | test(\"depends on #${N}\")) | .number" 2>/dev/null || true); do
  gh issue edit "$issue" --remove-label "status:blocked" --add-label "status:ready"
  echo "  #${issue}: blocked → ready"
  UNBLOCKED=$((UNBLOCKED + 1))
done
[ "$UNBLOCKED" -eq 0 ] && echo "  (후속 이슈 없음)"

# Step 11: 완료 보고
echo ""
echo "━━━ Issue #${N} 완료 ━━━"
echo "  PR: #${PR_NUM} (merged)"
echo "  이슈: #${N} (closed)"
echo "  언블록: ${UNBLOCKED}개"
echo ""
echo "  다음 ready 이슈:"
gh issue list --label "status:ready" --json number,title -q '.[] | "  #\(.number) \(.title)"' 2>/dev/null || echo "  (없음)"
