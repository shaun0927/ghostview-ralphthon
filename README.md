# GhostView Ralphthon

**AI가 보는 웹과 사람이 보는 웹의 차이를 시각화하는 접근성 감사 도구.**

> 결정적 인프라가 비결정적 AI를 감싸는 하네스 엔지니어링 아키텍처.
> 약 3시간 만에 960개 사이트를 스캔하고, 웹사이트를 빌드하고, 배포까지 완료.

**[Live Site](https://ghostview-chi.vercel.app)** | **[Architecture Presentation](docs/presentation.html)**

---

## Overview

GhostView Ralphthon은 AI 에이전트(Claude Code)가 **자율적으로** 한국 웹사이트 960개의 접근성을 감사하고, 결과를 리더보드 웹사이트로 빌드/배포하는 프로젝트입니다.

핵심은 **하네스 엔지니어링** — AI가 코드만 짜고, 나머지(git, PR, 검증, 배포)는 스크립트가 강제하는 아키텍처입니다.

### Key Stats

| Metric | Value |
|--------|-------|
| 전체 소요 시간 | ~3시간 (12:10 ~ 15:00 KST) |
| 스캔 사이트 수 | 960개 |
| Phase 자동 완료 | 5/5 |
| 사람 개입 횟수 | 0회 |

---

## Harness Architecture

```
run-auto.sh  (External Supervisor — tmux)
┌─────────────────────────────────────────────────────────────┐
│ Claude Code CLI  (--dangerously-skip-permissions)           │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ CLAUDE.md + phase*.md  →  AI Agent (비결정적 코드 작성) │ │
│ │                    │               │               │    │ │
│ │  GhostView MCP     OpenChrome MCP   State Files        │ │
│ │  ┌──────────────┐  ┌──────────────┐ ┌────────────────┐ │ │
│ │  │ gv_start     │  │ navigate     │ │ phase-gate.json│ │ │
│ │  │ gv_finish    │  │ batch_execute│ │ events.jsonl   │ │ │
│ │  │ gv_resume    │  │ screenshot   │ │ scan-progress  │ │ │
│ │  │ gv_scan_batch│  │ tabs_create  │ │ verify-results │ │ │
│ │  │ gv_verify    │  │ query_dom    │ │ visual-qa.json │ │ │
│ │  └──────┬───────┘  └──────────────┘ └────────────────┘ │ │
│ │         │                                               │ │
│ │  Shell Scripts (결정적)        External Services        │ │
│ │  ┌──────────────────┐  ┌───────────────────────────┐   │ │
│ │  │ issue-start.sh   │  │ GitHub Issues (진실의 원천)│   │ │
│ │  │ issue-finish.sh  │  │ Supabase     (DB+Storage) │   │ │
│ │  │ verify-gate.sh   │  │ Vercel       (배포)       │   │ │
│ │  │ retry.sh         │  │ Chrome       (CDP)        │   │ │
│ │  └──────────────────┘  └───────────────────────────┘   │ │
│ └─────────────────────────────────────────────────────────┘ │
│ Monitor: 완료체크 | Phase진행감지 | 행감지(60초) | 세션재시작 │
└─────────────────────────────────────────────────────────────┘
```

### Core Principle: Deterministic / Non-Deterministic Separation

| Deterministic (Scripts) | Non-Deterministic (AI) |
|-------------------------|------------------------|
| Git branch / commit / push | Code implementation |
| GitHub label management | Accessibility detection algorithm |
| PR create / merge / issue close | Bug fixes (on gate failure) |
| Phase gate verification | Browser automation strategy |
| Environment variable recovery | Website UI/UX |

---

## 4-Layer Stack

### Layer 1: tmux Supervisor (`run-auto.sh`)
- Claude Code를 tmux 세션에서 실행하고 외부에서 감독
- **행 감지**: 60초간 출력 무변화 시 `"계속 진행해"` 자동 주입
- **Phase 진행 감지**: high-water mark 비교 → context overflow 시 세션 재시작
- **완료 체크**: `gh issue list --state closed`로 GitHub에서 직접 확인

### Layer 2: GhostView MCP Server
- 단 하나의 커스텀 MCP 서버가 shell 스크립트를 AI 도구로 노출
- `gv_start` → `issue-start.sh`, `gv_finish` → `issue-finish.sh`
- `gv_resume` → events.jsonl 읽어 재개 지점 결정
- `gv_scan_batch` → 배치 스캔 UPSERT 상태 관리

### Layer 3: OpenChrome MCP
- Chrome DevTools Protocol(CDP)로 브라우저 자동화
- `batch_execute`로 5~10개 탭 병렬 Ghost 탐지
- Puppeteer 직접 사용 금지 (`verify-gate.sh`에서 차단)

### Layer 4: Shell Scripts (Deterministic)
- `issue-start.sh`: env 복구 → 이슈 읽기 → 의존성 체크 → 브랜치 생성
- `issue-finish.sh`: 커밋 → Supabase 업로드 → **verify-gate.sh** → PR → 머지 → 언블록
- `verify-gate.sh`: Phase별 품질 게이트 (실패 시 머지 차단, 누적 검증)

---

## Phase Pipeline

| Phase | 내용 | Gate 조건 |
|-------|------|-----------|
| 0 — Infra | Supabase + Vercel 셋업 | DB 접속 가능, env 설정 완료 |
| 1 — Scan | 960개 사이트 배치 스캔 | 80%+ 완료, FP=0, Supabase 동기화 |
| 2 — Deep Dive | 상위 10개 사이트 상세 분석 | 리포트 >= 5, 스크린샷 페어 존재 |
| 3 — Build | Next.js 리더보드 빌드 | `npm run build` 성공 |
| 4 — Deploy | Vercel 배포 + Visual QA | HTTP 200, 13/13 QA 통과 |

### Execution Timeline

```
12:10  Phase 0 — Infrastructure (~15분)
12:25  Phase 1 — Mass Scan (~80분)
13:45  Phase 2 — Deep Dive (~30분)
14:15  Phase 3 — Website Build (~25분)
14:40  Phase 4 — Deploy & Visual QA (~20분)
15:00  Pipeline Complete ✓
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14, React 18, TailwindCSS, TypeScript |
| Database | Supabase (PostgreSQL + Storage) |
| Deployment | Vercel |
| MCP Server | @modelcontextprotocol/sdk, Zod |
| Browser Automation | OpenChrome MCP (CDP) |
| Orchestration | tmux, Bash scripts, GitHub CLI |
| AI Agent | Claude Code (Opus) |

## Ghost Detection Model

| Level | Name | Description |
|-------|------|-------------|
| 1 | **GHOST** | AI/스크린리더가 완전히 볼 수 없음 (alt 없는 이미지, 라벨 없는 버튼) |
| 2 | **AMBIGUOUS** | 라벨이 있지만 무의미함 (alt="image", aria-label="a") |
| 3 | **DUPLICATE** | 같은 라벨이 3회+ 반복 (구분 불가) |

**Parity Score** = (명확한 요소 수 / 전체 인터랙티브 요소 수) x 100%

---

## Build & Run

```bash
# Website
cd ralphthon/website && npm install && npm run build

# MCP Server
cd mcp && npm install && npm run build

# Full autonomous pipeline
./scripts/run-auto.sh
```

---

Built with [Claude Code](https://claude.ai/claude-code) + [oh-my-claudecode](https://github.com/anthropics/claude-code)
