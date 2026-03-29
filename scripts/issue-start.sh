#!/bin/bash
# issue-start.sh — 이슈 실행 전반부 (Steps 1-3)
# 결정적: 이슈 읽기, 라벨 변경, 브랜치 생성
#
# Usage: ./scripts/issue-start.sh <issue-number>
# Output: 브랜치가 생성되고 이슈 본문이 출력됨. AI가 코드를 작성할 차례.

set -euo pipefail

N="${1:?Usage: ./scripts/issue-start.sh <issue-number>}"

echo "━━━ Issue #${N} START ━━━"

# Step 0: 환경변수 확인 (결정적 — 없으면 차단)
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [ ! -f "$ROOT/.env.local" ]; then
  # config/env.json에서 복구 시도
  if [ -f "$ROOT/config/env.json" ]; then
    echo "[0/3] .env.local 복구 (config/env.json에서)..."
    SUPA_URL=$(node -p "require('$ROOT/config/env.json').SUPABASE_URL")
    SUPA_KEY=$(node -p "require('$ROOT/config/env.json').SUPABASE_ANON_KEY")
    echo "NEXT_PUBLIC_SUPABASE_URL=$SUPA_URL" > "$ROOT/.env.local"
    echo "NEXT_PUBLIC_SUPABASE_ANON_KEY=$SUPA_KEY" >> "$ROOT/.env.local"
    echo "  .env.local 복구 완료"
  else
    echo "[0/3] .env.local + config/env.json 없음. Supabase CLI로 복구..."
    # Supabase CLI에서 프로젝트 ref + API 키 자동 추출
    PROJ_REF=$(supabase projects list 2>/dev/null | grep "|" | grep -v "LINKED\|---" | head -1 | awk -F'|' '{print $3}' | tr -d ' ')
    if [ -z "$PROJ_REF" ]; then
      echo "  FAIL: supabase projects list에서 프로젝트를 찾을 수 없음"
      echo "  supabase login을 먼저 실행하세요"
      exit 1
    fi
    ANON_KEY=$(supabase projects api-keys --project-ref "$PROJ_REF" 2>/dev/null | grep "anon" | awk -F'|' '{print $2}' | tr -d ' ')
    SUPA_URL="https://${PROJ_REF}.supabase.co"

    if [ -z "$ANON_KEY" ]; then
      echo "  FAIL: API 키 추출 실패"
      exit 1
    fi

    mkdir -p "$ROOT/config"
    echo "{\"SUPABASE_URL\": \"${SUPA_URL}\", \"SUPABASE_ANON_KEY\": \"${ANON_KEY}\"}" > "$ROOT/config/env.json"
    echo "NEXT_PUBLIC_SUPABASE_URL=$SUPA_URL" > "$ROOT/.env.local"
    echo "NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON_KEY" >> "$ROOT/.env.local"
    echo "  복구 완료: $PROJ_REF"
  fi
fi

# Step 1: 이슈 읽기 + 의존성 확인
TITLE=$(gh issue view "$N" --json title -q '.title')
echo "제목: $TITLE"

BODY=$(gh issue view "$N" --json body -q '.body')
DEPS=$(echo "$BODY" | grep -oE 'depends on #[0-9]+' | grep -oE '[0-9]+' || true)
for dep in $DEPS; do
  STATE=$(gh issue view "$dep" --json state -q '.state')
  if [ "$STATE" != "CLOSED" ]; then
    echo "BLOCKED: depends on #${dep} (${STATE})"
    exit 1
  fi
done

# Step 2: 라벨 변경
gh issue edit "$N" --remove-label "status:ready" --add-label "status:in-progress" 2>/dev/null || true

# Step 3: 브랜치 생성 (ASCII only)
SLUG=$(echo "$TITLE" | sed 's/[^a-zA-Z0-9]/-/g' | tr '[:upper:]' '[:lower:]' | sed 's/--*/-/g' | sed 's/^-//' | head -c 30 | sed 's/-$//')
BRANCH="issue-${N}-${SLUG}"
git checkout develop 2>/dev/null && git pull origin develop 2>/dev/null
git checkout -b "$BRANCH" develop

echo ""
echo "━━━ AI 작업 시작 ━━━"
echo "브랜치: $BRANCH"
echo ""
echo "$BODY"
echo ""
echo "━━━ 코드 작성 후 ./scripts/issue-finish.sh ${N} 실행 ━━━"
