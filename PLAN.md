# Ralphthon Execution Plan

## Mission

AI 에이전트가 이 문서만 읽고 4-5시간 내에 다음을 완료한다:
1. 한국 3,000개 사이트 GhostView 접근성 스캔
2. 최악 20개 사이트 Deep Dive 리포트 (before/after 슬라이더)
3. 리더보드 웹사이트 빌드 + Supabase DB 연동
4. Vercel 배포 → 라이브 URL

## Harness Engineering 원칙

```
상태는 파일에. 대화 메모리에 의존하지 않는다.
각 phase 명령 파일의 첫 줄 = "상태 파일 읽고 재개".
시간 하드컷 → 불완전해도 다음 단계로.
```

---

## Phase 구조

| Phase | 명령 파일 | 시간 예산 | Gate (다음 단계 조건) |
|-------|----------|----------|---------------------|
| 0 | `phase0-infra.md` | 30min | Supabase 테이블 생성됨, Vercel 프로젝트 존재 |
| 1 | `phase1-scan.md` | 2h 30min | Gate: completed >= 1000 (or timeout), perf: 20 sites <= 3min (100 sites <= 15min), FP: gv_verify pass (FP 0), UPSERT: no duplicates on re-scan |
| 2 | `phase2-deepdive.md` | 1h | `state/deepdive-progress.json` completed >= 10 |
| 3 | `phase3-website.md` | 45min | `npm run build` exit 0 |
| 4 | `phase4-deploy.md` | 15min | 라이브 URL HTTP 200 |

## 실행 방법

```
1. ralphthon/state/phase-gate.json 읽기
2. 첫 번째 "pending" phase 찾기
3. 해당 phase의 .claude/commands/phase{N}-*.md 실행
4. phase 내 각 step 완료 후 verify 명령 실행
5. verify 실패 시 → fix → 같은 step 재시도 (최대 3회)
6. 3회 실패 시 → 실패 원인을 state/failures.json에 기록하고 다음 step으로
7. gate 조건 충족 시 phase-gate.json 업데이트
8. 다음 phase로 진행
9. 모든 phase "complete" → 최종 검증 실행
```

## Scan Verification Loop (verify-fix cycle)

Phase 1 스캔 완료 후, `gv_verify` 도구로 결과 품질을 검증한다:

```
1. gv_verify(count=5, mode='pick') → 무작위 5개 사이트 + FP 검증 쿼리 반환
2. 각 사이트에 OpenChrome으로 접속 → batch_execute로 FP 쿼리 실행
3. gv_verify(mode='analyze', results=...) → FP 분석 결과 반환
4. FP 발견 시 → ghost-detect.js 쿼리 수정 → 재스캔 → 재검증 (최대 3회)
5. FP 0 달성 시 → state/verify-results.json에 결과 저장
```

### FP 검출 조건
- img에 alt 속성이 있는데 ghost로 잡힘
- button/link에 aria-label이 있는데 ghost로 잡힘
- display:none / visibility:hidden 요소가 ghost로 잡힘
- 실제 interactive 아닌 요소가 카운트됨

## 자기 검증 원칙

```
모든 step은 실행 → 검증 → (실패 시) 수정 → 재검증 루프를 따른다.
검증은 사람이 아닌 코드가 한다. 시각적 확인 금지.
검증 결과는 파일에 기록한다 (state/verify-log.json).
```

## 검증 프로토콜

모든 step은 **실행 → 검증 → (실패 시) 수정 → 재검증** 루프를 따른다.

### 검증 기록
각 검증 결과를 `state/verify-log.json`에 누적 기록한다:
```json
[
  {"phase": 0, "step": 1, "check": "supabase_table", "result": "pass", "at": "..."},
  {"phase": 1, "step": 0, "check": "site_list_count", "result": "fail", "error": "only 42 sites", "at": "..."},
  {"phase": 1, "step": 0, "check": "site_list_count", "result": "pass", "detail": "2847 sites", "at": "..."}
]
```

### 실패 처리 규칙
```
같은 검증이 1회 실패 → 에러 읽기 → 수정 → 재검증
같은 검증이 2회 실패 → 다른 접근법 시도 → 재검증
같은 검증이 3회 실패 → state/failures.json에 기록 → 해당 step skip → 다음으로
phase 전체 skip 불가. 폴백 경로를 반드시 실행.
```

### Phase별 핵심 검증 요약

| Phase | 핵심 검증 | 자동 검증 방법 |
|-------|----------|--------------|
| 0 | Supabase 테이블 존재 | `curl REST API → HTTP 200` |
| 0 | Vercel 배포 라이브 | `curl deploy-url → HTTP 200` |
| 1 | 사이트 리스트 >= 100개 | `node -e "require(sites).length >= 100"` |
| 1 | 스캔 데이터 무결성 | `cursor === completed + failed + blocked` |
| 1 | 성능: 100사이트 <= 15분 | `state/perf-log.json totalMs <= 900000` |
| 1 | FP 검증 통과 | `gv_verify → FP 0` |
| 1 | UPSERT 중복 없음 | re-scan후 results.length 불변 |
| 1 | DB 동기화 | `Supabase count ≈ local completed` |
| 2 | 스크린샷 쌍 존재 + 서로 다름 | `fs.statSync 크기 비교` |
| 2 | Deep dive >= 5개 | `deepdive-progress.completed >= 5` |
| 3 | 빌드 성공 | `npm run build exit 0` |
| 3 | 페이지 렌더링 | `curl localhost → HTML 크기 > 1KB` |
| 4 | 라이브 URL 200 | `curl deploy-url → 200` |
| 4 | 데이터 표시 | `OpenChrome → DOM 요소 count > 10` |

## 시간 하드컷 규칙

- Phase 0: 30분 초과 시 → 수동 개입 요청 후 Phase 1로 진행
- Phase 1: 2시간 30분 초과 시 → 스캔 중단, 현재 결과로 Phase 2 진행
- Phase 2: 1시간 초과 시 → 완료된 리포트만으로 Phase 3 진행
- Phase 3: 45분 초과 시 → 빌드 실패 시 정적 HTML 폴백
- Phase 4: 15분 초과 시 → Vercel 실패 시 `npx serve` + ngrok 폴백

## 상태 파일 스키마

### state/phase-gate.json
```json
{
  "phase0": "pending",
  "phase1": "pending",
  "phase2": "pending",
  "phase3": "pending",
  "phase4": "pending",
  "startedAt": null,
  "completedAt": null
}
```

### state/scan-progress.json
```json
{
  "cursor": 0,
  "completed": 0,
  "failed": 0,
  "blocked": 0,
  "totalSites": 0,
  "lastSavedAt": null,
  "results": []
}
```

### state/deepdive-progress.json
```json
{
  "cursor": 0,
  "completed": 0,
  "targetSites": [],
  "completedSites": [],
  "lastSavedAt": null
}
```

## 사전 준비 체크리스트 (대회 전)

```
□ config/sites-kr.json 준비 (Tranco 필터링, 최소 3000개 한국 도메인)
□ Supabase 프로젝트 생성 + SUPABASE_URL, SUPABASE_KEY 확보
□ Vercel 계정 + vercel CLI 로그인 완료
□ Chrome에 Supabase/Vercel 로그인 상태 확인
□ OpenChrome 설정 (`npx openchrome-mcp setup` — 권한 프롬프트 자동 허용)
□ OpenChrome 연결 확인 (mcp__openchrome__navigate 테스트)
□ ghostview/scripts/*.js 최신 상태 확인
□ 이 PLAN.md의 드라이런 1회 완료 (50사이트 + 3사이트 deepdive)
```

## 드라이런 프로토콜

대회 전에 최소 1회 전체 파이프라인 드라이런:
```
목표: 50사이트 스캔 → 3사이트 deepdive → 웹사이트 빌드 → 배포
시간: 1시간 이내
검증: 라이브 URL에서 리더보드 + 상세 페이지 확인
실패 시: 실패 원인 기록 → 명령 파일 수정 → 재시도
```

드라이런 성공 = 대회 준비 완료. 드라이런 실패 = 명령 파일 수정 필요.

## 에러 복구

| 상황 | 복구 방법 |
|------|----------|
| OpenChrome 연결 끊김 | `npx openchrome-mcp` 재시작 후 현재 phase 재개 |
| 브라우저 크래시 | Chrome 재시작, scan-progress.json cursor부터 재개 |
| 컨텍스트 압축 | 새 대화 시작, PLAN.md 읽기 → phase-gate.json 확인 → 재개 |
| Supabase 오류 | API 키 확인, 테이블 존재 확인 후 재시도 |
| Vercel 배포 실패 | `vercel deploy` 재시도, 실패 시 ngrok 폴백 |
| 사이트 봇 차단 | skip 처리 (blocked++), 다음 사이트로 |
| 시간 초과 | 현재 phase 즉시 중단, 다음 phase로 강제 전환 |

---

## Appendix A: 사이트 리스트 수집 스펙

Phase 1의 첫 단계로 AI가 실행한다. 하드코딩 금지.

### 방법: Tranco Top Sites 필터링
```
1. curl https://tranco-list.eu/top-1m.csv.zip → /tmp/tranco.csv.zip
2. unzip → top-1m.csv (rank,domain 형식)
3. .kr 도메인 필터: grep "\.kr$" 또는 한국 주요 도메인 포함
4. 상위 3,000개 추출
5. 각 도메인에 https:// 접두사 추가
6. 카테고리 자동 분류 (도메인 키워드 기반):
   - .go.kr, .or.kr → government
   - .ac.kr, .edu → education
   - news, daily, times → news
   - shop, store, market → commerce
   - 기타 → general
7. ralphthon/config/sites-kr.json으로 저장
```

### 출력 형식
```json
[
  {"url": "https://www.naver.com", "domain": "naver.com", "category": "portal"},
  ...
]
```

### Tranco 다운로드 실패 시 폴백
1. Tranco API: `curl https://tranco-list.eu/api/lists/date/latest`로 list ID 확인
2. `curl https://tranco-list.eu/download/<id>/1000000` 시도
3. 그래도 실패 시: Alexa/Similarweb 한국 Top Sites 페이지를 OpenChrome으로 스크래핑
4. 최후 수단: Chrome 방문 기록에서 수집 (`mcp__openchrome__storage`)

---

## Appendix B: 감지 스크립트 스펙

`ghostview/scripts/ghost-detect.js`가 이미 존재한다. 없으면 아래 스펙으로 재생성.

### 3-Level 감지 모델

**Level 1 — GHOST (완전 누락)**
기계가 존재 자체를 모르는 요소. 다음 CSS 셀렉터로 감지:

| 타입 | 셀렉터 | 필터 조건 |
|------|--------|----------|
| 이름 없는 링크 | `a[href]` | `!textContent.trim() && !aria-label && !title && !img[alt]` |
| 이름 없는 버튼 | `button` | `!textContent.trim() && !aria-label && !title` |
| 이름 없는 입력 | `input:not([type=hidden])` | `!aria-label && !title && !placeholder && !label[for]` |
| 역할 없는 클릭 | `[onclick],[tabindex=0]` | 시맨틱 태그 아님 && `!role` |
| alt 없는 이미지 | `a img, button img` | `!alt && 부모에 !aria-label` |

**Level 2 — AMBIGUOUS (라벨 있지만 무의미)**
| 타입 | 감지 방법 |
|------|----------|
| 무의미한 alt | `img[alt]`에서 alt 값이 image/photo/icon/logo/banner/placeholder 등 |
| 짧은 라벨 | `[aria-label]`에서 값이 2자 이하 |
| 일반적 라벨 | `[aria-label]`에서 값이 click here/link/button 등 |

**Level 3 — DUPLICATE (같은 라벨 3개 이상)**
| 타입 | 감지 방법 |
|------|----------|
| 중복 라벨 그룹 | `[aria-label]` 중 같은 값이 3회 이상 반복되는 고유 라벨 수 |
| 중복 라벨 요소 | 해당 라벨을 가진 전체 요소 수 |

### 모든 쿼리 규칙
- 단일 JS 표현식 (세미콜론 없음, IIFE 가능)
- `batch_execute`로 실행 (javascript_tool은 IIFE 반환값 깨짐)
- `offsetWidth > 0` 필터로 보이지 않는 요소 제외
- 결과는 `.length` (카운트) 또는 `JSON.stringify([...])` (상세)

---

## Appendix C: 오버레이 & 블랙홀 스펙

`ghostview/scripts/ghost-overlays.js`가 이미 존재한다. 없으면 아래 스펙으로 재생성.

### 두 가지 모드

**1. Overlay 모드 (개발자/분석용)**
- `position:absolute` div를 `document.body`에 추가
- `getBoundingClientRect() + window.scrollX/Y`로 위치 계산
- 카테고리별 색상: ghost=#ef4444, ambiguous=#f97316, duplicate=#eab308
- 클래스: `.gv-overlay`
- 제거: `.gv-overlay` 전체 remove

**주의: CSS stacking context 때문에 실제 이미지 위에 렌더링 안 될 수 있음. 분석용으로만 사용.**

**2. Blackhole 모드 (프레젠테이션/리포트용) — replaceChild 방식**
- `img.parentNode.replaceChild(hole, img)`로 실제 DOM 교체
- 교체 div: `background:#111; border:2px solid #333; display:flex; align-items:center; justify-content:center`
- 내부: `<span style="color:#555;font:900 28px system-ui">?</span>`
- 크기: 원본 이미지의 `offsetWidth × offsetHeight` 유지
- **비가역적** — 정상 스크린샷을 먼저 캡처한 후 실행해야 함
- 페이지 리로드(navigate)로 원복

### 스크린샷 캡처 순서 (필수)
```
1. 밀집 viewport 자동 탐색 (ghost 이미지 Y좌표 버킷팅 → 최다 영역)
2. 해당 Y로 스크롤
3. page_screenshot → normal.png (정상)
4. replaceChild 실행
5. page_screenshot → blackhole.png (블랙홀)
6. navigate(같은 URL) → DOM 원복
```

---

## Appendix D: 리포트 생성기 스펙

`ghostview/scripts/report.js`가 이미 존재한다. 없으면 아래 스펙으로 재생성.

### 입력: report-data.json
```json
{
  "url": "https://example.com",
  "timestamp": "2026-03-28 12:00:00 UTC",
  "totalInteractive": 280,
  "parityScore": 86.1,
  "confusionScore": 54.6,
  "categories": { "ghost": 39, "ambiguous": 3, "duplicate": 85, "clear": 153 },
  "heroScreenshot": "data:image/png;base64,...",
  "heroBlackhole": "data:image/png;base64,...",
  "findings": [
    {
      "severity": "ghost|ambiguous|duplicate",
      "title": "한국어 제목",
      "elementInfo": "<img> x 38",
      "description": "한국어 설명",
      "screenshots": { "normal": "data:...", "ghost": "data:..." },
      "screenshotCaption": "캡션",
      "codeCompare": {
        "human": { "label": "사람이 보는 것", "html": "..." },
        "machine": { "label": "AI가 보는 것", "html": "..." }
      },
      "impact": "한국어 임팩트",
      "fix": { "label": "수정 방법", "code": "<img alt=\"...\">" }
    }
  ]
}
```

### 출력: 자체 완결 HTML
- 다크 테마 (--bg:#0a0a0a, --card:#141414, --text:#fafafa)
- 히어로: heroBlackhole 존재 시 clip-path 슬라이더 (Human View ↔ AI View)
- 스코어 카드: Perception Parity(%), AI Confusion Score(%)
- 카테고리 바: ghost(빨강) + ambiguous(주황) + duplicate(노랑) + clear(초록)
- Finding 카드: severity badge, split-view 슬라이더, code compare, impact, fix + Copy 버튼
- 슬라이더 동작: `<input type=range>` → `--split` CSS변수 → `clip-path: inset(0 0 0 var(--split))`

### CLI 실행
```bash
node ghostview/scripts/report.js <report-data.json> [output.html]
```

---

## Appendix E: OpenChrome 도구 사용 규칙

이 세션에서 검증된 도구별 제약과 해결책:

| 도구 | 제약 | 해결 |
|------|------|------|
| `javascript_tool` | IIFE `(() => {...})()` 반환값 `{}` | `batch_execute` 사용 |
| `javascript_tool` | 세미콜론 in 문자열 깨짐 | `batch_execute` 사용 |
| `computer screenshot` | base64 추출 불가 (시각 확인용) | `page_screenshot` 사용 |
| `page_screenshot` | path 생략 시 base64 반환 | 리포트 임베딩에 활용 |
| `page_screenshot` | clip 파라미터로 영역 크롭 | 섹션별 스크린샷에 활용 |
| `page_screenshot` | fullPage:true로 전체 페이지 | JPEG q50 ~1MB |
| overlay (position:absolute) | CSS stacking context에 막힘 | replaceChild 사용 |
| replaceChild | 비가역적 (DOM 파괴) | 정상 스크린샷 먼저 캡처 |
| lazy loading | JS가 alt 동적 추가 | 감지는 빠르게, 또는 스크롤 후 재감지 |

### batch_execute 사용법
```
mcp__openchrome__batch_execute: tasks=[
  { "tabId": "<id>", "workerId": "이름", "script": "JS 표현식 또는 IIFE" }
]
```
- IIFE 정상 작동
- 병렬 실행 (concurrency 기본값 10)
- 각 task의 결과가 workerId로 구분되어 반환

### 병렬 멀티탭 스캔 패턴 (gv_scan_batch)

3000사이트를 2.5시간에 처리하기 위한 최적화 패턴:

**핵심: 1사이트 = 1 batch_execute call (6개 쿼리가 아닌 1개 combined query)**

```
1. gv_scan_batch(mode='prepare', batchSize=5, cursor=0)
   → 다음 5개 사이트 + combined ghost query 반환

2. tabs_create로 5개 탭 생성

3. 각 탭에 navigate (순차, ~1초/사이트)

4. batch_execute: 5개 탭에 combined query 동시 실행
   tasks = sites.map(s => ({tabId: s.tabId, workerId: 'scan_'+s.domain, script: combinedQuery}))
   → 5개 사이트 결과 동시 수집

5. 결과 파싱 → gv_scan_batch(mode='save', results=JSON.stringify(parsed))
   → scan-progress.json 자동 업데이트

6. 탭 닫기 → cursor 전진 → 반복

7. 200사이트마다 전체 탭 닫고 새로 열기 (메모리 관리)
```

**성능 목표:**
| 패턴 | 사이트/초 | 3000사이트 예상 |
|------|----------|----------------|
| 순차 (기존) | ~0.03 | ~25시간 |
| 단일탭 최적화 | ~0.2 | ~4시간 |
| 5탭 병렬 | ~1.0 | ~50분 |

**Checkpoint 간격:** 20사이트마다 (DB + scan-progress.json 동시 저장)

---

---

## Appendix F: 라이브 스캔 기능 스펙

### /scan 페이지 — "내 사이트 지금 검사"

사용자가 URL을 입력하면 서버에서 Puppeteer로 실시간 스캔하여 결과를 반환한다.
**LLM 호출 없이, ghost-detect 쿼리만으로 동작한다.**

#### API: POST /api/scan
```
요청: { url: "https://example.com" }
응답: {
  url, domain, parityScore, ghostCount,
  categories: { ghost, ambiguous, duplicate, clear },
  totalInteractive,
  normalScreenshot: "data:image/png;base64,...",
  blackholeScreenshot: "data:image/png;base64,...",
  findings: [
    { severity, title, description, elementInfo, fix: { label, code } }
  ]
}
```

#### 서버 구현
```
Vercel Serverless Function:
  puppeteer-core + @sparticuz/chromium (Vercel용 경량 Chrome)
  1. chromium.executablePath()로 Chrome 시작
  2. page.goto(url) → 페이지 로드
  3. page.evaluate(combinedGhostQuery) → ghost 카운트
  4. page.screenshot() → 정상 스크린샷 (base64)
  5. page.evaluate(replaceChildScript) → 블랙홀 적용
  6. page.screenshot() → 블랙홀 스크린샷 (base64)
  7. findings 템플릿 생성 (LLM 없이):
     - ghost_images > 0 → "alt 없는 이미지 N개"
     - ghost_links > 0 → "이름 없는 링크 N개"
     - ghost_buttons > 0 → "이름 없는 버튼 N개"
     - duplicate_labels > 0 → "중복 라벨 N개"
  8. 결과 반환
  소요: ~10초
```

#### 클라이언트 (/scan 페이지)
```
UI 흐름:
  1. URL 입력 폼 + "스캔 시작" 버튼
  2. 로딩 애니메이션 (진행 상태 표시)
  3. 결과 카드: Parity Score, Ghost 수, 카테고리 바
  4. Before/After 슬라이더 (clip-path, 드래그 가능)
     - 슬라이더 핸들이 이미지 위에 absolute 배치
     - 드래그 시 --split CSS 변수 업데이트
  5. Findings 목록: severity badge, 설명, fix 코드 + Copy 버튼
  6. "리더보드에 추가" 버튼 (Supabase INSERT)
```

#### 슬라이더 UX 요구사항
```
- 슬라이더(input[type=range])가 이미지 컨테이너 안에 absolute 배치
  position: absolute; top: 0; left: 0; width: 100%; height: 100%;
  opacity: 0; cursor: col-resize; z-index: 10;
- 중앙 핸들 바: position: absolute; width: 3px; background: white;
  top: 0; bottom: 0; left: var(--split, 50%); z-index: 5;
- 두 이미지 겹침: after 이미지에 clip-path: inset(0 0 0 var(--split));
- 드래그 시 onChange → setState → --split 업데이트
```

---

## Appendix G: 다국어 (i18n) 스펙

### 한국어/영어 전환
```
UI 요소:
  헤더에 🇰🇷/🇺🇸 토글 버튼
  기본: 한국어

번역 대상:
  - 제목, 부제, 통계 카드 라벨
  - 리더보드 컬럼명
  - 상세 페이지 섹션명
  - /scan 페이지 안내 문구
  - findings 설명 (한국어/영어 템플릿)

구현:
  간단한 dict 객체 (i18n 라이브러리 불필요)
  const t = locale === 'ko' ? ko : en;
  <h1>{t.title}</h1>

findings 번역 템플릿 (deep dive에서 생성 시 ko/en 모두 포함):
  ghost_images:
    ko: "Ghost 이미지: alt 속성 누락"
    en: "Ghost Images: Missing alt attribute"
  ghost_links:
    ko: "Ghost 링크: 접근 가능한 이름 없음"
    en: "Ghost Links: No accessible name"
  ghost_buttons:
    ko: "Ghost 버튼: 접근 가능한 이름 없음"
    en: "Ghost Buttons: No accessible name"
  ghost_inputs:
    ko: "Ghost 입력: 라벨 없음"
    en: "Ghost Inputs: No label"
  duplicate_labels:
    ko: "중복 라벨: 동일 이름 반복"
    en: "Duplicate Labels: Same name repeated"

  description, impact, fix.label도 ko/en 쌍으로 저장:
    findings: [{
      severity: "ghost",
      title: { ko: "Ghost 이미지: alt 속성 누락", en: "Ghost Images: Missing alt attribute" },
      description: { ko: "이미지에 alt 속성이 없어...", en: "Images lack alt attribute..." },
      fix: { code: '<img alt="description">', label: { ko: "수정 방법", en: "How to fix" } }
    }]

  렌더링: finding.title[locale] || finding.title
```

---

## Appendix I: 사이트 전면 메시지 스펙

### 히어로 섹션 — "왜 이것이 중요한가"

리더보드 위에 표시. 한/영 전환 지원.

**한국어:**
```
사람은 웹을 눈으로 봅니다. 이미지, 색상, 레이아웃으로 사이트를 이해합니다.

하지만 AI와 시각장애인은 다릅니다.
시각장애인이 사용하는 스크린 리더는 HTML의 '간판'만 읽습니다 — alt, aria-label, role.
AI 에이전트도 마찬가지입니다. 버튼의 색상이 아니라 '이름'을 봅니다.

간판이 없으면? AI에게 그 버튼은 존재하지 않습니다.
간판이 "image"라면? AI는 50개의 "image"를 구분할 수 없습니다.

현재 AI는 웹사이트를 시각장애인처럼 보고 있습니다.
GhostView는 그 차이를 보여줍니다.
```

**영어:**
```
Humans see the web with their eyes — images, colors, layouts.

But AI and screen readers are different.
They read 'signage' in HTML — alt, aria-label, role.
Not the color of a button, but its name.

No signage? The button doesn't exist for AI.
Signage says "image"? AI can't tell 50 "images" apart.

Right now, AI sees websites the way a blind person does.
GhostView reveals that gap.
```

### 디자인
- 리더보드 위, 다크 배경에 밝은 텍스트
- 핵심 문구 강조 (bold 또는 색상): "간판이 없으면", "존재하지 않습니다", "시각장애인처럼"
- 접을 수 있는 섹션 (첫 방문 시 열림, 이후 접힘)

---

## Appendix H: 브랜딩 스펙

### OpenChrome 크레딧
```
모든 페이지 하단 footer:
  "Made with OpenChrome" + OpenChrome 로고 이미지
  로고 URL: https://raw.githubusercontent.com/shaun0927/openchrome/main/assets/icon.png
  링크: https://github.com/shaun0927/openchrome

/about 페이지:
  "Powered by OpenChrome — Browser Automation MCP Server"
  OpenChrome GitHub 링크
  GhostView GitHub 링크: https://github.com/shaun0927/ghostview
```

---

## 최종 산출물

```
ghostview-chi.vercel.app
├── / (리더보드: worst-first, 정렬/필터, 한/영 전환)
├── /scan (라이브 스캔: URL 입력 → 실시간 결과 + 슬라이더)
├── /site/[domain] (상세: before/after 슬라이더, findings 전체, fix 코드)
├── /about (GhostView 설명, OpenChrome 크레딧)
└── footer: "Made with OpenChrome" + 로고 + GitHub 링크
```
