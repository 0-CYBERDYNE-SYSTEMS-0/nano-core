# TODOS.md — nano-core: Farm-Specific Strip + Full Telgram/p UX Merge

## Strategy

Start from nano-core `foundation-work` (Phase 0, clean state).
Source of truth for all Telegram/p UX code = local FFT_nano clone (`/tmp/FFT_nano`).
Goal = become identical to FFT_nano main in all capabilities, minus farm-specific code which lives in a profile.

**Approach:** Clone FFT_nano → use as reference for what needs to exist.
Work in nano-core by: (a) copying missing files from FFT_nano, (b) editing nano-core files to match FFT_nano, (c) deleting farm-specific code.

---

## PHASE 0 — Safety Baseline

- [x] Already confirmed: nano-core `foundation-work` is clean (no uncommitted changes)
- [x] Already confirmed: FFT_nano cloned at `/tmp/FFT_nano`
- [ ] Create backup branch snapshot: `git branch backup-foundation-work-$(date +%Y%m%d)`

---

## PHASE 1 — Farm-Specific Source Files (DELETE from nano-core)

Delete these files entirely — they are farm-specific, not domain-agnostic:

- [ ] `src/farm-action-gateway.ts`
- [ ] `src/farm-state-collector.ts`
- [ ] `src/home-assistant.ts`
- [ ] `src/app.ts`

---

## PHASE 2 — Farm-Specific Skills (DELETE from nano-core)

Delete farm-specific runtime skills:

- [ ] `skills/runtime/fft-farm-bootstrap/` (entire dir)
- [ ] `skills/runtime/fft-farm-onboarding/` (entire dir)
- [ ] `skills/runtime/fft-farm-ops/` (entire dir)
- [ ] `skills/runtime/fft-dashboard-ops/` (entire dir)
- [ ] `skills/runtime/fft-farm-autonomy/` (entire dir)
- [ ] `skills/runtime/fft-farm-validate/` (entire dir)

**NOTE:** Keep `skills/runtime/fft-coder-ops/`, `skills/runtime/fft-setup/`, `skills/runtime/fft-telegram-ops/`, `skills/runtime/fft-debug/` — these are operational tooling, not farm-domain.

---

## PHASE 3 — Farm-Specific Config & Env Vars (EDIT)

In `src/config.ts`, remove farm-specific exports:

- [ ] `FARM_MODE`
- [ ] `FARM_STATE_ENABLED`
- [ ] `FARM_STATE_DIR`
- [ ] `FARM_PROFILE_PATH`
- [ ] `FARM_STATE_FAST_MS`, `FARM_STATE_MEDIUM_MS`, `FARM_STATE_SLOW_MS`
- [ ] `HA_URL`, `HA_URL_CANDIDATES`, `HA_TOKEN`
- [ ] `FFT_DASHBOARD_REPO_PATH`
- [ ] `FEATURE_FARM` reference

---

## PHASE 4 — Farm-Specific Scripts & Docs (DELETE)

- [ ] `docs/FARM_ONBOARDING.md`
- [ ] `scripts/farm-bootstrap.sh`
- [ ] `scripts/farm-demo.sh`
- [ ] `scripts/farm-onboarding.sh`
- [ ] `scripts/farm-validate.sh`

---

## PHASE 5 — Missing Telegram/p UX Files (COPY from FFT_nano → nano-core)

These files exist in FFT_nano, missing or incomplete in nano-core. Copy directly:

| Source | Dest | Description |
|---|---|---|
| `src/telegram-commands.ts` | `src/telegram-commands.ts` | Full command dispatcher + 30+ panel callbacks |
| `src/telegram-streaming.ts` | `src/telegram-streaming.ts` | Block/draft/persistent streaming delivery |
| `src/chat-preferences.ts` | `src/chat-preferences.ts` | Per-chat prefs: model, think, reasoning, verbosity |
| `src/telegram-command-spec.ts` | `src/telegram-command-spec.ts` | Command registry + help text |
| `src/verbose-mode.ts` | `src/verbose-mode.ts` | Verbose mode cycling logic |
| `src/app-state.ts` | `src/app-state.ts` | Global singleton state + typed maps |
| `src/telegram-attachments.ts` | `src/telegram-attachments.ts` | Media attachment handling |
| `src/runtime/boundary-ipc.ts` | `src/runtime/boundary-ipc.ts` | Host↔container IPC boundary |
| `src/runtime/host-events.ts` | `src/runtime/host-events.ts` | Host event bus for TUI/container |

---

## PHASE 6 — Files Needing EDIT (align with FFT_nano)

These exist in both but differ. Review diff and update nano-core to match FFT_nano:

| File | Action |
|---|---|
| `src/index.ts` | Major edit: add Telegram command wiring, streaming, panel callbacks; remove farm imports |
| `src/telegram.ts` | Minor edit: add `isTelegramPrivateChatJid` function (missing) |
| `src/tui/gateway-server.ts` | Diff review: may need additional adapters |
| `src/web/control-center-server.ts` | Diff review: FFT_nano has ~40 more lines |
| `src/cron/service.ts` | Diff review: imports differ (pi-runner vs container-runner) |
| `src/coding-delegation.ts` | Diff review: may need additional routing |
| `src/onboard-cli.ts` | Edit: remove farm onboarding wizard sections |
| `src/doctor.ts` | Edit: remove farm health check sections |
| `src/task-scheduler.ts` | Edit: remove farm state tick registration |
| `src/config.ts` | Edit: already covered in Phase 3 |

---

## PHASE 7 — GRAFT IN from nano-core

These nano-core additions get preserved — they are good architecture:

- [ ] `src/profile-storage.ts` — profile manifest loader (keep)
- [ ] `src/profile-cli.ts` — profile management CLI (keep)
- [ ] `src/container-runner.ts` — container runtime (keep; FFT_nano uses pi-runner)
- [ ] `src/telegram-draft-ipc.ts` — draft IPC (keep; newer than FFT_nano's approach)
- [ ] `PROFILE_GUIDE.md` — profile creation guide (keep)
- [ ] `skills/runtime/` — 31 industry-agnostic skills from nano-core (keep all)

---

## PHASE 8 — Verify

After each phase, run:

```bash
npm run typecheck   # TypeScript compilation
npm run validate:skills   # Skill metadata validation
```

After all phases:

```bash
npm run build       # Production build
npm test           # Tests
git diff --stat    # Show what changed
```

---

## PHASE 9 — Commit + Push

- One commit per phase (small, reversible)
- Commit message format: `phase(N): description`
- Final commit: `feat: farm-agnostic core complete — full Telegram/p UX parity with FFT_nano`
- Push to `foundation-work`
- Open PR: `foundation-work → main` (or merge directly if clean)

---

## DECISION POINTS (flagged but proceeding with defaults)

- **container-runner vs pi-runner:** Keeping nano-core's `container-runner.ts` (1,429 lines) as-is. FFT_nano uses pi-runner. These are different abstractions — nano-core's is profile-aware.
- **nano-core `index.ts` vs FFT_nano `index.ts`:** Will graft FFT_nano's Telegram command/streaming logic into nano-core's index.ts rather than replacing wholesale. Smaller diff, lower risk.
- **Farm skills location:** FFT_nano's `fft-farm-*` skills will be moved to a new `fft-farm` profile repo, not bundled in core.
- **Branch:** Working on `foundation-work`. Backup branch created before Phase 1 begins.
