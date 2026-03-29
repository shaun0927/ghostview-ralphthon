# Phase 0: 인프라 셋업

## 진입 조건
`ralphthon/state/phase-gate.json`을 읽는다. `phase0`이 `"pending"`이면 실행한다.
`"complete"`이면 이 파일을 건너뛰고 Phase 1으로 진행한다.

## 목표
Supabase DB 테이블 생성 + Next.js 프로젝트 초기화 + Vercel 연결.
이 phase가 끝나면 빈 웹사이트가 라이브 상태여야 한다.

## 시간 예산: 30분

---

## Step 1: Supabase 스키마 생성

OpenChrome으로 Supabase 대시보드(https://supabase.com/dashboard)를 연다.
프로젝트의 SQL Editor에서 다음을 실행한다:

```sql
CREATE TABLE IF NOT EXISTS sites (
  id SERIAL PRIMARY KEY,
  url TEXT NOT NULL UNIQUE,
  domain TEXT NOT NULL,
  category TEXT,
  total_interactive INTEGER DEFAULT 0,
  ghost_count INTEGER DEFAULT 0,
  ambiguous_count INTEGER DEFAULT 0,
  duplicate_count INTEGER DEFAULT 0,
  parity_score NUMERIC(5,1) DEFAULT 100.0,
  scanned_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reports (
  id SERIAL PRIMARY KEY,
  site_id INTEGER REFERENCES sites(id),
  normal_screenshot_url TEXT,
  blackhole_screenshot_url TEXT,
  findings JSONB DEFAULT '[]',
  generated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_parity ON sites(parity_score ASC);
CREATE INDEX IF NOT EXISTS idx_ghosts ON sites(ghost_count DESC);
```

### 검증
SQL Editor에서 `SELECT count(*) FROM sites;`가 0을 반환하면 성공.

## Step 2: Supabase API 키 확인

프로젝트 Settings > API에서 다음 값을 확인한다:
- `SUPABASE_URL` (Project URL)
- `SUPABASE_ANON_KEY` (anon/public key)

`ralphthon/config/env.json`에 저장한다:
```json
{
  "SUPABASE_URL": "https://xxx.supabase.co",
  "SUPABASE_ANON_KEY": "eyJ..."
}
```

## Step 3: Next.js 프로젝트 생성

```bash
cd ralphthon && npx create-next-app@latest website --typescript --tailwind --app --no-src-dir --no-import-alias --yes
```

## Step 4: Supabase 클라이언트 설치

```bash
cd ralphthon/website && npm install @supabase/supabase-js
```

## Step 5: 환경변수 설정

`ralphthon/website/.env.local`에 작성:
```
NEXT_PUBLIC_SUPABASE_URL=<config/env.json의 SUPABASE_URL>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<config/env.json의 SUPABASE_ANON_KEY>
```

## Step 6: 최소 랜딩 페이지 작성

`ralphthon/website/app/page.tsx`에 다음 내용을 작성한다:
- 제목: "GhostView — 보이지 않는 웹을 보이게"
- 부제: "한국 웹사이트 접근성 리더보드"
- 현재 스캔된 사이트 수를 Supabase에서 실시간 쿼리 (`SELECT count(*) FROM sites`)
- 빈 테이블 (아직 데이터 없음)

`ralphthon/website/lib/supabase.ts`에 Supabase 클라이언트를 생성한다:
```typescript
import { createClient } from '@supabase/supabase-js'
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)
```

## Step 7: 로컬 빌드 확인

```bash
cd ralphthon/website && npm run build
```

exit 0이면 성공.

## Step 8: Vercel 배포

```bash
cd ralphthon/website && vercel deploy --prod --yes
```

배포 URL을 `ralphthon/state/deploy-url.txt`에 저장한다.

## Step 9: 라이브 확인

```bash
curl -s -o /dev/null -w "%{http_code}" $(cat ralphthon/state/deploy-url.txt)
```

200이면 성공.

## 단계별 검증 (각 Step 완료 후 즉시 실행)

### Step 1 검증: Supabase 테이블
```bash
curl -s "<SUPABASE_URL>/rest/v1/sites?select=count" \
  -H "apikey: <SUPABASE_ANON_KEY>" \
  -H "Accept: application/json"
```
- 성공: HTTP 200 + JSON 응답 (빈 배열 OK)
- 실패 시: SQL 재실행. 3회 실패 → Supabase 대시보드에서 수동 확인 요청

### Step 2 검증: API 키
```bash
test -f ralphthon/config/env.json && node -e "const c=require('./ralphthon/config/env.json'); if(!c.SUPABASE_URL||!c.SUPABASE_ANON_KEY) process.exit(1)"
```
- 성공: exit 0
- 실패 시: Supabase 대시보드 Settings > API 재확인

### Step 3-4 검증: Next.js 프로젝트
```bash
test -f ralphthon/website/package.json && node -e "const p=require('./ralphthon/website/package.json'); if(!p.dependencies['@supabase/supabase-js']) process.exit(1)"
```
- 성공: exit 0
- 실패 시: `npm install @supabase/supabase-js` 재실행

### Step 5 검증: 환경변수
```bash
grep -q "NEXT_PUBLIC_SUPABASE_URL" ralphthon/website/.env.local
```
- 성공: exit 0
- 실패 시: .env.local 재작성

### Step 7 검증: 빌드
```bash
cd ralphthon/website && npm run build 2>&1 | tail -5
```
- 성공: "Compiled successfully" 또는 exit 0
- 실패 시: 에러 메시지 읽기 → 코드 수정 → 재빌드 (최대 3회)

### Step 9 검증: 배포
```bash
curl -s -o /dev/null -w "%{http_code}" $(cat ralphthon/state/deploy-url.txt)
```
- 성공: 200
- 실패 시: `vercel deploy --prod --yes` 재시도

## 완료 조건

모든 검증 통과 시 `phase-gate.json`의 `phase0`을 `"complete"`로 업데이트.
