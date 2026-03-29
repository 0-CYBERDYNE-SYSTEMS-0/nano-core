---
name: migration-worker
description: Builds and tests the nano-core migration script (migrate-to-nanocore.ts)
---

# Migration Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Features related to building the migration script: CLI infrastructure, source detection, data migration logic, skills migration, tests, and CLI integration.

## Required Skills

None.

## Work Procedure

### Step 1: Read Context
Read these files for full context:
- `mission.md` from missionDir
- `AGENTS.md` from missionDir
- `.factory/library/architecture.md`
- `.factory/library/environment.md`

### Step 2: Write Tests First (TDD)
Before writing any implementation:
1. Create test fixtures in `tests/fixtures/migration/` for each source type
2. Write failing tests in `tests/migrate-to-nanocore.test.ts`
3. Tests MUST use `os.tmpdir()` for all file operations - never touch real user directories
4. Each test creates its own temp source/target dirs, runs migration, asserts results, cleans up

### Step 3: Implement
1. Create `scripts/migrate-to-nanocore.ts`
2. Implement only what's needed to make tests pass
3. Use `import YAML from 'yaml'` (already in deps) for Hermes YAML parsing
4. Use `import { z } from 'zod'` (already in deps) for schema validation
5. For JSON5 parsing, use a simple regex-based parser or install `json5` package
6. Follow nano-core's existing patterns for .env file handling (simple KEY=VALUE format)

### Step 4: Verify
1. Run `npm test` - all tests must pass
2. Run `npm run typecheck` - no type errors
3. Test the CLI: `npx tsx scripts/migrate-to-nanocore.ts --help`
4. Test dry-run with fixture data - verify no files modified
5. Test execute with fixture data - verify files created correctly

### Step 5: Commit and Handoff

Commit all changes with a descriptive message. Report:
- What was implemented
- What tests pass
- What was left undone

## Example Handoff

```json
{
  "salientSummary": "Implemented SOUL.md migration, memory merge with dedup, and channel settings extraction for OpenClaw source. 12 tests passing covering dry-run, execute, and conflict modes.",
  "whatWasImplemented": "Core migration infrastructure with CLI parsing, source detection for OpenClaw, SOUL.md copy with conflict handling, MEMORY.md merge with char limits and overflow, channel settings (Telegram bot token) extraction to .env with --migrate-secrets support.",
  "whatWasLeftUndone": "Hermes YAML source support not yet implemented. Skills migration not yet implemented. Moltbot/Clawdbot source-specific edge cases not tested.",
  "verification": {
    "commandsRun": [
      { "command": "npm test", "exitCode": 0, "observation": "12 tests passing" },
      { "command": "npm run typecheck", "exitCode": 0, "observation": "No type errors" }
    ],
    "interactiveChecks": []
  },
  "tests": {
    "added": [
      { "file": "tests/migrate-to-nanocore.test.ts", "cases": [
        { "name": "detects openclaw source", "verifies": "auto-detection of ~/.openclaw" },
        { "name": "copies SOUL.md to workspace", "verifies": "SOUL.md migration" },
        { "name": "dry-run modifies no files", "verifies": "dry-run safety" }
      ]}
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Dependencies missing that can't be installed (e.g., json5 package fails to install)
- Ambiguous mapping between source and target formats
- Feature requires changes to existing nano-core source files (off-limits per AGENTS.md)
- Tests fail due to pre-existing issues in the codebase
