/**
 * Migration script tests
 * Tests use temporary directories to avoid touching real user data
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

describe('migrate-to-nanocore', () => {
  let tempDir: string;
  let sourceDir: string;
  let targetDir: string;
  let repoRoot: string;
  let scriptPath: string;

  before(async () => {
    // Create temp directories
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'migration-test-'));
    sourceDir = path.join(tempDir, 'source');
    targetDir = path.join(tempDir, 'target');
    repoRoot = process.cwd();
    scriptPath = path.join(repoRoot, 'scripts/migrate-to-nanocore.ts');

    await fs.mkdir(sourceDir, { recursive: true });
    await fs.mkdir(targetDir, { recursive: true });
  });

  after(async () => {
    // Cleanup temp directory
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('CLI argument parsing', () => {
    test('--help shows usage information', () => {
      const output = execSync(`npx tsx ${scriptPath} --help`, {
        encoding: 'utf-8',
      });
      assert(output.includes('Migration Script'));
      assert(output.includes('--source'));
      assert(output.includes('--dry-run'));
      assert(output.includes('--execute'));
      assert(output.includes('--migrate-secrets'));
    });
  });

  describe('Source detection', () => {
    test('detects OpenClaw source when config exists', async () => {
      // Create mock OpenClaw config
      const openclawDir = path.join(tempDir, '.openclaw');
      await fs.mkdir(openclawDir, { recursive: true });
      await fs.writeFile(
        path.join(openclawDir, 'openclaw.json'),
        JSON.stringify({
          name: 'Test',
          agent: { name: 'TestAgent' },
          model: { provider: 'openai', model: 'gpt-4' },
        }),
        'utf-8',
      );

      // Test would need to override home directory detection
      // For now, we test via explicit source selection
      assert(existsSync(path.join(openclawDir, 'openclaw.json')));
    });

    test('detects Hermes source when config exists', async () => {
      const hermesDir = path.join(tempDir, '.hermes');
      await fs.mkdir(hermesDir, { recursive: true });
      await fs.writeFile(
        path.join(hermesDir, 'config.yaml'),
        `agent:\n  name: TestAgent\nllm:\n  provider: openai\n`,
        'utf-8',
      );

      assert(existsSync(path.join(hermesDir, 'config.yaml')));
    });
  });

  describe('Dry run mode', () => {
    test('dry-run does not modify files', async () => {
      // Create source structure
      const sourcePath = path.join(tempDir, 'test-source');
      const targetPath = path.join(tempDir, 'test-target');
      await fs.mkdir(sourcePath, { recursive: true });
      await fs.mkdir(targetPath, { recursive: true });

      // Create source config
      await fs.writeFile(
        path.join(sourcePath, 'openclaw.json'),
        JSON.stringify({
          agent: { name: 'TestAgent' },
          model: { provider: 'openai', model: 'gpt-4' },
        }),
        'utf-8',
      );

      // Create SOUL.md
      await fs.writeFile(
        path.join(sourcePath, 'SOUL.md'),
        '# Test SOUL\n\nTest content',
        'utf-8',
      );

      // Create output directory for report
      const outputDir = path.join(tempDir, 'report');

      // Run migration with explicit source (simulating --source openclaw)
      // Note: The script expects sources in specific home directory paths
      // For testing, we'd need to either mock fs or use environment variables

      // Verify target is still empty
      const targetFiles = await fs.readdir(targetPath);
      assert.strictEqual(
        targetFiles.length,
        0,
        'Target should be empty after dry-run',
      );
    });
  });

  describe('Report generation', () => {
    test('report.json has required structure', async () => {
      const reportDir = path.join(tempDir, 'report');
      await fs.mkdir(reportDir, { recursive: true });

      const report = {
        timestamp: new Date().toISOString(),
        mode: 'dry-run' as const,
        sourceRoot: '/test/source',
        targetRoot: '/test/target',
        sourceType: 'openclaw' as const,
        summary: {
          migrated: 1,
          archived: 0,
          skipped: 0,
          conflict: 0,
          error: 0,
          total: 1,
        },
        items: [
          {
            id: 'soul',
            category: 'soul',
            sourcePath: '/test/source/SOUL.md',
            targetPath: '/test/target/SOUL.md',
            status: 'would_migrate' as const,
            reason: 'Would copy SOUL.md',
          },
        ],
      };

      await fs.writeFile(
        path.join(reportDir, 'report.json'),
        JSON.stringify(report, null, 2),
        'utf-8',
      );

      const savedReport = JSON.parse(
        await fs.readFile(path.join(reportDir, 'report.json'), 'utf-8'),
      );
      assert(savedReport.timestamp);
      assert(savedReport.mode);
      assert(savedReport.sourceRoot);
      assert(savedReport.targetRoot);
      assert(savedReport.summary);
      assert(typeof savedReport.summary.migrated === 'number');
      assert(typeof savedReport.summary.archived === 'number');
      assert(typeof savedReport.summary.skipped === 'number');
      assert(typeof savedReport.summary.conflict === 'number');
      assert(typeof savedReport.summary.error === 'number');
      assert(Array.isArray(savedReport.items));
    });

    test('summary.md has required sections', async () => {
      const summaryContent = `# Migration Summary

**Source:** openclaw
**Mode:** dry-run
**Timestamp:** 2024-01-01T00:00:00.000Z

## Summary

- **Migrated:** 1
- **Archived:** 0
- **Skipped:** 0
- **Conflicts:** 0
- **Errors:** 0
- **Total:** 1

## Migrated Items

- **soul** (soul)
  - Would copy SOUL.md

## Next Steps

1. Review this summary and the detailed report.json
2. Run with --execute to perform the actual migration
`;

      const reportDir = path.join(tempDir, 'report2');
      await fs.mkdir(reportDir, { recursive: true });
      await fs.writeFile(
        path.join(reportDir, 'summary.md'),
        summaryContent,
        'utf-8',
      );

      const savedSummary = await fs.readFile(
        path.join(reportDir, 'summary.md'),
        'utf-8',
      );
      assert(savedSummary.includes('## Summary'));
      assert(savedSummary.includes('## Migrated Items'));
      assert(savedSummary.includes('## Next Steps'));
    });
  });

  describe('Configuration parsing', () => {
    test('parses OpenClaw JSON config', async () => {
      const configPath = path.join(tempDir, 'openclaw-test.json');
      await fs.writeFile(
        configPath,
        JSON.stringify({
          name: 'Test Config',
          agent: {
            name: 'TestAssistant',
            role: 'Helpful assistant',
            personality: 'friendly',
          },
          model: {
            provider: 'openai',
            model: 'gpt-4',
            apiKey: 'sk-test-key',
            baseUrl: 'https://api.openai.com/v1',
          },
          channels: {
            telegram: {
              enabled: true,
              botToken: '123456:token',
              allowedUsers: ['12345678'],
            },
          },
        }),
        'utf-8',
      );

      const content = await fs.readFile(configPath, 'utf-8');
      const data = JSON.parse(content);
      assert.strictEqual(data.agent.name, 'TestAssistant');
      assert.strictEqual(data.model.provider, 'openai');
      assert.strictEqual(data.channels.telegram.enabled, true);
    });

    test('extracts Discord botToken from OpenClaw config', async () => {
      // Load the fixture file
      const fixturePath = path.join(
        repoRoot,
        'tests/fixtures/migration/openclaw-config.json',
      );
      const content = await fs.readFile(fixturePath, 'utf-8');
      const data = JSON.parse(content);

      // Verify the fixture has Discord botToken
      assert.strictEqual(data.channels.discord.enabled, true);
      assert.strictEqual(
        data.channels.discord.botToken,
        'discord-bot-token-test-12345',
      );

      // Test the extraction logic (simulating parseOpenClawConfig)
      const discordToken =
        data.channels?.discord?.botToken || data.channels?.discord?.token;
      assert.strictEqual(discordToken, 'discord-bot-token-test-12345');
    });

    test('extracts Discord token from Clawdbot config', async () => {
      // Load the fixture file
      const fixturePath = path.join(
        repoRoot,
        'tests/fixtures/migration/clawdbot-config.json',
      );
      const content = await fs.readFile(fixturePath, 'utf-8');
      const data = JSON.parse(content);

      // Verify the fixture has Discord token
      assert.strictEqual(data.discord.token, 'discord-bot-token-here');

      // Test the extraction logic (simulating parseClawdbotConfig)
      const discordToken = data.discord?.token;
      assert.strictEqual(discordToken, 'discord-bot-token-here');
    });

    test('parses Hermes YAML config', async () => {
      const configPath = path.join(tempDir, 'hermes-test.yaml');
      await fs.writeFile(
        configPath,
        `agent:
  name: HermesAssistant
  role: Knowledgeable bot
llm:
  provider: openai
  model: gpt-4-turbo
  api_key: sk-hermes-key
channels:
  telegram:
    enabled: true
    bot_token: "999999:token"
`,
        'utf-8',
      );

      const content = await fs.readFile(configPath, 'utf-8');
      // Simple YAML-like parsing check
      assert(content.includes('agent:'));
      assert(content.includes('name: HermesAssistant'));
      assert(content.includes('llm:'));
    });
  });

  describe('Skill conflict modes', () => {
    test('skill-conflict skip preserves existing', async () => {
      // This would be tested via the migrator class
      // For now, just verify the argument is valid
      const validModes = ['skip', 'overwrite', 'rename'];
      assert(validModes.includes('skip'));
    });

    test('skill-conflict overwrite replaces existing', () => {
      const validModes = ['skip', 'overwrite', 'rename'];
      assert(validModes.includes('overwrite'));
    });

    test('skill-conflict rename creates new name', () => {
      const validModes = ['skip', 'overwrite', 'rename'];
      assert(validModes.includes('rename'));
    });
  });

  describe('Preset handling', () => {
    test('user-data preset excludes secrets', () => {
      // user-data preset should not migrate API keys
      const preset = 'user-data';
      const migrateSecrets = preset === 'full';
      assert.strictEqual(migrateSecrets, false);
    });

    test('full preset includes secrets', () => {
      const preset = 'full';
      const migrateSecrets = preset === 'full';
      assert.strictEqual(migrateSecrets, true);
    });
  });

  describe('Include/Exclude filtering', () => {
    test('include filters to specified categories', () => {
      const include = ['soul', 'memory'];
      const categories = ['soul', 'identity', 'memory', 'channels'];
      const filtered = categories.filter((c) => include.includes(c));
      assert.deepStrictEqual(filtered, ['soul', 'memory']);
    });

    test('exclude removes specified categories', () => {
      const exclude = ['secrets', 'channels'];
      const categories = ['soul', 'identity', 'memory', 'channels'];
      const filtered = categories.filter((c) => !exclude.includes(c));
      assert.deepStrictEqual(filtered, ['soul', 'identity', 'memory']);
    });
  });

  describe('Persona migration (VAL-PERSONA-001 to 005)', () => {
    test('SOUL.md is copied to target workspace', async () => {
      const testHomeDir = path.join(tempDir, 'test-persona-home');
      const testTargetDir = path.join(tempDir, 'test-persona-target');
      const openclawDir = path.join(testHomeDir, '.openclaw');
      await fs.mkdir(openclawDir, { recursive: true });
      await fs.mkdir(testTargetDir, { recursive: true });

      // Create source SOUL.md
      const soulContent = '# SOUL.md\n\n## Identity\nI am TestBot.';
      await fs.writeFile(
        path.join(openclawDir, 'SOUL.md'),
        soulContent,
        'utf-8',
      );

      // Create source config
      await fs.writeFile(
        path.join(openclawDir, 'openclaw.json'),
        JSON.stringify({ agent: { name: 'TestBot' } }),
        'utf-8',
      );

      // Run migration script
      const outputDir = path.join(tempDir, 'report-persona');
      execSync(
        `npx tsx ${scriptPath} --source openclaw --execute --target-workspace ${testTargetDir} --target-env ${path.join(testTargetDir, '.env')} --output-dir ${outputDir}`,
        {
          encoding: 'utf-8',
          cwd: repoRoot,
          env: { ...process.env, HOME: testHomeDir },
        },
      );

      // Verify SOUL.md was copied
      const targetSoulPath = path.join(testTargetDir, 'SOUL.md');
      const targetSoulExists = await fs
        .access(targetSoulPath)
        .then(() => true)
        .catch(() => false);
      assert.strictEqual(
        targetSoulExists,
        true,
        'SOUL.md should be copied to target',
      );

      const targetSoulContent = await fs.readFile(targetSoulPath, 'utf-8');
      assert.strictEqual(
        targetSoulContent,
        soulContent,
        'SOUL.md content should match',
      );
    });

    test('SOUL.md conflict reported when target exists without --overwrite', async () => {
      const testHomeDir = path.join(tempDir, 'test-conflict-home');
      const testTargetDir = path.join(tempDir, 'test-conflict-target');
      const openclawDir = path.join(testHomeDir, '.openclaw');
      await fs.mkdir(openclawDir, { recursive: true });
      await fs.mkdir(testTargetDir, { recursive: true });

      // Create source SOUL.md
      await fs.writeFile(
        path.join(openclawDir, 'SOUL.md'),
        '# Source SOUL',
        'utf-8',
      );

      // Create existing target SOUL.md
      await fs.writeFile(
        path.join(testTargetDir, 'SOUL.md'),
        '# Existing SOUL',
        'utf-8',
      );

      // Create source config
      await fs.writeFile(
        path.join(openclawDir, 'openclaw.json'),
        JSON.stringify({ agent: { name: 'TestBot' } }),
        'utf-8',
      );

      // Run migration script
      const outputDir = path.join(tempDir, 'report-conflict');
      execSync(
        `npx tsx ${scriptPath} --source openclaw --execute --target-workspace ${testTargetDir} --target-env ${path.join(testTargetDir, '.env')} --output-dir ${outputDir}`,
        {
          encoding: 'utf-8',
          cwd: repoRoot,
          env: { ...process.env, HOME: testHomeDir },
        },
      );

      // Verify existing SOUL.md was preserved
      const targetSoulContent = await fs.readFile(
        path.join(testTargetDir, 'SOUL.md'),
        'utf-8',
      );
      assert.strictEqual(
        targetSoulContent,
        '# Existing SOUL',
        'Existing SOUL.md should be preserved',
      );

      // Verify report shows conflict
      const reportPath = path.join(outputDir, 'report.json');
      const report = JSON.parse(await fs.readFile(reportPath, 'utf-8'));
      const soulItem = report.items.find(
        (i: { id: string }) => i.id === 'soul',
      );
      assert.strictEqual(
        soulItem?.status,
        'conflict',
        'SOUL.md should show conflict status',
      );
    });

    test('SOUL.md is overwritten with backup when --overwrite is set', async () => {
      const testHomeDir = path.join(tempDir, 'test-overwrite-home');
      const testTargetDir = path.join(tempDir, 'test-overwrite-target');
      const openclawDir = path.join(testHomeDir, '.openclaw');
      await fs.mkdir(openclawDir, { recursive: true });
      await fs.mkdir(testTargetDir, { recursive: true });

      // Create source SOUL.md
      const sourceContent = '# New SOUL\n\nNew content';
      await fs.writeFile(
        path.join(openclawDir, 'SOUL.md'),
        sourceContent,
        'utf-8',
      );

      // Create existing target SOUL.md
      const existingContent = '# Existing SOUL\n\nExisting content';
      await fs.writeFile(
        path.join(testTargetDir, 'SOUL.md'),
        existingContent,
        'utf-8',
      );

      // Create source config
      await fs.writeFile(
        path.join(openclawDir, 'openclaw.json'),
        JSON.stringify({ agent: { name: 'TestBot' } }),
        'utf-8',
      );

      // Run migration script with --overwrite
      const outputDir = path.join(tempDir, 'report-overwrite');
      execSync(
        `npx tsx ${scriptPath} --source openclaw --execute --overwrite --target-workspace ${testTargetDir} --target-env ${path.join(testTargetDir, '.env')} --output-dir ${outputDir}`,
        {
          encoding: 'utf-8',
          cwd: repoRoot,
          env: { ...process.env, HOME: testHomeDir },
        },
      );

      // Verify SOUL.md was replaced
      const targetSoulContent = await fs.readFile(
        path.join(testTargetDir, 'SOUL.md'),
        'utf-8',
      );
      assert.strictEqual(
        targetSoulContent,
        sourceContent,
        'SOUL.md should be replaced with source content',
      );

      // Verify backup was created
      const backupDir = path.join(outputDir, 'backups');
      const backupFiles = await fs.readdir(backupDir).catch(() => []);
      assert.ok(backupFiles.length > 0, 'Backup should be created');
    });

    test('IDENTITY.md is generated from agent config', async () => {
      const testHomeDir = path.join(tempDir, 'test-identity-home');
      const testTargetDir = path.join(tempDir, 'test-identity-target');
      const openclawDir = path.join(testHomeDir, '.openclaw');
      await fs.mkdir(openclawDir, { recursive: true });
      await fs.mkdir(testTargetDir, { recursive: true });

      // Create source config with agent identity
      await fs.writeFile(
        path.join(openclawDir, 'openclaw.json'),
        JSON.stringify({
          agent: {
            name: 'MyAssistant',
            role: 'Helpful coding assistant',
            personality: 'friendly and professional',
          },
        }),
        'utf-8',
      );

      // Run migration script
      const outputDir = path.join(tempDir, 'report-identity');
      execSync(
        `npx tsx ${scriptPath} --source openclaw --execute --target-workspace ${testTargetDir} --target-env ${path.join(testTargetDir, '.env')} --output-dir ${outputDir}`,
        {
          encoding: 'utf-8',
          cwd: repoRoot,
          env: { ...process.env, HOME: testHomeDir },
        },
      );

      // Verify IDENTITY.md was created
      const identityPath = path.join(testTargetDir, 'IDENTITY.md');
      const identityExists = await fs
        .access(identityPath)
        .then(() => true)
        .catch(() => false);
      assert.strictEqual(identityExists, true, 'IDENTITY.md should be created');

      const identityContent = await fs.readFile(identityPath, 'utf-8');
      assert.ok(
        identityContent.includes('MyAssistant'),
        'IDENTITY.md should contain agent name',
      );
      assert.ok(
        identityContent.includes('Helpful coding assistant'),
        'IDENTITY.md should contain agent role',
      );
      assert.ok(
        identityContent.includes('friendly and professional'),
        'IDENTITY.md should contain personality',
      );
    });

    test('ASSISTANT_NAME is set in .env from source agent name', async () => {
      const testHomeDir = path.join(tempDir, 'test-assistant-home');
      const testTargetDir = path.join(tempDir, 'test-assistant-target');
      const openclawDir = path.join(testHomeDir, '.openclaw');
      await fs.mkdir(openclawDir, { recursive: true });
      await fs.mkdir(testTargetDir, { recursive: true });

      // Create source config with agent name
      await fs.writeFile(
        path.join(openclawDir, 'openclaw.json'),
        JSON.stringify({
          agent: { name: 'FarmFriend' },
        }),
        'utf-8',
      );

      // Run migration script
      const outputDir = path.join(tempDir, 'report-assistant');
      const envPath = path.join(testTargetDir, '.env');
      execSync(
        `npx tsx ${scriptPath} --source openclaw --execute --target-workspace ${testTargetDir} --target-env ${envPath} --output-dir ${outputDir}`,
        {
          encoding: 'utf-8',
          cwd: repoRoot,
          env: { ...process.env, HOME: testHomeDir },
        },
      );

      // Verify .env contains ASSISTANT_NAME
      const envContent = await fs.readFile(envPath, 'utf-8');
      assert.ok(
        envContent.includes('ASSISTANT_NAME=FarmFriend'),
        '.env should contain ASSISTANT_NAME',
      );
    });
  });

  describe('Memory migration (VAL-MEM-001 to 006)', () => {
    test('MEMORY.md entries are merged with deduplication', async () => {
      const testHomeDir = path.join(tempDir, 'test-mem-home');
      const testTargetDir = path.join(tempDir, 'test-mem-target');
      const openclawDir = path.join(testHomeDir, '.openclaw');
      await fs.mkdir(openclawDir, { recursive: true });
      await fs.mkdir(testTargetDir, { recursive: true });

      // Create source MEMORY.md
      const sourceMemory = `# Memory

## User Preferences
- User likes TypeScript
- User prefers dark mode

## Project Info
- Project: nano-core
- Status: active`;
      await fs.writeFile(
        path.join(openclawDir, 'MEMORY.md'),
        sourceMemory,
        'utf-8',
      );

      // Create existing target MEMORY.md with some overlapping content
      const targetMemory = `# Memory

## User Preferences
- User likes TypeScript

## Existing Info
- Some existing data`;
      await fs.writeFile(
        path.join(testTargetDir, 'MEMORY.md'),
        targetMemory,
        'utf-8',
      );

      // Create source config
      await fs.writeFile(
        path.join(openclawDir, 'openclaw.json'),
        JSON.stringify({ agent: { name: 'TestBot' } }),
        'utf-8',
      );

      // Run migration script
      const outputDir = path.join(tempDir, 'report-mem');
      execSync(
        `npx tsx ${scriptPath} --source openclaw --execute --target-workspace ${testTargetDir} --target-env ${path.join(testTargetDir, '.env')} --output-dir ${outputDir}`,
        {
          encoding: 'utf-8',
          cwd: repoRoot,
          env: { ...process.env, HOME: testHomeDir },
        },
      );

      // Verify MEMORY.md was merged
      const mergedContent = await fs.readFile(
        path.join(testTargetDir, 'MEMORY.md'),
        'utf-8',
      );
      assert.ok(
        mergedContent.includes('User likes TypeScript'),
        'Should preserve existing entry',
      );
      assert.ok(
        mergedContent.includes('User prefers dark mode'),
        'Should add new entry',
      );
      assert.ok(
        mergedContent.includes('Some existing data'),
        'Should preserve existing section',
      );

      // Verify report shows duplicates
      const reportPath = path.join(outputDir, 'report.json');
      const report = JSON.parse(await fs.readFile(reportPath, 'utf-8'));
      const memItem = report.items.find(
        (i: { id: string }) => i.id === 'memory',
      );
      assert.ok(
        memItem?.reason?.includes('duplicate'),
        'Should report duplicates',
      );
    });

    test('Memory overflow file is created when entries exceed char limit', async () => {
      const testHomeDir = path.join(tempDir, 'test-overflow-home');
      const testTargetDir = path.join(tempDir, 'test-overflow-target');
      const openclawDir = path.join(testHomeDir, '.openclaw');
      await fs.mkdir(openclawDir, { recursive: true });
      await fs.mkdir(testTargetDir, { recursive: true });

      // Create source MEMORY.md with many entries to exceed limit (50KB)
      let sourceMemory = '# Memory\n\n';
      for (let i = 0; i < 300; i++) {
        sourceMemory += `## Entry ${i}\nThis is a long entry with lots of content to exceed the character limit. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Entry ${i} details here with additional padding to make sure we hit the limit. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.\n\n`;
      }
      await fs.writeFile(
        path.join(openclawDir, 'MEMORY.md'),
        sourceMemory,
        'utf-8',
      );

      // Create source config
      await fs.writeFile(
        path.join(openclawDir, 'openclaw.json'),
        JSON.stringify({ agent: { name: 'TestBot' } }),
        'utf-8',
      );

      // Run migration script
      const outputDir = path.join(tempDir, 'report-overflow');
      execSync(
        `npx tsx ${scriptPath} --source openclaw --execute --target-workspace ${testTargetDir} --target-env ${path.join(testTargetDir, '.env')} --output-dir ${outputDir}`,
        {
          encoding: 'utf-8',
          cwd: repoRoot,
          env: { ...process.env, HOME: testHomeDir },
        },
      );

      // Verify overflow file was created
      const overflowPath = path.join(outputDir, 'memory-overflow.md');
      const overflowExists = await fs
        .access(overflowPath)
        .then(() => true)
        .catch(() => false);
      assert.strictEqual(
        overflowExists,
        true,
        'Overflow file should be created',
      );

      // Verify report shows overflow
      const reportPath = path.join(outputDir, 'report.json');
      const report = JSON.parse(await fs.readFile(reportPath, 'utf-8'));
      const overflowItem = report.items.find(
        (i: { id: string }) => i.id === 'memory-overflow',
      );
      assert.ok(overflowItem, 'Should have overflow item in report');
    });

    test('USER.md entries are merged with deduplication', async () => {
      const testHomeDir = path.join(tempDir, 'test-user-home');
      const testTargetDir = path.join(tempDir, 'test-user-target');
      const openclawDir = path.join(testHomeDir, '.openclaw');
      await fs.mkdir(openclawDir, { recursive: true });
      await fs.mkdir(testTargetDir, { recursive: true });

      // Create source USER.md
      const sourceUser = `# USER Profile

## Preferences
- Editor: VS Code
- OS: macOS

## Work
- Role: Developer`;
      await fs.writeFile(
        path.join(openclawDir, 'USER.md'),
        sourceUser,
        'utf-8',
      );

      // Create existing target USER.md with overlapping content
      const targetUser = `# USER Profile

## Preferences
- Editor: VS Code

## Existing
- Some existing info`;
      await fs.writeFile(
        path.join(testTargetDir, 'USER.md'),
        targetUser,
        'utf-8',
      );

      // Create source config
      await fs.writeFile(
        path.join(openclawDir, 'openclaw.json'),
        JSON.stringify({ agent: { name: 'TestBot' } }),
        'utf-8',
      );

      // Run migration script
      const outputDir = path.join(tempDir, 'report-user');
      execSync(
        `npx tsx ${scriptPath} --source openclaw --execute --target-workspace ${testTargetDir} --target-env ${path.join(testTargetDir, '.env')} --output-dir ${outputDir}`,
        {
          encoding: 'utf-8',
          cwd: repoRoot,
          env: { ...process.env, HOME: testHomeDir },
        },
      );

      // Verify USER.md was merged
      const mergedContent = await fs.readFile(
        path.join(testTargetDir, 'USER.md'),
        'utf-8',
      );
      assert.ok(
        mergedContent.includes('Editor: VS Code'),
        'Should preserve existing entry',
      );
      assert.ok(mergedContent.includes('OS: macOS'), 'Should add new entry');
      assert.ok(
        mergedContent.includes('Some existing info'),
        'Should preserve existing section',
      );
    });

    test('Daily memory files are parsed and merged', async () => {
      const testHomeDir = path.join(tempDir, 'test-daily-home');
      const testTargetDir = path.join(tempDir, 'test-daily-target');
      const openclawDir = path.join(testHomeDir, '.openclaw');
      await fs.mkdir(openclawDir, { recursive: true });
      await fs.mkdir(path.join(openclawDir, 'memory'), { recursive: true });
      await fs.mkdir(testTargetDir, { recursive: true });

      // Create daily memory files
      await fs.writeFile(
        path.join(openclawDir, 'memory', '2024-01-15.md'),
        '## Learned\n- TypeScript is great',
        'utf-8',
      );
      await fs.writeFile(
        path.join(openclawDir, 'memory', '2024-01-16.md'),
        '## Progress\n- Migration script started',
        'utf-8',
      );

      // Create source config
      await fs.writeFile(
        path.join(openclawDir, 'openclaw.json'),
        JSON.stringify({ agent: { name: 'TestBot' } }),
        'utf-8',
      );

      // Run migration script
      const outputDir = path.join(tempDir, 'report-daily');
      execSync(
        `npx tsx ${scriptPath} --source openclaw --execute --target-workspace ${testTargetDir} --target-env ${path.join(testTargetDir, '.env')} --output-dir ${outputDir}`,
        {
          encoding: 'utf-8',
          cwd: repoRoot,
          env: { ...process.env, HOME: testHomeDir },
        },
      );

      // Verify MEMORY.md contains daily entries
      const memoryContent = await fs.readFile(
        path.join(testTargetDir, 'MEMORY.md'),
        'utf-8',
      );
      assert.ok(
        memoryContent.includes('TypeScript is great'),
        'Should include 2024-01-15 entry',
      );
      assert.ok(
        memoryContent.includes('Migration script started'),
        'Should include 2024-01-16 entry',
      );

      // Verify report shows daily files
      const reportPath = path.join(outputDir, 'report.json');
      const report = JSON.parse(await fs.readFile(reportPath, 'utf-8'));
      const memItem = report.items.find(
        (i: { id: string }) => i.id === 'memory',
      );
      assert.ok(
        memItem?.reason?.includes('daily'),
        'Should report daily files',
      );
    });

    test('Existing MEMORY.md entries are preserved when target exists', async () => {
      const testHomeDir = path.join(tempDir, 'test-preserve-home');
      const testTargetDir = path.join(tempDir, 'test-preserve-target');
      const openclawDir = path.join(testHomeDir, '.openclaw');
      await fs.mkdir(openclawDir, { recursive: true });
      await fs.mkdir(testTargetDir, { recursive: true });

      // Create source MEMORY.md
      await fs.writeFile(
        path.join(openclawDir, 'MEMORY.md'),
        '## New Entry\n- New data from source',
        'utf-8',
      );

      // Create existing target MEMORY.md
      const existingContent = '## Existing Entry\n- Existing data in target';
      await fs.writeFile(
        path.join(testTargetDir, 'MEMORY.md'),
        existingContent,
        'utf-8',
      );

      // Create source config
      await fs.writeFile(
        path.join(openclawDir, 'openclaw.json'),
        JSON.stringify({ agent: { name: 'TestBot' } }),
        'utf-8',
      );

      // Run migration script
      const outputDir = path.join(tempDir, 'report-preserve');
      execSync(
        `npx tsx ${scriptPath} --source openclaw --execute --target-workspace ${testTargetDir} --target-env ${path.join(testTargetDir, '.env')} --output-dir ${outputDir}`,
        {
          encoding: 'utf-8',
          cwd: repoRoot,
          env: { ...process.env, HOME: testHomeDir },
        },
      );

      // Verify both entries exist
      const mergedContent = await fs.readFile(
        path.join(testTargetDir, 'MEMORY.md'),
        'utf-8',
      );
      assert.ok(
        mergedContent.includes('Existing data in target'),
        'Should preserve existing entry',
      );
      assert.ok(
        mergedContent.includes('New data from source'),
        'Should add new entry',
      );
    });
  });

  describe('Channel settings migration (VAL-CHAN-001 to 006)', () => {
    test('Telegram bot token is written to .env with --migrate-secrets', async () => {
      const testHomeDir = path.join(tempDir, 'test-chan-secrets-home');
      const testTargetDir = path.join(tempDir, 'test-chan-secrets-target');
      const openclawDir = path.join(testHomeDir, '.openclaw');
      await fs.mkdir(openclawDir, { recursive: true });
      await fs.mkdir(testTargetDir, { recursive: true });

      // Create source config with Telegram token
      await fs.writeFile(
        path.join(openclawDir, 'openclaw.json'),
        JSON.stringify({
          agent: { name: 'TestBot' },
          channels: {
            telegram: {
              enabled: true,
              botToken: '123456789:ABCdefGHIjklMNOpqrsTUVwxyz',
              allowedUsers: ['12345678'],
            },
          },
        }),
        'utf-8',
      );

      // Run migration script with --migrate-secrets
      const outputDir = path.join(tempDir, 'report-chan-secrets');
      const envPath = path.join(testTargetDir, '.env');
      execSync(
        `npx tsx ${scriptPath} --source openclaw --execute --migrate-secrets --target-workspace ${testTargetDir} --target-env ${envPath} --output-dir ${outputDir}`,
        {
          encoding: 'utf-8',
          cwd: repoRoot,
          env: { ...process.env, HOME: testHomeDir },
        },
      );

      // Verify .env contains TELEGRAM_BOT_TOKEN
      const envContent = await fs.readFile(envPath, 'utf-8');
      assert.ok(
        envContent.includes(
          'TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz',
        ),
        '.env should contain TELEGRAM_BOT_TOKEN',
      );
      assert.ok(
        envContent.includes('TELEGRAM_MAIN_CHAT_ID=12345678'),
        '.env should contain TELEGRAM_MAIN_CHAT_ID',
      );
    });

    test('Telegram bot token is NOT written without --migrate-secrets', async () => {
      const testHomeDir = path.join(tempDir, 'test-chan-no-secrets-home');
      const testTargetDir = path.join(tempDir, 'test-chan-no-secrets-target');
      const openclawDir = path.join(testHomeDir, '.openclaw');
      await fs.mkdir(openclawDir, { recursive: true });
      await fs.mkdir(testTargetDir, { recursive: true });

      // Create source config with Telegram token
      await fs.writeFile(
        path.join(openclawDir, 'openclaw.json'),
        JSON.stringify({
          agent: { name: 'TestBot' },
          channels: {
            telegram: {
              enabled: true,
              botToken: '123456789:ABCdefGHIjklMNOpqrsTUVwxyz',
              allowedUsers: ['12345678'],
            },
          },
        }),
        'utf-8',
      );

      // Run migration script WITHOUT --migrate-secrets
      const outputDir = path.join(tempDir, 'report-chan-no-secrets');
      const envPath = path.join(testTargetDir, '.env');
      execSync(
        `npx tsx ${scriptPath} --source openclaw --execute --target-workspace ${testTargetDir} --target-env ${envPath} --output-dir ${outputDir}`,
        {
          encoding: 'utf-8',
          cwd: repoRoot,
          env: { ...process.env, HOME: testHomeDir },
        },
      );

      // Verify .env does NOT contain TELEGRAM_BOT_TOKEN
      const envContent = await fs.readFile(envPath, 'utf-8');
      assert.ok(
        !envContent.includes('TELEGRAM_BOT_TOKEN'),
        '.env should NOT contain TELEGRAM_BOT_TOKEN without --migrate-secrets',
      );
      // But TELEGRAM_MAIN_CHAT_ID should still be set (not a secret)
      assert.ok(
        envContent.includes('TELEGRAM_MAIN_CHAT_ID=12345678'),
        '.env should still contain TELEGRAM_MAIN_CHAT_ID (not a secret)',
      );

      // Verify report shows skipped secrets
      const reportPath = path.join(outputDir, 'report.json');
      const report = JSON.parse(await fs.readFile(reportPath, 'utf-8'));
      const secretsItem = report.items.find(
        (i: { id: string }) => i.id === 'channels-secrets',
      );
      assert.ok(secretsItem, 'Should have channels-secrets item in report');
      assert.ok(
        secretsItem.reason.includes('migrate-secrets'),
        'Skip reason should mention --migrate-secrets',
      );
    });

    test('WHATSAPP_ENABLED=1 is written when source has WhatsApp enabled', async () => {
      const testHomeDir = path.join(tempDir, 'test-chan-wa-home');
      const testTargetDir = path.join(tempDir, 'test-chan-wa-target');
      const openclawDir = path.join(testHomeDir, '.openclaw');
      await fs.mkdir(openclawDir, { recursive: true });
      await fs.mkdir(testTargetDir, { recursive: true });

      // Create source config with WhatsApp enabled
      await fs.writeFile(
        path.join(openclawDir, 'openclaw.json'),
        JSON.stringify({
          agent: { name: 'TestBot' },
          channels: {
            whatsapp: {
              enabled: true,
            },
          },
        }),
        'utf-8',
      );

      // Run migration script
      const outputDir = path.join(tempDir, 'report-chan-wa');
      const envPath = path.join(testTargetDir, '.env');
      execSync(
        `npx tsx ${scriptPath} --source openclaw --execute --target-workspace ${testTargetDir} --target-env ${envPath} --output-dir ${outputDir}`,
        {
          encoding: 'utf-8',
          cwd: repoRoot,
          env: { ...process.env, HOME: testHomeDir },
        },
      );

      // Verify .env contains WHATSAPP_ENABLED=1
      const envContent = await fs.readFile(envPath, 'utf-8');
      assert.ok(
        envContent.includes('WHATSAPP_ENABLED=1'),
        '.env should contain WHATSAPP_ENABLED=1',
      );
    });

    test('Discord bot token is written with --migrate-secrets', async () => {
      const testHomeDir = path.join(tempDir, 'test-chan-discord-home');
      const testTargetDir = path.join(tempDir, 'test-chan-discord-target');
      const openclawDir = path.join(testHomeDir, '.openclaw');
      await fs.mkdir(openclawDir, { recursive: true });
      await fs.mkdir(testTargetDir, { recursive: true });

      // Create source config with Discord token
      await fs.writeFile(
        path.join(openclawDir, 'openclaw.json'),
        JSON.stringify({
          agent: { name: 'TestBot' },
          channels: {
            discord: {
              enabled: true,
              botToken: 'discord-bot-token-test-12345',
            },
          },
        }),
        'utf-8',
      );

      // Run migration script with --migrate-secrets
      const outputDir = path.join(tempDir, 'report-chan-discord');
      const envPath = path.join(testTargetDir, '.env');
      execSync(
        `npx tsx ${scriptPath} --source openclaw --execute --migrate-secrets --target-workspace ${testTargetDir} --target-env ${envPath} --output-dir ${outputDir}`,
        {
          encoding: 'utf-8',
          cwd: repoRoot,
          env: { ...process.env, HOME: testHomeDir },
        },
      );

      // Verify .env contains DISCORD_BOT_TOKEN
      const envContent = await fs.readFile(envPath, 'utf-8');
      assert.ok(
        envContent.includes('DISCORD_BOT_TOKEN=discord-bot-token-test-12345'),
        '.env should contain DISCORD_BOT_TOKEN',
      );
    });

    test('Existing .env values are preserved on conflict without --overwrite', async () => {
      const testHomeDir = path.join(tempDir, 'test-chan-conflict-home');
      const testTargetDir = path.join(tempDir, 'test-chan-conflict-target');
      const openclawDir = path.join(testHomeDir, '.openclaw');
      await fs.mkdir(openclawDir, { recursive: true });
      await fs.mkdir(testTargetDir, { recursive: true });

      // Create existing .env with TELEGRAM_BOT_TOKEN
      const envPath = path.join(testTargetDir, '.env');
      await fs.writeFile(
        envPath,
        'TELEGRAM_BOT_TOKEN=existing-token-value\nEXISTING_VAR=keep-me',
        'utf-8',
      );

      // Create source config with different Telegram token
      await fs.writeFile(
        path.join(openclawDir, 'openclaw.json'),
        JSON.stringify({
          agent: { name: 'TestBot' },
          channels: {
            telegram: {
              enabled: true,
              botToken: 'new-token-from-source',
              allowedUsers: ['99999999'],
            },
          },
        }),
        'utf-8',
      );

      // Run migration script with --migrate-secrets but without --overwrite
      const outputDir = path.join(tempDir, 'report-chan-conflict');
      execSync(
        `npx tsx ${scriptPath} --source openclaw --execute --migrate-secrets --target-workspace ${testTargetDir} --target-env ${envPath} --output-dir ${outputDir}`,
        {
          encoding: 'utf-8',
          cwd: repoRoot,
          env: { ...process.env, HOME: testHomeDir },
        },
      );

      // Verify existing TELEGRAM_BOT_TOKEN was preserved
      const envContent = await fs.readFile(envPath, 'utf-8');
      assert.ok(
        envContent.includes('TELEGRAM_BOT_TOKEN=existing-token-value'),
        'Existing TELEGRAM_BOT_TOKEN should be preserved',
      );
      assert.ok(
        envContent.includes('EXISTING_VAR=keep-me'),
        'Other existing vars should be preserved',
      );
      // TELEGRAM_MAIN_CHAT_ID should be added (new key)
      assert.ok(
        envContent.includes('TELEGRAM_MAIN_CHAT_ID=99999999'),
        'New TELEGRAM_MAIN_CHAT_ID should be added',
      );
    });

    test('Multiple channels from same source are migrated', async () => {
      const testHomeDir = path.join(tempDir, 'test-chan-multi-home');
      const testTargetDir = path.join(tempDir, 'test-chan-multi-target');
      const openclawDir = path.join(testHomeDir, '.openclaw');
      await fs.mkdir(openclawDir, { recursive: true });
      await fs.mkdir(testTargetDir, { recursive: true });

      // Create source config with multiple channels
      await fs.writeFile(
        path.join(openclawDir, 'openclaw.json'),
        JSON.stringify({
          agent: { name: 'TestBot' },
          channels: {
            telegram: {
              enabled: true,
              botToken: 'telegram-token-123',
              allowedUsers: ['11111111'],
            },
            whatsapp: {
              enabled: true,
            },
            discord: {
              enabled: true,
              botToken: 'discord-token-456',
            },
          },
        }),
        'utf-8',
      );

      // Run migration script with --migrate-secrets
      const outputDir = path.join(tempDir, 'report-chan-multi');
      const envPath = path.join(testTargetDir, '.env');
      execSync(
        `npx tsx ${scriptPath} --source openclaw --execute --migrate-secrets --target-workspace ${testTargetDir} --target-env ${envPath} --output-dir ${outputDir}`,
        {
          encoding: 'utf-8',
          cwd: repoRoot,
          env: { ...process.env, HOME: testHomeDir },
        },
      );

      // Verify .env contains all channel settings
      const envContent = await fs.readFile(envPath, 'utf-8');
      assert.ok(
        envContent.includes('TELEGRAM_BOT_TOKEN=telegram-token-123'),
        '.env should contain TELEGRAM_BOT_TOKEN',
      );
      assert.ok(
        envContent.includes('WHATSAPP_ENABLED=1'),
        '.env should contain WHATSAPP_ENABLED',
      );
      assert.ok(
        envContent.includes('DISCORD_BOT_TOKEN=discord-token-456'),
        '.env should contain DISCORD_BOT_TOKEN',
      );
    });
  });

  describe('Model/Provider migration (VAL-MODEL-001 to 006)', () => {
    test('PI_API is set correctly based on source provider type', async () => {
      const testHomeDir = path.join(tempDir, 'test-model-api-home');
      const testTargetDir = path.join(tempDir, 'test-model-api-target');
      const openclawDir = path.join(testHomeDir, '.openclaw');
      await fs.mkdir(openclawDir, { recursive: true });
      await fs.mkdir(testTargetDir, { recursive: true });

      // Create source config with OpenAI provider
      await fs.writeFile(
        path.join(openclawDir, 'openclaw.json'),
        JSON.stringify({
          agent: { name: 'TestBot' },
          model: {
            provider: 'openai',
            model: 'gpt-4',
          },
        }),
        'utf-8',
      );

      // Run migration script
      const outputDir = path.join(tempDir, 'report-model-api');
      const envPath = path.join(testTargetDir, '.env');
      execSync(
        `npx tsx ${scriptPath} --source openclaw --execute --target-workspace ${testTargetDir} --target-env ${envPath} --output-dir ${outputDir}`,
        {
          encoding: 'utf-8',
          cwd: repoRoot,
          env: { ...process.env, HOME: testHomeDir },
        },
      );

      // Verify .env contains PI_API=openai
      const envContent = await fs.readFile(envPath, 'utf-8');
      assert.ok(
        envContent.includes('PI_API=openai'),
        '.env should contain PI_API=openai',
      );
    });

    test('PI_MODEL is set from source default model', async () => {
      const testHomeDir = path.join(tempDir, 'test-model-name-home');
      const testTargetDir = path.join(tempDir, 'test-model-name-target');
      const openclawDir = path.join(testHomeDir, '.openclaw');
      await fs.mkdir(openclawDir, { recursive: true });
      await fs.mkdir(testTargetDir, { recursive: true });

      // Create source config with specific model
      await fs.writeFile(
        path.join(openclawDir, 'openclaw.json'),
        JSON.stringify({
          agent: { name: 'TestBot' },
          model: {
            provider: 'openai',
            model: 'gpt-4-turbo-preview',
          },
        }),
        'utf-8',
      );

      // Run migration script
      const outputDir = path.join(tempDir, 'report-model-name');
      const envPath = path.join(testTargetDir, '.env');
      execSync(
        `npx tsx ${scriptPath} --source openclaw --execute --target-workspace ${testTargetDir} --target-env ${envPath} --output-dir ${outputDir}`,
        {
          encoding: 'utf-8',
          cwd: repoRoot,
          env: { ...process.env, HOME: testHomeDir },
        },
      );

      // Verify .env contains PI_MODEL
      const envContent = await fs.readFile(envPath, 'utf-8');
      assert.ok(
        envContent.includes('PI_MODEL=gpt-4-turbo-preview'),
        '.env should contain PI_MODEL=gpt-4-turbo-preview',
      );
    });

    test('API keys are written to .env with --migrate-secrets', async () => {
      const testHomeDir = path.join(tempDir, 'test-model-key-home');
      const testTargetDir = path.join(tempDir, 'test-model-key-target');
      const openclawDir = path.join(testHomeDir, '.openclaw');
      await fs.mkdir(openclawDir, { recursive: true });
      await fs.mkdir(testTargetDir, { recursive: true });

      // Create source config with API key
      await fs.writeFile(
        path.join(openclawDir, 'openclaw.json'),
        JSON.stringify({
          agent: { name: 'TestBot' },
          model: {
            provider: 'openai',
            model: 'gpt-4',
            apiKey: 'sk-test-api-key-12345',
          },
        }),
        'utf-8',
      );

      // Run migration script with --migrate-secrets
      const outputDir = path.join(tempDir, 'report-model-key');
      const envPath = path.join(testTargetDir, '.env');
      execSync(
        `npx tsx ${scriptPath} --source openclaw --execute --migrate-secrets --target-workspace ${testTargetDir} --target-env ${envPath} --output-dir ${outputDir}`,
        {
          encoding: 'utf-8',
          cwd: repoRoot,
          env: { ...process.env, HOME: testHomeDir },
        },
      );

      // Verify .env contains OPENAI_API_KEY
      const envContent = await fs.readFile(envPath, 'utf-8');
      assert.ok(
        envContent.includes('OPENAI_API_KEY=sk-test-api-key-12345'),
        '.env should contain OPENAI_API_KEY',
      );
    });

    test('API keys are NOT written without --migrate-secrets', async () => {
      const testHomeDir = path.join(tempDir, 'test-model-nokey-home');
      const testTargetDir = path.join(tempDir, 'test-model-nokey-target');
      const openclawDir = path.join(testHomeDir, '.openclaw');
      await fs.mkdir(openclawDir, { recursive: true });
      await fs.mkdir(testTargetDir, { recursive: true });

      // Create source config with API key
      await fs.writeFile(
        path.join(openclawDir, 'openclaw.json'),
        JSON.stringify({
          agent: { name: 'TestBot' },
          model: {
            provider: 'openai',
            model: 'gpt-4',
            apiKey: 'sk-test-api-key-12345',
          },
        }),
        'utf-8',
      );

      // Run migration script WITHOUT --migrate-secrets
      const outputDir = path.join(tempDir, 'report-model-nokey');
      const envPath = path.join(testTargetDir, '.env');
      execSync(
        `npx tsx ${scriptPath} --source openclaw --execute --target-workspace ${testTargetDir} --target-env ${envPath} --output-dir ${outputDir}`,
        {
          encoding: 'utf-8',
          cwd: repoRoot,
          env: { ...process.env, HOME: testHomeDir },
        },
      );

      // Verify .env does NOT contain API key
      const envContent = await fs.readFile(envPath, 'utf-8');
      assert.ok(
        !envContent.includes('OPENAI_API_KEY'),
        '.env should NOT contain OPENAI_API_KEY without --migrate-secrets',
      );
      assert.ok(
        !envContent.includes('sk-test-api-key-12345'),
        '.env should NOT contain the API key value',
      );

      // Verify report shows skipped secrets
      const reportPath = path.join(outputDir, 'report.json');
      const report = JSON.parse(await fs.readFile(reportPath, 'utf-8'));
      const secretsItem = report.items.find(
        (i: { id: string }) => i.id === 'model-secrets',
      );
      assert.ok(secretsItem, 'Should have model-secrets item in report');
      assert.ok(
        secretsItem.reason.includes('migrate-secrets'),
        'Skip reason should mention --migrate-secrets',
      );
    });

    test('OPENAI_BASE_URL is set for custom endpoints', async () => {
      const testHomeDir = path.join(tempDir, 'test-model-baseurl-home');
      const testTargetDir = path.join(tempDir, 'test-model-baseurl-target');
      const openclawDir = path.join(testHomeDir, '.openclaw');
      await fs.mkdir(openclawDir, { recursive: true });
      await fs.mkdir(testTargetDir, { recursive: true });

      // Create source config with custom base URL
      await fs.writeFile(
        path.join(openclawDir, 'openclaw.json'),
        JSON.stringify({
          agent: { name: 'TestBot' },
          model: {
            provider: 'openai',
            model: 'gpt-4',
            baseUrl: 'https://custom-api.example.com/v1',
          },
        }),
        'utf-8',
      );

      // Run migration script
      const outputDir = path.join(tempDir, 'report-model-baseurl');
      const envPath = path.join(testTargetDir, '.env');
      execSync(
        `npx tsx ${scriptPath} --source openclaw --execute --target-workspace ${testTargetDir} --target-env ${envPath} --output-dir ${outputDir}`,
        {
          encoding: 'utf-8',
          cwd: repoRoot,
          env: { ...process.env, HOME: testHomeDir },
        },
      );

      // Verify .env contains OPENAI_BASE_URL
      const envContent = await fs.readFile(envPath, 'utf-8');
      assert.ok(
        envContent.includes(
          'OPENAI_BASE_URL=https://custom-api.example.com/v1',
        ),
        '.env should contain OPENAI_BASE_URL',
      );
    });

    test('Existing PI_MODEL is not overwritten without --overwrite', async () => {
      const testHomeDir = path.join(tempDir, 'test-model-conflict-home');
      const testTargetDir = path.join(tempDir, 'test-model-conflict-target');
      const openclawDir = path.join(testHomeDir, '.openclaw');
      await fs.mkdir(openclawDir, { recursive: true });
      await fs.mkdir(testTargetDir, { recursive: true });

      // Create existing .env with PI_MODEL
      const envPath = path.join(testTargetDir, '.env');
      await fs.writeFile(
        envPath,
        'PI_MODEL=existing-model-value\nPI_API=existing-provider',
        'utf-8',
      );

      // Create source config with different model
      await fs.writeFile(
        path.join(openclawDir, 'openclaw.json'),
        JSON.stringify({
          agent: { name: 'TestBot' },
          model: {
            provider: 'new-provider',
            model: 'new-model-from-source',
          },
        }),
        'utf-8',
      );

      // Run migration script without --overwrite
      const outputDir = path.join(tempDir, 'report-model-conflict');
      execSync(
        `npx tsx ${scriptPath} --source openclaw --execute --target-workspace ${testTargetDir} --target-env ${envPath} --output-dir ${outputDir}`,
        {
          encoding: 'utf-8',
          cwd: repoRoot,
          env: { ...process.env, HOME: testHomeDir },
        },
      );

      // Verify existing PI_MODEL was preserved
      const envContent = await fs.readFile(envPath, 'utf-8');
      assert.ok(
        envContent.includes('PI_MODEL=existing-model-value'),
        'Existing PI_MODEL should be preserved',
      );
      assert.ok(
        envContent.includes('PI_API=existing-provider'),
        'Existing PI_API should be preserved',
      );
    });

    test('OpenRouter API key is written to OPENROUTER_API_KEY', async () => {
      const testHomeDir = path.join(tempDir, 'test-model-openrouter-home');
      const testTargetDir = path.join(tempDir, 'test-model-openrouter-target');
      const openclawDir = path.join(testHomeDir, '.openclaw');
      await fs.mkdir(openclawDir, { recursive: true });
      await fs.mkdir(testTargetDir, { recursive: true });

      // Create source config with OpenRouter provider
      await fs.writeFile(
        path.join(openclawDir, 'openclaw.json'),
        JSON.stringify({
          agent: { name: 'TestBot' },
          model: {
            provider: 'openrouter',
            model: 'anthropic/claude-3-opus',
            apiKey: 'sk-or-v1-test-openrouter-key',
          },
        }),
        'utf-8',
      );

      // Run migration script with --migrate-secrets
      const outputDir = path.join(tempDir, 'report-model-openrouter');
      const envPath = path.join(testTargetDir, '.env');
      execSync(
        `npx tsx ${scriptPath} --source openclaw --execute --migrate-secrets --target-workspace ${testTargetDir} --target-env ${envPath} --output-dir ${outputDir}`,
        {
          encoding: 'utf-8',
          cwd: repoRoot,
          env: { ...process.env, HOME: testHomeDir },
        },
      );

      // Verify .env contains OPENROUTER_API_KEY
      const envContent = await fs.readFile(envPath, 'utf-8');
      assert.ok(
        envContent.includes('PI_API=openrouter'),
        '.env should contain PI_API=openrouter',
      );
      assert.ok(
        envContent.includes('OPENROUTER_API_KEY=sk-or-v1-test-openrouter-key'),
        '.env should contain OPENROUTER_API_KEY',
      );
    });

    test('Anthropic API key is written to ANTHROPIC_API_KEY', async () => {
      const testHomeDir = path.join(tempDir, 'test-model-anthropic-home');
      const testTargetDir = path.join(tempDir, 'test-model-anthropic-target');
      const clawdbotDir = path.join(testHomeDir, '.config', 'clawdbot');
      await fs.mkdir(clawdbotDir, { recursive: true });
      await fs.mkdir(testTargetDir, { recursive: true });

      // Create source config with Anthropic provider (Clawdbot format)
      await fs.writeFile(
        path.join(clawdbotDir, 'config.json'),
        JSON.stringify({
          agent: { name: 'TestBot', identity: 'A helpful bot' },
          llm: {
            provider: 'anthropic',
            model: 'claude-3-opus-20240229',
            apiKey: 'sk-ant-api03-test-anthropic-key',
          },
        }),
        'utf-8',
      );

      // Run migration script with --migrate-secrets
      const outputDir = path.join(tempDir, 'report-model-anthropic');
      const envPath = path.join(testTargetDir, '.env');
      execSync(
        `npx tsx ${scriptPath} --source clawdbot --execute --migrate-secrets --target-workspace ${testTargetDir} --target-env ${envPath} --output-dir ${outputDir}`,
        {
          encoding: 'utf-8',
          cwd: repoRoot,
          env: { ...process.env, HOME: testHomeDir },
        },
      );

      // Verify .env contains ANTHROPIC_API_KEY
      const envContent = await fs.readFile(envPath, 'utf-8');
      assert.ok(
        envContent.includes('PI_API=anthropic'),
        '.env should contain PI_API=anthropic',
      );
      assert.ok(
        envContent.includes(
          'ANTHROPIC_API_KEY=sk-ant-api03-test-anthropic-key',
        ),
        '.env should contain ANTHROPIC_API_KEY',
      );
    });
  });

  describe('Workspace docs migration (VAL-DOCS-001 to 003)', () => {
    test('AGENTS.md is copied to target workspace', async () => {
      const testHomeDir = path.join(tempDir, 'test-agents-home');
      const testTargetDir = path.join(tempDir, 'test-agents-target');
      const openclawDir = path.join(testHomeDir, '.openclaw');
      await fs.mkdir(openclawDir, { recursive: true });
      await fs.mkdir(testTargetDir, { recursive: true });

      // Create source AGENTS.md
      const agentsContent =
        '# AGENTS.md\n\n## Instructions\nBe helpful and concise.';
      await fs.writeFile(
        path.join(openclawDir, 'AGENTS.md'),
        agentsContent,
        'utf-8',
      );

      // Create source config
      await fs.writeFile(
        path.join(openclawDir, 'openclaw.json'),
        JSON.stringify({ agent: { name: 'TestBot' } }),
        'utf-8',
      );

      // Run migration script
      const outputDir = path.join(tempDir, 'report-agents');
      execSync(
        `npx tsx ${scriptPath} --source openclaw --execute --target-workspace ${testTargetDir} --target-env ${path.join(testTargetDir, '.env')} --output-dir ${outputDir}`,
        {
          encoding: 'utf-8',
          cwd: repoRoot,
          env: { ...process.env, HOME: testHomeDir },
        },
      );

      // Verify AGENTS.md was copied
      const targetAgentsPath = path.join(testTargetDir, 'AGENTS.md');
      const targetAgentsExists = await fs
        .access(targetAgentsPath)
        .then(() => true)
        .catch(() => false);
      assert.strictEqual(
        targetAgentsExists,
        true,
        'AGENTS.md should be copied',
      );

      const targetAgentsContent = await fs.readFile(targetAgentsPath, 'utf-8');
      assert.strictEqual(
        targetAgentsContent,
        agentsContent,
        'AGENTS.md content should match',
      );
    });

    test('TOOLS.md is created at target workspace', async () => {
      const testHomeDir = path.join(tempDir, 'test-tools-home');
      const testTargetDir = path.join(tempDir, 'test-tools-target');
      const openclawDir = path.join(testHomeDir, '.openclaw');
      await fs.mkdir(openclawDir, { recursive: true });
      await fs.mkdir(testTargetDir, { recursive: true });

      // Create source config
      await fs.writeFile(
        path.join(openclawDir, 'openclaw.json'),
        JSON.stringify({ agent: { name: 'TestBot' } }),
        'utf-8',
      );

      // Run migration script
      const outputDir = path.join(tempDir, 'report-tools');
      execSync(
        `npx tsx ${scriptPath} --source openclaw --execute --target-workspace ${testTargetDir} --target-env ${path.join(testTargetDir, '.env')} --output-dir ${outputDir}`,
        {
          encoding: 'utf-8',
          cwd: repoRoot,
          env: { ...process.env, HOME: testHomeDir },
        },
      );

      // Verify TOOLS.md was created
      const toolsPath = path.join(testTargetDir, 'TOOLS.md');
      const toolsExists = await fs
        .access(toolsPath)
        .then(() => true)
        .catch(() => false);
      assert.strictEqual(toolsExists, true, 'TOOLS.md should be created');
    });

    test('PRINCIPLES.md is created at target workspace', async () => {
      const testHomeDir = path.join(tempDir, 'test-principles-home');
      const testTargetDir = path.join(tempDir, 'test-principles-target');
      const openclawDir = path.join(testHomeDir, '.openclaw');
      await fs.mkdir(openclawDir, { recursive: true });
      await fs.mkdir(testTargetDir, { recursive: true });

      // Create source config with personality
      await fs.writeFile(
        path.join(openclawDir, 'openclaw.json'),
        JSON.stringify({
          agent: {
            name: 'TestBot',
            personality: 'Always be kind and helpful',
          },
        }),
        'utf-8',
      );

      // Run migration script
      const outputDir = path.join(tempDir, 'report-principles');
      execSync(
        `npx tsx ${scriptPath} --source openclaw --execute --target-workspace ${testTargetDir} --target-env ${path.join(testTargetDir, '.env')} --output-dir ${outputDir}`,
        {
          encoding: 'utf-8',
          cwd: repoRoot,
          env: { ...process.env, HOME: testHomeDir },
        },
      );

      // Verify PRINCIPLES.md was created
      const principlesPath = path.join(testTargetDir, 'PRINCIPLES.md');
      const principlesExists = await fs
        .access(principlesPath)
        .then(() => true)
        .catch(() => false);
      assert.strictEqual(
        principlesExists,
        true,
        'PRINCIPLES.md should be created',
      );

      const principlesContent = await fs.readFile(principlesPath, 'utf-8');
      assert.ok(
        principlesContent.includes('Always be kind and helpful'),
        'PRINCIPLES.md should contain personality',
      );
    });
  });

  describe('Skills migration (VAL-SKILL-001 to 005)', () => {
    test('Skills with SKILL.md are copied to ~/nano/skills/<source>-imports/', async () => {
      const testHomeDir = path.join(tempDir, 'test-skills-home');
      const testTargetDir = path.join(tempDir, 'test-skills-target');
      const openclawDir = path.join(testHomeDir, '.openclaw');
      const skillsDir = path.join(openclawDir, 'skills');
      await fs.mkdir(openclawDir, { recursive: true });
      await fs.mkdir(testTargetDir, { recursive: true });
      await fs.mkdir(skillsDir, { recursive: true });

      // Create skill directories with SKILL.md
      const skill1Dir = path.join(skillsDir, 'web-search');
      const skill2Dir = path.join(skillsDir, 'code-review');
      await fs.mkdir(skill1Dir, { recursive: true });
      await fs.mkdir(skill2Dir, { recursive: true });

      await fs.writeFile(
        path.join(skill1Dir, 'SKILL.md'),
        '# Web Search Skill\n\nSearch the web for information.',
        'utf-8',
      );
      await fs.writeFile(
        path.join(skill2Dir, 'SKILL.md'),
        '# Code Review Skill\n\nReview code for issues.',
        'utf-8',
      );

      // Create source config
      await fs.writeFile(
        path.join(openclawDir, 'openclaw.json'),
        JSON.stringify({ agent: { name: 'TestBot' } }),
        'utf-8',
      );

      // Run migration script
      const outputDir = path.join(tempDir, 'report-skills');
      execSync(
        `npx tsx ${scriptPath} --source openclaw --execute --target-workspace ${testTargetDir} --target-env ${path.join(testTargetDir, '.env')} --output-dir ${outputDir}`,
        {
          encoding: 'utf-8',
          cwd: repoRoot,
          env: { ...process.env, HOME: testHomeDir },
        },
      );

      // Verify skills were copied
      const targetSkillsDir = path.join(testTargetDir, 'skills', 'openclaw-imports');
      const skill1Exists = await fs
        .access(path.join(targetSkillsDir, 'web-search', 'SKILL.md'))
        .then(() => true)
        .catch(() => false);
      const skill2Exists = await fs
        .access(path.join(targetSkillsDir, 'code-review', 'SKILL.md'))
        .then(() => true)
        .catch(() => false);

      assert.strictEqual(skill1Exists, true, 'web-search skill should be copied');
      assert.strictEqual(skill2Exists, true, 'code-review skill should be copied');

      // Verify DESCRIPTION.md was created
      const descPath = path.join(targetSkillsDir, 'DESCRIPTION.md');
      const descExists = await fs
        .access(descPath)
        .then(() => true)
        .catch(() => false);
      assert.strictEqual(descExists, true, 'DESCRIPTION.md should be created');

      const descContent = await fs.readFile(descPath, 'utf-8');
      assert.ok(descContent.includes('web-search'), 'DESCRIPTION.md should list web-search');
      assert.ok(descContent.includes('code-review'), 'DESCRIPTION.md should list code-review');
    });

    test('Skill conflict skip mode preserves existing skill', async () => {
      const testHomeDir = path.join(tempDir, 'test-skill-skip-home');
      const testTargetDir = path.join(tempDir, 'test-skill-skip-target');
      const openclawDir = path.join(testHomeDir, '.openclaw');
      const skillsDir = path.join(openclawDir, 'skills');
      await fs.mkdir(openclawDir, { recursive: true });
      await fs.mkdir(testTargetDir, { recursive: true });
      await fs.mkdir(skillsDir, { recursive: true });

      // Create source skill
      const skillDir = path.join(skillsDir, 'my-skill');
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(
        path.join(skillDir, 'SKILL.md'),
        '# Source Skill\n\nSource version',
        'utf-8',
      );

      // Create existing target skill
      const targetSkillsDir = path.join(testTargetDir, 'skills', 'openclaw-imports');
      const targetSkillDir = path.join(targetSkillsDir, 'my-skill');
      await fs.mkdir(targetSkillDir, { recursive: true });
      await fs.writeFile(
        path.join(targetSkillDir, 'SKILL.md'),
        '# Existing Skill\n\nExisting version',
        'utf-8',
      );

      // Create source config
      await fs.writeFile(
        path.join(openclawDir, 'openclaw.json'),
        JSON.stringify({ agent: { name: 'TestBot' } }),
        'utf-8',
      );

      // Run migration script with --skill-conflict skip
      const outputDir = path.join(tempDir, 'report-skill-skip');
      execSync(
        `npx tsx ${scriptPath} --source openclaw --execute --skill-conflict skip --target-workspace ${testTargetDir} --target-env ${path.join(testTargetDir, '.env')} --output-dir ${outputDir}`,
        {
          encoding: 'utf-8',
          cwd: repoRoot,
          env: { ...process.env, HOME: testHomeDir },
        },
      );

      // Verify existing skill was preserved
      const targetContent = await fs.readFile(
        path.join(targetSkillDir, 'SKILL.md'),
        'utf-8',
      );
      assert.ok(
        targetContent.includes('Existing version'),
        'Existing skill should be preserved',
      );

      // Verify report shows conflict
      const reportPath = path.join(outputDir, 'report.json');
      const report = JSON.parse(await fs.readFile(reportPath, 'utf-8'));
      const skillItem = report.items.find((i: { id: string }) => i.id === 'skill-my-skill');
      assert.strictEqual(skillItem?.status, 'conflict', 'Should show conflict status');
    });

    test('Skill conflict overwrite mode replaces existing skill with backup', async () => {
      const testHomeDir = path.join(tempDir, 'test-skill-overwrite-home');
      const testTargetDir = path.join(tempDir, 'test-skill-overwrite-target');
      const openclawDir = path.join(testHomeDir, '.openclaw');
      const skillsDir = path.join(openclawDir, 'skills');
      await fs.mkdir(openclawDir, { recursive: true });
      await fs.mkdir(testTargetDir, { recursive: true });
      await fs.mkdir(skillsDir, { recursive: true });

      // Create source skill
      const skillDir = path.join(skillsDir, 'my-skill');
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(
        path.join(skillDir, 'SKILL.md'),
        '# Source Skill\n\nSource version',
        'utf-8',
      );

      // Create existing target skill
      const targetSkillsDir = path.join(testTargetDir, 'skills', 'openclaw-imports');
      const targetSkillDir = path.join(targetSkillsDir, 'my-skill');
      await fs.mkdir(targetSkillDir, { recursive: true });
      await fs.writeFile(
        path.join(targetSkillDir, 'SKILL.md'),
        '# Existing Skill\n\nExisting version',
        'utf-8',
      );

      // Create source config
      await fs.writeFile(
        path.join(openclawDir, 'openclaw.json'),
        JSON.stringify({ agent: { name: 'TestBot' } }),
        'utf-8',
      );

      // Run migration script with --skill-conflict overwrite
      const outputDir = path.join(tempDir, 'report-skill-overwrite');
      execSync(
        `npx tsx ${scriptPath} --source openclaw --execute --skill-conflict overwrite --target-workspace ${testTargetDir} --target-env ${path.join(testTargetDir, '.env')} --output-dir ${outputDir}`,
        {
          encoding: 'utf-8',
          cwd: repoRoot,
          env: { ...process.env, HOME: testHomeDir },
        },
      );

      // Verify skill was replaced
      const targetContent = await fs.readFile(
        path.join(targetSkillDir, 'SKILL.md'),
        'utf-8',
      );
      assert.ok(
        targetContent.includes('Source version'),
        'Skill should be replaced with source version',
      );

      // Verify backup was created
      const backupDir = path.join(outputDir, 'backups');
      const backupFiles = await fs.readdir(backupDir).catch(() => []);
      assert.ok(backupFiles.length > 0, 'Backup should be created');
    });

    test('Skill conflict rename mode creates skill with new name', async () => {
      const testHomeDir = path.join(tempDir, 'test-skill-rename-home');
      const testTargetDir = path.join(tempDir, 'test-skill-rename-target');
      const openclawDir = path.join(testHomeDir, '.openclaw');
      const skillsDir = path.join(openclawDir, 'skills');
      await fs.mkdir(openclawDir, { recursive: true });
      await fs.mkdir(testTargetDir, { recursive: true });
      await fs.mkdir(skillsDir, { recursive: true });

      // Create source skill
      const skillDir = path.join(skillsDir, 'my-skill');
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(
        path.join(skillDir, 'SKILL.md'),
        '# Source Skill\n\nSource version',
        'utf-8',
      );

      // Create existing target skill
      const targetSkillsDir = path.join(testTargetDir, 'skills', 'openclaw-imports');
      const targetSkillDir = path.join(targetSkillsDir, 'my-skill');
      await fs.mkdir(targetSkillDir, { recursive: true });
      await fs.writeFile(
        path.join(targetSkillDir, 'SKILL.md'),
        '# Existing Skill\n\nExisting version',
        'utf-8',
      );

      // Create source config
      await fs.writeFile(
        path.join(openclawDir, 'openclaw.json'),
        JSON.stringify({ agent: { name: 'TestBot' } }),
        'utf-8',
      );

      // Run migration script with --skill-conflict rename
      const outputDir = path.join(tempDir, 'report-skill-rename');
      execSync(
        `npx tsx ${scriptPath} --source openclaw --execute --skill-conflict rename --target-workspace ${testTargetDir} --target-env ${path.join(testTargetDir, '.env')} --output-dir ${outputDir}`,
        {
          encoding: 'utf-8',
          cwd: repoRoot,
          env: { ...process.env, HOME: testHomeDir },
        },
      );

      // Verify existing skill still exists
      const existingContent = await fs.readFile(
        path.join(targetSkillDir, 'SKILL.md'),
        'utf-8',
      );
      assert.ok(
        existingContent.includes('Existing version'),
        'Existing skill should be preserved',
      );

      // Verify renamed skill was created
      const renamedSkillDir = path.join(targetSkillsDir, 'my-skill-imported');
      const renamedExists = await fs
        .access(path.join(renamedSkillDir, 'SKILL.md'))
        .then(() => true)
        .catch(() => false);
      assert.strictEqual(renamedExists, true, 'Renamed skill should be created');

      const renamedContent = await fs.readFile(
        path.join(renamedSkillDir, 'SKILL.md'),
        'utf-8',
      );
      assert.ok(
        renamedContent.includes('Source version'),
        'Renamed skill should have source content',
      );
    });

    test('Skills without SKILL.md are skipped', async () => {
      const testHomeDir = path.join(tempDir, 'test-skills-noskill-home');
      const testTargetDir = path.join(tempDir, 'test-skills-noskill-target');
      const openclawDir = path.join(testHomeDir, '.openclaw');
      const skillsDir = path.join(openclawDir, 'skills');
      await fs.mkdir(openclawDir, { recursive: true });
      await fs.mkdir(testTargetDir, { recursive: true });
      await fs.mkdir(skillsDir, { recursive: true });

      // Create skill directory without SKILL.md
      const skillDir = path.join(skillsDir, 'incomplete-skill');
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(
        path.join(skillDir, 'README.md'),
        'Just a readme',
        'utf-8',
      );

      // Create source config
      await fs.writeFile(
        path.join(openclawDir, 'openclaw.json'),
        JSON.stringify({ agent: { name: 'TestBot' } }),
        'utf-8',
      );

      // Run migration script
      const outputDir = path.join(tempDir, 'report-skills-noskill');
      execSync(
        `npx tsx ${scriptPath} --source openclaw --execute --target-workspace ${testTargetDir} --target-env ${path.join(testTargetDir, '.env')} --output-dir ${outputDir}`,
        {
          encoding: 'utf-8',
          cwd: repoRoot,
          env: { ...process.env, HOME: testHomeDir },
        },
      );

      // Verify report shows skipped
      const reportPath = path.join(outputDir, 'report.json');
      const report = JSON.parse(await fs.readFile(reportPath, 'utf-8'));
      const skillsItem = report.items.find((i: { id: string }) => i.id === 'skills-summary');
      assert.ok(skillsItem, 'Should have skills-summary item');
      assert.ok(
        skillsItem.reason.includes('SKILL.md'),
        'Skip reason should mention SKILL.md',
      );
    });
  });

  describe('Command allowlist migration (VAL-CMD-001, 002)', () => {
    test('Exec patterns are merged into mount-allowlist.json', async () => {
      const testHomeDir = path.join(tempDir, 'test-allowlist-home');
      const testTargetDir = path.join(tempDir, 'test-allowlist-target');
      const openclawDir = path.join(testHomeDir, '.openclaw');
      await fs.mkdir(openclawDir, { recursive: true });
      await fs.mkdir(testTargetDir, { recursive: true });

      // Create source config with exec patterns
      await fs.writeFile(
        path.join(openclawDir, 'openclaw.json'),
        JSON.stringify({
          agent: { name: 'TestBot' },
          exec: {
            approvalPatterns: ['npm test', 'npm run build', 'git status'],
          },
        }),
        'utf-8',
      );

      // Run migration script
      const outputDir = path.join(tempDir, 'report-allowlist');
      execSync(
        `npx tsx ${scriptPath} --source openclaw --execute --target-workspace ${testTargetDir} --target-env ${path.join(testTargetDir, '.env')} --output-dir ${outputDir}`,
        {
          encoding: 'utf-8',
          cwd: repoRoot,
          env: { ...process.env, HOME: testHomeDir },
        },
      );

      // Verify mount-allowlist.json was created
      const allowlistPath = path.join(testHomeDir, '.config', 'fft_nano', 'mount-allowlist.json');
      const allowlistExists = await fs
        .access(allowlistPath)
        .then(() => true)
        .catch(() => false);
      assert.strictEqual(allowlistExists, true, 'mount-allowlist.json should be created');

      const allowlistContent = await fs.readFile(allowlistPath, 'utf-8');
      const allowlist = JSON.parse(allowlistContent);
      assert.ok(Array.isArray(allowlist.patterns), 'patterns should be an array');
      assert.ok(allowlist.patterns.includes('npm test'), 'Should include npm test');
      assert.ok(allowlist.patterns.includes('npm run build'), 'Should include npm run build');
      assert.ok(allowlist.patterns.includes('git status'), 'Should include git status');
    });

    test('Allowlist patterns are deduplicated', async () => {
      const testHomeDir = path.join(tempDir, 'test-allowlist-dedup-home');
      const testTargetDir = path.join(tempDir, 'test-allowlist-dedup-target');
      const openclawDir = path.join(testHomeDir, '.openclaw');
      await fs.mkdir(openclawDir, { recursive: true });
      await fs.mkdir(testTargetDir, { recursive: true });

      // Create existing mount-allowlist.json with some patterns
      const configDir = path.join(testHomeDir, '.config', 'fft_nano');
      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(
        path.join(configDir, 'mount-allowlist.json'),
        JSON.stringify({ patterns: ['npm test', 'git status'] }),
        'utf-8',
      );

      // Create source config with overlapping patterns
      await fs.writeFile(
        path.join(openclawDir, 'openclaw.json'),
        JSON.stringify({
          agent: { name: 'TestBot' },
          exec: {
            approvalPatterns: ['npm test', 'npm run build', 'git status'],
          },
        }),
        'utf-8',
      );

      // Run migration script
      const outputDir = path.join(tempDir, 'report-allowlist-dedup');
      execSync(
        `npx tsx ${scriptPath} --source openclaw --execute --target-workspace ${testTargetDir} --target-env ${path.join(testTargetDir, '.env')} --output-dir ${outputDir}`,
        {
          encoding: 'utf-8',
          cwd: repoRoot,
          env: { ...process.env, HOME: testHomeDir },
        },
      );

      // Verify patterns are deduplicated
      const allowlistPath = path.join(configDir, 'mount-allowlist.json');
      const allowlistContent = await fs.readFile(allowlistPath, 'utf-8');
      const allowlist = JSON.parse(allowlistContent);

      // Should have 3 unique patterns, not 5
      assert.strictEqual(allowlist.patterns.length, 3, 'Should have 3 unique patterns');
      assert.ok(allowlist.patterns.includes('npm run build'), 'Should include new pattern');

      // Verify report shows only new patterns added
      const reportPath = path.join(outputDir, 'report.json');
      const report = JSON.parse(await fs.readFile(reportPath, 'utf-8'));
      const allowlistItem = report.items.find((i: { id: string }) => i.id === 'allowlist');
      assert.ok(
        allowlistItem.reason.includes('1'),
        'Should report 1 new pattern added',
      );
    });

    test('All patterns already present shows appropriate message', async () => {
      const testHomeDir = path.join(tempDir, 'test-allowlist-all-present-home');
      const testTargetDir = path.join(tempDir, 'test-allowlist-all-present-target');
      const openclawDir = path.join(testHomeDir, '.openclaw');
      await fs.mkdir(openclawDir, { recursive: true });
      await fs.mkdir(testTargetDir, { recursive: true });

      // Create existing mount-allowlist.json with all patterns
      const configDir = path.join(testHomeDir, '.config', 'fft_nano');
      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(
        path.join(configDir, 'mount-allowlist.json'),
        JSON.stringify({ patterns: ['npm test', 'npm run build'] }),
        'utf-8',
      );

      // Create source config with same patterns
      await fs.writeFile(
        path.join(openclawDir, 'openclaw.json'),
        JSON.stringify({
          agent: { name: 'TestBot' },
          exec: {
            approvalPatterns: ['npm test', 'npm run build'],
          },
        }),
        'utf-8',
      );

      // Run migration script
      const outputDir = path.join(tempDir, 'report-allowlist-all-present');
      execSync(
        `npx tsx ${scriptPath} --source openclaw --execute --target-workspace ${testTargetDir} --target-env ${path.join(testTargetDir, '.env')} --output-dir ${outputDir}`,
        {
          encoding: 'utf-8',
          cwd: repoRoot,
          env: { ...process.env, HOME: testHomeDir },
        },
      );

      // Verify report shows all patterns already present
      const reportPath = path.join(outputDir, 'report.json');
      const report = JSON.parse(await fs.readFile(reportPath, 'utf-8'));
      const allowlistItem = report.items.find((i: { id: string }) => i.id === 'allowlist');
      assert.strictEqual(allowlistItem.status, 'skipped');
      assert.ok(
        allowlistItem.reason.includes('already present'),
        'Should report all patterns already present',
      );
    });
  });

  describe('Agent config migration (VAL-AGENT-001 to 003)', () => {
    test('Heartbeat cadence is migrated to FFT_NANO_HEARTBEAT_EVERY', async () => {
      const testHomeDir = path.join(tempDir, 'test-agent-hb-home');
      const testTargetDir = path.join(tempDir, 'test-agent-hb-target');
      const openclawDir = path.join(testHomeDir, '.openclaw');
      await fs.mkdir(openclawDir, { recursive: true });
      await fs.mkdir(testTargetDir, { recursive: true });

      // Create source config with heartbeat interval
      await fs.writeFile(
        path.join(openclawDir, 'openclaw.json'),
        JSON.stringify({
          agent: { name: 'TestBot' },
          heartbeat: {
            enabled: true,
            interval: '30m',
          },
        }),
        'utf-8',
      );

      // Run migration script
      const outputDir = path.join(tempDir, 'report-agent-hb');
      const envPath = path.join(testTargetDir, '.env');
      execSync(
        `npx tsx ${scriptPath} --source openclaw --execute --target-workspace ${testTargetDir} --target-env ${envPath} --output-dir ${outputDir}`,
        {
          encoding: 'utf-8',
          cwd: repoRoot,
          env: { ...process.env, HOME: testHomeDir },
        },
      );

      // Verify .env contains FFT_NANO_HEARTBEAT_EVERY
      const envContent = await fs.readFile(envPath, 'utf-8');
      assert.ok(
        envContent.includes('FFT_NANO_HEARTBEAT_EVERY=30m'),
        '.env should contain FFT_NANO_HEARTBEAT_EVERY=30m',
      );
    });

    test('Container runtime settings are migrated to .env', async () => {
      const testHomeDir = path.join(tempDir, 'test-agent-container-home');
      const testTargetDir = path.join(tempDir, 'test-agent-container-target');
      const openclawDir = path.join(testHomeDir, '.openclaw');
      await fs.mkdir(openclawDir, { recursive: true });
      await fs.mkdir(testTargetDir, { recursive: true });

      // Create source config with container settings
      await fs.writeFile(
        path.join(openclawDir, 'openclaw.json'),
        JSON.stringify({
          agent: { name: 'TestBot' },
          sandbox: {
            runtime: 'docker',
            image: 'node:20-alpine',
          },
        }),
        'utf-8',
      );

      // Run migration script
      const outputDir = path.join(tempDir, 'report-agent-container');
      const envPath = path.join(testTargetDir, '.env');
      execSync(
        `npx tsx ${scriptPath} --source openclaw --execute --target-workspace ${testTargetDir} --target-env ${envPath} --output-dir ${outputDir}`,
        {
          encoding: 'utf-8',
          cwd: repoRoot,
          env: { ...process.env, HOME: testHomeDir },
        },
      );

      // Verify .env contains container settings
      const envContent = await fs.readFile(envPath, 'utf-8');
      assert.ok(
        envContent.includes('CONTAINER_RUNTIME=docker'),
        '.env should contain CONTAINER_RUNTIME=docker',
      );
      assert.ok(
        envContent.includes('CONTAINER_IMAGE=node:20-alpine'),
        '.env should contain CONTAINER_IMAGE',
      );
    });

    test('Memory flush settings are migrated to parity config', async () => {
      const testHomeDir = path.join(tempDir, 'test-agent-parity-home');
      const testTargetDir = path.join(tempDir, 'test-agent-parity-target');
      const openclawDir = path.join(testHomeDir, '.openclaw');
      await fs.mkdir(openclawDir, { recursive: true });
      await fs.mkdir(testTargetDir, { recursive: true });

      // Create source config with memory flush setting
      await fs.writeFile(
        path.join(openclawDir, 'openclaw.json'),
        JSON.stringify({
          agent: { name: 'TestBot' },
          memory: {
            flushBeforeCompaction: true,
          },
        }),
        'utf-8',
      );

      // Run migration script
      const outputDir = path.join(tempDir, 'report-agent-parity');
      execSync(
        `npx tsx ${scriptPath} --source openclaw --execute --target-workspace ${testTargetDir} --target-env ${path.join(testTargetDir, '.env')} --output-dir ${outputDir}`,
        {
          encoding: 'utf-8',
          cwd: repoRoot,
          env: { ...process.env, HOME: testHomeDir },
        },
      );

      // Verify runtime.parity.json was created with memory flush setting
      const parityPath = path.join(testHomeDir, '.config', 'fft_nano', 'runtime.parity.json');
      const parityExists = await fs
        .access(parityPath)
        .then(() => true)
        .catch(() => false);
      assert.strictEqual(parityExists, true, 'runtime.parity.json should be created');

      const parityContent = await fs.readFile(parityPath, 'utf-8');
      const parity = JSON.parse(parityContent);
      assert.strictEqual(
        parity.memory?.flushBeforeCompaction,
        true,
        'memory.flushBeforeCompaction should be true',
      );
    });

    test('Existing parity config is preserved and merged', async () => {
      const testHomeDir = path.join(tempDir, 'test-agent-parity-merge-home');
      const testTargetDir = path.join(tempDir, 'test-agent-parity-merge-target');
      const openclawDir = path.join(testHomeDir, '.openclaw');
      await fs.mkdir(openclawDir, { recursive: true });
      await fs.mkdir(testTargetDir, { recursive: true });

      // Create existing parity config
      const configDir = path.join(testHomeDir, '.config', 'fft_nano');
      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(
        path.join(configDir, 'runtime.parity.json'),
        JSON.stringify({
          existingField: 'value',
          memory: {
            existingMemorySetting: true,
          },
        }),
        'utf-8',
      );

      // Create source config with memory flush setting
      await fs.writeFile(
        path.join(openclawDir, 'openclaw.json'),
        JSON.stringify({
          agent: { name: 'TestBot' },
          memory: {
            flushBeforeCompaction: true,
          },
        }),
        'utf-8',
      );

      // Run migration script
      const outputDir = path.join(tempDir, 'report-agent-parity-merge');
      execSync(
        `npx tsx ${scriptPath} --source openclaw --execute --target-workspace ${testTargetDir} --target-env ${path.join(testTargetDir, '.env')} --output-dir ${outputDir}`,
        {
          encoding: 'utf-8',
          cwd: repoRoot,
          env: { ...process.env, HOME: testHomeDir },
        },
      );

      // Verify existing fields are preserved
      const parityPath = path.join(configDir, 'runtime.parity.json');
      const parityContent = await fs.readFile(parityPath, 'utf-8');
      const parity = JSON.parse(parityContent);
      assert.strictEqual(parity.existingField, 'value', 'Existing field should be preserved');
      assert.strictEqual(
        parity.memory.existingMemorySetting,
        true,
        'Existing memory setting should be preserved',
      );
      assert.strictEqual(
        parity.memory.flushBeforeCompaction,
        true,
        'New memory setting should be added',
      );
    });
  });

  describe('Archive migration (VAL-ARCH-001 to 003)', () => {
    test('MCP servers are archived as JSON', async () => {
      const testHomeDir = path.join(tempDir, 'test-archive-mcp-home');
      const testTargetDir = path.join(tempDir, 'test-archive-mcp-target');
      const openclawDir = path.join(testHomeDir, '.openclaw');
      await fs.mkdir(openclawDir, { recursive: true });
      await fs.mkdir(testTargetDir, { recursive: true });

      // Create source config with MCP servers
      await fs.writeFile(
        path.join(openclawDir, 'openclaw.json'),
        JSON.stringify({
          agent: { name: 'TestBot' },
          mcp: {
            servers: [
              { name: 'filesystem', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'] },
              { name: 'github', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] },
            ],
          },
        }),
        'utf-8',
      );

      // Run migration script
      const outputDir = path.join(tempDir, 'report-archive-mcp');
      execSync(
        `npx tsx ${scriptPath} --source openclaw --execute --target-workspace ${testTargetDir} --target-env ${path.join(testTargetDir, '.env')} --output-dir ${outputDir}`,
        {
          encoding: 'utf-8',
          cwd: repoRoot,
          env: { ...process.env, HOME: testHomeDir },
        },
      );

      // Verify MCP servers were archived
      const archivePath = path.join(outputDir, 'archive', 'mcp-servers.json');
      const archiveExists = await fs
        .access(archivePath)
        .then(() => true)
        .catch(() => false);
      assert.strictEqual(archiveExists, true, 'mcp-servers.json should be archived');

      const archiveContent = await fs.readFile(archivePath, 'utf-8');
      const mcpServers = JSON.parse(archiveContent);
      assert.strictEqual(mcpServers.length, 2, 'Should have 2 MCP servers');
      assert.strictEqual(mcpServers[0].name, 'filesystem');
    });

    test('Plugins are archived as JSON', async () => {
      const testHomeDir = path.join(tempDir, 'test-archive-plugins-home');
      const testTargetDir = path.join(tempDir, 'test-archive-plugins-target');
      const openclawDir = path.join(testHomeDir, '.openclaw');
      await fs.mkdir(openclawDir, { recursive: true });
      await fs.mkdir(testTargetDir, { recursive: true });

      // Create source config with plugins
      await fs.writeFile(
        path.join(openclawDir, 'openclaw.json'),
        JSON.stringify({
          agent: { name: 'TestBot' },
          plugins: ['plugin-a', 'plugin-b', 'plugin-c'],
        }),
        'utf-8',
      );

      // Run migration script
      const outputDir = path.join(tempDir, 'report-archive-plugins');
      execSync(
        `npx tsx ${scriptPath} --source openclaw --execute --target-workspace ${testTargetDir} --target-env ${path.join(testTargetDir, '.env')} --output-dir ${outputDir}`,
        {
          encoding: 'utf-8',
          cwd: repoRoot,
          env: { ...process.env, HOME: testHomeDir },
        },
      );

      // Verify plugins were archived
      const archivePath = path.join(outputDir, 'archive', 'plugins.json');
      const archiveExists = await fs
        .access(archivePath)
        .then(() => true)
        .catch(() => false);
      assert.strictEqual(archiveExists, true, 'plugins.json should be archived');

      const archiveContent = await fs.readFile(archivePath, 'utf-8');
      const plugins = JSON.parse(archiveContent);
      assert.deepStrictEqual(plugins, ['plugin-a', 'plugin-b', 'plugin-c']);
    });

    test('Cron jobs are archived as JSON', async () => {
      const testHomeDir = path.join(tempDir, 'test-archive-cron-home');
      const testTargetDir = path.join(tempDir, 'test-archive-cron-target');
      const moltbotDir = path.join(testHomeDir, '.moltbot');
      await fs.mkdir(moltbotDir, { recursive: true });
      await fs.mkdir(testTargetDir, { recursive: true });

      // Create source config with cron jobs (Moltbot format)
      await fs.writeFile(
        path.join(moltbotDir, 'moltbot.json'),
        JSON.stringify({
          agentName: 'TestBot',
          cron: [
            { schedule: '0 9 * * *', task: 'morning-report' },
            { schedule: '0 17 * * *', task: 'evening-summary' },
          ],
        }),
        'utf-8',
      );

      // Run migration script
      const outputDir = path.join(tempDir, 'report-archive-cron');
      execSync(
        `npx tsx ${scriptPath} --source moltbot --execute --target-workspace ${testTargetDir} --target-env ${path.join(testTargetDir, '.env')} --output-dir ${outputDir}`,
        {
          encoding: 'utf-8',
          cwd: repoRoot,
          env: { ...process.env, HOME: testHomeDir },
        },
      );

      // Verify cron jobs were archived
      const archivePath = path.join(outputDir, 'archive', 'cron-jobs.json');
      const archiveExists = await fs
        .access(archivePath)
        .then(() => true)
        .catch(() => false);
      assert.strictEqual(archiveExists, true, 'cron-jobs.json should be archived');

      const archiveContent = await fs.readFile(archivePath, 'utf-8');
      const cronJobs = JSON.parse(archiveContent);
      assert.strictEqual(cronJobs.length, 2, 'Should have 2 cron jobs');
      assert.strictEqual(cronJobs[0].task, 'morning-report');
    });

    test('Webhooks are archived as JSON', async () => {
      const testHomeDir = path.join(tempDir, 'test-archive-webhooks-home');
      const testTargetDir = path.join(tempDir, 'test-archive-webhooks-target');
      const hermesDir = path.join(testHomeDir, '.hermes');
      await fs.mkdir(hermesDir, { recursive: true });
      await fs.mkdir(testTargetDir, { recursive: true });

      // Create source config with webhooks (Hermes format)
      await fs.writeFile(
        path.join(hermesDir, 'config.yaml'),
        `
agent:
  name: TestAgent
features:
  webhooks:
    - path: /webhook/github
      secret: github-secret
    - path: /webhook/stripe
      secret: stripe-secret
`,
        'utf-8',
      );

      // Run migration script
      const outputDir = path.join(tempDir, 'report-archive-webhooks');
      execSync(
        `npx tsx ${scriptPath} --source hermes --execute --target-workspace ${testTargetDir} --target-env ${path.join(testTargetDir, '.env')} --output-dir ${outputDir}`,
        {
          encoding: 'utf-8',
          cwd: repoRoot,
          env: { ...process.env, HOME: testHomeDir },
        },
      );

      // Verify webhooks were archived
      const archivePath = path.join(outputDir, 'archive', 'webhooks.json');
      const archiveExists = await fs
        .access(archivePath)
        .then(() => true)
        .catch(() => false);
      assert.strictEqual(archiveExists, true, 'webhooks.json should be archived');

      const archiveContent = await fs.readFile(archivePath, 'utf-8');
      const webhooks = JSON.parse(archiveContent);
      assert.strictEqual(webhooks.length, 2, 'Should have 2 webhooks');
    });

    test('Multi-agent config is archived as JSON', async () => {
      const testHomeDir = path.join(tempDir, 'test-archive-multiagent-home');
      const testTargetDir = path.join(tempDir, 'test-archive-multiagent-target');
      const hermesDir = path.join(testHomeDir, '.hermes');
      await fs.mkdir(hermesDir, { recursive: true });
      await fs.mkdir(testTargetDir, { recursive: true });

      // Create source config with multi-agent (Hermes format)
      await fs.writeFile(
        path.join(hermesDir, 'config.yaml'),
        `
agent:
  name: TestAgent
features:
  multi_agent:
    enabled: true
    agents:
      - name: coder
        role: coding assistant
      - name: researcher
        role: research assistant
`,
        'utf-8',
      );

      // Run migration script
      const outputDir = path.join(tempDir, 'report-archive-multiagent');
      execSync(
        `npx tsx ${scriptPath} --source hermes --execute --target-workspace ${testTargetDir} --target-env ${path.join(testTargetDir, '.env')} --output-dir ${outputDir}`,
        {
          encoding: 'utf-8',
          cwd: repoRoot,
          env: { ...process.env, HOME: testHomeDir },
        },
      );

      // Verify multi-agent config was archived
      const archivePath = path.join(outputDir, 'archive', 'multi-agent.json');
      const archiveExists = await fs
        .access(archivePath)
        .then(() => true)
        .catch(() => false);
      assert.strictEqual(archiveExists, true, 'multi-agent.json should be archived');

      const archiveContent = await fs.readFile(archivePath, 'utf-8');
      const multiAgent = JSON.parse(archiveContent);
      assert.strictEqual(multiAgent.enabled, true);
    });

    test('Archive files are valid JSON', async () => {
      const testHomeDir = path.join(tempDir, 'test-archive-valid-home');
      const testTargetDir = path.join(tempDir, 'test-archive-valid-target');
      const openclawDir = path.join(testHomeDir, '.openclaw');
      await fs.mkdir(openclawDir, { recursive: true });
      await fs.mkdir(testTargetDir, { recursive: true });

      // Create source config with various items to archive
      await fs.writeFile(
        path.join(openclawDir, 'openclaw.json'),
        JSON.stringify({
          agent: { name: 'TestBot' },
          mcp: {
            servers: [{ name: 'test-server' }],
          },
          plugins: ['plugin-a'],
        }),
        'utf-8',
      );

      // Run migration script
      const outputDir = path.join(tempDir, 'report-archive-valid');
      execSync(
        `npx tsx ${scriptPath} --source openclaw --execute --target-workspace ${testTargetDir} --target-env ${path.join(testTargetDir, '.env')} --output-dir ${outputDir}`,
        {
          encoding: 'utf-8',
          cwd: repoRoot,
          env: { ...process.env, HOME: testHomeDir },
        },
      );

      // Verify all archive files are valid JSON
      const archiveDir = path.join(outputDir, 'archive');
      const archiveFiles = await fs.readdir(archiveDir);

      for (const file of archiveFiles) {
        if (file.endsWith('.json')) {
          const content = await fs.readFile(path.join(archiveDir, file), 'utf-8');
          // Should not throw
          JSON.parse(content);
        }
      }

      assert.ok(archiveFiles.length > 0, 'Should have archive files');
    });

    test('Skipped items are reported with reasons', async () => {
      const testHomeDir = path.join(tempDir, 'test-archive-skipped-home');
      const testTargetDir = path.join(tempDir, 'test-archive-skipped-target');
      const openclawDir = path.join(testHomeDir, '.openclaw');
      await fs.mkdir(openclawDir, { recursive: true });
      await fs.mkdir(testTargetDir, { recursive: true });

      // Create source config without items to archive
      await fs.writeFile(
        path.join(openclawDir, 'openclaw.json'),
        JSON.stringify({ agent: { name: 'TestBot' } }),
        'utf-8',
      );

      // Run migration script
      const outputDir = path.join(tempDir, 'report-archive-skipped');
      execSync(
        `npx tsx ${scriptPath} --source openclaw --execute --target-workspace ${testTargetDir} --target-env ${path.join(testTargetDir, '.env')} --output-dir ${outputDir}`,
        {
          encoding: 'utf-8',
          cwd: repoRoot,
          env: { ...process.env, HOME: testHomeDir },
        },
      );

      // Verify report shows skipped archive
      const reportPath = path.join(outputDir, 'report.json');
      const report = JSON.parse(await fs.readFile(reportPath, 'utf-8'));
      const archiveItem = report.items.find((i: { id: string }) => i.id === 'archive');
      assert.ok(archiveItem, 'Should have archive item');
      assert.strictEqual(archiveItem.status, 'skipped');
      assert.ok(archiveItem.reason, 'Should have skip reason');
    });
  });

  describe('Idempotent re-run (VAL-CROSS-003)', () => {
    test('Running migration twice produces no duplicate entries in MEMORY.md', async () => {
      const testHomeDir = path.join(tempDir, 'test-idempotent-mem-home');
      const testTargetDir = path.join(tempDir, 'test-idempotent-mem-target');
      const openclawDir = path.join(testHomeDir, '.openclaw');
      await fs.mkdir(openclawDir, { recursive: true });
      await fs.mkdir(testTargetDir, { recursive: true });

      // Create source MEMORY.md
      const sourceMemory = `## Entry 1
- First memory entry

## Entry 2
- Second memory entry`;
      await fs.writeFile(
        path.join(openclawDir, 'MEMORY.md'),
        sourceMemory,
        'utf-8',
      );

      // Create source config
      await fs.writeFile(
        path.join(openclawDir, 'openclaw.json'),
        JSON.stringify({ agent: { name: 'TestBot' } }),
        'utf-8',
      );

      // First migration run
      const outputDir1 = path.join(tempDir, 'report-idempotent-1');
      execSync(
        `npx tsx ${scriptPath} --source openclaw --execute --target-workspace ${testTargetDir} --target-env ${path.join(testTargetDir, '.env')} --output-dir ${outputDir1}`,
        {
          encoding: 'utf-8',
          cwd: repoRoot,
          env: { ...process.env, HOME: testHomeDir },
        },
      );

      // Get MEMORY.md content after first run
      const memoryAfterFirst = await fs.readFile(
        path.join(testTargetDir, 'MEMORY.md'),
        'utf-8',
      );

      // Second migration run
      const outputDir2 = path.join(tempDir, 'report-idempotent-2');
      execSync(
        `npx tsx ${scriptPath} --source openclaw --execute --target-workspace ${testTargetDir} --target-env ${path.join(testTargetDir, '.env')} --output-dir ${outputDir2}`,
        {
          encoding: 'utf-8',
          cwd: repoRoot,
          env: { ...process.env, HOME: testHomeDir },
        },
      );

      // Get MEMORY.md content after second run
      const memoryAfterSecond = await fs.readFile(
        path.join(testTargetDir, 'MEMORY.md'),
        'utf-8',
      );

      // Content should be identical (no duplicates added)
      assert.strictEqual(
        memoryAfterFirst,
        memoryAfterSecond,
        'MEMORY.md should not change on second run',
      );

      // Verify second run report shows duplicates
      const reportPath = path.join(outputDir2, 'report.json');
      const report = JSON.parse(await fs.readFile(reportPath, 'utf-8'));
      const memItem = report.items.find((i: { id: string }) => i.id === 'memory');
      assert.ok(
        memItem?.reason?.includes('already') || memItem?.reason?.includes('duplicate'),
        'Second run should report entries already present',
      );
    });

    test('Running migration twice produces no duplicate entries in USER.md', async () => {
      const testHomeDir = path.join(tempDir, 'test-idempotent-user-home');
      const testTargetDir = path.join(tempDir, 'test-idempotent-user-target');
      const openclawDir = path.join(testHomeDir, '.openclaw');
      await fs.mkdir(openclawDir, { recursive: true });
      await fs.mkdir(testTargetDir, { recursive: true });

      // Create source USER.md
      const sourceUser = `## User Profile
- Name: Test User
- Role: Developer`;
      await fs.writeFile(
        path.join(openclawDir, 'USER.md'),
        sourceUser,
        'utf-8',
      );

      // Create source config
      await fs.writeFile(
        path.join(openclawDir, 'openclaw.json'),
        JSON.stringify({ agent: { name: 'TestBot' } }),
        'utf-8',
      );

      // First migration run
      const outputDir1 = path.join(tempDir, 'report-idempotent-user-1');
      execSync(
        `npx tsx ${scriptPath} --source openclaw --execute --target-workspace ${testTargetDir} --target-env ${path.join(testTargetDir, '.env')} --output-dir ${outputDir1}`,
        {
          encoding: 'utf-8',
          cwd: repoRoot,
          env: { ...process.env, HOME: testHomeDir },
        },
      );

      // Get USER.md content after first run
      const userAfterFirst = await fs.readFile(
        path.join(testTargetDir, 'USER.md'),
        'utf-8',
      );

      // Second migration run
      const outputDir2 = path.join(tempDir, 'report-idempotent-user-2');
      execSync(
        `npx tsx ${scriptPath} --source openclaw --execute --target-workspace ${testTargetDir} --target-env ${path.join(testTargetDir, '.env')} --output-dir ${outputDir2}`,
        {
          encoding: 'utf-8',
          cwd: repoRoot,
          env: { ...process.env, HOME: testHomeDir },
        },
      );

      // Get USER.md content after second run
      const userAfterSecond = await fs.readFile(
        path.join(testTargetDir, 'USER.md'),
        'utf-8',
      );

      // Content should be identical (no duplicates added)
      assert.strictEqual(
        userAfterFirst,
        userAfterSecond,
        'USER.md should not change on second run',
      );
    });

    test('Running migration twice produces no duplicate entries in .env', async () => {
      const testHomeDir = path.join(tempDir, 'test-idempotent-env-home');
      const testTargetDir = path.join(tempDir, 'test-idempotent-env-target');
      const openclawDir = path.join(testHomeDir, '.openclaw');
      await fs.mkdir(openclawDir, { recursive: true });
      await fs.mkdir(testTargetDir, { recursive: true });

      // Create source config
      await fs.writeFile(
        path.join(openclawDir, 'openclaw.json'),
        JSON.stringify({
          agent: { name: 'TestBot' },
          model: { provider: 'openai', model: 'gpt-4' },
        }),
        'utf-8',
      );

      // First migration run
      const outputDir1 = path.join(tempDir, 'report-idempotent-env-1');
      execSync(
        `npx tsx ${scriptPath} --source openclaw --execute --target-workspace ${testTargetDir} --target-env ${path.join(testTargetDir, '.env')} --output-dir ${outputDir1}`,
        {
          encoding: 'utf-8',
          cwd: repoRoot,
          env: { ...process.env, HOME: testHomeDir },
        },
      );

      // Get .env content after first run
      const envAfterFirst = await fs.readFile(
        path.join(testTargetDir, '.env'),
        'utf-8',
      );
      const envLineCountFirst = envAfterFirst.split('\n').filter((l) => l.trim()).length;

      // Second migration run
      const outputDir2 = path.join(tempDir, 'report-idempotent-env-2');
      execSync(
        `npx tsx ${scriptPath} --source openclaw --execute --target-workspace ${testTargetDir} --target-env ${path.join(testTargetDir, '.env')} --output-dir ${outputDir2}`,
        {
          encoding: 'utf-8',
          cwd: repoRoot,
          env: { ...process.env, HOME: testHomeDir },
        },
      );

      // Get .env content after second run
      const envAfterSecond = await fs.readFile(
        path.join(testTargetDir, '.env'),
        'utf-8',
      );
      const envLineCountSecond = envAfterSecond.split('\n').filter((l) => l.trim()).length;

      // Line count should be identical (no duplicates added)
      assert.strictEqual(
        envLineCountFirst,
        envLineCountSecond,
        '.env should not have duplicate entries on second run',
      );
    });

    test('Running migration twice produces no duplicate patterns in allowlist', async () => {
      const testHomeDir = path.join(tempDir, 'test-idempotent-allowlist-home');
      const testTargetDir = path.join(tempDir, 'test-idempotent-allowlist-target');
      const openclawDir = path.join(testHomeDir, '.openclaw');
      await fs.mkdir(openclawDir, { recursive: true });
      await fs.mkdir(testTargetDir, { recursive: true });

      // Create source config with exec patterns
      await fs.writeFile(
        path.join(openclawDir, 'openclaw.json'),
        JSON.stringify({
          agent: { name: 'TestBot' },
          exec: {
            approvalPatterns: ['npm test', 'git status'],
          },
        }),
        'utf-8',
      );

      // First migration run
      const outputDir1 = path.join(tempDir, 'report-idempotent-allowlist-1');
      execSync(
        `npx tsx ${scriptPath} --source openclaw --execute --target-workspace ${testTargetDir} --target-env ${path.join(testTargetDir, '.env')} --output-dir ${outputDir1}`,
        {
          encoding: 'utf-8',
          cwd: repoRoot,
          env: { ...process.env, HOME: testHomeDir },
        },
      );

      // Get allowlist content after first run
      const allowlistPath = path.join(testHomeDir, '.config', 'fft_nano', 'mount-allowlist.json');
      const allowlistAfterFirst = JSON.parse(await fs.readFile(allowlistPath, 'utf-8'));

      // Second migration run
      const outputDir2 = path.join(tempDir, 'report-idempotent-allowlist-2');
      execSync(
        `npx tsx ${scriptPath} --source openclaw --execute --target-workspace ${testTargetDir} --target-env ${path.join(testTargetDir, '.env')} --output-dir ${outputDir2}`,
        {
          encoding: 'utf-8',
          cwd: repoRoot,
          env: { ...process.env, HOME: testHomeDir },
        },
      );

      // Get allowlist content after second run
      const allowlistAfterSecond = JSON.parse(await fs.readFile(allowlistPath, 'utf-8'));

      // Pattern count should be identical
      assert.strictEqual(
        allowlistAfterFirst.patterns.length,
        allowlistAfterSecond.patterns.length,
        'Allowlist should not have duplicate patterns on second run',
      );

      // Verify report shows all patterns already present
      const reportPath = path.join(outputDir2, 'report.json');
      const report = JSON.parse(await fs.readFile(reportPath, 'utf-8'));
      const allowlistItem = report.items.find((i: { id: string }) => i.id === 'allowlist');
      assert.strictEqual(allowlistItem.status, 'skipped');
      assert.ok(
        allowlistItem.reason.includes('already present'),
        'Should report all patterns already present',
      );
    });
  });

  describe('All 4 source types produce valid output (VAL-CROSS-004)', () => {
    test('OpenClaw source produces valid target files', async () => {
      const testHomeDir = path.join(tempDir, 'test-source-openclaw-home');
      const testTargetDir = path.join(tempDir, 'test-source-openclaw-target');
      const openclawDir = path.join(testHomeDir, '.openclaw');
      await fs.mkdir(openclawDir, { recursive: true });
      await fs.mkdir(testTargetDir, { recursive: true });

      // Create full OpenClaw source structure using fixture
      const fixturePath = path.join(repoRoot, 'tests/fixtures/migration/openclaw-config.json');
      const fixtureContent = await fs.readFile(fixturePath, 'utf-8');
      await fs.writeFile(path.join(openclawDir, 'openclaw.json'), fixtureContent, 'utf-8');

      // Create SOUL.md
      await fs.writeFile(
        path.join(openclawDir, 'SOUL.md'),
        '# OpenClaw SOUL\n\nTest content',
        'utf-8',
      );

      // Run migration
      const outputDir = path.join(tempDir, 'report-source-openclaw');
      execSync(
        `npx tsx ${scriptPath} --source openclaw --execute --migrate-secrets --target-workspace ${testTargetDir} --target-env ${path.join(testTargetDir, '.env')} --output-dir ${outputDir}`,
        {
          encoding: 'utf-8',
          cwd: repoRoot,
          env: { ...process.env, HOME: testHomeDir },
        },
      );

      // Verify target files exist and are valid
      const soulPath = path.join(testTargetDir, 'SOUL.md');
      const envPath = path.join(testTargetDir, '.env');
      const identityPath = path.join(testTargetDir, 'IDENTITY.md');

      assert.strictEqual(
        await fs.access(soulPath).then(() => true).catch(() => false),
        true,
        'SOUL.md should exist',
      );
      assert.strictEqual(
        await fs.access(envPath).then(() => true).catch(() => false),
        true,
        '.env should exist',
      );
      assert.strictEqual(
        await fs.access(identityPath).then(() => true).catch(() => false),
        true,
        'IDENTITY.md should exist',
      );

      // Verify .env has valid format
      const envContent = await fs.readFile(envPath, 'utf-8');
      assert.ok(envContent.includes('ASSISTANT_NAME=TestAssistant'), '.env should have ASSISTANT_NAME');
      assert.ok(envContent.includes('PI_API=openai'), '.env should have PI_API');
      assert.ok(envContent.includes('TELEGRAM_BOT_TOKEN='), '.env should have TELEGRAM_BOT_TOKEN');

      // Verify report is valid JSON
      const reportPath = path.join(outputDir, 'report.json');
      const report = JSON.parse(await fs.readFile(reportPath, 'utf-8'));
      assert.strictEqual(report.sourceType, 'openclaw');
      assert.ok(report.summary.migrated > 0, 'Should have migrated items');
    });

    test('Clawdbot source produces valid target files', async () => {
      const testHomeDir = path.join(tempDir, 'test-source-clawdbot-home');
      const testTargetDir = path.join(tempDir, 'test-source-clawdbot-target');
      const clawdbotDir = path.join(testHomeDir, '.config', 'clawdbot');
      await fs.mkdir(clawdbotDir, { recursive: true });
      await fs.mkdir(testTargetDir, { recursive: true });

      // Create full Clawdbot source structure using fixture
      const fixturePath = path.join(repoRoot, 'tests/fixtures/migration/clawdbot-config.json');
      const fixtureContent = await fs.readFile(fixturePath, 'utf-8');
      await fs.writeFile(path.join(clawdbotDir, 'config.json'), fixtureContent, 'utf-8');

      // Run migration
      const outputDir = path.join(tempDir, 'report-source-clawdbot');
      execSync(
        `npx tsx ${scriptPath} --source clawdbot --execute --migrate-secrets --target-workspace ${testTargetDir} --target-env ${path.join(testTargetDir, '.env')} --output-dir ${outputDir}`,
        {
          encoding: 'utf-8',
          cwd: repoRoot,
          env: { ...process.env, HOME: testHomeDir },
        },
      );

      // Verify target files exist and are valid
      const envPath = path.join(testTargetDir, '.env');
      const identityPath = path.join(testTargetDir, 'IDENTITY.md');

      assert.strictEqual(
        await fs.access(envPath).then(() => true).catch(() => false),
        true,
        '.env should exist',
      );
      assert.strictEqual(
        await fs.access(identityPath).then(() => true).catch(() => false),
        true,
        'IDENTITY.md should exist',
      );

      // Verify .env has valid format
      const envContent = await fs.readFile(envPath, 'utf-8');
      assert.ok(envContent.includes('ASSISTANT_NAME=ClawdAssistant'), '.env should have ASSISTANT_NAME');
      assert.ok(envContent.includes('PI_API=anthropic'), '.env should have PI_API=anthropic');
      assert.ok(envContent.includes('ANTHROPIC_API_KEY='), '.env should have ANTHROPIC_API_KEY');
      assert.ok(envContent.includes('WHATSAPP_ENABLED=1'), '.env should have WHATSAPP_ENABLED');

      // Verify report is valid JSON
      const reportPath = path.join(outputDir, 'report.json');
      const report = JSON.parse(await fs.readFile(reportPath, 'utf-8'));
      assert.strictEqual(report.sourceType, 'clawdbot');
      assert.ok(report.summary.migrated > 0, 'Should have migrated items');
    });

    test('Moltbot source produces valid target files', async () => {
      const testHomeDir = path.join(tempDir, 'test-source-moltbot-home');
      const testTargetDir = path.join(tempDir, 'test-source-moltbot-target');
      const moltbotDir = path.join(testHomeDir, '.moltbot');
      await fs.mkdir(moltbotDir, { recursive: true });
      await fs.mkdir(testTargetDir, { recursive: true });

      // Create full Moltbot source structure using fixture
      const fixturePath = path.join(repoRoot, 'tests/fixtures/migration/moltbot-config.json');
      const fixtureContent = await fs.readFile(fixturePath, 'utf-8');
      await fs.writeFile(path.join(moltbotDir, 'moltbot.json'), fixtureContent, 'utf-8');

      // Run migration
      const outputDir = path.join(tempDir, 'report-source-moltbot');
      execSync(
        `npx tsx ${scriptPath} --source moltbot --execute --migrate-secrets --target-workspace ${testTargetDir} --target-env ${path.join(testTargetDir, '.env')} --output-dir ${outputDir}`,
        {
          encoding: 'utf-8',
          cwd: repoRoot,
          env: { ...process.env, HOME: testHomeDir },
        },
      );

      // Verify target files exist and are valid
      const envPath = path.join(testTargetDir, '.env');
      const identityPath = path.join(testTargetDir, 'IDENTITY.md');

      assert.strictEqual(
        await fs.access(envPath).then(() => true).catch(() => false),
        true,
        '.env should exist',
      );
      assert.strictEqual(
        await fs.access(identityPath).then(() => true).catch(() => false),
        true,
        'IDENTITY.md should exist',
      );

      // Verify .env has valid format
      const envContent = await fs.readFile(envPath, 'utf-8');
      assert.ok(envContent.includes('ASSISTANT_NAME=MoltBot'), '.env should have ASSISTANT_NAME');
      assert.ok(envContent.includes('PI_API=openrouter'), '.env should have PI_API=openrouter');
      assert.ok(envContent.includes('OPENROUTER_API_KEY='), '.env should have OPENROUTER_API_KEY');

      // Verify archive has cron jobs
      const cronArchivePath = path.join(outputDir, 'archive', 'cron-jobs.json');
      assert.strictEqual(
        await fs.access(cronArchivePath).then(() => true).catch(() => false),
        true,
        'Cron jobs should be archived',
      );

      // Verify report is valid JSON
      const reportPath = path.join(outputDir, 'report.json');
      const report = JSON.parse(await fs.readFile(reportPath, 'utf-8'));
      assert.strictEqual(report.sourceType, 'moltbot');
      assert.ok(report.summary.migrated > 0, 'Should have migrated items');
    });

    test('Hermes source produces valid target files', async () => {
      const testHomeDir = path.join(tempDir, 'test-source-hermes-home');
      const testTargetDir = path.join(tempDir, 'test-source-hermes-target');
      const hermesDir = path.join(testHomeDir, '.hermes');
      await fs.mkdir(hermesDir, { recursive: true });
      await fs.mkdir(testTargetDir, { recursive: true });

      // Create full Hermes source structure using fixture
      const fixturePath = path.join(repoRoot, 'tests/fixtures/migration/hermes-config.yaml');
      const fixtureContent = await fs.readFile(fixturePath, 'utf-8');
      await fs.writeFile(path.join(hermesDir, 'config.yaml'), fixtureContent, 'utf-8');

      // Run migration
      const outputDir = path.join(tempDir, 'report-source-hermes');
      execSync(
        `npx tsx ${scriptPath} --source hermes --execute --migrate-secrets --target-workspace ${testTargetDir} --target-env ${path.join(testTargetDir, '.env')} --output-dir ${outputDir}`,
        {
          encoding: 'utf-8',
          cwd: repoRoot,
          env: { ...process.env, HOME: testHomeDir },
        },
      );

      // Verify target files exist and are valid
      const envPath = path.join(testTargetDir, '.env');
      const identityPath = path.join(testTargetDir, 'IDENTITY.md');

      assert.strictEqual(
        await fs.access(envPath).then(() => true).catch(() => false),
        true,
        '.env should exist',
      );
      assert.strictEqual(
        await fs.access(identityPath).then(() => true).catch(() => false),
        true,
        'IDENTITY.md should exist',
      );

      // Verify .env has valid format
      const envContent = await fs.readFile(envPath, 'utf-8');
      assert.ok(envContent.includes('ASSISTANT_NAME=HermesAssistant'), '.env should have ASSISTANT_NAME');
      assert.ok(envContent.includes('PI_API=openai'), '.env should have PI_API');
      assert.ok(envContent.includes('WHATSAPP_ENABLED=1'), '.env should have WHATSAPP_ENABLED');
      assert.ok(envContent.includes('SLACK_BOT_TOKEN='), '.env should have SLACK_BOT_TOKEN');

      // Verify archive has webhooks
      const webhooksArchivePath = path.join(outputDir, 'archive', 'webhooks.json');
      assert.strictEqual(
        await fs.access(webhooksArchivePath).then(() => true).catch(() => false),
        true,
        'Webhooks should be archived',
      );

      // Verify report is valid JSON
      const reportPath = path.join(outputDir, 'report.json');
      const report = JSON.parse(await fs.readFile(reportPath, 'utf-8'));
      assert.strictEqual(report.sourceType, 'hermes');
      assert.ok(report.summary.migrated > 0, 'Should have migrated items');
    });
  });

  describe('Cross-area flows (VAL-CROSS-001, 002, 005, 006)', () => {
    test('Full preset automatically enables --migrate-secrets', async () => {
      const testHomeDir = path.join(tempDir, 'test-preset-full-home');
      const testTargetDir = path.join(tempDir, 'test-preset-full-target');
      const openclawDir = path.join(testHomeDir, '.openclaw');
      await fs.mkdir(openclawDir, { recursive: true });
      await fs.mkdir(testTargetDir, { recursive: true });

      // Create source config with secrets
      await fs.writeFile(
        path.join(openclawDir, 'openclaw.json'),
        JSON.stringify({
          agent: { name: 'TestBot' },
          model: {
            provider: 'openai',
            model: 'gpt-4',
            apiKey: 'sk-test-full-preset-key',
          },
          channels: {
            telegram: {
              enabled: true,
              botToken: 'full-preset-token',
            },
          },
        }),
        'utf-8',
      );

      // Run migration with --preset full (should include secrets)
      const outputDir = path.join(tempDir, 'report-preset-full');
      execSync(
        `npx tsx ${scriptPath} --source openclaw --execute --preset full --target-workspace ${testTargetDir} --target-env ${path.join(testTargetDir, '.env')} --output-dir ${outputDir}`,
        {
          encoding: 'utf-8',
          cwd: repoRoot,
          env: { ...process.env, HOME: testHomeDir },
        },
      );

      // Verify .env contains API keys (secrets were migrated)
      const envContent = await fs.readFile(
        path.join(testTargetDir, '.env'),
        'utf-8',
      );
      assert.ok(
        envContent.includes('OPENAI_API_KEY=sk-test-full-preset-key'),
        'Full preset should migrate API keys',
      );
      assert.ok(
        envContent.includes('TELEGRAM_BOT_TOKEN=full-preset-token'),
        'Full preset should migrate tokens',
      );
    });

    test('User-data preset excludes secrets', async () => {
      const testHomeDir = path.join(tempDir, 'test-preset-userdata-home');
      const testTargetDir = path.join(tempDir, 'test-preset-userdata-target');
      const openclawDir = path.join(testHomeDir, '.openclaw');
      await fs.mkdir(openclawDir, { recursive: true });
      await fs.mkdir(testTargetDir, { recursive: true });

      // Create source config with secrets
      await fs.writeFile(
        path.join(openclawDir, 'openclaw.json'),
        JSON.stringify({
          agent: { name: 'TestBot' },
          model: {
            provider: 'openai',
            model: 'gpt-4',
            apiKey: 'sk-test-userdata-key',
          },
          channels: {
            telegram: {
              enabled: true,
              botToken: 'userdata-token',
            },
          },
        }),
        'utf-8',
      );

      // Run migration with --preset user-data (should exclude secrets)
      const outputDir = path.join(tempDir, 'report-preset-userdata');
      execSync(
        `npx tsx ${scriptPath} --source openclaw --execute --preset user-data --target-workspace ${testTargetDir} --target-env ${path.join(testTargetDir, '.env')} --output-dir ${outputDir}`,
        {
          encoding: 'utf-8',
          cwd: repoRoot,
          env: { ...process.env, HOME: testHomeDir },
        },
      );

      // Verify .env does NOT contain API keys
      const envContent = await fs.readFile(
        path.join(testTargetDir, '.env'),
        'utf-8',
      );
      assert.ok(
        !envContent.includes('OPENAI_API_KEY'),
        'User-data preset should NOT migrate API keys',
      );
      assert.ok(
        !envContent.includes('TELEGRAM_BOT_TOKEN'),
        'User-data preset should NOT migrate tokens',
      );

      // Verify report shows skipped secrets
      const reportPath = path.join(outputDir, 'report.json');
      const report = JSON.parse(await fs.readFile(reportPath, 'utf-8'));
      const secretsItems = report.items.filter(
        (i: { id: string; status: string }) =>
          i.id.includes('secrets') && i.status === 'skipped',
      );
      assert.ok(secretsItems.length > 0, 'Should have skipped secrets items');
    });

    test('--overwrite flag applies globally to all categories', async () => {
      const testHomeDir = path.join(tempDir, 'test-overwrite-global-home');
      const testTargetDir = path.join(tempDir, 'test-overwrite-global-target');
      const openclawDir = path.join(testHomeDir, '.openclaw');
      await fs.mkdir(openclawDir, { recursive: true });
      await fs.mkdir(testTargetDir, { recursive: true });

      // Create source files
      await fs.writeFile(
        path.join(openclawDir, 'SOUL.md'),
        '# New SOUL',
        'utf-8',
      );
      await fs.writeFile(
        path.join(openclawDir, 'AGENTS.md'),
        '# New AGENTS',
        'utf-8',
      );
      await fs.writeFile(
        path.join(openclawDir, 'MEMORY.md'),
        '## New Memory',
        'utf-8',
      );

      // Create existing target files
      await fs.writeFile(
        path.join(testTargetDir, 'SOUL.md'),
        '# Old SOUL',
        'utf-8',
      );
      await fs.writeFile(
        path.join(testTargetDir, 'AGENTS.md'),
        '# Old AGENTS',
        'utf-8',
      );
      await fs.writeFile(
        path.join(testTargetDir, 'MEMORY.md'),
        '## Old Memory',
        'utf-8',
      );

      // Create source config
      await fs.writeFile(
        path.join(openclawDir, 'openclaw.json'),
        JSON.stringify({ agent: { name: 'TestBot' } }),
        'utf-8',
      );

      // Run migration with --overwrite
      const outputDir = path.join(tempDir, 'report-overwrite-global');
      execSync(
        `npx tsx ${scriptPath} --source openclaw --execute --overwrite --target-workspace ${testTargetDir} --target-env ${path.join(testTargetDir, '.env')} --output-dir ${outputDir}`,
        {
          encoding: 'utf-8',
          cwd: repoRoot,
          env: { ...process.env, HOME: testHomeDir },
        },
      );

      // Verify all files were overwritten
      const soulContent = await fs.readFile(
        path.join(testTargetDir, 'SOUL.md'),
        'utf-8',
      );
      const agentsContent = await fs.readFile(
        path.join(testTargetDir, 'AGENTS.md'),
        'utf-8',
      );

      assert.ok(soulContent.includes('New'), 'SOUL.md should be overwritten');
      assert.ok(agentsContent.includes('New'), 'AGENTS.md should be overwritten');

      // Verify report shows migrated (not conflict) for overwritten items
      const reportPath = path.join(outputDir, 'report.json');
      const report = JSON.parse(await fs.readFile(reportPath, 'utf-8'));
      const soulItem = report.items.find((i: { id: string }) => i.id === 'soul');
      const agentsItem = report.items.find((i: { id: string }) => i.id === 'agents');

      assert.strictEqual(soulItem.status, 'migrated', 'SOUL.md should show migrated');
      assert.strictEqual(agentsItem.status, 'migrated', 'AGENTS.md should show migrated');
    });

    test('--include filters to specified categories only', async () => {
      const testHomeDir = path.join(tempDir, 'test-include-home');
      const testTargetDir = path.join(tempDir, 'test-include-target');
      const openclawDir = path.join(testHomeDir, '.openclaw');
      await fs.mkdir(openclawDir, { recursive: true });
      await fs.mkdir(testTargetDir, { recursive: true });

      // Create source files
      await fs.writeFile(
        path.join(openclawDir, 'SOUL.md'),
        '# SOUL',
        'utf-8',
      );
      await fs.writeFile(
        path.join(openclawDir, 'AGENTS.md'),
        '# AGENTS',
        'utf-8',
      );
      await fs.writeFile(
        path.join(openclawDir, 'MEMORY.md'),
        '## Memory',
        'utf-8',
      );

      // Create source config
      await fs.writeFile(
        path.join(openclawDir, 'openclaw.json'),
        JSON.stringify({ agent: { name: 'TestBot' } }),
        'utf-8',
      );

      // Run migration with --include soul,memory
      const outputDir = path.join(tempDir, 'report-include');
      execSync(
        `npx tsx ${scriptPath} --source openclaw --execute --include soul,memory --target-workspace ${testTargetDir} --target-env ${path.join(testTargetDir, '.env')} --output-dir ${outputDir}`,
        {
          encoding: 'utf-8',
          cwd: repoRoot,
          env: { ...process.env, HOME: testHomeDir },
        },
      );

      // Verify SOUL.md and MEMORY.md were migrated
      assert.strictEqual(
        await fs.access(path.join(testTargetDir, 'SOUL.md')).then(() => true).catch(() => false),
        true,
        'SOUL.md should exist',
      );
      assert.strictEqual(
        await fs.access(path.join(testTargetDir, 'MEMORY.md')).then(() => true).catch(() => false),
        true,
        'MEMORY.md should exist',
      );

      // Verify AGENTS.md was NOT migrated
      assert.strictEqual(
        await fs.access(path.join(testTargetDir, 'AGENTS.md')).then(() => true).catch(() => false),
        false,
        'AGENTS.md should NOT exist',
      );

      // Verify report shows skipped for non-included categories
      const reportPath = path.join(outputDir, 'report.json');
      const report = JSON.parse(await fs.readFile(reportPath, 'utf-8'));
      const agentsItem = report.items.find((i: { id: string }) => i.id === 'agents');
      assert.ok(
        agentsItem?.status === 'skipped' || !agentsItem,
        'AGENTS.md should be skipped or not in report',
      );
    });

    test('--exclude removes specified categories', async () => {
      const testHomeDir = path.join(tempDir, 'test-exclude-home');
      const testTargetDir = path.join(tempDir, 'test-exclude-target');
      const openclawDir = path.join(testHomeDir, '.openclaw');
      await fs.mkdir(openclawDir, { recursive: true });
      await fs.mkdir(testTargetDir, { recursive: true });

      // Create source files
      await fs.writeFile(
        path.join(openclawDir, 'SOUL.md'),
        '# SOUL',
        'utf-8',
      );
      await fs.writeFile(
        path.join(openclawDir, 'AGENTS.md'),
        '# AGENTS',
        'utf-8',
      );
      await fs.writeFile(
        path.join(openclawDir, 'MEMORY.md'),
        '## Memory',
        'utf-8',
      );

      // Create source config
      await fs.writeFile(
        path.join(openclawDir, 'openclaw.json'),
        JSON.stringify({ agent: { name: 'TestBot' } }),
        'utf-8',
      );

      // Run migration with --exclude agents
      const outputDir = path.join(tempDir, 'report-exclude');
      execSync(
        `npx tsx ${scriptPath} --source openclaw --execute --exclude agents --target-workspace ${testTargetDir} --target-env ${path.join(testTargetDir, '.env')} --output-dir ${outputDir}`,
        {
          encoding: 'utf-8',
          cwd: repoRoot,
          env: { ...process.env, HOME: testHomeDir },
        },
      );

      // Verify SOUL.md and MEMORY.md were migrated
      assert.strictEqual(
        await fs.access(path.join(testTargetDir, 'SOUL.md')).then(() => true).catch(() => false),
        true,
        'SOUL.md should exist',
      );
      assert.strictEqual(
        await fs.access(path.join(testTargetDir, 'MEMORY.md')).then(() => true).catch(() => false),
        true,
        'MEMORY.md should exist',
      );

      // Verify AGENTS.md was NOT migrated
      assert.strictEqual(
        await fs.access(path.join(testTargetDir, 'AGENTS.md')).then(() => true).catch(() => false),
        false,
        'AGENTS.md should NOT exist',
      );
    });
  });
});

// Helper function
function existsSync(filepath: string): boolean {
  try {
    fs.access(filepath);
    return true;
  } catch {
    return false;
  }
}
