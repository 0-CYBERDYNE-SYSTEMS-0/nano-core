# User Testing

Testing surface, required testing skills/tools, and resource cost classification.

## Validation Surface

This mission has ONE surface: **CLI terminal script**.

- Tool: `tuistory` for running the migration script and inspecting terminal output
- The migration script is invoked via: `npx tsx scripts/migrate-to-nanocore.ts [flags]`
- No HTTP endpoints, no browser testing needed

## Resource Cost Classification

- Single migration script process, lightweight
- No concurrent processes needed
- Memory: ~100MB per run
- CPU: minimal
- Max concurrent validators: 5

## Validation Concurrency

| Surface | Max Concurrent | Notes |
|---------|---------------|-------|
| CLI terminal (tuistory) | 5 | Lightweight, file-ops only. Isolation via --target-workspace/--target-env temp dirs. |

## Flow Validator Guidance: CLI Terminal

### Isolation Rules
- ALWAYS use `--target-workspace <tmpdir>` and `--target-env <tmpdir>/.env` to isolate output
- NEVER modify real user files (~/nano/, ~/.config/fft_nano/, real .env)
- Source configs at ~/.openclaw/, ~/.hermes/ are REAL user data - do not delete or move them
- For tests requiring source config creation (clawdbot, moltbot), create in ~/.config/clawdbot/ and ~/.moltbot/
- For tests requiring source config removal, use `HOME=<tmpdir>` env var override instead of deleting real files. This makes detectSources() check temp paths. Example: `HOME=$(mktemp -d) npx tsx scripts/migrate-to-nanocore.ts --source auto ...`

### Key Paths
- OpenClaw: `~/.openclaw/openclaw.json` (EXISTS - real data)
- Clawdbot: `~/.config/clawdbot/config.json` (may not exist)
- Moltbot: `~/.moltbot/moltbot.json` (may not exist)
- Hermes: `~/.hermes/config.yaml` (EXISTS - real data, symlink to service-config/)
- Report output: `--output-dir <tmpdir>` (default creates nested dir, specify flat path)

### Known Frictions
- Mission worker cannot rm/mv real user files - blocks tests requiring hiding existing sources
- OpenClaw real config has SOUL.md in workspace/ subdirectory, not at source root - script skips it
- Hermes config.yaml is a symlink to service-config/config.yaml which has different structure (no channels/llm)
- report.json output path: when using --output-dir, report is placed directly in that dir (not nested by source/timestamp)

### Script Exit Codes
- 0: Success
- 1: Error (invalid source type via Zod, source not found, no sources found, multiple sources with auto)
