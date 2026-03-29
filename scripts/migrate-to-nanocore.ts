#!/usr/bin/env node
/**
 * Migration script: OpenClaw/Clawdbot/Moltbot/Hermes → Nano-Core
 *
 * Usage:
 *   npx tsx scripts/migrate-to-nanocore.ts --source auto --dry-run
 *   npx tsx scripts/migrate-to-nanocore.ts --source openclaw --execute
 */

import { promises as fs, existsSync } from 'fs';
import path from 'path';
import os from 'os';
import YAML from 'yaml';
import { z } from 'zod';

// ============================================================================
// Types and Schemas
// ============================================================================

const SourceTypeSchema = z.enum([
  'openclaw',
  'clawdbot',
  'moltbot',
  'hermes',
  'auto',
]);
const SkillConflictSchema = z.enum(['skip', 'overwrite', 'rename']);
const PresetSchema = z.enum(['user-data', 'full']);

const CliArgsSchema = z.object({
  source: SourceTypeSchema.default('auto'),
  dryRun: z.boolean().default(true),
  execute: z.boolean().default(false),
  overwrite: z.boolean().default(false),
  migrateSecrets: z.boolean().default(false),
  skillConflict: SkillConflictSchema.default('skip'),
  preset: PresetSchema.default('user-data'),
  include: z.array(z.string()).default([]),
  exclude: z.array(z.string()).default([]),
  targetWorkspace: z.string().default(''),
  targetEnv: z.string().default(''),
  outputDir: z.string().default(''),
  help: z.boolean().default(false),
});

type CliArgs = z.infer<typeof CliArgsSchema>;
type SourceType = z.infer<typeof SourceTypeSchema>;
type SkillConflictMode = z.infer<typeof SkillConflictSchema>;

interface MigrationItem {
  id: string;
  category: string;
  sourcePath: string;
  targetPath: string;
  status:
    | 'migrated'
    | 'skipped'
    | 'conflict'
    | 'error'
    | 'would_migrate'
    | 'archived';
  reason?: string;
  backupPath?: string;
}

interface MigrationReport {
  timestamp: string;
  mode: 'dry-run' | 'execute';
  sourceRoot: string;
  targetRoot: string;
  sourceType: SourceType;
  summary: {
    migrated: number;
    archived: number;
    skipped: number;
    conflict: number;
    error: number;
    total: number;
  };
  items: MigrationItem[];
}

interface DetectedSource {
  type: SourceType;
  path: string;
  configPath: string;
  exists: boolean;
}

interface SourceConfig {
  type: SourceType;
  agentName?: string;
  agentRole?: string;
  agentPersonality?: string;
  modelProvider?: string;
  modelName?: string;
  apiKey?: string;
  baseUrl?: string;
  telegramToken?: string;
  telegramChatId?: string;
  whatsappEnabled?: boolean;
  discordToken?: string;
  slackBotToken?: string;
  slackAppToken?: string;
  signalEnabled?: boolean;
  containerRuntime?: string;
  containerImage?: string;
  heartbeatInterval?: string;
  memoryFlushEnabled?: boolean;
  execPatterns?: string[];
  mcpServers?: unknown[];
  plugins?: string[];
  cronJobs?: unknown[];
  webhooks?: unknown[];
  multiAgentEnabled?: boolean;
  raw: Record<string, unknown>;
}

// ============================================================================
// Configuration
// ============================================================================

const CATEGORIES = [
  'soul',
  'identity',
  'heartbeat',
  'memory',
  'user',
  'agents',
  'tools',
  'principles',
  'channels',
  'model',
  'skills',
  'allowlist',
  'agent-config',
  'archive',
] as const;

const SOURCE_PATHS: Record<
  Exclude<SourceType, 'auto'>,
  { dir: string; config: string }
> = {
  openclaw: { dir: '~/.openclaw', config: 'openclaw.json' },
  clawdbot: { dir: '~/.config/clawdbot', config: 'config.json' },
  moltbot: { dir: '~/.moltbot', config: 'moltbot.json' },
  hermes: { dir: '~/.hermes', config: 'config.yaml' },
};

// ============================================================================
// Utility Functions
// ============================================================================

function expandHome(filepath: string): string {
  if (filepath.startsWith('~/')) {
    return path.join(os.homedir(), filepath.slice(2));
  }
  return filepath;
}

function maskSecret(value: string): string {
  if (!value || value.length < 8) return '***';
  return value.slice(0, 4) + '...' + value.slice(-4);
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: Partial<CliArgs> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--source':
        result.source = args[++i] as SourceType;
        break;
      case '--dry-run':
        result.dryRun = true;
        break;
      case '--execute':
        result.execute = true;
        result.dryRun = false;
        break;
      case '--overwrite':
        result.overwrite = true;
        break;
      case '--migrate-secrets':
        result.migrateSecrets = true;
        break;
      case '--skill-conflict':
        result.skillConflict = args[++i] as SkillConflictMode;
        break;
      case '--preset':
        result.preset = args[++i] as 'user-data' | 'full';
        break;
      case '--include':
        result.include = args[++i].split(',').map((s) => s.trim());
        break;
      case '--exclude':
        result.exclude = args[++i].split(',').map((s) => s.trim());
        break;
      case '--target-workspace':
        result.targetWorkspace = args[++i];
        break;
      case '--target-env':
        result.targetEnv = args[++i];
        break;
      case '--output-dir':
        result.outputDir = args[++i];
        break;
      case '--help':
      case '-h':
        result.help = true;
        break;
    }
  }

  // Apply preset defaults
  if (result.preset === 'full' && result.migrateSecrets === undefined) {
    result.migrateSecrets = true;
  }

  return CliArgsSchema.parse(result);
}

function printHelp(): void {
  console.log(`
Migration Script: OpenClaw/Clawdbot/Moltbot/Hermes → Nano-Core

Usage:
  npx tsx scripts/migrate-to-nanocore.ts [options]

Options:
  --source <type>           Source system: openclaw, clawdbot, moltbot, hermes, auto (default: auto)
  --dry-run                 Show what would be migrated without making changes (default)
  --execute                 Actually perform the migration
  --overwrite               Replace existing target files (backs up originals)
  --migrate-secrets         Include API keys and tokens in migration
  --skill-conflict <mode>   How to handle skill conflicts: skip, overwrite, rename (default: skip)
  --preset <name>           Preset: user-data (no secrets), full (with secrets) (default: user-data)
  --include <categories>    Comma-separated list of categories to include
  --exclude <categories>    Comma-separated list of categories to exclude
  --target-workspace <path> Target workspace directory (default: ~/nano)
  --target-env <path>       Target .env file path (default: <repo-root>/.env)
  --output-dir <path>       Directory for migration reports (default: ./migration/<source>/<timestamp>)
  --help, -h                Show this help message

Categories:
  soul, identity, heartbeat, memory, user, agents, tools, principles,
  channels, model, skills, allowlist, agent-config, archive

Examples:
  # Dry run with auto-detection
  npx tsx scripts/migrate-to-nanocore.ts --source auto --dry-run

  # Execute migration from OpenClaw with secrets
  npx tsx scripts/migrate-to-nanocore.ts --source openclaw --execute --migrate-secrets

  # Migrate only specific categories
  npx tsx scripts/migrate-to-nanocore.ts --source hermes --execute --include soul,memory,channels
`);
}

// ============================================================================
// Source Detection
// ============================================================================

async function detectSources(): Promise<DetectedSource[]> {
  const sources: DetectedSource[] = [];

  for (const [type, paths] of Object.entries(SOURCE_PATHS)) {
    const dirPath = expandHome(paths.dir);
    const configPath = path.join(dirPath, paths.config);
    const exists = existsSync(configPath);
    sources.push({
      type: type as Exclude<SourceType, 'auto'>,
      path: dirPath,
      configPath,
      exists,
    });
  }

  return sources;
}

// ============================================================================
// Config Parsers
// ============================================================================

/**
 * Remove comments from JSON/JSON5 content without affecting strings
 * Handles both single-line and multi-line comments
 */
function removeComments(content: string): string {
  let result = '';
  let inString = false;
  let stringChar = '';
  let i = 0;

  while (i < content.length) {
    const char = content[i];
    const nextChar = content[i + 1];

    if (!inString) {
      // Check for start of string
      if (char === '"' || char === "'") {
        inString = true;
        stringChar = char;
        result += char;
      }
      // Check for single-line comment
      else if (char === '/' && nextChar === '/') {
        // Skip until end of line
        while (i < content.length && content[i] !== '\n') {
          i++;
        }
        continue;
      }
      // Check for multi-line comment
      else if (char === '/' && nextChar === '*') {
        // Skip until */
        i += 2;
        while (
          i < content.length - 1 &&
          !(content[i] === '*' && content[i + 1] === '/')
        ) {
          i++;
        }
        i += 2;
        continue;
      } else {
        result += char;
      }
    } else {
      // Inside string
      result += char;
      // Check for escape sequence
      if (char === '\\') {
        i++;
        if (i < content.length) {
          result += content[i];
        }
      }
      // Check for end of string
      else if (char === stringChar) {
        inString = false;
      }
    }
    i++;
  }

  return result;
}

async function parseOpenClawConfig(configPath: string): Promise<SourceConfig> {
  const content = await fs.readFile(configPath, 'utf-8');
  // Handle JSON5 (strip comments, trailing commas)
  // Remove single-line comments (but not // inside strings)
  let cleaned = removeComments(content);
  // Remove trailing commas before } or ]
  cleaned = cleaned.replace(/,(\s*[}\]])/g, '$1');
  // Normalize line endings and remove control characters except newlines and tabs
  cleaned = cleaned
    .replace(/\r\n/g, '\n')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  const data = JSON.parse(cleaned);

  return {
    type: 'openclaw',
    agentName: data.agent?.name,
    agentRole: data.agent?.role,
    agentPersonality: data.agent?.personality,
    modelProvider: data.model?.provider,
    modelName: data.model?.model,
    apiKey: data.model?.apiKey,
    baseUrl: data.model?.baseUrl,
    telegramToken: data.channels?.telegram?.botToken,
    telegramChatId: data.channels?.telegram?.allowedUsers?.[0],
    whatsappEnabled: data.channels?.whatsapp?.enabled,
    discordToken: data.channels?.discord?.enabled ? undefined : undefined,
    containerRuntime: data.sandbox?.runtime,
    containerImage: data.sandbox?.image,
    heartbeatInterval: data.heartbeat?.enabled
      ? data.heartbeat?.interval
      : undefined,
    memoryFlushEnabled: data.memory?.flushBeforeCompaction,
    execPatterns: data.exec?.approvalPatterns,
    mcpServers: data.mcp?.servers,
    plugins: data.plugins,
    raw: data,
  };
}

async function parseClawdbotConfig(configPath: string): Promise<SourceConfig> {
  const content = await fs.readFile(configPath, 'utf-8');
  const data = JSON.parse(content);

  return {
    type: 'clawdbot',
    agentName: data.agent?.name,
    agentRole: data.agent?.identity,
    modelProvider: data.llm?.provider,
    modelName: data.llm?.model,
    apiKey: data.llm?.apiKey,
    telegramToken: data.telegram?.token,
    telegramChatId: data.telegram?.mainChatId,
    whatsappEnabled: data.whatsapp?.enabled,
    discordToken: data.discord?.token,
    containerRuntime: data.container?.runtime,
    containerImage: data.container?.image,
    heartbeatInterval: data.memory?.flushInterval,
    execPatterns: data.allowedCommands,
    raw: data,
  };
}

async function parseMoltbotConfig(configPath: string): Promise<SourceConfig> {
  const content = await fs.readFile(configPath, 'utf-8');
  // Handle JSON5 (strip comments, trailing commas)
  let cleaned = removeComments(content);
  cleaned = cleaned.replace(/,(\s*[}\]])/g, '$1');
  cleaned = cleaned
    .replace(/\r\n/g, '\n')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  const data = JSON.parse(cleaned);

  return {
    type: 'moltbot',
    agentName: data.agentName,
    agentPersonality: data.persona,
    modelProvider: data.ai?.service,
    modelName: data.ai?.model,
    apiKey: data.ai?.apiKey,
    baseUrl: data.ai?.baseUrl,
    telegramToken: data.channels?.telegram?.botToken,
    whatsappEnabled: data.channels?.signal?.enabled, // Moltbot uses Signal, map to WhatsApp for simplicity
    containerRuntime: data.sandbox?.type,
    cronJobs: data.cron,
    raw: data,
  };
}

async function parseHermesConfig(configPath: string): Promise<SourceConfig> {
  const content = await fs.readFile(configPath, 'utf-8');
  const data = YAML.parse(content);

  return {
    type: 'hermes',
    agentName: data.agent?.name,
    agentRole: data.agent?.role,
    agentPersonality: data.agent?.description,
    modelProvider: data.llm?.provider,
    modelName: data.llm?.model,
    apiKey: data.llm?.api_key,
    baseUrl: data.llm?.base_url,
    telegramToken: data.channels?.telegram?.bot_token,
    telegramChatId: data.channels?.telegram?.main_chat_id,
    whatsappEnabled: data.channels?.whatsapp?.enabled,
    slackBotToken: data.channels?.slack?.bot_token,
    slackAppToken: data.channels?.slack?.app_token,
    containerRuntime: data.runtime?.container,
    heartbeatInterval: data.runtime?.heartbeat_interval,
    memoryFlushEnabled: data.runtime?.auto_compact,
    execPatterns: data.security?.exec_allowlist,
    webhooks: data.features?.webhooks,
    multiAgentEnabled: data.features?.multi_agent?.enabled,
    raw: data,
  };
}

async function loadSourceConfig(source: DetectedSource): Promise<SourceConfig> {
  switch (source.type) {
    case 'openclaw':
      return parseOpenClawConfig(source.configPath);
    case 'clawdbot':
      return parseClawdbotConfig(source.configPath);
    case 'moltbot':
      return parseMoltbotConfig(source.configPath);
    case 'hermes':
      return parseHermesConfig(source.configPath);
    default:
      throw new Error(`Unknown source type: ${source.type}`);
  }
}

// ============================================================================
// Migration Logic
// ============================================================================

class Migrator {
  private items: MigrationItem[] = [];
  private reportDir: string;
  private backupDir: string;
  private archiveDir: string;

  constructor(
    private args: CliArgs,
    private source: DetectedSource,
    private config: SourceConfig,
    private targetWorkspace: string,
    private targetEnv: string,
    private repoRoot: string,
  ) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.reportDir =
      args.outputDir ||
      path.join(repoRoot, 'migration', source.type, timestamp);
    this.backupDir = path.join(this.reportDir, 'backups');
    this.archiveDir = path.join(this.reportDir, 'archive');
  }

  private shouldInclude(category: string): boolean {
    if (this.args.exclude.includes(category)) return false;
    if (this.args.include.length === 0) return true;
    return this.args.include.includes(category);
  }

  private async ensureDir(dir: string, force: boolean = false): Promise<void> {
    if (!this.args.dryRun || force) {
      await fs.mkdir(dir, { recursive: true });
    }
  }

  private async backupIfExists(
    targetPath: string,
  ): Promise<string | undefined> {
    if (!existsSync(targetPath)) return undefined;

    // Handle files outside target workspace (like .env)
    let backupPath: string;
    if (targetPath.startsWith(this.targetWorkspace)) {
      backupPath = path.join(
        this.backupDir,
        path.relative(this.targetWorkspace, targetPath),
      );
    } else {
      // For files outside workspace, use a safe filename
      const safeName = targetPath.replace(/[^a-zA-Z0-9]/g, '_');
      backupPath = path.join(this.backupDir, 'external', safeName);
    }

    if (!this.args.dryRun) {
      await this.ensureDir(path.dirname(backupPath));
      await fs.copyFile(targetPath, backupPath);
    }
    return backupPath;
  }

  private addItem(
    item: Omit<MigrationItem, 'status'> & { status?: MigrationItem['status'] },
  ): void {
    this.items.push({
      status: 'migrated',
      ...item,
    } as MigrationItem);
  }

  async migrate(): Promise<MigrationReport> {
    // Create report directories (always create report dir for output, even in dry-run)
    await this.ensureDir(this.reportDir, true);
    await this.ensureDir(this.backupDir);
    await this.ensureDir(this.archiveDir);

    // Run migrations by category
    if (this.shouldInclude('soul')) await this.migrateSoul();
    if (this.shouldInclude('identity')) await this.migrateIdentity();
    if (this.shouldInclude('heartbeat')) await this.migrateHeartbeat();
    if (this.shouldInclude('memory')) await this.migrateMemory();
    if (this.shouldInclude('user')) await this.migrateUser();
    if (this.shouldInclude('agents')) await this.migrateAgents();
    if (this.shouldInclude('tools')) await this.migrateTools();
    if (this.shouldInclude('principles')) await this.migratePrinciples();
    if (this.shouldInclude('channels')) await this.migrateChannels();
    if (this.shouldInclude('model')) await this.migrateModel();
    if (this.shouldInclude('skills')) await this.migrateSkills();
    if (this.shouldInclude('allowlist')) await this.migrateAllowlist();
    if (this.shouldInclude('agent-config')) await this.migrateAgentConfig();
    if (this.shouldInclude('archive')) await this.migrateArchive();

    // Generate and save report
    const report = this.generateReport();
    await this.saveReport(report);

    return report;
  }

  private async migrateSoul(): Promise<void> {
    const sourceSoulPath = path.join(this.source.path, 'SOUL.md');
    const targetSoulPath = path.join(this.targetWorkspace, 'SOUL.md');

    if (!existsSync(sourceSoulPath)) {
      this.addItem({
        id: 'soul',
        category: 'soul',
        sourcePath: sourceSoulPath,
        targetPath: targetSoulPath,
        status: 'skipped',
        reason: 'Source SOUL.md not found',
      });
      return;
    }

    if (existsSync(targetSoulPath) && !this.args.overwrite) {
      this.addItem({
        id: 'soul',
        category: 'soul',
        sourcePath: sourceSoulPath,
        targetPath: targetSoulPath,
        status: 'conflict',
        reason: 'Target SOUL.md already exists (use --overwrite to replace)',
      });
      return;
    }

    const backupPath = await this.backupIfExists(targetSoulPath);

    if (!this.args.dryRun) {
      await this.ensureDir(this.targetWorkspace);
      await fs.copyFile(sourceSoulPath, targetSoulPath);
    }

    this.addItem({
      id: 'soul',
      category: 'soul',
      sourcePath: sourceSoulPath,
      targetPath: targetSoulPath,
      status: this.args.dryRun ? 'would_migrate' : 'migrated',
      reason: this.args.dryRun ? 'Would copy SOUL.md' : undefined,
      backupPath,
    });
  }

  private async migrateIdentity(): Promise<void> {
    if (!this.config.agentName && !this.config.agentRole) {
      this.addItem({
        id: 'identity',
        category: 'identity',
        sourcePath: this.source.configPath,
        targetPath: path.join(this.targetWorkspace, 'IDENTITY.md'),
        status: 'skipped',
        reason: 'No agent identity found in source config',
      });
      return;
    }

    const targetPath = path.join(this.targetWorkspace, 'IDENTITY.md');

    if (existsSync(targetPath) && !this.args.overwrite) {
      this.addItem({
        id: 'identity',
        category: 'identity',
        sourcePath: this.source.configPath,
        targetPath,
        status: 'conflict',
        reason: 'Target IDENTITY.md already exists',
      });
      return;
    }

    const content = `# IDENTITY.md

## Agent Identity

**Name:** ${this.config.agentName || 'Unknown'}
**Role:** ${this.config.agentRole || 'Assistant'}
${this.config.agentPersonality ? `**Personality:** ${this.config.agentPersonality}` : ''}

*Migrated from ${this.source.type}*
`;

    const backupPath = await this.backupIfExists(targetPath);

    if (!this.args.dryRun) {
      await this.ensureDir(this.targetWorkspace);
      await fs.writeFile(targetPath, content, 'utf-8');
    }

    this.addItem({
      id: 'identity',
      category: 'identity',
      sourcePath: this.source.configPath,
      targetPath,
      status: this.args.dryRun ? 'would_migrate' : 'migrated',
      reason: this.args.dryRun ? 'Would create IDENTITY.md' : undefined,
      backupPath,
    });
  }

  private async migrateHeartbeat(): Promise<void> {
    if (!this.config.heartbeatInterval) {
      this.addItem({
        id: 'heartbeat',
        category: 'heartbeat',
        sourcePath: this.source.configPath,
        targetPath: path.join(this.targetWorkspace, 'HEARTBEAT.md'),
        status: 'skipped',
        reason: 'No heartbeat config found',
      });
      return;
    }

    const targetPath = path.join(this.targetWorkspace, 'HEARTBEAT.md');

    if (existsSync(targetPath) && !this.args.overwrite) {
      this.addItem({
        id: 'heartbeat',
        category: 'heartbeat',
        sourcePath: this.source.configPath,
        targetPath,
        status: 'conflict',
        reason: 'Target HEARTBEAT.md already exists',
      });
      return;
    }

    const content = `# HEARTBEAT.md

## Heartbeat Configuration

**Interval:** ${this.config.heartbeatInterval}

*Migrated from ${this.source.type}*
`;

    const backupPath = await this.backupIfExists(targetPath);

    if (!this.args.dryRun) {
      await this.ensureDir(this.targetWorkspace);
      await fs.writeFile(targetPath, content, 'utf-8');
    }

    this.addItem({
      id: 'heartbeat',
      category: 'heartbeat',
      sourcePath: this.source.configPath,
      targetPath,
      status: this.args.dryRun ? 'would_migrate' : 'migrated',
      reason: this.args.dryRun ? 'Would create HEARTBEAT.md' : undefined,
      backupPath,
    });
  }

  private async migrateMemory(): Promise<void> {
    const sourceMemoryPath = path.join(this.source.path, 'MEMORY.md');
    const targetMemoryPath = path.join(this.targetWorkspace, 'MEMORY.md');

    // Also check for memory directory with daily files
    const sourceMemoryDir = path.join(this.source.path, 'memory');
    const hasMemoryDir = existsSync(sourceMemoryDir);

    if (!existsSync(sourceMemoryPath) && !hasMemoryDir) {
      this.addItem({
        id: 'memory',
        category: 'memory',
        sourcePath: sourceMemoryPath,
        targetPath: targetMemoryPath,
        status: 'skipped',
        reason: 'No memory files found',
      });
      return;
    }

    let memoryContent = '';

    // Read main MEMORY.md if exists
    if (existsSync(sourceMemoryPath)) {
      memoryContent = await fs.readFile(sourceMemoryPath, 'utf-8');
    }

    // Read daily memory files
    let dailyFilesCount = 0;
    if (hasMemoryDir) {
      const files = await fs.readdir(sourceMemoryDir);
      for (const file of files.filter((f) => f.endsWith('.md'))) {
        const filePath = path.join(sourceMemoryDir, file);
        const content = await fs.readFile(filePath, 'utf-8');
        memoryContent += `\n\n<!-- From ${file} -->\n${content}`;
        dailyFilesCount++;
      }
    }

    // Merge with existing target if present and not overwriting
    if (existsSync(targetMemoryPath) && !this.args.overwrite) {
      const existingContent = await fs.readFile(targetMemoryPath, 'utf-8');
      // Simple dedup: check if content already exists
      const newLines = memoryContent
        .split('\n')
        .filter((line) => !existingContent.includes(line));
      if (newLines.length === 0) {
        this.addItem({
          id: 'memory',
          category: 'memory',
          sourcePath: sourceMemoryPath,
          targetPath: targetMemoryPath,
          status: 'skipped',
          reason: 'All memory entries already present',
        });
        return;
      }
      memoryContent =
        existingContent +
        '\n\n<!-- Merged from ' +
        this.source.type +
        ' -->\n' +
        newLines.join('\n');
    }

    const backupPath = await this.backupIfExists(targetMemoryPath);

    if (!this.args.dryRun) {
      await this.ensureDir(this.targetWorkspace);
      await fs.writeFile(targetMemoryPath, memoryContent, 'utf-8');
    }

    this.addItem({
      id: 'memory',
      category: 'memory',
      sourcePath: sourceMemoryPath,
      targetPath: targetMemoryPath,
      status: this.args.dryRun ? 'would_migrate' : 'migrated',
      reason: this.args.dryRun
        ? `Would merge memory (${dailyFilesCount} daily files)`
        : `Merged memory (${dailyFilesCount} daily files)`,
      backupPath,
    });
  }

  private async migrateUser(): Promise<void> {
    const sourceUserPath = path.join(this.source.path, 'USER.md');
    const targetUserPath = path.join(this.targetWorkspace, 'USER.md');

    if (!existsSync(sourceUserPath)) {
      this.addItem({
        id: 'user',
        category: 'user',
        sourcePath: sourceUserPath,
        targetPath: targetUserPath,
        status: 'skipped',
        reason: 'Source USER.md not found',
      });
      return;
    }

    const content = await fs.readFile(sourceUserPath, 'utf-8');

    // Merge with existing if present
    if (existsSync(targetUserPath) && !this.args.overwrite) {
      const existingContent = await fs.readFile(targetUserPath, 'utf-8');
      const newLines = content
        .split('\n')
        .filter((line) => !existingContent.includes(line));
      if (newLines.length === 0) {
        this.addItem({
          id: 'user',
          category: 'user',
          sourcePath: sourceUserPath,
          targetPath: targetUserPath,
          status: 'skipped',
          reason: 'All user entries already present',
        });
        return;
      }
    }

    const backupPath = await this.backupIfExists(targetUserPath);

    if (!this.args.dryRun) {
      await this.ensureDir(this.targetWorkspace);
      await fs.writeFile(targetUserPath, content, 'utf-8');
    }

    this.addItem({
      id: 'user',
      category: 'user',
      sourcePath: sourceUserPath,
      targetPath: targetUserPath,
      status: this.args.dryRun ? 'would_migrate' : 'migrated',
      reason: this.args.dryRun ? 'Would copy USER.md' : undefined,
      backupPath,
    });
  }

  private async migrateAgents(): Promise<void> {
    const sourceAgentsPath = path.join(this.source.path, 'AGENTS.md');
    const targetAgentsPath = path.join(this.targetWorkspace, 'AGENTS.md');

    if (!existsSync(sourceAgentsPath)) {
      this.addItem({
        id: 'agents',
        category: 'agents',
        sourcePath: sourceAgentsPath,
        targetPath: targetAgentsPath,
        status: 'skipped',
        reason: 'Source AGENTS.md not found',
      });
      return;
    }

    if (existsSync(targetAgentsPath) && !this.args.overwrite) {
      this.addItem({
        id: 'agents',
        category: 'agents',
        sourcePath: sourceAgentsPath,
        targetPath: targetAgentsPath,
        status: 'conflict',
        reason: 'Target AGENTS.md already exists',
      });
      return;
    }

    const backupPath = await this.backupIfExists(targetAgentsPath);

    if (!this.args.dryRun) {
      await this.ensureDir(this.targetWorkspace);
      await fs.copyFile(sourceAgentsPath, targetAgentsPath);
    }

    this.addItem({
      id: 'agents',
      category: 'agents',
      sourcePath: sourceAgentsPath,
      targetPath: targetAgentsPath,
      status: this.args.dryRun ? 'would_migrate' : 'migrated',
      reason: this.args.dryRun ? 'Would copy AGENTS.md' : undefined,
      backupPath,
    });
  }

  private async migrateTools(): Promise<void> {
    // Tools.md is typically generated from config, not a source file
    const targetToolsPath = path.join(this.targetWorkspace, 'TOOLS.md');

    if (existsSync(targetToolsPath) && !this.args.overwrite) {
      this.addItem({
        id: 'tools',
        category: 'tools',
        sourcePath: this.source.configPath,
        targetPath: targetToolsPath,
        status: 'conflict',
        reason: 'Target TOOLS.md already exists',
      });
      return;
    }

    const content = `# TOOLS.md

## Available Tools

*Migrated from ${this.source.type}*

Tools configuration should be reviewed and updated manually.
`;

    const backupPath = await this.backupIfExists(targetToolsPath);

    if (!this.args.dryRun) {
      await this.ensureDir(this.targetWorkspace);
      await fs.writeFile(targetToolsPath, content, 'utf-8');
    }

    this.addItem({
      id: 'tools',
      category: 'tools',
      sourcePath: this.source.configPath,
      targetPath: targetToolsPath,
      status: this.args.dryRun ? 'would_migrate' : 'migrated',
      reason: this.args.dryRun ? 'Would create TOOLS.md' : undefined,
      backupPath,
    });
  }

  private async migratePrinciples(): Promise<void> {
    const sourcePrinciplesPath = path.join(this.source.path, 'PRINCIPLES.md');
    const targetPrinciplesPath = path.join(
      this.targetWorkspace,
      'PRINCIPLES.md',
    );

    if (!existsSync(sourcePrinciplesPath)) {
      // Generate from agent personality if available
      if (!this.config.agentPersonality) {
        this.addItem({
          id: 'principles',
          category: 'principles',
          sourcePath: sourcePrinciplesPath,
          targetPath: targetPrinciplesPath,
          status: 'skipped',
          reason: 'No principles found in source',
        });
        return;
      }
    }

    if (existsSync(targetPrinciplesPath) && !this.args.overwrite) {
      this.addItem({
        id: 'principles',
        category: 'principles',
        sourcePath: sourcePrinciplesPath,
        targetPath: targetPrinciplesPath,
        status: 'conflict',
        reason: 'Target PRINCIPLES.md already exists',
      });
      return;
    }

    let content: string;
    if (existsSync(sourcePrinciplesPath)) {
      content = await fs.readFile(sourcePrinciplesPath, 'utf-8');
    } else {
      content = `# PRINCIPLES.md

## Core Principles

${this.config.agentPersonality}

*Migrated from ${this.source.type}*
`;
    }

    const backupPath = await this.backupIfExists(targetPrinciplesPath);

    if (!this.args.dryRun) {
      await this.ensureDir(this.targetWorkspace);
      await fs.writeFile(targetPrinciplesPath, content, 'utf-8');
    }

    this.addItem({
      id: 'principles',
      category: 'principles',
      sourcePath: sourcePrinciplesPath,
      targetPath: targetPrinciplesPath,
      status: this.args.dryRun ? 'would_migrate' : 'migrated',
      reason: this.args.dryRun ? 'Would create PRINCIPLES.md' : undefined,
      backupPath,
    });
  }

  private async migrateChannels(): Promise<void> {
    const envVars: Record<string, string> = {};

    // Telegram
    if (this.config.telegramToken) {
      if (this.args.migrateSecrets) {
        envVars['TELEGRAM_BOT_TOKEN'] = this.config.telegramToken;
      }
    }
    if (this.config.telegramChatId) {
      envVars['TELEGRAM_MAIN_CHAT_ID'] = this.config.telegramChatId;
    }

    // WhatsApp
    if (this.config.whatsappEnabled) {
      envVars['WHATSAPP_ENABLED'] = '1';
    }

    // Discord
    if (this.config.discordToken) {
      if (this.args.migrateSecrets) {
        envVars['DISCORD_BOT_TOKEN'] = this.config.discordToken;
      }
    }

    // Slack
    if (this.config.slackBotToken) {
      if (this.args.migrateSecrets) {
        envVars['SLACK_BOT_TOKEN'] = this.config.slackBotToken;
      }
    }
    if (this.config.slackAppToken) {
      if (this.args.migrateSecrets) {
        envVars['SLACK_APP_TOKEN'] = this.config.slackAppToken;
      }
    }

    // Signal
    if (this.config.signalEnabled) {
      envVars['SIGNAL_ENABLED'] = '1';
    }

    if (Object.keys(envVars).length === 0) {
      this.addItem({
        id: 'channels',
        category: 'channels',
        sourcePath: this.source.configPath,
        targetPath: this.targetEnv,
        status: 'skipped',
        reason: 'No channel configuration found',
      });
      return;
    }

    // Check for secrets that would be skipped
    const secretsSkipped: string[] = [];
    if (this.config.telegramToken && !this.args.migrateSecrets) {
      secretsSkipped.push('TELEGRAM_BOT_TOKEN');
    }
    if (this.config.discordToken && !this.args.migrateSecrets) {
      secretsSkipped.push('DISCORD_BOT_TOKEN');
    }
    if (this.config.slackBotToken && !this.args.migrateSecrets) {
      secretsSkipped.push('SLACK_BOT_TOKEN');
    }

    await this.updateEnvFile(envVars, 'channels');

    if (secretsSkipped.length > 0) {
      this.addItem({
        id: 'channels-secrets',
        category: 'channels',
        sourcePath: this.source.configPath,
        targetPath: this.targetEnv,
        status: 'skipped',
        reason: `Secrets not migrated (use --migrate-secrets): ${secretsSkipped.join(', ')}`,
      });
    }
  }

  private async migrateModel(): Promise<void> {
    const envVars: Record<string, string> = {};

    if (this.config.modelProvider) {
      envVars['PI_API'] = this.config.modelProvider;
    }
    if (this.config.modelName) {
      envVars['PI_MODEL'] = this.config.modelName;
    }
    if (this.config.baseUrl) {
      envVars['OPENAI_BASE_URL'] = this.config.baseUrl;
    }

    // API keys (only with --migrate-secrets)
    const secretsSkipped: string[] = [];
    if (this.config.apiKey) {
      if (this.args.migrateSecrets) {
        // Determine key name based on provider
        const provider = this.config.modelProvider?.toLowerCase() || '';
        if (provider.includes('openai')) {
          envVars['OPENAI_API_KEY'] = this.config.apiKey;
        } else if (provider.includes('anthropic')) {
          envVars['ANTHROPIC_API_KEY'] = this.config.apiKey;
        } else if (provider.includes('openrouter')) {
          envVars['OPENROUTER_API_KEY'] = this.config.apiKey;
        } else {
          envVars['API_KEY'] = this.config.apiKey;
        }
      } else {
        secretsSkipped.push('API_KEY');
      }
    }

    if (Object.keys(envVars).length === 0 && secretsSkipped.length === 0) {
      this.addItem({
        id: 'model',
        category: 'model',
        sourcePath: this.source.configPath,
        targetPath: this.targetEnv,
        status: 'skipped',
        reason: 'No model configuration found',
      });
      return;
    }

    if (Object.keys(envVars).length > 0) {
      await this.updateEnvFile(envVars, 'model');
    }

    if (secretsSkipped.length > 0) {
      this.addItem({
        id: 'model-secrets',
        category: 'model',
        sourcePath: this.source.configPath,
        targetPath: this.targetEnv,
        status: 'skipped',
        reason: `API keys not migrated (use --migrate-secrets): ${secretsSkipped.join(', ')}`,
      });
    }
  }

  private async updateEnvFile(
    envVars: Record<string, string>,
    category: string,
  ): Promise<void> {
    let existingContent = '';
    if (existsSync(this.targetEnv)) {
      existingContent = await fs.readFile(this.targetEnv, 'utf-8');
    }

    const lines = existingContent.split('\n');
    const newLines: string[] = [];
    const updatedKeys = new Set<string>();

    for (const line of lines) {
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (match) {
        const key = match[1];
        if (key in envVars) {
          if (this.args.overwrite) {
            newLines.push(`${key}=${envVars[key]}`);
            updatedKeys.add(key);
          } else {
            newLines.push(line); // Keep existing
          }
        } else {
          newLines.push(line);
        }
      } else {
        newLines.push(line);
      }
    }

    // Add new keys
    for (const [key, value] of Object.entries(envVars)) {
      if (!updatedKeys.has(key)) {
        newLines.push(`${key}=${value}`);
      }
    }

    const backupPath = this.args.overwrite
      ? await this.backupIfExists(this.targetEnv)
      : undefined;

    if (!this.args.dryRun) {
      await this.ensureDir(path.dirname(this.targetEnv));
      await fs.writeFile(this.targetEnv, newLines.join('\n'), 'utf-8');
    }

    this.addItem({
      id: `env-${category}`,
      category,
      sourcePath: this.source.configPath,
      targetPath: this.targetEnv,
      status: this.args.dryRun ? 'would_migrate' : 'migrated',
      reason: this.args.dryRun
        ? `Would update .env with ${category} settings`
        : undefined,
      backupPath,
    });
  }

  private async migrateSkills(): Promise<void> {
    const sourceSkillsDir = path.join(this.source.path, 'skills');
    if (!existsSync(sourceSkillsDir)) {
      this.addItem({
        id: 'skills',
        category: 'skills',
        sourcePath: sourceSkillsDir,
        targetPath: path.join(this.targetWorkspace, 'skills'),
        status: 'skipped',
        reason: 'No skills directory found',
      });
      return;
    }

    const targetSkillsDir = path.join(
      this.targetWorkspace,
      'skills',
      `${this.source.type}-imports`,
    );
    const entries = await fs.readdir(sourceSkillsDir, { withFileTypes: true });
    const skillDirs = entries.filter((e) => e.isDirectory());

    if (skillDirs.length === 0) {
      this.addItem({
        id: 'skills',
        category: 'skills',
        sourcePath: sourceSkillsDir,
        targetPath: targetSkillsDir,
        status: 'skipped',
        reason: 'No skills found in source directory',
      });
      return;
    }

    let migratedCount = 0;
    let skippedCount = 0;

    for (const skillDir of skillDirs) {
      const sourceSkillPath = path.join(sourceSkillsDir, skillDir.name);
      const skillMdPath = path.join(sourceSkillPath, 'SKILL.md');

      if (!existsSync(skillMdPath)) {
        skippedCount++;
        continue;
      }

      let targetSkillPath = path.join(targetSkillsDir, skillDir.name);

      // Handle conflicts
      if (existsSync(targetSkillPath)) {
        switch (this.args.skillConflict) {
          case 'skip':
            this.addItem({
              id: `skill-${skillDir.name}`,
              category: 'skills',
              sourcePath: sourceSkillPath,
              targetPath: targetSkillPath,
              status: 'conflict',
              reason: `Skill ${skillDir.name} already exists (use --skill-conflict overwrite or rename)`,
            });
            skippedCount++;
            continue;
          case 'rename':
            targetSkillPath = path.join(
              targetSkillsDir,
              `${skillDir.name}-imported`,
            );
            break;
          case 'overwrite':
            // Will overwrite below
            break;
        }
      }

      const backupPath =
        this.args.skillConflict === 'overwrite' || this.args.overwrite
          ? await this.backupIfExists(targetSkillPath)
          : undefined;

      if (!this.args.dryRun) {
        await this.ensureDir(targetSkillPath);
        // Copy all files in skill directory
        const files = await fs.readdir(sourceSkillPath);
        for (const file of files) {
          const srcFile = path.join(sourceSkillPath, file);
          const dstFile = path.join(targetSkillPath, file);
          const stat = await fs.stat(srcFile);
          if (stat.isFile()) {
            await fs.copyFile(srcFile, dstFile);
          }
        }
      }

      this.addItem({
        id: `skill-${skillDir.name}`,
        category: 'skills',
        sourcePath: sourceSkillPath,
        targetPath: targetSkillPath,
        status: this.args.dryRun ? 'would_migrate' : 'migrated',
        reason: this.args.dryRun
          ? `Would copy skill ${skillDir.name}`
          : undefined,
        backupPath,
      });
      migratedCount++;
    }

    // Create DESCRIPTION.md
    if (!this.args.dryRun && migratedCount > 0) {
      const descriptionPath = path.join(targetSkillsDir, 'DESCRIPTION.md');
      const descriptionContent = `# Skills Imported from ${this.source.type}

This directory contains skills migrated from ${this.source.type}.

**Total skills:** ${migratedCount}
**Migration date:** ${new Date().toISOString()}

## Skills

${skillDirs
  .filter((d) => existsSync(path.join(sourceSkillsDir, d.name, 'SKILL.md')))
  .map((d) => `- ${d.name}`)
  .join('\n')}

## Notes

Please review each skill for compatibility with nano-core.
`;
      await fs.writeFile(descriptionPath, descriptionContent, 'utf-8');
    }

    if (migratedCount === 0 && skippedCount > 0) {
      this.addItem({
        id: 'skills-summary',
        category: 'skills',
        sourcePath: sourceSkillsDir,
        targetPath: targetSkillsDir,
        status: 'skipped',
        reason: `${skippedCount} skills skipped (no SKILL.md or conflicts)`,
      });
    }
  }

  private async migrateAllowlist(): Promise<void> {
    if (!this.config.execPatterns || this.config.execPatterns.length === 0) {
      this.addItem({
        id: 'allowlist',
        category: 'allowlist',
        sourcePath: this.source.configPath,
        targetPath: path.join(
          os.homedir(),
          '.config/fft_nano/mount-allowlist.json',
        ),
        status: 'skipped',
        reason: 'No exec patterns found',
      });
      return;
    }

    const allowlistPath = path.join(
      os.homedir(),
      '.config/fft_nano/mount-allowlist.json',
    );
    let existingPatterns: string[] = [];

    if (existsSync(allowlistPath)) {
      try {
        const content = await fs.readFile(allowlistPath, 'utf-8');
        const data = JSON.parse(content);
        existingPatterns = data.patterns || [];
      } catch {
        // Ignore parse errors
      }
    }

    // Merge patterns (dedup)
    const newPatterns = this.config.execPatterns.filter(
      (p) => !existingPatterns.includes(p),
    );

    if (newPatterns.length === 0) {
      this.addItem({
        id: 'allowlist',
        category: 'allowlist',
        sourcePath: this.source.configPath,
        targetPath: allowlistPath,
        status: 'skipped',
        reason: 'All patterns already present',
      });
      return;
    }

    const mergedPatterns = [...existingPatterns, ...newPatterns];

    const backupPath = await this.backupIfExists(allowlistPath);

    if (!this.args.dryRun) {
      await this.ensureDir(path.dirname(allowlistPath));
      await fs.writeFile(
        allowlistPath,
        JSON.stringify({ patterns: mergedPatterns }, null, 2),
        'utf-8',
      );
    }

    this.addItem({
      id: 'allowlist',
      category: 'allowlist',
      sourcePath: this.source.configPath,
      targetPath: allowlistPath,
      status: this.args.dryRun ? 'would_migrate' : 'migrated',
      reason: this.args.dryRun
        ? `Would add ${newPatterns.length} exec patterns`
        : `Added ${newPatterns.length} exec patterns`,
      backupPath,
    });
  }

  private async migrateAgentConfig(): Promise<void> {
    const envVars: Record<string, string> = {};

    if (this.config.containerRuntime) {
      envVars['CONTAINER_RUNTIME'] = this.config.containerRuntime;
    }
    if (this.config.containerImage) {
      envVars['CONTAINER_IMAGE'] = this.config.containerImage;
    }
    if (this.config.heartbeatInterval) {
      envVars['FFT_NANO_HEARTBEAT_EVERY'] = this.config.heartbeatInterval;
    }

    if (Object.keys(envVars).length > 0) {
      await this.updateEnvFile(envVars, 'agent-config');
    }

    // Parity config for memory flush
    if (this.config.memoryFlushEnabled !== undefined) {
      const parityPath = path.join(
        os.homedir(),
        '.config/fft_nano/runtime.parity.json',
      );
      let parityConfig: Record<string, unknown> = {};

      if (existsSync(parityPath)) {
        try {
          const content = await fs.readFile(parityPath, 'utf-8');
          parityConfig = JSON.parse(content);
        } catch {
          // Ignore parse errors
        }
      }

      parityConfig.memory = {
        ...((parityConfig.memory as Record<string, unknown>) || {}),
        flushBeforeCompaction: this.config.memoryFlushEnabled,
      };

      const backupPath = await this.backupIfExists(parityPath);

      if (!this.args.dryRun) {
        await this.ensureDir(path.dirname(parityPath));
        await fs.writeFile(
          parityPath,
          JSON.stringify(parityConfig, null, 2),
          'utf-8',
        );
      }

      this.addItem({
        id: 'parity-config',
        category: 'agent-config',
        sourcePath: this.source.configPath,
        targetPath: parityPath,
        status: this.args.dryRun ? 'would_migrate' : 'migrated',
        reason: this.args.dryRun ? 'Would update parity config' : undefined,
        backupPath,
      });
    }
  }

  private async migrateArchive(): Promise<void> {
    const archiveItems: Array<{ name: string; data: unknown }> = [];

    if (this.config.mcpServers && this.config.mcpServers.length > 0) {
      archiveItems.push({ name: 'mcp-servers', data: this.config.mcpServers });
    }
    if (this.config.plugins && this.config.plugins.length > 0) {
      archiveItems.push({ name: 'plugins', data: this.config.plugins });
    }
    if (this.config.cronJobs && this.config.cronJobs.length > 0) {
      archiveItems.push({ name: 'cron-jobs', data: this.config.cronJobs });
    }
    if (this.config.webhooks && this.config.webhooks.length > 0) {
      archiveItems.push({ name: 'webhooks', data: this.config.webhooks });
    }
    if (this.config.multiAgentEnabled !== undefined) {
      archiveItems.push({
        name: 'multi-agent',
        data: { enabled: this.config.multiAgentEnabled },
      });
    }

    for (const item of archiveItems) {
      const archivePath = path.join(this.archiveDir, `${item.name}.json`);

      if (!this.args.dryRun) {
        await fs.writeFile(
          archivePath,
          JSON.stringify(item.data, null, 2),
          'utf-8',
        );
      }

      this.addItem({
        id: `archive-${item.name}`,
        category: 'archive',
        sourcePath: this.source.configPath,
        targetPath: archivePath,
        status: this.args.dryRun ? 'would_migrate' : 'archived',
        reason: this.args.dryRun
          ? `Would archive ${item.name}`
          : `Archived ${item.name} for manual review`,
      });
    }

    if (archiveItems.length === 0) {
      this.addItem({
        id: 'archive',
        category: 'archive',
        sourcePath: this.source.configPath,
        targetPath: this.archiveDir,
        status: 'skipped',
        reason: 'No items to archive',
      });
    }
  }

  private generateReport(): MigrationReport {
    const summary = {
      migrated: this.items.filter(
        (i) => i.status === 'migrated' || i.status === 'would_migrate',
      ).length,
      archived: this.items.filter((i) => i.status === 'archived').length,
      skipped: this.items.filter((i) => i.status === 'skipped').length,
      conflict: this.items.filter((i) => i.status === 'conflict').length,
      error: this.items.filter((i) => i.status === 'error').length,
      total: this.items.length,
    };

    return {
      timestamp: new Date().toISOString(),
      mode: this.args.dryRun ? 'dry-run' : 'execute',
      sourceRoot: this.source.path,
      targetRoot: this.targetWorkspace,
      sourceType: this.source.type,
      summary,
      items: this.items,
    };
  }

  private async saveReport(report: MigrationReport): Promise<void> {
    const reportPath = path.join(this.reportDir, 'report.json');
    const summaryPath = path.join(this.reportDir, 'summary.md');
    const notesPath = path.join(this.reportDir, 'MIGRATION_NOTES.md');

    // Save JSON report (always, even in dry-run)
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf-8');

    // Save markdown summary (always, even in dry-run)
    const summaryContent = this.generateSummaryMarkdown(report);
    await fs.writeFile(summaryPath, summaryContent, 'utf-8');

    // Save migration notes (always, even in dry-run)
    const notesContent = this.generateMigrationNotes(report);
    await fs.writeFile(notesPath, notesContent, 'utf-8');

    // Print terminal summary
    this.printTerminalSummary(report);
  }

  private generateSummaryMarkdown(report: MigrationReport): string {
    const sections: string[] = [];

    sections.push(`# Migration Summary`);
    sections.push('');
    sections.push(`**Source:** ${report.sourceType}`);
    sections.push(`**Mode:** ${report.mode}`);
    sections.push(`**Timestamp:** ${report.timestamp}`);
    sections.push('');

    sections.push(`## Summary`);
    sections.push('');
    sections.push(`- **Migrated:** ${report.summary.migrated}`);
    sections.push(`- **Archived:** ${report.summary.archived}`);
    sections.push(`- **Skipped:** ${report.summary.skipped}`);
    sections.push(`- **Conflicts:** ${report.summary.conflict}`);
    sections.push(`- **Errors:** ${report.summary.error}`);
    sections.push(`- **Total:** ${report.summary.total}`);
    sections.push('');

    // Migrated items
    const migrated = report.items.filter(
      (i) => i.status === 'migrated' || i.status === 'would_migrate',
    );
    if (migrated.length > 0) {
      sections.push(`## Migrated Items`);
      sections.push('');
      for (const item of migrated) {
        sections.push(`- **${item.id}** (${item.category})`);
        if (item.reason) sections.push(`  - ${item.reason}`);
      }
      sections.push('');
    }

    // Archived items
    const archived = report.items.filter((i) => i.status === 'archived');
    if (archived.length > 0) {
      sections.push(`## Archived Items`);
      sections.push('');
      for (const item of archived) {
        sections.push(`- **${item.id}**`);
        if (item.reason) sections.push(`  - ${item.reason}`);
      }
      sections.push('');
    }

    // Conflicts
    const conflicts = report.items.filter((i) => i.status === 'conflict');
    if (conflicts.length > 0) {
      sections.push(`## Conflicts`);
      sections.push('');
      for (const item of conflicts) {
        sections.push(`- **${item.id}** (${item.category})`);
        if (item.reason) sections.push(`  - ${item.reason}`);
      }
      sections.push('');
    }

    // Skipped
    const skipped = report.items.filter((i) => i.status === 'skipped');
    if (skipped.length > 0) {
      sections.push(`## Skipped Items`);
      sections.push('');
      for (const item of skipped) {
        sections.push(`- **${item.id}** (${item.category})`);
        if (item.reason) sections.push(`  - ${item.reason}`);
      }
      sections.push('');
    }

    sections.push(`## Next Steps`);
    sections.push('');
    if (report.mode === 'dry-run') {
      sections.push(`1. Review this summary and the detailed report.json`);
      sections.push(`2. Run with --execute to perform the actual migration`);
    } else {
      sections.push(`1. Review migrated files in ${report.targetRoot}`);
      sections.push(`2. Check archived items in ${this.archiveDir}`);
      sections.push(`3. Review and update .env file with your settings`);
    }
    sections.push('');

    return sections.join('\n');
  }

  private generateMigrationNotes(report: MigrationReport): string {
    const sections: string[] = [];

    sections.push(`# Migration Notes`);
    sections.push('');
    sections.push(
      `This file contains notes and action items from the migration from ${report.sourceType}.`,
    );
    sections.push('');

    sections.push(`## Manual Review Required`);
    sections.push('');

    // Check for items that need attention
    const needsReview = report.items.filter(
      (i) =>
        i.status === 'archived' ||
        i.status === 'conflict' ||
        i.status === 'skipped',
    );

    if (needsReview.length > 0) {
      for (const item of needsReview) {
        sections.push(`### ${item.id} (${item.category})`);
        sections.push(`- Status: ${item.status}`);
        if (item.reason) sections.push(`- Reason: ${item.reason}`);
        sections.push('');
      }
    } else {
      sections.push(
        'All items migrated successfully. No manual review required.',
      );
      sections.push('');
    }

    sections.push(`## Action Items`);
    sections.push('');
    sections.push('- [ ] Review migrated configuration files');
    sections.push('- [ ] Verify API keys and secrets are correct');
    sections.push('- [ ] Test channel connections (Telegram, WhatsApp, etc.)');
    sections.push('- [ ] Review archived items for manual migration');
    sections.push('- [ ] Update any hardcoded paths in skills');
    sections.push('');

    return sections.join('\n');
  }

  private printTerminalSummary(report: MigrationReport): void {
    console.log('\n' + '='.repeat(60));
    console.log(`Migration Report: ${report.sourceType}`);
    console.log('='.repeat(60));
    console.log(`Mode: ${report.mode}`);
    console.log(`Source: ${report.sourceRoot}`);
    console.log(`Target: ${report.targetRoot}`);
    console.log('-'.repeat(60));
    console.log(`Migrated:  ${report.summary.migrated}`);
    console.log(`Archived:  ${report.summary.archived}`);
    console.log(`Skipped:   ${report.summary.skipped}`);
    console.log(`Conflicts: ${report.summary.conflict}`);
    console.log(`Errors:    ${report.summary.error}`);
    console.log('-'.repeat(60));

    if (report.mode === 'dry-run') {
      console.log('\n⚠️  This was a dry run. No files were modified.');
      console.log('   Run with --execute to perform the actual migration.');
    } else {
      console.log(`\n✅ Migration complete. Report saved to:`);
      console.log(`   ${this.reportDir}`);
    }

    if (report.summary.conflict > 0) {
      console.log(
        '\n⚠️  Some items had conflicts. Use --overwrite to replace existing files.',
      );
    }

    console.log('='.repeat(60) + '\n');
  }
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const args = parseArgs();

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  // Determine paths
  const targetWorkspace = args.targetWorkspace || expandHome('~/nano');
  const repoRoot = process.cwd();
  const targetEnv = args.targetEnv || path.join(repoRoot, '.env');

  console.log('🔍 Detecting sources...');

  // Detect sources
  const detectedSources = await detectSources();
  const availableSources = detectedSources.filter((s) => s.exists);

  if (args.source === 'auto') {
    if (availableSources.length === 0) {
      console.error('❌ No source configurations found.');
      console.error('Checked paths:');
      for (const s of detectedSources) {
        console.error(`  - ${s.configPath}`);
      }
      process.exit(1);
    }

    if (availableSources.length > 1) {
      console.log('\nMultiple sources detected:');
      for (const s of availableSources) {
        console.log(`  - ${s.type}: ${s.path}`);
      }
      console.log('\nPlease specify a source with --source <type>');
      process.exit(1);
    }

    // Use the only available source
    const source = availableSources[0];
    console.log(`✅ Using detected source: ${source.type}`);

    const config = await loadSourceConfig(source);
    const migrator = new Migrator(
      args,
      source,
      config,
      targetWorkspace,
      targetEnv,
      repoRoot,
    );
    await migrator.migrate();
  } else {
    // Explicit source specified
    const source = detectedSources.find((s) => s.type === args.source);
    if (!source) {
      console.error(`❌ Unknown source type: ${args.source}`);
      process.exit(1);
    }

    if (!source.exists) {
      console.error(`❌ Source not found: ${source.configPath}`);
      process.exit(1);
    }

    console.log(`✅ Using source: ${source.type}`);

    const config = await loadSourceConfig(source);
    const migrator = new Migrator(
      args,
      source,
      config,
      targetWorkspace,
      targetEnv,
      repoRoot,
    );
    await migrator.migrate();
  }
}

main().catch((error) => {
  console.error('❌ Migration failed:', error);
  process.exit(1);
});
