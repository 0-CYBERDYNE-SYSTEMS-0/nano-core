# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# nano-core — Project Instructions

## Architecture

Single Node.js host process: receives chat messages (Telegram/WhatsApp), runs `pi` (coding agent) as a subprocess, returns responses. SQLite for persistence.

### Message Flow

```
Telegram/WhatsApp → pipeline/message-dispatch-pipeline.ts → pi-runner.ts (spawns pi subprocess)
                                        ↓
                              HostEventBus (host-events.ts)
                                        ↓
                      streaming/telegram-adapter.ts / file-delivery.ts
```

- **Pipeline dispatcher** (`src/pipeline/pipeline-dispatcher.ts`): Routes requests to `ChatPipeline`, `CodingPipeline`, or `CronPipeline` based on run type.
- **Host-local delivery** (preview/final): `pi-runner.ts` emits `HostEvent`s on `hostEventBus` — never writes files for this path.
- **Cross-boundary IPC** (agent-authored actions): `pi` subprocess writes JSON to `messages/`, `tasks/`, `actions/`, `action_results/` directories; `startIpcWatcher()` in `index.ts` polls these.
- **Evaluator loop**: After agent completes, `evaluator.ts` runs a second `pi` pass to score output quality; verdict JSON must never leak to users (see `boundary-ipc.ts:isInternalEvaluatorVerdictText`).
- **Streaming subsystem** (`src/streaming/`): Platform-agnostic stream consumption with Telegram and WhatsApp adapters.
- **Heartbeat service** (`src/heartbeat-service.ts`): Periodic main-session check using `HEARTBEAT.md`.
- **Delivery outbox** (`src/outbox.ts`): At-least-once cron result delivery with deduplication.
- **Long-run service** (`src/long-run-service.ts`): Durable `agent_runs`; restart triage and `resumeRecoverableRuns()`.
- **Self-improvement signals** (`src/self-improve-signals.ts`): Deterministic lexical signal extraction for skill improvement.
- **Skill versioning** (`src/skill-history.ts`): `.history/` snapshots and `skill_rollback` support.
- **Cron service** (`src/cron/service.ts`): Drives scheduled tasks via SQLite, calls `runContainerAgent` and `runEvaluatorPass` directly.
- **Coding orchestrator** (`src/coding-orchestrator.ts`): Manages plan/execute worker routing for coding tasks; uses ephemeral worktrees and evaluator refinement loops.
- **Permission gate** (`src/permission-gate-policy.ts`): Blocks destructive bash commands for subagents or headless runs; `bash-guard.ts` classifies commands.
- **Memory subsystem**: Lexical search across transcript + document stores; `memory-backend.ts` is the unified facade; `memory-paths.ts` owns directory layout.
- **TUI** (`src/tui/`): Separate gateway server/client pair bridging the terminal UI to the host event bus over WebSocket.

### State Access Pattern

```typescript
import { state, activeChatRuns, hostEventBus } from './app-state.js';
// Reassignable vars live on `state` object (ESM compatibility)
// Maps: activeChatRuns.get(...), activeChatRuns.set(...)
```

## Development Workflow (Authoritative)

Use a two-checkout model:

1. Implement in the dev checkout/worktree (e.g. `nano-core-dev`).
2. Merge via PR to `origin/main`.
3. Fast-forward the runtime/release checkout on `main`.
4. Build and restart the installed launchd service from that `main` checkout.

- Dev-checkout path and service-checkout path being different is expected.
- Runtime debugging starts from the active service checkout (`.env`, logs, launchd state); fixes land in the dev checkout and are promoted via PR.

## Build & Test

```bash
npm run build                                    # TypeScript → dist/
npm run dev                                      # Run via tsx (no build step)
npm test                                         # All tests via node --test
npm run typecheck                                # Type-check without emitting

# Run a single test file
node --import tsx --test tests/<name>.test.ts

npm run format                                   # Prettier write
npm run format:check                             # Prettier check (CI)
npm run validate:skills                          # Validate pi skill manifests
npm run doctor                                   # Diagnose runtime env
```

## CI/CD (Required Gates)

Before release/tag promotion:

```bash
npm run release-check
npm run secret-scan
```

GitHub Actions:
- `.github/workflows/release-readiness.yml`: typecheck, tests, secret-scan, validate:skills, release-check
- `.github/workflows/skills-only.yml`: validate:skills for skills-only changes

## Key Files

| File | Role |
|---|---|
| `src/index.ts` | Orchestrator wiring (~2,100 lines): constructs services and `*Deps` objects |
| `src/app-state.ts` | All global mutable state, type definitions, `hostEventBus` singleton |
| `src/app.ts` | `main()`, startup/shutdown, `connectWhatsApp` |
| `src/pipeline/message-dispatch-pipeline.ts` | Primary message dispatch orchestrator |
| `src/pipeline/pipeline-dispatcher.ts` | Routes requests to Chat/Coding/Cron pipelines |
| `src/pi-runner.ts` | Agent subprocess spawning, runtime event emission, snapshots |
| `src/telegram-streaming.ts` | Visible Telegram preview registry and completion state |
| `src/telegram-commands.ts` | Telegram command handling, settings panels, callback queries |
| `src/telegram-delivery.ts` | Telegram delivery modes: append, draft, stream, off |
| `src/telegram-settings.ts` | Telegram settings management panel |
| `src/telegram-group-mgmt.ts` | Telegram group management |
| `src/runtime/host-events.ts` | `HostEventBus` — typed EventEmitter hub for host-local delivery |
| `src/runtime/boundary-ipc.ts` | Cross-boundary envelope parsing, evaluator verdict leak guard |
| `src/evaluator.ts` | Post-run quality scoring; verdict persistence |
| `src/coding-orchestrator.ts` | Plan/execute worker routing; ephemeral worktrees; evaluator refinement |
| `src/cron/service.ts` | Scheduled task execution engine |
| `src/long-run-service.ts` | Durable agent runs; restart triage + `resumeRecoverableRuns()` |
| `src/outbox.ts` | At-least-once delivery outbox with dedupe |
| `src/heartbeat-service.ts` | Periodic main-session heartbeat using `HEARTBEAT.md` |
| `src/memory-backend.ts` / `src/memory-search.ts` | Memory facade / lexical search |
| `src/memory-embeddings.ts` | Optional semantic re-ranking via Ollama embeddings |
| `src/skill-history.ts` | Skill version snapshots and rollback support |
| `src/self-improve-signals.ts` | Deterministic lexical signal extraction for skill improvement |
| `src/state-persistence.ts` | JSON snapshot persistence for crash recovery |
| `src/update-service.ts` | Self-update with stash/unstash for dirty checkouts |
| `src/web-control-center.ts` | Web dashboard server |
| `src/tui-coordination.ts` | TUI gateway coordination |
| `src/host-coordination.ts` | Host-level coordination service |
| `src/permission-gate-policy.ts` | Tool permission decisions for subagents/headless runs |
| `src/streaming/` | Platform-agnostic streaming adapters (Telegram, WhatsApp) |
| `src/config.ts` | All configuration constants and env var defaults |

## Completed Refactoring

The `index.ts` decomposition (8,030 → ~2,100 lines) and the host-local EventEmitter delivery migration are complete. The Agent Durability & Self-Improvement pass (resume, outbox, evaluator feedback, cron/subagent memory, semantic memory, skill versioning) is complete.

## Conventions

- ESM modules (`"type": "module"`); import paths use `.js` extensions.
- Tests in `tests/`, named `*.test.ts`. Run after every extraction step.
- `src/skills/` and `skills/` contain pi skill manifests; validate with `npm run validate:skills`.
- `config/runtime.parity.json` controls parity feature flags (`PARITY_CONFIG`).
- Git hooks in `hooks/` (pre-commit, pre-push) — do not bypass with `--no-verify`.
