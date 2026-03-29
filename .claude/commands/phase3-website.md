# Phase 3: 웹사이트 빌드

## 진입 조건
`ralphthon/state/phase-gate.json`을 읽는다. `phase2`가 `"complete"`이고 `phase3`이 `"pending"`이면 실행한다.

## 목표
Phase 0에서 생성한 Next.js 프로젝트에 리더보드 + 상세 페이지를 구현한다.
Supabase에 이미 데이터가 있으므로, 페이지가 데이터를 쿼리하여 렌더링하면 된다.

## 시간 예산: 45분 하드컷

---

## 사이트 요구사항

### 페이지 1: 랜딩/리더보드 (`app/page.tsx`)

**히어로 영역:**
- 제목: "GhostView"
- 부제: "AI가 보는 한국 웹 — 접근성 리더보드"
- 통계 카드 3개:
  - 스캔된 사이트 수 (`SELECT count(*) FROM sites`)
  - 평균 Perception Parity (`SELECT avg(parity_score) FROM sites`)
  - Ghost 총 개수 (`SELECT sum(ghost_count) FROM sites`)

**리더보드 테이블:**
- Supabase에서 `SELECT * FROM sites ORDER BY parity_score ASC`
- 컬럼: 순위, 도메인, 카테고리, Parity Score(%), Ghost 수, 상세 링크
- Parity Score에 따라 색상: <50% 빨강, 50-80% 주황, >80% 초록
- 정렬 가능 (parity_score, ghost_count)
- Deep Dive가 있는 사이트는 "상세 보기" 링크 표시

**디자인:**
- 다크 테마 (ghostview report.js의 color scheme 참조: --bg:#0a0a0a, --card:#141414, etc.)
- 모바일 반응형
- Tailwind CSS 사용

### 페이지 2: 사이트 상세 (`app/site/[domain]/page.tsx`)

**데이터 로드:**
```typescript
const { data: site } = await supabase.from('sites').select('*').eq('domain', domain).single()
const { data: report } = await supabase.from('reports').select('*').eq('site_id', site.id).single()
```

**렌더링:**
- 사이트 URL, Parity Score, Ghost 수
- before/after 슬라이더 (report.normal_screenshot_url, report.blackhole_screenshot_url)
  - CSS clip-path 방식: `ghostview/scripts/report.js`의 슬라이더 구현 참조
  - "Human View" / "AI View" 라벨
  - `<input type="range">` + `--split` CSS 변수로 슬라이더 동작
- findings 목록 (report.findings JSONB에서 렌더링)
  - severity badge (ghost/ambiguous/duplicate)
  - 한국어 제목, 설명, 임팩트
  - 수정 코드 + Copy 버튼

**report가 없는 경우:**
- "Deep Dive 리포트 없음. 기본 스캔 결과만 표시합니다."
- 스캔 메트릭만 표시

### 페이지 3: About (`app/about/page.tsx`)

- GhostView 설명 (PRD Section 1-2 요약)
- 3-Level 감지 방법론 (Ghost, Ambiguous, Duplicate)
- "Powered by OpenChrome + Claude" 크레딧
- GitHub 링크

## Supabase 클라이언트

`lib/supabase.ts`는 Phase 0에서 이미 생성됨. 없으면 생성:
```typescript
import { createClient } from '@supabase/supabase-js'
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)
```

## 빌드 검증

```bash
cd ralphthon/website && npm run build
```

exit 0이 아니면:
1. 에러 메시지 읽기
2. 수정
3. 재빌드
4. 3회 실패 시 → 정적 HTML 폴백 (ghostview/scripts/report.js 기반 단일 페이지)

## 완료 조건

다음 충족 시 `phase3`을 `"complete"`로 업데이트:
- [ ] `npm run build` exit 0
- [ ] 리더보드 페이지가 Supabase 데이터를 렌더링
- [ ] 상세 페이지가 슬라이더를 렌더링

## 단계별 검증

### Supabase 연동 검증
```bash
cd ralphthon/website && node -e "
  const {createClient}=require('@supabase/supabase-js');
  const c=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  c.from('sites').select('count').then(({data,error})=>{
    if(error){console.error('Supabase error:',error.message);process.exit(1)}
    console.log('OK: Supabase connected, sites count query works');
  })
" 2>&1
```
- 성공: "OK: Supabase connected"
- 실패 시: .env.local 확인, supabase.ts import 확인

### 빌드 검증
```bash
cd ralphthon/website && npm run build 2>&1 | tail -10
```
- 성공: exit 0
- 실패 시: 에러 읽기 → 수정 → 재빌드 (최대 3회)
- 3회 실패 시: 에러 패턴을 state/failures.json에 기록 → 폴백으로 전환

### 페이지 렌더 검증 (빌드 성공 후)
```bash
cd ralphthon/website && npx next start -p 3999 &
sleep 3

# 리더보드 페이지
curl -s http://localhost:3999/ | node -e "
  let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
    if(!d.includes('GhostView')){console.error('FAIL: landing page missing GhostView title');process.exit(1)}
    console.log('OK: landing page renders ('+d.length+' bytes)')
  })
"

# 상세 페이지 (deep dive가 있는 첫 번째 도메인)
DOMAIN=$(node -e "const d=require('../state/deepdive-progress.json');console.log(d.completedSites[0]||'none')")
if [ "$DOMAIN" != "none" ]; then
  curl -s "http://localhost:3999/site/$DOMAIN" | node -e "
    let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
      if(d.length<1000){console.error('FAIL: detail page too small');process.exit(1)}
      console.log('OK: detail page renders ('+d.length+' bytes)')
    })
  "
fi

kill %1 2>/dev/null
```
- 성공: 두 페이지 모두 렌더링, 적절한 크기
- 실패 시: 페이지 코드 수정 → 재빌드 → 재검증

## 폴백 (빌드 3회 실패 시)

Next.js 빌드가 반복 실패하면:
1. `ghostview/scripts/report.js`를 활용하여 정적 HTML 리더보드 생성
2. scan-progress.json 데이터를 HTML 테이블로 렌더링
3. deep dive HTML 파일들을 같은 디렉토리에 배치
4. 이 정적 파일들을 Phase 4에서 Vercel에 배포

### 폴백 검증
```bash
test -f ralphthon/output/index.html && node -e "
  const h=require('fs').readFileSync('ralphthon/output/index.html','utf8');
  if(h.length<5000){console.error('FAIL: fallback HTML too small');process.exit(1)}
  if(!h.includes('GhostView')){console.error('FAIL: missing title');process.exit(1)}
  console.log('OK: fallback HTML ('+h.length+' bytes)')
"
```
