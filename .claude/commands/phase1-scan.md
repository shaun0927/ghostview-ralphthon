# Phase 1: Mass Scan

## 진입 조건
`ralphthon/state/phase-gate.json`을 읽는다. `phase0`이 `"complete"`이고 `phase1`이 `"pending"` 또는 `"in_progress"`이면 실행한다.
`ralphthon/state/scan-progress.json`을 읽는다. `cursor > 0`이면 그 위치부터 재개한다.

## 목표
`ralphthon/config/sites-kr.json`의 사이트 목록을 순회하며 ghost 감지 결과를 수집한다.
결과는 Supabase `sites` 테이블에 실시간 INSERT한다.

## 시간 예산: 2시간 30분 하드컷

---

## Step 0: 사이트 리스트 수집 (자동)

`ralphthon/config/sites-kr.json`이 없으면 자동 생성한다.
있으면 이 단계를 건너뛴다.

### 수집 방법: Tranco Top Sites
```bash
curl -L "https://tranco-list.eu/top-1m.csv.zip" -o /tmp/tranco.csv.zip
unzip -o /tmp/tranco.csv.zip -d /tmp/
```

### 한국 도메인 필터링 + 카테고리 분류
Node 스크립트를 작성하여 실행한다:
```
1. /tmp/top-1m.csv 읽기 (rank,domain 형식)
2. .kr 도메인 추출 + 한국 주요 글로벌 도메인 추가 (naver.com, daum.net, kakao.com 등)
3. 상위 3,000개 선택
4. 도메인 키워드로 카테고리 자동 분류:
   - .go.kr, .or.kr → government
   - .ac.kr → education
   - news, daily, times, ilbo → news
   - shop, store, market, mall → commerce
   - 기타 → general
5. JSON 배열로 ralphthon/config/sites-kr.json 저장
```

### Tranco 실패 시 폴백
1. Tranco API `https://tranco-list.eu/api/lists/date/latest`로 최신 list ID 확인 후 재시도
2. 그래도 실패 시: OpenChrome으로 `https://www.similarweb.com/top-websites/south-korea/` 스크래핑
3. 최후 수단: PLAN.md Appendix A의 수동 목록 참조

### 사이트 리스트 형식

`ralphthon/config/sites-kr.json`:
```json
[
  {"url": "https://www.naver.com", "domain": "naver.com", "category": "portal"},
  ...
]
```

## 스캔 루프

각 사이트에 대해:

### 1. Navigate
```
mcp__openchrome__navigate: url=<site.url>
```
실패 시 → `{blocked: true}` 기록, 다음 사이트로.

### 2. Detection (batch_execute)
```
mcp__openchrome__batch_execute: tasks=[
  {tabId, workerId: "interactive", script: "document.querySelectorAll('a[href],button,input:not([type=\"hidden\"]),select,textarea,[role=\"button\"],[role=\"link\"],[role=\"tab\"],[role=\"menuitem\"],[role=\"checkbox\"],[role=\"radio\"],[onclick],[tabindex=\"0\"]').length"},
  {tabId, workerId: "ghost_imgs", script: "Array.from(document.querySelectorAll('img:not([alt]):not([role=\"presentation\"]):not([role=\"none\"])')).filter(e=>e.width>4&&e.height>4&&e.offsetWidth>0).length"},
  {tabId, workerId: "ghost_btns", script: "Array.from(document.querySelectorAll('button')).filter(e=>!e.textContent.trim()&&!e.getAttribute('aria-label')&&!e.getAttribute('title')&&!e.querySelector('img[alt]')).length"},
  {tabId, workerId: "ghost_links", script: "Array.from(document.querySelectorAll('a[href]')).filter(e=>e.offsetWidth>0&&!e.textContent.trim()&&!e.getAttribute('aria-label')&&!e.getAttribute('title')&&!e.querySelector('img[alt]')).length"},
  {tabId, workerId: "empty_alt", script: "Array.from(document.querySelectorAll('img[alt=\"\"]')).filter(e=>e.offsetWidth>10).length"},
  {tabId, workerId: "dup_labels", script: "Array.from(document.querySelectorAll('[aria-label]')).filter(e=>e.offsetWidth>0).map(e=>e.getAttribute('aria-label')).filter((v,i,a)=>a.filter(x=>x===v).length>=3).length"}
]
```

### 3. 결과 계산
```
ghost_count = ghost_imgs + ghost_btns + ghost_links + empty_alt
parity_score = ((interactive - ghost_count) / interactive) * 100
```

### 4. Supabase INSERT
`batch_execute`로 페이지 내에서 직접 Supabase REST API를 호출하거나,
로컬에서 `curl` 또는 node 스크립트로 INSERT한다:

```bash
curl -X POST "<SUPABASE_URL>/rest/v1/sites" \
  -H "apikey: <SUPABASE_ANON_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"url":"...","domain":"...","category":"...","total_interactive":N,"ghost_count":N,"parity_score":N}'
```

### 5. Checkpoint (50사이트마다)

`ralphthon/state/scan-progress.json` 업데이트:
```json
{
  "cursor": <현재 인덱스>,
  "completed": <성공 수>,
  "failed": <실패 수>,
  "blocked": <차단 수>,
  "totalSites": <전체 수>,
  "lastSavedAt": "<ISO timestamp>"
}
```

### 6. 진행률 출력 (50사이트마다)
```
[Phase 1] 250/3000 (8.3%) | 238 OK | 7 blocked | 5 failed | ETA: 1h 52m
```

## 브라우저 관리

- **200사이트마다** 현재 탭을 닫고 새 탭을 연다 (메모리 누수 방지)
- navigate 실패 시 3초 대기 후 1회 재시도, 재실패 시 skip

## 시간 초과 처리

2시간 30분 경과 시:
1. 현재 스캔 즉시 중단
2. scan-progress.json 최종 저장
3. `phase-gate.json`의 `phase1`을 `"complete"`로 업데이트
4. Phase 2로 진행

## 완료 조건

다음 중 하나 충족 시 `phase1`을 `"complete"`로 업데이트:
- [ ] 전체 사이트 스캔 완료
- [ ] completed >= 1000 AND 시간 초과
- [ ] 시간 초과 (completed 수와 무관하게 Phase 2로 진행)

## 단계별 검증

### Step 0 검증: 사이트 리스트 생성 완료
```bash
test -f ralphthon/config/sites-kr.json && node -e "const s=require('./ralphthon/config/sites-kr.json'); if(!Array.isArray(s)||s.length<100) process.exit(1); console.log(s.length+' sites')"
```
- 성공: 100개 이상의 사이트 출력
- 실패 시: Tranco 폴백 방법 시도

### 스캔 중간 검증 (50사이트마다)

**로컬 데이터 무결성:**
```bash
node -e "const s=require('./ralphthon/state/scan-progress.json'); if(s.completed+s.failed+s.blocked!==s.cursor) { console.error('MISMATCH: cursor='+s.cursor+' but sum='+(s.completed+s.failed+s.blocked)); process.exit(1) } console.log('OK: '+s.cursor+' processed')"
```

**Supabase 데이터 동기화:**
```bash
curl -s "<SUPABASE_URL>/rest/v1/sites?select=count" \
  -H "apikey: <KEY>" -H "Accept: application/vnd.pgrst.object+json" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const n=JSON.parse(d).count;const local=require('./ralphthon/state/scan-progress.json').completed;if(Math.abs(n-local)>50){console.error('DB DRIFT: db='+n+' local='+local);process.exit(1)}console.log('OK: db='+n+' local='+local)})"
```
- 성공: DB와 로컬 차이 50 이내
- 실패 시: 누락분 재INSERT

### 스캔 결과 품질 검증 (Phase 1 완료 시)
```bash
node -e "
const s=require('./ralphthon/state/scan-progress.json');
const rate = s.completed / (s.completed + s.failed + s.blocked);
const avgScore = s.results && s.results.length > 0
  ? s.results.reduce((a,r)=>a+r.parity_score,0)/s.results.length : 0;
console.log('Success rate: '+(rate*100).toFixed(1)+'%');
console.log('Avg parity: '+avgScore.toFixed(1)+'%');
console.log('Total: '+s.completed+' OK / '+s.blocked+' blocked / '+s.failed+' failed');
if(rate < 0.5) { console.error('WARNING: >50% failure rate'); process.exit(1) }
"
```
- 성공: success rate > 50%
- 실패 시: 차단 패턴 분석 → User-Agent 변경 또는 사이트 리스트 필터링

## Step 7: Scan Verification (verify-fix cycle)

스캔 루프 완료 후, 결과 품질을 FP 검증으로 확인한다.

### 검증 흐름
```
1. gv_verify(count=5, mode='pick') 호출 → 무작위 5개 사이트 + FP 검증 쿼리
2. 각 사이트에 OpenChrome navigate → batch_execute로 FP 쿼리 실행
3. gv_verify(mode='analyze', results=JSON.stringify(collectedResults)) → FP 분석
4. FP 발견 시:
   a. ghost-detect.js 쿼리 수정 (해당 FP 조건 보완)
   b. FP 사이트 재스캔
   c. 재검증 (최대 3회 반복)
5. FP 0 또는 3회 반복 후 → state/verify-results.json 저장
```

### FP 조건 (False Positive)
| 조건 | 설명 |
|------|------|
| alt가 있는 이미지 | `img[alt]`인데 altlessImages에 잡힘 |
| aria-label이 있는 버튼/링크 | label이 있는데 unnamed으로 잡힘 |
| 숨겨진 요소 | `display:none` / `visibility:hidden` / `opacity:0` |
| 비대화형 요소 | interactive가 아닌데 카운트됨 |

### 검증 결과 저장
`state/verify-results.json`:
```json
{
  "timestamp": "...",
  "sitesVerified": 5,
  "totalFalsePositives": 0,
  "sites": [...]
}
```

### 검증 실패 처리
- 1회 FP 발견 → ghost-detect.js 쿼리 수정 → 재검증
- 2회 FP 발견 → 다른 접근법 시도 → 재검증
- 3회 FP 발견 → 결과 기록, 수동 리뷰 필요로 표시

## 실패 시 복구

- scan-progress.json의 cursor부터 재개
- 새 Claude Code 세션에서도 이 파일을 읽으면 자동 재개
- 특정 step에서 3회 연속 실패 시 해당 사이트 skip하고 failures.json에 기록
