# ff-nano

Agnostic AI agent runtime with capability profiles.

## What is ff-nano?

`ff-nano` is a stripped-down, domain-agnostic version of FFT_nano designed to load **capability profiles** on-demand. Instead of being locked into one domain (agriculture, web development, etc.), `ff-nano` transforms into whatever you need by loading a profile.

## Core Philosophy

**Nano-core = Infrastructure + Profiles = Capabilities**

- **Core:** Container runtime, config system, memory, Telegram integration
- **Profiles:** Domain-specific logic, skills, configuration
- **Result:** Transform `ff-nano` into anything by switching profiles

## Quick Start

### Installation

```bash
# Clone the repository
git clone https://github.com/0-CYBERDYNE-SYSTEMS-0/nano-core.git
cd nano-core
npm install
npm run build
```

### Profile Management

```bash
# List installed profiles
npm run profile -- list

# Install a profile (from GitHub, URL, or local path)
npm run profile -- install <source>

# Activate a profile (first-time setup)
npm run profile -- activate <name>

# Switch profiles (backups current workspace)
npm run profile -- switch <name>

# Remove a profile
npm run profile -- remove <name>

# Show current profile status
npm run profile -- status
```

## Profile Structure

A **profile** is a collection of:
- **Manifest** (`PROFILE.json`) - Metadata, capabilities, configuration
- **Skills** - Domain-specific skills and logic
- **Config** - Profile-specific configuration
- **Startup Hooks** - Initialization scripts

### Example Profile

```json
{
  "version": "1.0.0",
  "name": "farm",
  "displayName": "Farm",
  "description": "Agricultural monitoring and control",
  "author": "Farm Friend Technologies",
  "license": "MIT",
  "capabilities": [
    "agricultural_monitoring",
    "home_assistant_integration",
    "farm_state_tracking"
  ],
  "config": {
    "systemPrompt": "system_prompt.md",
    "envVars": {
      "FEATURE_FARM": "1",
      "FARM_STATE_ENABLED": "true",
      "ASSISTANT_NAME": "FarmFriend"
    },
    "startupHooks": [
      "src/farm-action-gateway.ts",
      "src/farm-state-collector.ts",
      "src/home-assistant.ts"
    ]
  }
}
```

## Directory Structure

```
~/.ff-nano/
├── profiles/                      # Installed capability profiles
│   ├── farm/
│   │   ├── PROFILE.json
│   │   ├── skills/
│   │   ├── config/
│   │   └── src/
│   ├── starter_kit/
│   └── ...
└── workspaces/                    # Profile-specific workspaces
    ├── farm/
    ├── starter_kit/
    └── ...
```

## Core Features

### Profile System
- **Install** profiles from GitHub, URL, or local path
- **List** all installed profiles with metadata
- **Activate** profiles for first-time setup
- **Switch** profiles with workspace backup
- **Remove** profiles with confirmation

### Workspace Isolation
- Each profile has its own workspace
- Workspace isolation prevents data conflicts
- Backup on profile switch

### Configuration
- Profile-specific environment variables
- Base + profile + user config merge
- `.env` file for active profile

### Container Runtime
- Run agents in Docker containers
- Host runtime option (no Docker required)
- Profile-specific container configurations

## Usage Examples

### Basic Workflow

```bash
# 1. Install a profile
npm run profile -- install farmfriend/smart_controller

# 2. Activate the profile
npm run profile -- activate smart_controller

# 3. Start ff-nano
npm start
```

### Profile Switching

```bash
# Switch from current profile to another
npm run profile -- switch farm

# Previous workspace is backed up to:
# ~/.ff-nano/workspaces/<previous>_backup_<timestamp>/
```

### Profile Removal

```bash
# Remove an installed profile
npm run profile -- remove farm

# Profile directory is removed
# Workspace is NOT deleted (can be manually removed)
```

## Creating Profiles

See [PROFILE_GUIDE.md](PROFILE_GUIDE.md) for detailed instructions on creating custom profiles.

### Quick Profile Template

```bash
mkdir -p my_profile/{skills,config}
cat > my_profile/PROFILE.json << 'EOF'
{
  "version": "1.0.0",
  "name": "my_profile",
  "displayName": "My Profile",
  "description": "Description of what this profile does",
  "author": "Your Name",
  "license": "MIT",
  "capabilities": ["capability1", "capability2"],
  "config": {
    "envVars": {
      "MY_SETTING": "value"
    }
  }
}
EOF

# Install your profile
npm run profile -- install ./my_profile
```

## Development

### Building

```bash
npm run build          # Compile TypeScript
npm run dev           # Watch mode
npm run typecheck     # Type check only
```

### Testing

```bash
npm test              # Run tests
npm run profile -- list  # Test profile system
```

## Contributing

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT License - see [LICENSE](LICENSE) file.

## Related Projects

- [FFT Terminal](https://github.com/0-CYBERDYNE-SYSTEMS-0/FarmFriend-Terminal-React) - Original skill-based agent
- [FFT_nano](https://github.com/0-CYBERDYNE-SYSTEMS-0/FFT_nano) - Original container-based host
- [Farm Friend](https://farm-friend.com) - Company website

## Support

- GitHub Issues: https://github.com/0-CYBERDYNE-SYSTEMS-0/nano-core/issues
- Documentation: https://github.com/0-CYBERDYNE-SYSTEMS-0/nano-core/wiki
