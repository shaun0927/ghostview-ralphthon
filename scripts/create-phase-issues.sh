#!/bin/bash
# create-phase-issues.sh — Phase별 이슈 자동 생성 (결정적)
#
# run-auto.sh가 시작 시 호출. 이미 열린 이슈가 있으면 skip.
# 각 이슈에 phase 라벨 + 의존성 + autopilot 지시 포함.
#
# Usage: ./scripts/create-phase-issues.sh

set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# 이미 열린 phase 이슈가 있으면 skip
OPEN_COUNT=$(gh issue list --state open --json number -q 'length' 2>/dev/null || echo "0")
if [ "$OPEN_COUNT" -gt 0 ]; then
  echo "이미 열린 이슈 ${OPEN_COUNT}개 존재. 이슈 생성 skip."
  gh issue list --state open --json number,title -q '.[] | "#\(.number) \(.title)"'
  exit 0
fi

echo "Phase 0-4 이슈 생성 중..."

# Phase 0
P0=$(gh issue create \
  --title "Phase 0: Supabase 스키마 + Next.js + Vercel 배포" \
  --label "phase:0-infra,status:ready,type:task" \
  --body "phase0-infra.md 참조. Supabase 스키마 생성, Next.js 초기화, Vercel 배포.

## 검증 명령
\`\`\`bash
npm run build && curl -s -o /dev/null -w '%{http_code}' \$(cat state/deploy-url.txt)
\`\`\`

## Execution
autopilot으로 진행해줘. PLAN.md + phase0-infra.md 참조." 2>&1 | grep -oE '[0-9]+$')
echo "  #${P0} Phase 0 (ready)"

# Phase 1
P1=$(gh issue create \
  --title "Phase 1: 1000사이트 스캔 + FP 검증 + Supabase 업로드" \
  --label "phase:1-scan,status:blocked,type:task" \
  --body "depends on #${P0}

phase1-scan.md 참조. Tranco에서 1000사이트 수집, CDP 병렬 스캔, FP 전수 검증.
completed >= 800 (80%) 달성해야 gate 통과.

## 검증 명령
\`\`\`bash
./scripts/verify-gate.sh 1
\`\`\`

## Execution
autopilot으로 진행해줘. PLAN.md Appendix A,B,E 참조." 2>&1 | grep -oE '[0-9]+$')
echo "  #${P1} Phase 1 (blocked, depends on #${P0})"

# Phase 2
P2=$(gh issue create \
  --title "Phase 2: Deep Dive worst 10사이트 (카테고리별 findings ko/en)" \
  --label "phase:2-deepdive,status:blocked,type:task" \
  --body "depends on #${P1}

phase2-deepdive.md 참조. worst 10사이트 스크린샷 + replaceChild 블랙홀.
카테고리별 findings를 ko/en 쌍으로 배열 저장.

## 도구 제약 (필수)
- **반드시 OpenChrome MCP 도구 사용** (navigate, batch_execute, page_screenshot)
- **Puppeteer 직접 설치/사용 금지** — Deep Dive는 OpenChrome으로만 수행
- 스크린샷: page_screenshot (path 지정으로 파일 저장)
- 오버레이: batch_execute로 replaceChild 실행
- PLAN.md Appendix C, E의 도구 사용 규칙 준수

## 검증 명령
\`\`\`bash
./scripts/verify-gate.sh 2
\`\`\`

## Execution
autopilot으로 진행해줘. PLAN.md Appendix C,G 참조." 2>&1 | grep -oE '[0-9]+$')
echo "  #${P2} Phase 2 (blocked, depends on #${P1})"

# Phase 3
P3=$(gh issue create \
  --title "Phase 3: 웹사이트 (슬라이더 + i18n + /scan + 전면 메시지 + 브랜딩)" \
  --label "phase:3-website,status:blocked,type:task" \
  --body "depends on #${P2}

phase3-website.md 참조. PLAN.md Appendix D,F,G,H,I 참조.
- 리더보드 (worst-first) + 상세 페이지 (슬라이더 UX)
- /scan 라이브 스캔 (Puppeteer serverless)
- i18n ko/en (findings 포함)
- OpenChrome 브랜딩 (로고 + 링크)
- 전면 메시지 (Appendix I)
- findings 3개+ 카드 렌더링

## 검증 명령
\`\`\`bash
./scripts/verify-gate.sh 3
\`\`\`

## Execution
autopilot으로 진행해줘." 2>&1 | grep -oE '[0-9]+$')
echo "  #${P3} Phase 3 (blocked, depends on #${P2})"

# Phase 4
P4=$(gh issue create \
  --title "Phase 4: 최종 배포 + visual QA v7 (13항목) 통과" \
  --label "phase:4-deploy,status:blocked,type:task" \
  --body "depends on #${P3}

phase4-deploy.md 참조. vercel deploy --prod 후 visual QA v7 전체 통과.
gv_visual_qa(mode=checklist) → OpenChrome batch_execute → 13항목 PASS → gv_visual_qa(mode=report).
FAIL 항목은 fix 참고해 수정 후 재검증.

## 검증 명령
\`\`\`bash
./scripts/verify-gate.sh 4
\`\`\`

## Execution
autopilot으로 진행해줘." 2>&1 | grep -oE '[0-9]+$')
echo "  #${P4} Phase 4 (blocked, depends on #${P3})"

echo ""
echo "Phase 이슈 생성 완료: #${P0} → #${P1} → #${P2} → #${P3} → #${P4}"
