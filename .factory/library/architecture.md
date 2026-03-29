# Architecture

Single TS CLI script migrates from 4 sources to nano-core format.

Sources: OpenClaw (~/.openclaw), Clawdbot (~/.config/clawdbot), Moltbot (~/.moltbot), Hermes (~/.hermes)
Targets: ~/nano/ (workspace), .env (config), ~/.config/fft_nano/ (parity+allowlist)
Key invariants: dry-run safe, no overwrite without flag, secrets gated, dedup, idempotent, mask secrets
