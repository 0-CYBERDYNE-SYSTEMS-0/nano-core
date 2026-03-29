# Environment

Environment variables, external dependencies, and setup notes.

**What belongs here:** Required env vars, external API keys/services, dependency quirks, platform-specific notes.
**What does NOT belong here:** Service ports/commands (use `.factory/services.yaml`).

---

## Dependencies

- Node.js >= 20
- npm (comes with Node)
- `tsx` for running TypeScript scripts directly
- `yaml` package (already in nano-core deps) for parsing Hermes config
- `zod` package (already in nano-core deps) for schema validation
- TypeScript 5.7+

## No External Services Required

This migration script is purely file-based. No databases, servers, or network calls needed.

## Platform

- macOS and Linux supported
- Uses `os.homedir()` for user directory detection
- Uses `os.tmpdir()` for test fixtures

## Migration Test Isolation Pattern

Migration tests in `tests/migrate-to-nanocore.test.ts` use a specific pattern to avoid touching real user data:

1. `fs.mkdtemp(path.join(os.tmpdir(), 'migration-test-'))` creates isolated temp directories
2. `HOME` env var is overridden via `execSync` options to point to temp home dirs (so source detection finds fixtures there)
3. `--target-workspace` and `--target-env` flags are passed to the migration script to direct output to temp locations
4. Cleanup happens in `after()` via `fs.rm(tempDir, { recursive: true, force: true })`

When writing new migration tests, follow this pattern rather than modifying real user directories.
