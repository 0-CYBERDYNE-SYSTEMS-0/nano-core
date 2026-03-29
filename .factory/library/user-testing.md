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
