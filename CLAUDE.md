# GhostView — 보이지 않는 웹을 보이게

AI가 보는 웹과 사람이 보는 웹의 차이를 시각화하는 접근성 감사 도구.

## Issue 실행 프로토콜

"Issue #N을 실행해줘"라는 지시를 받으면 아래 전체 사이클을 **빠짐없이** 완료한다.
중간에 멈추지 않는다. PR을 열고 끝내는 것이 아니라 **merge까지 완료**한다.

### 전체 사이클 (3 커맨드)

```bash
# Step 1: 스크립트가 이슈 읽기 + 라벨 변경 + 브랜치 생성 (결정적)
./scripts/issue-start.sh <N>

# Step 2: AI가 코드 작성 + 검증 (지능 필요)
# - 이슈 본문의 설명에 따라 구현
# - PLAN.md Appendix 참조하여 스펙대로 작성
# - 이슈의 "검증 명령" 블록을 실행
# - 실패 시 수정 → 재검증 (최대 3회)

# Step 3: 스크립트가 커밋 + PR + 머지 + 이슈종료 + 언블록 (결정적)
./scripts/issue-finish.sh <N>
```

**이 순서를 반드시 지킨다. Step 1과 3은 스크립트가 강제한다. AI는 Step 2만 담당한다.**

### Context 압축 후 복구

context가 압축되면 즉시 `gv_status` 도구를 호출하여 현재 상태를 복원한다.
이벤트 로그(`state/events.jsonl`)가 진실의 원천이다.

### 연속 실행

`gv_finish` 호출 후 반환값의 `nextReady`를 확인한다.
다음 ready 이슈가 있으면 `gv_start`로 즉시 시작한다.
사용자가 "멈춰"라고 할 때까지 반복한다.

```
gv_start(1) → AI 코드 작성 → gv_finish(1) → nextReady: #2
  → gv_start(2) → AI 코드 작성 → gv_finish(2) → nextReady: #3
  → gv_start(3) → ... 반복
```

### 검증 실패 시
```
1회 실패 → 에러 읽기 → 수정 → 재검증
2회 실패 → 다른 접근법 시도 → 재검증
3회 실패 → 이슈에 코멘트로 실패 원인 기록 → 사용자에게 보고 → 중단
```

## Phase 기반 실행

`PLAN.md`를 읽고 `state/phase-gate.json`에서 현재 phase를 확인한 후
해당 phase의 `.claude/commands/phase{N}-*.md`를 실행한다.

## 환경변수 복구 (결정적 — issue-start.sh가 자동 처리)

`issue-start.sh` Step 0이 자동으로 처리한다. AI가 별도 작업할 필요 없음.
```
.env.local 있음 → 통과
config/env.json 있음 → .env.local 자동 생성 → 통과
둘 다 없음 → supabase CLI로 자동 복구 → config/env.json + .env.local 생성 → 통과
supabase CLI 실패 → exit 1 (supabase login 필요)
```
**사용자에게 키를 요청하지 않는다. 스크립트가 supabase CLI로 직접 가져온다.**

## Guard Rails

- **DO NOT** skip gv_verify after scanning. 스캔 후 반드시 FP 검증 실행.
- **DO NOT** merge with incomplete data (parity_score 누락 = gate fail).
- **DO NOT** bypass verify-gate.sh. issue-finish.sh가 자동으로 호출하며, 실패 시 merge 차단.
- **DO** use OpenChrome MCP tools for all browser interactions. CDP 직접 스크립트를 만든 경우에도 gv_verify로 결과 품질을 반드시 검증.
- **DO** re-run gv_verify after every scan batch (20사이트 스캔 후가 아니라 최종 스캔 완료 후).

## Build & Test

```bash
npm install && npm run build
```

## PR Target Branch

모든 PR은 `develop` branch를 타겟으로 한다. Release merge는 develop → main.

## Code Quality

- 소스 코드, 커밋 메시지는 English
- 설명, 이슈, 리포트 내용은 Korean
