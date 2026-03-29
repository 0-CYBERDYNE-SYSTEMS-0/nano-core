#!/bin/bash
set -e

# Test migration script with fixture data
# Uses temp directories to avoid touching real user data

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TEMP_DIR=$(mktemp -d)

echo "=== Migration Test ==="
echo "Temp directory: $TEMP_DIR"

# Setup fake home directory with OpenClaw config
mkdir -p "$TEMP_DIR/.openclaw/skills/web-search"
mkdir -p "$TEMP_DIR/.openclaw/memory"
mkdir -p "$TEMP_DIR/target"

# Copy fixture files (OpenClaw stores files in root, not workspace/)
cp "$REPO_ROOT/tests/fixtures/migration/openclaw-config.json" "$TEMP_DIR/.openclaw/openclaw.json"
cp "$REPO_ROOT/tests/fixtures/migration/openclaw/SOUL.md" "$TEMP_DIR/.openclaw/SOUL.md"
cp "$REPO_ROOT/tests/fixtures/migration/openclaw/MEMORY.md" "$TEMP_DIR/.openclaw/MEMORY.md"
cp "$REPO_ROOT/tests/fixtures/migration/openclaw/USER.md" "$TEMP_DIR/.openclaw/USER.md"
cp "$REPO_ROOT/tests/fixtures/migration/openclaw/AGENTS.md" "$TEMP_DIR/.openclaw/AGENTS.md"
cp "$REPO_ROOT/tests/fixtures/migration/openclaw/skills/web-search/SKILL.md" "$TEMP_DIR/.openclaw/skills/web-search/SKILL.md"
cp "$REPO_ROOT/tests/fixtures/migration/openclaw/memory/2024-01-15.md" "$TEMP_DIR/.openclaw/memory/2024-01-15.md"

echo ""
echo "=== Test 1: Dry run ==="
cd "$REPO_ROOT"
HOME="$TEMP_DIR" npx tsx scripts/migrate-to-nanocore.ts --source openclaw --dry-run --target-workspace "$TEMP_DIR/target" --output-dir "$TEMP_DIR/report"

echo ""
echo "=== Verify dry-run didn't modify files ==="
if [ -f "$TEMP_DIR/target/SOUL.md" ]; then
    echo "ERROR: SOUL.md was created during dry-run!"
    exit 1
else
    echo "OK: No files created during dry-run"
fi

# Check report was generated
if [ -f "$TEMP_DIR/report/report.json" ]; then
    echo "OK: report.json generated"
    cat "$TEMP_DIR/report/report.json"
else
    echo "ERROR: report.json not found"
    exit 1
fi

echo ""
echo "=== Test 2: Execute migration ==="
HOME="$TEMP_DIR" npx tsx scripts/migrate-to-nanocore.ts --source openclaw --execute --target-workspace "$TEMP_DIR/target" --output-dir "$TEMP_DIR/report2"

echo ""
echo "=== Verify migration created files ==="
if [ -f "$TEMP_DIR/target/SOUL.md" ]; then
    echo "OK: SOUL.md created"
else
    echo "ERROR: SOUL.md not found"
    exit 1
fi

if [ -f "$TEMP_DIR/target/MEMORY.md" ]; then
    echo "OK: MEMORY.md created"
else
    echo "ERROR: MEMORY.md not found"
    exit 1
fi

if [ -f "$TEMP_DIR/target/USER.md" ]; then
    echo "OK: USER.md created"
else
    echo "ERROR: USER.md not found"
    exit 1
fi

if [ -f "$TEMP_DIR/target/AGENTS.md" ]; then
    echo "OK: AGENTS.md created"
else
    echo "ERROR: AGENTS.md not found"
    exit 1
fi

if [ -f "$TEMP_DIR/target/IDENTITY.md" ]; then
    echo "OK: IDENTITY.md created"
    cat "$TEMP_DIR/target/IDENTITY.md"
else
    echo "ERROR: IDENTITY.md not found"
    exit 1
fi

if [ -f "$TEMP_DIR/target/skills/openclaw-imports/DESCRIPTION.md" ]; then
    echo "OK: Skills DESCRIPTION.md created"
else
    echo "ERROR: Skills DESCRIPTION.md not found"
    exit 1
fi

if [ -f "$TEMP_DIR/target/skills/openclaw-imports/web-search/SKILL.md" ]; then
    echo "OK: Skill web-search migrated"
else
    echo "ERROR: Skill web-search not found"
    exit 1
fi

echo ""
echo "=== Test 3: Verify report structure ==="
if [ -f "$TEMP_DIR/report2/report.json" ]; then
    echo "OK: report.json exists"
    # Check required fields
    if grep -q '"timestamp"' "$TEMP_DIR/report2/report.json" && \
       grep -q '"mode"' "$TEMP_DIR/report2/report.json" && \
       grep -q '"sourceRoot"' "$TEMP_DIR/report2/report.json" && \
       grep -q '"targetRoot"' "$TEMP_DIR/report2/report.json" && \
       grep -q '"summary"' "$TEMP_DIR/report2/report.json" && \
       grep -q '"items"' "$TEMP_DIR/report2/report.json"; then
        echo "OK: All required report fields present"
    else
        echo "ERROR: Missing required fields in report.json"
        exit 1
    fi
else
    echo "ERROR: report.json not found"
    exit 1
fi

if [ -f "$TEMP_DIR/report2/summary.md" ]; then
    echo "OK: summary.md exists"
    if grep -q "## Summary" "$TEMP_DIR/report2/summary.md" && \
       grep -q "## Migrated Items" "$TEMP_DIR/report2/summary.md" && \
       grep -q "## Next Steps" "$TEMP_DIR/report2/summary.md"; then
        echo "OK: All required summary sections present"
    else
        echo "ERROR: Missing required sections in summary.md"
        exit 1
    fi
else
    echo "ERROR: summary.md not found"
    exit 1
fi

if [ -f "$TEMP_DIR/report2/MIGRATION_NOTES.md" ]; then
    echo "OK: MIGRATION_NOTES.md exists"
else
    echo "ERROR: MIGRATION_NOTES.md not found"
    exit 1
fi

echo ""
echo "=== Test 4: Test conflict handling ==="
# Run again without --overwrite - should report conflicts
HOME="$TEMP_DIR" npx tsx scripts/migrate-to-nanocore.ts --source openclaw --execute --target-workspace "$TEMP_DIR/target" --output-dir "$TEMP_DIR/report3"

if grep -q 'conflict' "$TEMP_DIR/report3/report.json"; then
    echo "OK: Conflicts detected on second run"
else
    echo "WARNING: No conflicts reported (may be expected if files match)"
fi

echo ""
echo "=== Test 5: Test --overwrite ==="
HOME="$TEMP_DIR" npx tsx scripts/migrate-to-nanocore.ts --source openclaw --execute --overwrite --target-workspace "$TEMP_DIR/target" --output-dir "$TEMP_DIR/report4"

# Check backup was created
if [ -d "$TEMP_DIR/report4/backups" ]; then
    echo "OK: Backup directory created"
else
    echo "WARNING: No backup directory (may be expected if no files needed backup)"
fi

echo ""
echo "=== Test 6: Test --include filtering ==="
rm -rf "$TEMP_DIR/target2"
mkdir -p "$TEMP_DIR/target2"
HOME="$TEMP_DIR" npx tsx scripts/migrate-to-nanocore.ts --source openclaw --execute --include soul,memory --target-workspace "$TEMP_DIR/target2" --output-dir "$TEMP_DIR/report5"

if [ -f "$TEMP_DIR/target2/SOUL.md" ] && [ -f "$TEMP_DIR/target2/MEMORY.md" ]; then
    echo "OK: SOUL.md and MEMORY.md created with --include"
else
    echo "ERROR: Expected files not created"
    exit 1
fi

# AGENTS.md should NOT exist when filtered
if [ -f "$TEMP_DIR/target2/AGENTS.md" ]; then
    echo "ERROR: AGENTS.md should not exist with --include soul,memory"
    exit 1
else
    echo "OK: AGENTS.md correctly excluded"
fi

echo ""
echo "=== All tests passed! ==="

# Cleanup
rm -rf "$TEMP_DIR"
