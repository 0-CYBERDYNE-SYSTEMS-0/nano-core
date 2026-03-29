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
