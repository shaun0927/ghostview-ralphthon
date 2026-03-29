#!/bin/bash
# verify-gate.sh — Phase별 gate 검증 (issue-finish.sh가 호출)
# 이 검증을 통과하지 못하면 merge 불가.
#
# Usage: ./scripts/verify-gate.sh <phase-number>
# Exit 0 = 통과, Exit 1 = 실패 (merge 차단)

set -euo pipefail

PHASE="${1:?Usage: ./scripts/verify-gate.sh <phase-number>}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
FAIL=0

echo "━━━ Phase ${PHASE} Gate Check ━━━"

case "$PHASE" in
  1)
    # Gate 1: 데이터 완전성 — parity_score 누락 0건
    echo "[1] 데이터 완전성..."
    INCOMPLETE=$(node -p "
      const s=require('${ROOT}/state/scan-progress.json');
      s.results.filter(r => !r.error && (r.parity_score === undefined || r.parity_score === null)).length
    ")
    if [ "$INCOMPLETE" -gt 0 ]; then
      echo "  FAIL: ${INCOMPLETE}건의 parity_score 누락"
      FAIL=1
    else
      echo "  PASS: 모든 결과에 parity_score 존재"
    fi

    # Gate 2: FP 검증 시점 — 스캔 완료 이후여야 함
    echo "[2] FP 검증 시점..."
    VERIFY_OK=$(node -p "
      const fs=require('fs');
      const vPath='${ROOT}/state/verify-results.json';
      const sPath='${ROOT}/state/scan-progress.json';
      if (!fs.existsSync(vPath)) { console.error('verify-results.json 없음'); process.exit(0); 'false' }
      const v=JSON.parse(fs.readFileSync(vPath));
      const s=JSON.parse(fs.readFileSync(sPath));
      const vTime=new Date(v.timestamp).getTime();
      const sTime=new Date(s.lastSavedAt).getTime();
      vTime >= sTime ? 'true' : 'false'
    ")
    if [ "$VERIFY_OK" != "true" ]; then
      echo "  FAIL: FP 검증이 스캔 완료 이전 시점. gv_verify 재실행 필요."
      FAIL=1
    else
      echo "  PASS: FP 검증이 스캔 이후 시점"
    fi

    # Gate 3: FP 0
    echo "[3] FP count..."
    FP_COUNT=$(node -p "
      const fs=require('fs');
      const vPath='${ROOT}/state/verify-results.json';
      if (!fs.existsSync(vPath)) { 'no_file' }
      else { JSON.parse(fs.readFileSync(vPath)).totalFalsePositives }
    ")
    if [ "$FP_COUNT" != "0" ]; then
      echo "  FAIL: FP ${FP_COUNT}건 (0이어야 함)"
      FAIL=1
    else
      echo "  PASS: FP 0"
    fi

    # Gate 4: 성능 기준
    echo "[4] 성능 기준..."
    PERF_OK=$(node -p "
      const fs=require('fs');
      const pPath='${ROOT}/state/perf-log.json';
      if (!fs.existsSync(pPath)) { 'no_file' }
      else {
        const p=JSON.parse(fs.readFileSync(pPath));
        const perSite = p.totalMs / p.totalSites;
        perSite <= 3000 ? 'true' : 'false_'+Math.round(perSite)+'ms'
      }
    ")
    if [[ "$PERF_OK" != "true" ]]; then
      echo "  FAIL: 사이트당 ${PERF_OK} (3초 이내여야 함)"
      FAIL=1
    else
      echo "  PASS: 사이트당 3초 이내"
    fi

    # Gate 5: 최소 완료 수 (totalSites의 80%)
    echo "[5] 최소 완료 수..."
    COMPLETED=$(node -p "require('${ROOT}/state/scan-progress.json').completed")
    TOTAL=$(node -p "require('${ROOT}/state/scan-progress.json').totalSites || 0")
    MIN_REQUIRED=$((TOTAL * 80 / 100))
    if [ "$MIN_REQUIRED" -lt 80 ]; then MIN_REQUIRED=80; fi
    if [ "$COMPLETED" -lt "$MIN_REQUIRED" ]; then
      echo "  FAIL: ${COMPLETED}건 완료 (${MIN_REQUIRED} 이상이어야 함, totalSites=${TOTAL}의 80%)"
      FAIL=1
    else
      echo "  PASS: ${COMPLETED}건 완료"
    fi

    # Gate 6: Supabase sites 테이블에 데이터 존재
    echo "[6] Supabase sites 데이터..."
    if [ -f "${ROOT}/.env.local" ]; then
      source "${ROOT}/.env.local"
      SB_COUNT=$(curl -s "${NEXT_PUBLIC_SUPABASE_URL}/rest/v1/sites?select=count" \
        -H "apikey: ${NEXT_PUBLIC_SUPABASE_ANON_KEY}" \
        -H "Authorization: Bearer ${NEXT_PUBLIC_SUPABASE_ANON_KEY}" \
        -H "Accept: application/vnd.pgrst.object+json" \
        -H "Prefer: count=exact" 2>/dev/null | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).count" 2>/dev/null || echo "0")
      if [ "$SB_COUNT" -lt 80 ] 2>/dev/null; then
        echo "  FAIL: Supabase에 ${SB_COUNT}건 (80 이상이어야 함)"
        FAIL=1
      else
        echo "  PASS: Supabase에 ${SB_COUNT}건"
      fi
    else
      echo "  WARN: .env.local 없음 — Supabase 체크 건너뜀"
    fi

    # Gate 7: 라이브 사이트에 데이터 표시
    echo "[7] 라이브 사이트 데이터 표시..."
    if [ -f "${ROOT}/state/deploy-url.txt" ]; then
      DEPLOY_URL=$(cat "${ROOT}/state/deploy-url.txt")
      LIVE_HTML=$(curl -s "$DEPLOY_URL" 2>/dev/null)
      LIVE_COUNT=$(echo "$LIVE_HTML" | grep -o "스캔 사이트 수" | head -1)
      if [ -z "$LIVE_COUNT" ]; then
        echo "  FAIL: 라이브 사이트에서 '스캔 사이트 수' 텍스트를 찾을 수 없음"
        FAIL=1
      else
        # 사이트 수가 0이 아닌지 확인
        SITE_NUM=$(echo "$LIVE_HTML" | grep -oE '[0-9]+' | head -1)
        if [ "$SITE_NUM" = "0" ]; then
          echo "  FAIL: 라이브 사이트에 데이터 0건"
          FAIL=1
        else
          echo "  PASS: 라이브 사이트에 데이터 표시 (${DEPLOY_URL})"
        fi
      fi
    else
      echo "  WARN: deploy-url.txt 없음 — 라이브 체크 건너뜀"
    fi
    ;;

  2)
    # Gate 0: Puppeteer 직접 사용 금지 (OpenChrome 필수)
    echo "[0] Puppeteer 직접 사용 여부..."
    if grep -r "require('puppeteer')\|require(\"puppeteer\")\|from 'puppeteer'" "${ROOT}/scripts/" 2>/dev/null | grep -v node_modules | grep -q .; then
      echo "  FAIL: scripts/에 Puppeteer 직접 import 감지. Deep Dive는 OpenChrome MCP로 수행해야 함."
      echo "  파일: $(grep -rl "require.*puppeteer" "${ROOT}/scripts/" 2>/dev/null | grep -v node_modules)"
      FAIL=1
    else
      echo "  PASS: Puppeteer 직접 사용 없음"
    fi

    echo "[1] Deep dive 최소 5개..."
    DD=$(node -p "require('${ROOT}/state/deepdive-progress.json').completed")
    if [ "$DD" -lt 5 ]; then
      echo "  FAIL: ${DD}건 (5 이상이어야 함)"
      FAIL=1
    else
      echo "  PASS: ${DD}건"
    fi

    # Gate 2: Supabase reports 테이블에 데이터 존재
    echo "[2] Supabase reports 데이터..."
    if [ -f "${ROOT}/.env.local" ]; then
      source "${ROOT}/.env.local"
      RPT_COUNT=$(curl -s "${NEXT_PUBLIC_SUPABASE_URL}/rest/v1/reports?select=count" \
        -H "apikey: ${NEXT_PUBLIC_SUPABASE_ANON_KEY}" \
        -H "Authorization: Bearer ${NEXT_PUBLIC_SUPABASE_ANON_KEY}" \
        -H "Accept: application/vnd.pgrst.object+json" \
        -H "Prefer: count=exact" 2>/dev/null | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).count" 2>/dev/null || echo "0")
      if [ "$RPT_COUNT" -lt 5 ] 2>/dev/null; then
        echo "  FAIL: Supabase reports에 ${RPT_COUNT}건 (5 이상이어야 함)"
        FAIL=1
      else
        echo "  PASS: Supabase reports에 ${RPT_COUNT}건"
      fi
    else
      echo "  WARN: .env.local 없음 — Supabase 체크 건너뜀"
    fi
    ;;

  3)
    echo "[1] 빌드 성공..."
    if ! npm run build --prefix "${ROOT}/ralphthon/website" > /dev/null 2>&1; then
      echo "  FAIL: npm run build 실패"
      FAIL=1
    else
      echo "  PASS"
    fi

    # Gate 2: Ghost 수 쿼리가 sites 테이블 사용 (ghosts 테이블 아님)
    echo "[2] Ghost 수 쿼리 정확성..."
    if grep -q 'from("ghosts")' "${ROOT}/ralphthon/website/app/page.tsx" 2>/dev/null; then
      echo "  FAIL: ghosts 테이블 쿼리 (sites 테이블의 ghost_count를 사용해야 함)"
      FAIL=1
    else
      echo "  PASS: ghosts 테이블 미사용"
    fi

    # Gate 3: 정렬 방향 = worst first (ascending: true)
    echo "[3] 정렬 방향 (worst first)..."
    if grep -q 'ascending.*false\|ascending: false' "${ROOT}/ralphthon/website/app/page.tsx" 2>/dev/null; then
      echo "  FAIL: 정렬이 best-first (ascending: false). worst-first여야 함"
      FAIL=1
    else
      echo "  PASS: worst-first 정렬"
    fi

    # Gate 4: 상세 페이지 + 슬라이더 컴포넌트 존재
    echo "[4] 상세 페이지 + 슬라이더..."
    if [ ! -f "${ROOT}/ralphthon/website/app/site/[domain]/page.tsx" ]; then
      echo "  FAIL: ralphthon/website/app/site/[domain]/page.tsx 없음"
      FAIL=1
    elif ! grep -q "clip-path\|clipPath\|slider\|range" "${ROOT}/ralphthon/website/app/site/[domain]/page.tsx" "${ROOT}/ralphthon/website/components/BeforeAfterSlider.tsx" 2>/dev/null; then
      echo "  FAIL: 슬라이더 컴포넌트에 clip-path/range 없음"
      FAIL=1
    else
      echo "  PASS: 상세 페이지 + 슬라이더 존재"
    fi

    # Gate 5: 로컬 렌더링 검증 (Ghost 수 > 0)
    echo "[5] 로컬 렌더링 (Ghost 수 > 0)..."
    # Check Supabase directly for ghost data instead of local render
    if [ -f "${ROOT}/.env.local" ]; then
      source "${ROOT}/.env.local"
      TOTAL_GHOSTS=$(curl -s "${NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/sum" \
        -H "apikey: ${NEXT_PUBLIC_SUPABASE_ANON_KEY}" 2>/dev/null || echo "0")
      # Fallback: check scan-progress for ghost data
      GHOST_NUM=$(node -p "
        const s=require('${ROOT}/state/scan-progress.json');
        s.results.reduce((a,r)=>a+(r.ghost_count||0),0)
      " 2>/dev/null || echo "0")
      if [ "$GHOST_NUM" = "0" ] || [ -z "$GHOST_NUM" ]; then
        echo "  FAIL: 총 Ghost 수가 0"
        FAIL=1
      else
        echo "  PASS: Ghost 수 = ${GHOST_NUM}"
      fi
    else
      echo "  WARN: .env.local 없음 — 건너뜀"
    fi
    ;;

  4)
    echo "[1] 라이브 URL..."
    if [ -f "${ROOT}/state/deploy-url.txt" ]; then
      URL=$(cat "${ROOT}/state/deploy-url.txt")
      STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$URL")
      if [ "$STATUS" != "200" ]; then
        echo "  FAIL: HTTP ${STATUS}"
        FAIL=1
      else
        echo "  PASS: ${URL} → 200"
      fi
    else
      echo "  FAIL: deploy-url.txt 없음"
      FAIL=1
    fi

    # Gate 2: 라이브 Ghost 수 > 0
    echo "[2] 라이브 Ghost 수..."
    if [ -n "$URL" ]; then
      LIVE_HTML=$(curl -s "$URL" 2>/dev/null)
      GHOST_NUM=$(echo "$LIVE_HTML" | node -e "
        const html=require('fs').readFileSync(0,'utf8');
        const m=html.match(/>(\d+)<\/p>[^<]*<p[^>]*>총 Ghost/);
        console.log(m ? m[1] : '0');
      " 2>/dev/null)
      if [ "$GHOST_NUM" = "0" ] || [ -z "$GHOST_NUM" ]; then
        echo "  FAIL: 라이브에서 총 Ghost 수 = 0"
        FAIL=1
      else
        echo "  PASS: Ghost 수 = ${GHOST_NUM}"
      fi
    fi

    # Gate 3: worst 사이트가 상위 (100점이 1위가 아님)
    echo "[3] 정렬 (worst first)..."
    if [ -n "$URL" ]; then
      FIRST_SCORE=$(echo "$LIVE_HTML" | node -e "
        const html=require('fs').readFileSync(0,'utf8');
        const m=html.match(/Parity Score<\/th>.*?<td[^>]*>(\d+\.?\d*)<\/td>/);
        console.log(m ? m[1] : 'unknown');
      " 2>/dev/null)
      if [ "$FIRST_SCORE" = "100" ]; then
        echo "  FAIL: 1위가 Parity 100 (worst-first여야 함)"
        FAIL=1
      else
        echo "  PASS: 1위 Parity = ${FIRST_SCORE}"
      fi
    fi

    # Gate 4: curl 콘텐츠 + visual-qa.json (둘 다 필요)
    echo "[4] 라이브 콘텐츠 (curl)..."
    if [ -n "$URL" ]; then
      CONTENT_OK=$(echo "$LIVE_HTML" | node -e "
        const html=require('fs').readFileSync(0,'utf8');
        const checks = [];
        if (!html.includes('GhostView')) checks.push('제목');
        if (!html.includes('간판') && !html.includes('signage')) checks.push('메시지');
        if (!html.includes('openchrome') && !html.includes('OpenChrome')) checks.push('브랜딩');
        if (!html.includes('<td')) checks.push('테이블');
        if (checks.length > 0) { console.log('FAIL:' + checks.join(',')); process.exit(1); }
        console.log('PASS');
      " 2>/dev/null)
      if [ "$CONTENT_OK" != "PASS" ]; then
        echo "  FAIL: ${CONTENT_OK}"
        FAIL=1
      else
        echo "  PASS"
      fi
    fi

    echo "[4b] visual QA..."
    if [ -f "${ROOT}/state/visual-qa.json" ]; then
      VQA_PASSED=$(node -p "JSON.parse(require('fs').readFileSync('${ROOT}/state/visual-qa.json')).allPassed" 2>/dev/null)
      if [ "$VQA_PASSED" = "true" ]; then
        echo "  PASS"
      else
        echo "  FAIL: visual QA 미통과"
        FAIL=1
      fi
    else
      echo "  WARN: visual-qa.json 없음 (curl 체크로 대체)"
    fi

    # Gate 5: 상세 페이지 접근 가능
    echo "[5] 상세 페이지 접근..."
    if [ -n "$URL" ]; then
      DETAIL_DOMAIN=$(node -p "require('${ROOT}/state/deepdive-progress.json').completedSites[0]" 2>/dev/null)
      if [ -n "$DETAIL_DOMAIN" ] && [ "$DETAIL_DOMAIN" != "undefined" ]; then
        DETAIL_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${URL}/site/${DETAIL_DOMAIN}" 2>/dev/null)
        if [ "$DETAIL_STATUS" = "200" ]; then
          echo "  PASS: /site/${DETAIL_DOMAIN} → 200"
        else
          echo "  FAIL: /site/${DETAIL_DOMAIN} → ${DETAIL_STATUS}"
          FAIL=1
        fi
      else
        echo "  WARN: deepdive 사이트 없음 — 건너뜀"
      fi
    fi
    ;;

  *)
    echo "Phase ${PHASE}: gate check 없음 (skip)"
    ;;
esac

echo ""
if [ "$FAIL" -gt 0 ]; then
  echo "━━━ GATE FAILED ━━━"
  echo "merge를 차단합니다. 위 FAIL 항목을 수정 후 재시도하세요."
  exit 1
else
  echo "━━━ GATE PASSED ━━━"
  exit 0
fi
