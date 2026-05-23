# nano-core

Domain-agnostic AI agent runtime. Receives chat messages via Telegram and/or WhatsApp, dispatches each message to an agent running inside an isolated Docker container, and streams the response back to the originating chat.

The repository is `nano-core`. The CLI binary and npm package name is `ff-nano`.

---

## What it is

nano-core is a **host process**, not a library. It is a standalone Node.js/TypeScript application that:

- Polls Telegram (primary) and/or WhatsApp for inbound messages
- Stores messages and sessions in SQLite
- Spawns the `pi` coding agent inside a Docker container per group, with volume mounts for workspace, memory, and skills
- Streams responses back to Telegram or WhatsApp with draft/block delivery
- Maintains per-group memory (`MEMORY.md`, `SOUL.md`, `IDENTITY.md`) and a global memory at `groups/global/MEMORY.md`
- Runs periodic heartbeat checks from `HEARTBEAT.md` on a configurable cadence
- Exposes a TUI client/server pair and a web control center (React)
- Supports a profile system to layer domain-specific capabilities on top of the agnostic core

The runtime requires Node.js >= 20. Docker is required for container execution (there is an explicit host-runtime escape hatch for development, but it is not the default path).

---

## Quick start

```bash
git clone https://github.com/0-CYBERDYNE-SYSTEMS-0/nano-core.git
cd nano-core
npm install
cp .env.example .env
# Edit .env: set TELEGRAM_BOT_TOKEN at minimum
npm run build
npm start
```

For watch-mode development (no build step):

```bash
npm run dev
```

### Telegram-only setup (recommended for dev)

Set in `.env`:

```
TELEGRAM_BOT_TOKEN=123456:ABCDEF...
WHATSAPP_ENABLED=0
```

Start the process. On first message from your bot, the chat is auto-registered. To designate a chat as the main/admin channel either set `TELEGRAM_MAIN_CHAT_ID` in `.env` or send `/main <TELEGRAM_ADMIN_SECRET>` as a DM to the bot.

### WhatsApp setup

Leave `WHATSAPP_ENABLED=1` (the default). On first run, a QR code is printed to stdout. Scan it with WhatsApp to authenticate. Auth state is persisted to `store/`. To re-authenticate run `npm run auth`.

---

## Architecture

![nano-core architecture](assets/architecture.svg)

[Edit diagram](https://excalidraw.com/#json=0rOfumv4kb5ez_gK2ech9,ElC66pp_di48sBQlyj3lnA) — source at `assets/architecture.excalidraw`

The system is organized into four layers:

**Inbound channels** — Telegram (primary) and WhatsApp (Baileys) deliver messages into the host process via polling and WebSocket respectively.

**Host process** (`src/index.ts`) — The central orchestrator. Runs a message routing loop that parses commands, manages per-chat session state, retrieves memory context, and dispatches to the container agent. Also runs the task scheduler (cron v2), heartbeat loop, TUI gateway server (:28989), and web control center (:28990).

**Docker container** (`container/agent-runner/`) — Isolated execution environment. The host calls `runContainerAgent()` which spawns a Docker container, mounts the group workspace, injects runtime skills from `skills/runtime/`, and runs the `pi` coding agent subprocess. The agent receives assembled prompt context (including memory retrieved from SOUL.md/MEMORY.md) and returns a JSON result.

**File system / persistence** — SQLite (`store/messages.db`) for messages and chat state. Per-group directories (`groups/<group>/`) hold SOUL.md, MEMORY.md, and logs. The main agent workspace (`~/nano`) is the working directory for the primary chat. `data/router_state.json` holds preferences and usage stats across restarts.

### Key source modules

| File | Role |
|------|------|
| `src/index.ts` | Main entry point, message loop, WhatsApp socket, top-level orchestration |
| `src/config.ts` | All env var configuration, profile config merge |
| `src/telegram.ts` | Telegram bot core (polling, send, typing) |
| `src/telegram-streaming.ts` | Block/draft streaming delivery to Telegram |
| `src/container-runner.ts` | Docker container orchestration, volume mounts, output parsing |
| `src/container-runtime.ts` | Runtime mode detection (docker vs host) |
| `src/profile.ts` | Profile detection and loading |
| `src/profile-storage.ts` | PROFILE.json manifest loader |
| `src/profile-cli.ts` | Profile management CLI |
| `src/task-scheduler.ts` | Cron/task scheduling (v2 timer-based + legacy polling) |
| `src/heartbeat-policy.ts` | Heartbeat suppression logic and active-hours gating |
| `src/workspace-bootstrap.ts` | Main workspace bootstrap and onboarding gate |
| `src/memory-paths.ts` | Memory file path resolution |
| `src/singleton-lock.ts` | Prevents duplicate host process instances |
| `src/tui/` | TUI gateway server and client |
| `src/web/` | Web control center HTTP server |
| `src/cron/` | Cron adapter and type definitions |

---

## Profile system

Profiles are the mechanism for domain specialization. The core runtime is domain-agnostic. A profile installs on top of the core and supplies:

- **`PROFILE.json`** — manifest with metadata, capabilities list, env vars, and startup hooks
- **`skills/`** — domain-specific skills injected into the agent at runtime
- **`config/`** — profile-specific configuration files
- **`src/`** — optional TypeScript modules loaded as startup hooks

Profiles are installed to `~/.ff-nano/profiles/<name>/`. Each profile gets an isolated workspace at `~/.ff-nano/workspaces/<name>/`. Switching profiles backs up the current workspace before activating the new one.

### Profile manifest (`PROFILE.json`)

```json
{
  "version": "1.0.0",
  "name": "my_profile",
  "displayName": "My Profile",
  "description": "What this profile does",
  "author": "Your Name",
  "license": "MIT",
  "capabilities": ["capability1", "capability2"],
  "config": {
    "systemPrompt": "system_prompt.md",
    "envVars": {
      "MY_SETTING": "value"
    },
    "startupHooks": [
      "src/my-hook.ts"
    ]
  }
}
```

All fields under `config` are optional. `envVars` are merged into `process.env` at startup, with the active profile's values taking precedence.

### Profile CLI

```bash
# List installed profiles
npm run profile -- list

# Install from GitHub, URL, or local path
npm run profile -- install <source>

# Activate a profile (first-time setup)
npm run profile -- activate <name>

# Switch profiles (backs up current workspace)
npm run profile -- switch <name>

# Show current profile status
npm run profile -- status

# Remove a profile
npm run profile -- remove <name>
```

See [PROFILE_GUIDE.md](PROFILE_GUIDE.md) for the complete profile authoring reference.

---

## Telegram setup

Telegram is the primary UX. Set `TELEGRAM_BOT_TOKEN` to enable it.

### Claiming the main channel

The main channel is the admin/control channel. There are two ways to designate it:

1. Set `TELEGRAM_MAIN_CHAT_ID=<chat_id>` in `.env` before starting
2. DM the bot `/main <TELEGRAM_ADMIN_SECRET>` (requires `TELEGRAM_ADMIN_SECRET` to be set)

To find a chat's ID, send `/id` in that chat.

### Bot commands

All chats:

```
/help                              Show command help
/status                            Runtime and queue status
/id                                Show this chat's Telegram ID
/models [query]                    List/search available models
/model [provider/model|reset]      Show or set model override for this chat
/think [off|minimal|low|medium|high|xhigh]   Thinking level
/reasoning [off|on|stream]         Reasoning visibility
/verbose [/v] [off|on|full]        Tool/verbose output mode
/new                               Start fresh session on next run
/reset                             Alias for /new
/stop                              Abort the current in-flight run
/usage [all]                       Token usage counters
/queue [mode|debounce|cap|drop]    Queue policy for this chat
/compact [instructions]            Summarize session and roll context
```

Main/admin channel only:

```
/main <secret>                     Claim this chat as main/admin
/gateway status|restart|doctor     Host service operations
/tasks [list|due|detail|runs]      Inspect scheduled tasks
/task_pause <id>                   Pause a task
/task_resume <id>                  Resume a task
/task_cancel <id>                  Cancel a task
/groups                            List registered groups
/freechat add|remove|list          Manage free-chat allowlist
/reload                            Refresh command menus and group metadata
/panel                             Open admin quick-action buttons
/coder <task>                      Delegate explicit coding run
/coder-plan <task>                 Delegate planning run
/subagents list|stop|spawn         Manage delegated subagent runs
```

### Per-chat preferences

Each chat can override the default model, thinking level, reasoning visibility, verbose mode, and queue behavior. These are persisted in `data/router_state.json` and survive restarts.

### Trigger word

In non-main chats, messages must start with `@<ASSISTANT_NAME>` (default: `@OpenClaw`). The main channel responds to all messages. Additional trigger aliases can be set via `ASSISTANT_ALIASES`.

---

## Skills system

Skills are markdown or TypeScript files injected into the agent context.

```
skills/
├── setup/      # Install-time skills (run once during setup)
└── runtime/    # Injected into the agent on every run
```

User-created runtime skills live at `~/nano/skills/` (or wherever `FFT_NANO_MAIN_WORKSPACE_DIR` points). These are mounted into the container and made available to the agent alongside the built-in runtime skills.

Validate skill metadata with:

```bash
npm run validate:skills
```

---

## Environment variable reference

Copy `.env.example` to `.env`. Key variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `TELEGRAM_BOT_TOKEN` | — | Enables Telegram. Required for Telegram UX. |
| `TELEGRAM_MAIN_CHAT_ID` | — | Designates a specific Telegram chat as main/admin on startup. |
| `TELEGRAM_ADMIN_SECRET` | — | Secret for `/main <secret>` bot DM to claim main channel. |
| `WHATSAPP_ENABLED` | `1` | Set to `0` to disable WhatsApp entirely. |
| `PI_API` | — | LLM provider for the container agent (e.g. `openai`, `anthropic`, `gemini`, `openrouter`). |
| `PI_MODEL` | — | Model name passed to the `pi` agent (e.g. `gpt-4o-mini`, `claude-3-5-sonnet-latest`). |
| `OPENAI_API_KEY` | — | Required when `PI_API=openai`. |
| `ANTHROPIC_API_KEY` | — | Required when `PI_API=anthropic`. |
| `GEMINI_API_KEY` | — | Required when `PI_API=gemini`. |
| `OPENROUTER_API_KEY` | — | Required when `PI_API=openrouter`. |
| `FFT_NANO_MAIN_WORKSPACE_DIR` | `~/nano` | Main agent workspace path, mounted as `/workspace/group` in main-chat runs. |
| `FFT_NANO_HEARTBEAT_EVERY` | `30m` | Heartbeat cadence. Accepts `15m`, `1h`, `0m` (disabled), etc. |
| `FFT_NANO_HEARTBEAT_ACTIVE_HOURS` | — | Restrict heartbeat to active hours, e.g. `09:00-18:00` or `Mon-Fri@09:00-18:00`. |
| `ASSISTANT_NAME` | `OpenClaw` | Trigger word prefix for non-main chats. |
| `ASSISTANT_ALIASES` | — | Comma-separated additional trigger aliases. |
| `CONTAINER_IMAGE` | `fft-nano-agent:latest` | Docker image used for agent containers. |
| `CONTAINER_RUNTIME` | `auto` | `auto` (Docker if available) or `host` (explicit unisolated fallback). |
| `FFT_NANO_TUI_ENABLED` | `1` | Enable TUI gateway server. |
| `FFT_NANO_TUI_PORT` | `28989` | TUI server port. |
| `FFT_NANO_TUI_AUTH_TOKEN` | — | Auth token for TUI connections. |
| `FFT_NANO_WEB_ENABLED` | `1` | Enable web control center server. |
| `FFT_NANO_WEB_PORT` | `28990` | Web control center port. |
| `FFT_NANO_WEB_ACCESS_MODE` | `localhost` | `localhost`, `lan`, or `remote`. Controls bind host. |
| `FFT_NANO_WEB_AUTH_TOKEN` | — | Auth token for web control center. |
| `MEMORY_RETRIEVAL_GATE_ENABLED` | `1` | Lexical memory retrieval gate. |
| `MEMORY_TOP_K` | `8` | Max memory snippets injected per run. |
| `MEMORY_CONTEXT_CHAR_BUDGET` | `6000` | Hard character budget for injected memory. |
| `LOG_LEVEL` | — | Set to `debug` for verbose container args and logs. |
| `FFT_NANO_DRY_RUN` | — | Set to `1` to bypass LLM calls for smoke testing routing. |
| `FFT_PROFILE` | — | Active profile name. Set by the profile CLI or manually. |

The full reference with all variables, including farm-bridge and container-reuse settings, is in [.env.example](.env.example).

---

## npm scripts

```bash
npm run build            # TypeScript → dist/
npm start                # Run production build (node dist/index.js)
npm run dev              # Watch mode via tsx (no build step)
npm run typecheck        # Type check without emitting
npm test                 # Run test suite

npm run profile -- list|install|activate|switch|remove|status

npm run tui              # Start TUI server
npm run tui:client       # Start TUI client

npm run web:install      # Install web control center dependencies
npm run web:build        # Build web control center
npm run web:dev          # Dev server for web control center

npm run doctor           # Health check report
npm run validate:skills  # Validate skill metadata
npm run secret-scan      # Secret scanning gate
npm run release-check    # Release readiness check

npm run onboard          # Guided onboarding CLI
npm run auth             # WhatsApp re-authentication (QR code)
npm run backup:state     # Backup runtime state
npm run restore:state    # Restore runtime state
```

---

## Directory layout

```
nano-core/
├── src/                    # TypeScript source
│   ├── index.ts            # Main entry point
│   ├── config.ts           # All env var configuration
│   ├── telegram.ts         # Telegram bot core
│   ├── telegram-streaming.ts
│   ├── telegram-commands.ts
│   ├── container-runner.ts # Docker orchestration
│   ├── container-runtime.ts
│   ├── profile.ts
│   ├── profile-storage.ts
│   ├── profile-cli.ts
│   ├── task-scheduler.ts
│   ├── heartbeat-policy.ts
│   ├── workspace-bootstrap.ts
│   ├── memory-paths.ts
│   ├── singleton-lock.ts
│   ├── runtime/            # Host↔container IPC boundary
│   ├── tui/                # TUI gateway server and client
│   ├── web/                # Web control center HTTP server
│   └── cron/               # Cron adapter and types
├── container/
│   ├── Dockerfile
│   ├── build.sh
│   ├── build-docker.sh
│   └── agent-runner/       # Agent container source
├── skills/
│   ├── setup/              # Install-time skills
│   └── runtime/            # Agent runtime skills (injected per run)
├── config/                 # Base configuration files
├── config-examples/        # Example configurations
├── docs/                   # Documentation
├── docs-site/              # Documentation site source
├── scripts/                # Build, deploy, and maintenance scripts
├── launchd/                # macOS launchd service plists
├── web/                    # Web control center (React app)
├── bin/                    # CLI entry points (ff-nano / fft)
├── assets/                 # Static assets
├── tests/                  # Test suite
├── PROFILE_GUIDE.md
├── AGENTS.md
└── .env.example
```

---

## Runtime data layout

These paths are created at runtime and are not committed to the repository.

```
~/.ff-nano/
├── profiles/               # Installed profiles
│   └── <name>/
│       ├── PROFILE.json
│       ├── skills/
│       └── src/
└── workspaces/             # Profile-specific workspaces
    └── <name>/

~/nano/                     # Main agent workspace (FFT_NANO_MAIN_WORKSPACE_DIR default)
├── MEMORY.md
├── SOUL.md
└── skills/                 # User-created runtime skills

groups/                     # Per-group runtime data (relative to project root)
└── <group>/
    ├── MEMORY.md
    ├── SOUL.md
    ├── IDENTITY.md
    ├── logs/
    └── inbox/
        └── telegram/       # Inbound Telegram media files

data/
├── router_state.json       # Chat preferences, usage stats, registered groups
├── registered_groups.json
├── fft_nano.lock           # Singleton lock (prevents duplicate instances)
└── pi/
    └── <group>/
        └── .pi/            # Pi agent state per group
```

---

## Heartbeat

The heartbeat system runs the agent periodically against the main workspace `HEARTBEAT.md`. It is used for autonomous monitoring, scheduled context checks, and proactive notifications.

- Cadence: `FFT_NANO_HEARTBEAT_EVERY` (default `30m`)
- Active hours gate: `FFT_NANO_HEARTBEAT_ACTIVE_HOURS` (optional, e.g. `09:00-18:00`)
- The agent receives `HEARTBEAT.md` as context. If it replies `HEARTBEAT_OK` (with fewer than `FFT_NANO_HEARTBEAT_ACK_MAX_CHARS` trailing chars) the result is suppressed and not sent to the chat.
- Heartbeat target (which chat receives actionable results) is controlled by `PARITY_CONFIG` or defaults to the main channel.

---

## Development workflow

```bash
# 1. Install dependencies
npm install

# 2. Copy and configure env
cp .env.example .env
# Set TELEGRAM_BOT_TOKEN, PI_API, PI_MODEL, and provider key

# 3. Build the container image (requires Docker)
./container/build.sh

# 4. Start in watch mode
npm run dev

# 5. Type check
npm run typecheck

# 6. Run tests
npm test
```

### macOS launchd service

Launchd plists are in `launchd/`. Use `scripts/run-launchd.sh` or `scripts/service.sh` for service management. From Telegram main channel, `/gateway status|restart|doctor` invokes `scripts/service.sh`.

---

## Debugging

**Verbose container logs**

```bash
LOG_LEVEL=debug npm run dev
```

Prints full Docker run arguments and container stdout/stderr.

**Dry run (no LLM calls)**

```bash
FFT_NANO_DRY_RUN=1 npm run dev
```

Exercises the full message routing path without making any LLM requests. Useful for testing Telegram webhook delivery and group registration.

**Health check**

```bash
npm run doctor
```

Or from Telegram main channel: `/gateway doctor`

**Common issues**

| Symptom | Cause | Fix |
|---------|-------|-----|
| Telegram conflict error on startup | Two instances polling the same bot token | Check `data/fft_nano.lock`; kill the other process |
| "No models available" in container | Provider API key not passed into container env | Verify `PI_API`, `PI_MODEL`, and the corresponding key are set in `.env` |
| Docker daemon unavailable | Docker not running | Run `docker info` to confirm Docker is up |
| WhatsApp authentication loop | Stale auth state | Delete `store/` and run `npm run auth` |
| Group not receiving responses | Chat not registered or trigger word missing | Send `/id` in the chat; check `data/registered_groups.json`; confirm `@ASSISTANT_NAME` prefix in non-main chats |

---

## License

MIT
