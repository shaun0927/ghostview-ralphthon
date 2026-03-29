# Phase 4: 배포

## 진입 조건
`ralphthon/state/phase-gate.json`을 읽는다. `phase3`이 `"complete"`이고 `phase4`가 `"pending"`이면 실행한다.

## 목표
Phase 3에서 빌드된 웹사이트를 Vercel에 배포하여 라이브 URL을 확보한다.

## 시간 예산: 15분 하드컷

---

## Step 1: 환경변수 확인

`ralphthon/config/env.json`을 읽어 SUPABASE_URL과 SUPABASE_ANON_KEY가 있는지 확인.
`ralphthon/website/.env.local`이 올바른지 확인.

## Step 2: Vercel 배포

```bash
cd ralphthon/website && vercel deploy --prod --yes
```

배포 URL을 `ralphthon/state/deploy-url.txt`에 저장.

Vercel에 환경변수 설정이 필요하면:
```bash
vercel env add NEXT_PUBLIC_SUPABASE_URL production < <(echo "<URL>")
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production < <(echo "<KEY>")
vercel deploy --prod --yes
```

## Step 3: 라이브 검증

```bash
curl -s -o /dev/null -w "%{http_code}" $(cat ralphthon/state/deploy-url.txt)
```

200이면 성공.

## Step 4: 기능 검증 (OpenChrome)

OpenChrome으로 배포된 URL을 열고 확인:
1. 리더보드 페이지가 로드되는가?
2. 사이트 수가 표시되는가?
3. Deep Dive가 있는 사이트의 상세 페이지에서 슬라이더가 동작하는가?

## 폴백

### Vercel CLI 실패 시
```bash
cd ralphthon/website && npx serve out/ -l 3000 &
npx ngrok http 3000
```
ngrok URL을 deploy-url.txt에 저장.

### 빌드 자체가 없는 경우 (Phase 3 폴백)
정적 HTML 파일이 있다면:
```bash
cd ralphthon/output && npx serve . -l 3000 &
npx ngrok http 3000
```

## 완료 조건

다음 충족 시 `phase4`를 `"complete"`로 업데이트:
- [ ] 라이브 URL이 HTTP 200 반환
- [ ] 리더보드에 스캔 데이터가 표시됨

## 단계별 검증

### 배포 검증
```bash
URL=$(cat ralphthon/state/deploy-url.txt)
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$URL")
if [ "$STATUS" != "200" ]; then echo "FAIL: HTTP $STATUS"; exit 1; fi
echo "OK: $URL returns 200"
```

### 데이터 표시 검증 (OpenChrome)
OpenChrome으로 배포 URL을 열고:
```
batch_execute: script="document.querySelectorAll('table tr, [class*=site], [class*=card]').length"
```
- 성공: 10개 이상의 사이트 항목이 렌더링됨
- 실패 시: Supabase 연결 확인, 환경변수 확인

### 슬라이더 검증 (Deep Dive 페이지)
OpenChrome으로 상세 페이지를 열고:
```
batch_execute: script="document.querySelectorAll('input[type=range]').length"
```
- 성공: 1개 이상의 range input (슬라이더) 존재
- 실패 시: 상세 페이지 코드 확인

## 최종 검증 (모든 Phase 완료 후)

전체 파이프라인의 성공을 확인하는 최종 테스트:

```bash
echo "=== Ralphthon Final Verification ==="

# 1. 라이브 URL
URL=$(cat ralphthon/state/deploy-url.txt)
echo "1. Deploy URL: $URL"
curl -s -o /dev/null -w "   HTTP: %{http_code}\n" "$URL"

# 2. Supabase 데이터
echo "2. Supabase data:"
curl -s "<SUPABASE_URL>/rest/v1/sites?select=count" \
  -H "apikey: <KEY>" -H "Accept: application/vnd.pgrst.object+json" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log('   Sites: '+JSON.parse(d).count))"
curl -s "<SUPABASE_URL>/rest/v1/reports?select=count" \
  -H "apikey: <KEY>" -H "Accept: application/vnd.pgrst.object+json" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log('   Reports: '+JSON.parse(d).count))"

# 3. 로컬 상태
echo "3. Local state:"
node -e "const g=require('./ralphthon/state/phase-gate.json');Object.entries(g).filter(([k])=>k.startsWith('phase')).forEach(([k,v])=>console.log('   '+k+': '+v))"
node -e "const s=require('./ralphthon/state/scan-progress.json');console.log('   Scanned: '+s.completed+' OK / '+s.blocked+' blocked / '+s.failed+' failed')"
node -e "const d=require('./ralphthon/state/deepdive-progress.json');console.log('   Deep dives: '+d.completed+' ('+d.completedSites.join(', ')+')')"

echo "=== Verification Complete ==="
```

## 최종 출력

```
ralphthon/state/phase-gate.json:
{
  "phase0": "complete",
  "phase1": "complete",
  "phase2": "complete",
  "phase3": "complete",
  "phase4": "complete",
  "completedAt": "<ISO timestamp>"
}

ralphthon/state/deploy-url.txt:
https://ghostview-kr.vercel.app
```

모든 phase가 `"complete"` + 최종 검증 통과 → Ralphthon 파이프라인 완료.
