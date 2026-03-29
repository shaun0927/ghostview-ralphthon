#!/bin/bash
# run-issue.sh — 이슈 실행 오케스트레이터
#
# 결정적 단계는 이 스크립트가, 지능이 필요한 단계는 AI가 처리한다.
# Usage: ./scripts/run-issue.sh <issue-number>
#
# 단계:
#   1-3:  스크립트 (이슈 읽기, 라벨, 브랜치)
#   4-5:  AI (코드 작성 + 검증)
#   6-11: 스크립트 (커밋, PR, 머지, 종료, 언블록)

set -euo pipefail

N="${1:?Usage: ./scripts/run-issue.sh <issue-number>}"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Issue #${N} — 실행 시작"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── Step 1: 이슈 읽기 ──────────────────────────
echo "[1/11] 이슈 읽기..."
TITLE=$(gh issue view "$N" --json title -q '.title')
BODY=$(gh issue view "$N" --json body -q '.body')
echo "  제목: $TITLE"

# 의존성 확인
DEPS=$(echo "$BODY" | grep -oE 'depends on #[0-9]+' | grep -oE '[0-9]+' || true)
for dep in $DEPS; do
  STATE=$(gh issue view "$dep" --json state -q '.state')
  if [ "$STATE" != "CLOSED" ]; then
    echo "  BLOCKED: #${N} depends on #${dep} (${STATE})"
    exit 1
  fi
done

# ── Step 2: 라벨 변경 ─────────────────────────
echo "[2/11] 라벨: ready → in-progress"
gh issue edit "$N" --remove-label "status:ready" --add-label "status:in-progress" 2>/dev/null || true

# ── Step 3: 브랜치 생성 ────────────────────────
SLUG=$(echo "$TITLE" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9가-힣]/-/g' | head -c 30 | sed 's/-$//')
BRANCH="issue-${N}-${SLUG}"
echo "[3/11] 브랜치: $BRANCH"
git checkout develop && git pull origin develop
git checkout -b "$BRANCH" develop

# ── Step 4-5: AI 코드 작성 + 검증 ──────────────
echo "[4-5/11] AI에게 코드 작성 위임..."
echo ""
echo "━━━ AI 작업 시작 ━━━"
echo "다음 이슈를 구현하고, 이슈 본문의 '검증 명령'이 통과할 때까지 수정해줘."
echo ""
echo "Issue #${N}: ${TITLE}"
echo ""
echo "$BODY"
echo ""
echo "규칙:"
echo "- 검증 명령이 exit 0일 때까지 수정을 반복한다 (최대 3회)"
echo "- 완료되면 '===AI_DONE==='을 출력한다"
echo "━━━ AI 작업 끝 ━━━"
echo ""

# 여기서 AI (Claude Code)가 대화형으로 코드를 작성하고 검증한다.
# 스크립트를 대화형으로 사용할 때는 이 시점에서 사용자가 AI에게 지시한다.
# 자동화 시에는 claude CLI를 파이프로 호출할 수 있다:
#
#   echo "이 이슈를 구현해줘. ${BODY}" | claude --print
#
# 현재는 대화형 모드: 사용자가 AI 작업 완료를 확인한 후 Enter를 누른다.

read -r -p "[AI 작업 완료 후 Enter를 눌러 계속 진행] "

# ── Step 6: 커밋 + 푸시 ────────────────────────
echo "[6/11] 커밋 + 푸시..."
git add -A
if git diff --cached --quiet; then
  echo "  변경사항 없음. 중단."
  git checkout develop
  exit 1
fi
git commit -m "feat: ${TITLE} (#${N})

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
git push origin "$BRANCH"

# ── Step 7: PR 생성 ────────────────────────────
echo "[7/11] PR 생성..."
PR_URL=$("$SCRIPT_DIR/retry.sh" 3 gh pr create --base develop --title "feat: ${TITLE} (#${N})" --body "Closes #${N}" 2>&1)
PR_NUM=$(echo "$PR_URL" | grep -oE '[0-9]+$')
echo "  PR #${PR_NUM}: $PR_URL"

# ── Step 8: PR 머지 ────────────────────────────
echo "[8/11] PR 머지..."
"$SCRIPT_DIR/retry.sh" 3 gh pr merge "$PR_NUM" --squash --delete-branch
git checkout develop && git pull origin develop

# ── Step 9: 이슈 종료 ──────────────────────────
echo "[9/11] 이슈 종료..."
"$SCRIPT_DIR/retry.sh" 3 gh issue close "$N"
gh issue edit "$N" --remove-label "status:in-progress" --add-label "status:done" 2>/dev/null || true

# ── Step 10: 후속 언블록 ───────────────────────
echo "[10/11] 후속 이슈 언블록..."
UNBLOCKED=0
for issue in $(gh issue list --state open --label "status:blocked" --json number,body \
  -q ".[] | select(.body | test(\"depends on #${N}\")) | .number" 2>/dev/null || true); do
  gh issue edit "$issue" --remove-label "status:blocked" --add-label "status:ready"
  echo "  #${issue}: blocked → ready"
  UNBLOCKED=$((UNBLOCKED + 1))
done
[ "$UNBLOCKED" -eq 0 ] && echo "  (후속 이슈 없음)"

# ── Step 11: 완료 보고 ─────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Issue #${N} 완료"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  PR: #${PR_NUM} (merged)"
echo "  이슈: #${N} (closed)"
echo "  언블록: ${UNBLOCKED}개 이슈"
echo ""
echo "  다음 ready 이슈:"
gh issue list --label "status:ready" --json number,title -q '.[] | "  #\(.number) \(.title)"' 2>/dev/null || echo "  (없음)"
