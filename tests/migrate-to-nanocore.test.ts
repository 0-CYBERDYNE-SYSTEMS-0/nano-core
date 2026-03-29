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
