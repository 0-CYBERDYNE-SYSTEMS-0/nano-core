# Profile Guide

Creating custom capability profiles for ff-nano.

## What is a Profile?

A **profile** is a self-contained package that defines:
- **Capabilities** - What the profile enables
- **Configuration** - Environment variables and settings
- **Skills** - Domain-specific logic and tools
- **Startup Hooks** - Initialization scripts

## Profile Structure

```
my_profile/
├── PROFILE.json              # Required: Profile manifest
├── skills/                  # Optional: Profile's skills
├── config/                  # Optional: Profile-specific config
├── src/                     # Optional: Source code
└── docs/                    # Optional: Documentation
```

## PROFILE.json Schema

### Required Fields

```json
{
  "version": "1.0.0",
  "name": "my_profile",
  "displayName": "My Profile",
  "description": "Description of what this profile does",
  "author": "Your Name",
  "license": "MIT",
  "capabilities": ["capability1", "capability2"]
}
```

### Optional Fields

#### Configuration

```json
{
  "config": {
    "systemPrompt": "system_prompt.md",
    "envVars": {
      "SETTING_1": "value1",
      "SETTING_2": "value2"
    },
    "startupHooks": [
      "src/module1.ts",
      "src/module2.ts"
    ]
  }
}
```

**Fields:**
- `systemPrompt` (string, optional): Path to system prompt
- `envVars` (object, optional): Environment variables to set
- `startupHooks` (array, optional): Files to run on activation

#### Dependencies

```json
{
  "dependencies": {
    "system": ["package1", "package2"],
    "npm": ["npm-package"]
  }
}
```

**Fields:**
- `system` (array, optional): System packages (apt, brew, etc.)
- `npm` (array, optional): NPM packages to install

## Profile Capabilities

A **capability** is a string that describes what the profile provides. Examples:

```
"agricultural_monitoring"
"home_assistant_integration"
"farm_state_tracking"
"web_development"
"data_science"
"content_creation"
"automation"
```

Capabilities are used for:
- Profile discovery (what profiles do you have?)
- Dependency resolution (what do you need?)
- Feature checking (does this profile support X?)

## Creating a Profile

### Step 1: Create Directory Structure

```bash
mkdir -p my_profile/{skills,config,src,docs}
cd my_profile
```

### Step 2: Create PROFILE.json

```bash
cat > PROFILE.json << 'EOF'
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
```

### Step 3: Add Skills (Optional)

If your profile includes skills:

```bash
# Create skill directories
mkdir -p skills/my_skill

# Create skill manifest
cat > skills/my_skill/SKILL.md << 'EOF'
# My Skill

Description of what this skill does.

## Triggers
- "do X"
- "help with Y"

## Author
Your Name

## License
MIT
EOF

# Add skill implementation
cat > skills/my_skill/tools.ts << 'EOF'
import type { ToolHandler } from '../../types.js';

export const myTool: ToolHandler = async (args) => {
  // Your tool implementation
  return { success: true, data: "result" };
};
EOF
```

### Step 4: Add Configuration (Optional)

```bash
# Create profile-specific config
cat > config/profile_config.json << 'EOF'
{
  "mySetting": "value",
  "myFeature": true
}
EOF
```

### Step 5: Add Source Code (Optional)

```bash
# Add profile-specific modules
cat > src/my_module.ts << 'EOF'
// Profile-specific module
export function initialize() {
  console.log("My profile initialized!");
}
EOF
```

### Step 6: Add Documentation (Optional)

```bash
# Create README
cat > docs/README.md << 'EOF'
# My Profile

Description of what this profile does.

## Usage

## Features

## Configuration

## Troubleshooting
EOF
```

## Installing Your Profile

### From Local Path

```bash
cd ~/nano-core
npm run profile -- install ../my_profile
```

### From GitHub Repository

```bash
cd ~/nano-core
npm run profile -- install username/profile-repo
```

### From URL

```bash
cd ~/nano-core
npm run profile -- install https://example.com/profile.zip
```

## Profile Activation

### First-Time Setup

```bash
cd ~/nano-core
npm run profile -- activate my_profile
```

**What happens:**
1. Workspace created: `~/.ff-nano/workspaces/my_profile/`
2. Environment variables applied to `.env`
3. Startup hooks executed (if defined)

### Switching Profiles

```bash
npm run profile -- switch other_profile
```

**What happens:**
1. Current workspace backed up: `~/.ff-nano/workspaces/my_profile_backup_<timestamp>/`
2. Profile switched to `other_profile`
3. New workspace created
4. New environment variables applied

## Profile Configuration

### Environment Variables

Profile `envVars` are merged with existing `.env` and applied on activation:

```json
{
  "config": {
    "envVars": {
      "FEATURE_X": "1",
      "SETTING_Y": "value"
    }
  }
}
```

### Startup Hooks

Startup hooks are files that run when a profile is activated:

```json
{
  "config": {
    "startupHooks": [
      "src/module1.ts",
      "src/module2.ts"
    ]
  }
}
```

Hooks are executed in order and can:
- Initialize profile-specific services
- Create directories
- Setup configurations
- Validate dependencies

## Profile Best Practices

### 1. Use Semantic Versioning

```json
{
  "version": "1.0.0"  // MAJOR.MINOR.PATCH
}
```

- MAJOR: Breaking changes
- MINOR: New features
- PATCH: Bug fixes

### 2. Declare Capabilities Clearly

```json
{
  "capabilities": [
    "environmental_monitoring",
    "hardware_control",
    "automation"
  ]
}
```

Use lowercase with underscores for multi-word capabilities.

### 3. Provide Good Documentation

```bash
my_profile/
├── PROFILE.json       # Manifest
├── README.md          # User guide
└── docs/
    ├── SETUP.md       # Setup instructions
    ├── CONFIG.md      # Configuration reference
    └── API.md         # API documentation
```

### 4. Test Your Profile

```bash
# Install
npm run profile -- install ../my_profile

# Activate
npm run profile -- activate my_profile

# List profiles
npm run profile -- list

# Test ff-nano with profile
npm start
```

### 5. Publish Your Profile

Create a GitHub repository for your profile:

```bash
# Initialize git repo
cd ../my_profile
git init
git add -A
git commit -m "Initial commit"

# Create GitHub repo
gh repo create my-profile --public

# Push
git remote add origin git@github.com:username/my-profile.git
git push -u origin main
```

Users can now install:

```bash
npm run profile -- install username/my-profile
```

## Advanced Topics

### Profile Dependencies

If your profile requires system packages:

```json
{
  "dependencies": {
    "system": [
      "mosquitto",
      "homeassistant"
    ]
  }
}
```

**Installation:** Users must install these packages manually.

If your profile requires NPM packages:

```json
{
  "dependencies": {
    "npm": [
      "mqtt",
      "home-assistant-js"
    ]
  }
}
```

**Installation:** Packages are installed during profile installation.

### Profile Storage

Profiles are installed to: `~/.ff-nano/profiles/<profile_name>/`

Workspaces are created at: `~/.ff-nano/workspaces/<profile_name>/`

Profile data is isolated and backed up on switch.

### Profile Removal

When a profile is removed:

```bash
npm run profile -- remove my_profile
```

**What happens:**
1. Profile directory is deleted
2. Workspace is NOT deleted (can be manually removed)
3. Environment variables are removed from `.env`

**Backups are preserved:** Workspace backups from profile switches are NOT deleted.

## Troubleshooting

### Profile Installation Fails

**Error:** "Invalid profile: missing PROFILE.json"
**Solution:** Ensure `PROFILE.json` exists in the root of your profile directory.

**Error:** "Failed to parse PROFILE.json"
**Solution:** Validate JSON syntax:
```bash
cat PROFILE.json | jq .
```

### Profile Activation Fails

**Error:** "Profile not found: my_profile"
**Solution:** Ensure profile is installed:
```bash
npm run profile -- list
```

**Error:** "Workspace already exists"
**Solution:** Switch to profile first (creates workspace):
```bash
npm run profile -- switch my_profile
```

### Environment Variables Not Applied

**Error:** Environment variables not set
**Solution:** Check `.env` file:
```bash
cat .env | grep MY_SETTING
```

If missing, re-activate profile:
```bash
npm run profile -- activate my_profile
```

## Examples

### Minimal Profile

```json
{
  "version": "1.0.0",
  "name": "minimal",
  "displayName": "Minimal Profile",
  "description": "Minimal profile for testing",
  "author": "Your Name",
  "license": "MIT",
  "capabilities": ["minimal"],
  "config": {}
}
```

### Full Profile

```json
{
  "version": "1.0.0",
  "name": "full_profile",
  "displayName": "Full Profile",
  "description": "Full-featured profile",
  "author": "Your Name",
  "license": "MIT",
  "capabilities": [
    "capability1",
    "capability2",
    "capability3"
  ],
  "config": {
    "systemPrompt": "system_prompt.md",
    "envVars": {
      "SETTING_1": "value1",
      "SETTNG_2": "value2"
    },
    "startupHooks": [
      "src/module1.ts",
      "src/module2.ts"
    ]
  },
  "dependencies": {
    "system": ["package1"],
    "npm": ["npm-package"]
  }
}
```

## Resources

- [ff-nano README](../README.md) - ff-nano documentation
- [PROFILE_SCHEMA.md](PROFILE_SCHEMA.md) - Complete schema reference
- [Examples](../examples/) - Example profiles

## Support

- GitHub Issues: https://github.com/0-CYBERDYNE-SYSTEMS-0/nano-core/issues
- Documentation: https://github.com/0-CYBERDYNE-SYSTEMS-0/nano-core/wiki
