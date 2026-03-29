# Phase 2: Deep Dive

## 진입 조건
`ralphthon/state/phase-gate.json`을 읽는다. `phase1`이 `"complete"`이고 `phase2`가 `"pending"` 또는 `"in_progress"`이면 실행한다.
`ralphthon/state/deepdive-progress.json`을 읽는다. `cursor > 0`이면 그 위치부터 재개한다.

## 목표
Phase 1에서 가장 접근성이 나쁜 20개 사이트를 선별하여:
- replaceChild 방식의 before/after 스크린샷 캡처
- 슬라이더 리포트 HTML 생성
- 스크린샷을 Supabase Storage에 업로드
- findings를 Supabase `reports` 테이블에 INSERT

## 시간 예산: 1시간 하드컷

---

## Step 1: 최악 20개 사이트 선별

Supabase에서 쿼리:
```sql
SELECT url, domain, ghost_count, parity_score
FROM sites
WHERE ghost_count > 0
ORDER BY parity_score ASC
LIMIT 20
```

또는 `scan-progress.json`의 results를 parity_score 오름차순 정렬하여 상위 20개 선택.

결과를 `deepdive-progress.json`의 `targetSites`에 저장.

## Step 2: 각 사이트 Deep Dive (사이트당 ~3분)

### 2a. Navigate + Lazy Loading 트리거

```
mcp__openchrome__navigate: url=<site.url>
```

navigate 성공 후, 페이지를 빠르게 스크롤하여 lazy loading 트리거:
```
batch_execute: script="(() => {
  return new Promise(resolve => {
    let y = 0; const step = 800; const maxY = document.body.scrollHeight;
    const interval = setInterval(() => {
      y += step; window.scrollTo(0, y);
      if (y >= maxY) { clearInterval(interval); window.scrollTo(0, 0);
        setTimeout(() => resolve('loaded'), 500); }
    }, 150);
  });
})()"
```

### 2b. Ghost 감지 + 밀집 viewport 자동 탐색

```
batch_execute: script="(() => {
  const ghosts = Array.from(document.querySelectorAll(
    'img:not([alt]):not([role=\"presentation\"]):not([role=\"none\"]),img[alt=\"\"]'
  )).filter(e => e.width > 30 && e.height > 30 && e.offsetWidth > 0);
  const positions = ghosts.map(e => Math.round(e.getBoundingClientRect().top + window.scrollY));
  const viewH = window.innerHeight;
  let bestY = 0, bestCount = 0;
  for (let y = 0; y <= document.body.scrollHeight - viewH; y += 200) {
    const count = positions.filter(p => p >= y && p < y + viewH).length;
    if (count > bestCount) { bestCount = count; bestY = y; }
  }
  return JSON.stringify({ total: ghosts.length, bestY, bestCount });
})()"
```

`bestY`로 스크롤:
```
batch_execute: script="window.scrollTo(0, <bestY>)"
```

### 2c. 정상 스크린샷

```
mcp__openchrome__page_screenshot: tabId=<id>, path="/tmp/gv-<domain>-normal.png"
```

### 2d. replaceChild 블랙홀 적용

```
batch_execute: script="(() => {
  let n = 0;
  const replace = (img) => {
    const hole = document.createElement('div');
    hole.className = 'gv-replaced';
    hole.style.cssText = 'width:'+img.offsetWidth+'px;height:'+img.offsetHeight+'px;background:#111;display:flex;align-items:center;justify-content:center;border:2px solid #333;border-radius:4px';
    hole.innerHTML = '<span style=\"color:#555;font:900 28px system-ui\">?</span>';
    img.parentNode.replaceChild(hole, img);
    n++;
  };
  Array.from(document.querySelectorAll('img:not([alt]):not([role=\"presentation\"]):not([role=\"none\"])')).filter(e => e.width > 4 && e.height > 4 && e.offsetWidth > 0).forEach(replace);
  Array.from(document.querySelectorAll('img[alt=\"\"]')).filter(e => e.offsetWidth > 10 && e.offsetHeight > 10).forEach(replace);
  return n;
})()"
```

### 2e. 블랙홀 스크린샷

```
mcp__openchrome__page_screenshot: tabId=<id>, path="/tmp/gv-<domain>-blackhole.png"
```

### 2f. Findings 생성 (LLM 판단)

정상 스크린샷과 블랙홀 스크린샷을 비교하여 findings를 생성한다.
각 finding은 다음 구조:
```json
{
  "severity": "ghost",
  "title": "한국어 제목",
  "elementInfo": "<img> x N",
  "description": "한국어 설명",
  "impact": "한국어 임팩트",
  "fix": {"label": "수정 방법", "code": "<img alt=\"설명\">"}
}
```

### 2g. Supabase 업로드

1. 스크린샷을 Supabase Storage에 업로드:
```bash
curl -X POST "<SUPABASE_URL>/storage/v1/object/screenshots/<domain>-normal.png" \
  -H "apikey: <KEY>" -H "Content-Type: image/png" \
  --data-binary @/tmp/gv-<domain>-normal.png
```

2. reports 테이블에 INSERT:
```bash
curl -X POST "<SUPABASE_URL>/rest/v1/reports" \
  -H "apikey: <KEY>" -H "Content-Type: application/json" \
  -d '{"site_id": N, "normal_screenshot_url": "...", "blackhole_screenshot_url": "...", "findings": [...]}'
```

### 2h. Checkpoint

`deepdive-progress.json` 업데이트:
```json
{
  "cursor": <현재 인덱스>,
  "completed": <완료 수>,
  "completedSites": ["dcinside.com", "..."],
  "lastSavedAt": "<ISO timestamp>"
}
```

## 반복

Step 2를 targetSites 전체(최대 20개)에 대해 반복.
사이트당 3분 × 20 = 60분.

## 단계별 검증 (사이트마다 실행)

### 스크린샷 검증
```bash
test -f /tmp/gv-<domain>-normal.png && test -f /tmp/gv-<domain>-blackhole.png && \
  node -e "
    const fs=require('fs');
    const n=fs.statSync('/tmp/gv-<domain>-normal.png').size;
    const b=fs.statSync('/tmp/gv-<domain>-blackhole.png').size;
    if(n<10000) { console.error('normal too small: '+n); process.exit(1) }
    if(b<10000) { console.error('blackhole too small: '+b); process.exit(1) }
    if(Math.abs(n-b)<100) { console.error('WARNING: identical files, blackhole may not have worked'); process.exit(1) }
    console.log('OK: normal='+n+' blackhole='+b+' diff='+(n-b))
  "
```
- 성공: 두 파일 존재, 각 10KB 이상, 서로 다름
- 실패 (identical): replaceChild가 동작하지 않음 → 해당 사이트의 이미지가 모두 alt 있음 → skip 처리
- 실패 (too small): 스크린샷 재캡처

### Supabase 업로드 검증
```bash
curl -s "<SUPABASE_URL>/rest/v1/reports?site_id=eq.<SITE_ID>&select=id" \
  -H "apikey: <KEY>"
```
- 성공: 1개 이상의 report 반환
- 실패 시: INSERT 재시도

### Deep Dive 품질 검증 (Phase 2 완료 시)
```bash
node -e "
  const d=require('./ralphthon/state/deepdive-progress.json');
  console.log('Completed: '+d.completed+'/'+d.targetSites.length);
  console.log('Sites: '+d.completedSites.join(', '));
  if(d.completed < 5) { console.error('WARNING: fewer than 5 deep dives'); process.exit(1) }
"
```
- 성공: 5개 이상 deep dive 완료
- 경고 (5개 미만): 시간 부족으로 Phase 3 진행하되 경고 기록

## 완료 조건

모든 검증 통과 후 `phase2`를 `"complete"`로 업데이트:
- [ ] 최소 5개 사이트 deep dive 완료
- [ ] 각 사이트의 스크린샷 2장(normal/blackhole)이 서로 다름
- [ ] Supabase reports 테이블에 데이터 존재
- 시간 초과 시: completed 수와 무관하게 Phase 3으로 진행
