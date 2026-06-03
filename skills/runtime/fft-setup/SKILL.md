---
name: fft-setup
description: Verify host prereqs (node, npm, container runtime) before running nano-core. Use when a user asks whether their machine can run nano-core, or when troubleshooting first-run setup failures.
---

# fft-setup

Host prereq checker for nano-core.

## When to use this skill

- Use when an operator asks "can I run nano-core on this machine" or "what's missing".
- Use when a first-run setup fails and the cause is unclear.

## When not to use this skill

- Do not use for general node/npm installation help — link the user to upstream docs.

## Guardrails

- Never run destructive git commands unless explicitly requested.
- Preserve unrelated worktree changes.
- Main/admin chat only for privileged actions.
- Read-only diagnostic: do not install or upgrade anything.

## Workflow

1. Run `bash scripts/check-prereqs.sh` from the operator's checkout root.
2. Report which prereqs are missing (if any).
3. If the only failure is the container runtime, suggest Docker install steps or the `NANO_CORE_ALLOW_HOST_RUNTIME=1` env override (set explicitly, never default).
