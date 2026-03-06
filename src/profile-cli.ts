import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

import { FEATURE_FARM, FFT_PROFILE, PROFILE_DETECTION, type FFTProfile } from './profile.js';
import {
  getProfilesDir,
  getWorkspacesDir,
  getProfileDir,
  getWorkspaceDir,
  getProfileManifest,
  listInstalledProfiles,
  ensureDirectories,
  type ProfileManifest
} from './profile-storage.js';

interface CliArgs {
  command: 'status' | 'set' | 'apply' | 'install' | 'list' | 'activate' | 'switch' | 'remove';
  profile?: string;
  source?: string;
  writeEnv: boolean;
}

function usage(): string {
  return [
    'Usage:',
    '  npm run profile -- status',
    '  npm run profile -- set <core|farm> [--no-env]',
    '  npm run profile -- apply <core|farm> [--no-env]',
    '  npm run profile -- install <source>',
    '  npm run profile -- list',
    '  npm run profile -- activate <name>',
    '  npm run profile -- switch <name>',
    '  npm run profile -- remove <name>',
    '',
    'Commands:',
    '  - status: Show current profile',
    '  - set: Update runtime profile selection (optionally writes .env)',
    '  - apply: Enable profile flags without removing existing data',
    '  - install: Install a profile from GitHub, URL, or local path',
    '  - list: List all installed profiles',
    '  - activate: Activate a profile (first-time setup)',
    '  - switch: Switch to a different profile',
    '  - remove: Remove an installed profile',
    '',
    'Notes:',
    '  - install <source>: Source can be GitHub repo (user/repo), URL, or local path',
    '  - activate <name>: First-time setup for a profile',
    '  - switch <name>: Switch profiles (backs up current workspace)',
  ].join('\n');
}

function parseArgs(argv: string[]): CliArgs {
  if (argv.length === 0 || argv.includes('-h') || argv.includes('--help')) {
    console.log(usage());
    process.exit(0);
  }

  const [commandRaw, target, ...rest] = argv;
  const command = commandRaw?.trim().toLowerCase();
  const writeEnv = !rest.includes('--no-env');

  if (command === 'status' || command === 'list') {
    return { command, writeEnv };
  }

  if (command === 'install') {
    if (!target) {
      throw new Error('install requires <source>');
    }
    return { command: 'install', source: target, writeEnv };
  }

  if (command === 'activate' || command === 'switch') {
    if (!target) {
      throw new Error(`${command} requires <profile-name>`);
    }
    return { command, profile: target, writeEnv };
  }

  if (command === 'remove') {
    if (!target) {
      throw new Error('remove requires <profile-name>');
    }
    return { command, profile: target, writeEnv };
  }

  if (command === 'set' || command === 'apply') {
    const profileRaw = target?.trim().toLowerCase();
    if (profileRaw !== 'core' && profileRaw !== 'farm') {
      throw new Error(`${command} requires <core|farm>`);
    }
    return {
      command,
      profile: profileRaw,
      writeEnv,
    };
  }

  throw new Error(`Unknown command: ${commandRaw}`);
}

function readEnvPath(projectRoot: string): string {
  return path.join(projectRoot, '.env');
}

function upsertEnvValue(envPath: string, key: string, value: string): void {
  const lines = fs.existsSync(envPath)
    ? fs.readFileSync(envPath, 'utf-8').replace(/\r\n/g, '\n').split('\n')
    : [];

  let updated = false;
  const pattern = new RegExp(`^\\s*${key}=`);
  const next = lines.map((line) => {
    if (pattern.test(line)) {
      updated = true;
      return `${key}=${value}`;
    }
    return line;
  });

  if (!updated) next.push(`${key}=${value}`);
  fs.writeFileSync(envPath, `${next.filter((line, idx, arr) => !(idx === arr.length - 1 && line === '')).join('\n')}\n`, 'utf-8');
}

function copyRecursive(source: string, dest: string): void {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(source);
  for (const entry of entries) {
    const srcPath = path.join(source, entry);
    const destPath = path.join(dest, entry);
    const stat = fs.statSync(srcPath);

    if (stat.isDirectory()) {
      copyRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

async function installProfile(source: string): Promise<void> {
  console.log(`Installing profile from: ${source}`);

  let sourceDir: string;

  // Detect source type
  if (source.startsWith('http://') || source.startsWith('https://')) {
    console.log('Source is URL - downloading...');
    throw new Error('URL download not yet implemented - use GitHub or local path');
  } else if (source.includes(path.sep)) {
    // Local path
    sourceDir = path.resolve(source);
    if (!fs.existsSync(sourceDir)) {
      throw new Error(`Source directory does not exist: ${sourceDir}`);
    }
    console.log(`Using local source: ${sourceDir}`);
  } else {
    // GitHub repo (user/repo format)
    console.log(`Cloning from GitHub: ${source}`);
    const tempDir = path.join(getProfilesDir(), `temp_${Date.now()}`);
    try {
      execSync(`git clone --depth 1 https://github.com/${source}.git ${tempDir}`, { stdio: 'inherit' });
      sourceDir = tempDir;
    } catch (err) {
      throw new Error(`Failed to clone GitHub repo: ${err}`);
    }
  }

  // Validate PROFILE.json
  const manifestPath = path.join(sourceDir, 'PROFILE.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error('Invalid profile: missing PROFILE.json');
  }

  let manifest: ProfileManifest | null = null;
  try {
    const content = fs.readFileSync(manifestPath, 'utf-8');
    manifest = JSON.parse(content) as ProfileManifest;
  } catch {
    throw new Error('Failed to parse PROFILE.json');
  }

  if (!manifest) {
    throw new Error('Invalid profile manifest');
  }

  console.log(`Profile: ${manifest.displayName} (${manifest.name})`);
  console.log(`Description: ${manifest.description}`);

  // Install to profiles directory
  ensureDirectories();
  const installDir = getProfileDir(manifest.name);

  if (fs.existsSync(installDir)) {
    console.log(`Profile already installed at: ${installDir}`);
    console.log('Remove it first with: npm run profile -- remove <name>');
    return;
  }

  console.log(`Installing to: ${installDir}`);
  copyRecursive(sourceDir, installDir);

  console.log(`✅ Profile "${manifest.displayName}" installed successfully`);
  console.log(`Activate with: npm run profile -- activate ${manifest.name}`);
}

function listProfiles(): void {
  const profiles = listInstalledProfiles();

  if (profiles.length === 0) {
    console.log('No profiles installed.');
    console.log('Install a profile with: npm run profile -- install <source>');
    return;
  }

  console.log('Installed profiles:');
  console.log('');

  for (const profileName of profiles) {
    const manifest = getProfileManifest(profileName);
    if (manifest) {
      console.log(`  • ${manifest.name} - ${manifest.displayName}`);
      console.log(`    ${manifest.description}`);
      console.log(`    Author: ${manifest.author}`);
      console.log(`    Capabilities: ${manifest.capabilities.join(', ')}`);
      console.log('');
    } else {
      console.log(`  • ${profileName} - (no manifest)`);
      console.log('');
    }
  }

  const activeProfile = process.env.FFT_PROFILE || '(not set)';
  console.log(`Active profile: ${activeProfile}`);
}

function activateProfile(profileName: string): void {
  console.log(`Activating profile: ${profileName}`);

  const manifest = getProfileManifest(profileName);
  if (!manifest) {
    throw new Error(`Profile not found: ${profileName}`);
  }

  ensureDirectories();

  // Create workspace if needed
  const workspaceDir = getWorkspaceDir(profileName);
  if (!fs.existsSync(workspaceDir)) {
    console.log(`Creating workspace: ${workspaceDir}`);
    fs.mkdirSync(workspaceDir, { recursive: true });
  }

  // Apply profile config to .env
  const projectRoot = process.cwd();
  const envPath = readEnvPath(projectRoot);

  if (manifest.config?.envVars) {
    console.log('Applying profile environment variables...');
    for (const [key, value] of Object.entries(manifest.config.envVars)) {
      upsertEnvValue(envPath, key, value);
      console.log(`  ${key}=${value}`);
    }
  }

  upsertEnvValue(envPath, 'FFT_PROFILE', profileName);
  console.log(`✅ Profile "${profileName}" activated`);
}

function switchProfile(targetProfile: string): void {
  const currentProfile = process.env.FFT_PROFILE;

  if (currentProfile === targetProfile) {
    console.log(`Already using profile: ${targetProfile}`);
    return;
  }

  if (currentProfile) {
    console.log(`Backing up current profile: ${currentProfile}`);

    const currentWorkspace = getWorkspaceDir(currentProfile);
    if (fs.existsSync(currentWorkspace)) {
      const backupDir = path.join(getWorkspacesDir(), `${currentProfile}_backup_${Date.now()}`);
      console.log(`Backing up to: ${backupDir}`);
      copyRecursive(currentWorkspace, backupDir);
      console.log('✅ Backup complete');
    }
  }

  activateProfile(targetProfile);
  console.log(`✅ Switched to profile: ${targetProfile}`);
}

async function removeProfile(profileName: string): Promise<void> {
  const manifest = getProfileManifest(profileName);
  if (manifest) {
    console.log(`Profile: ${manifest.displayName} (${manifest.name})`);
    console.log(`Description: ${manifest.description}`);
  } else {
    console.log(`Profile: ${profileName} (no manifest)`);
  }

  console.log('');
  console.log('⚠️  This will remove the profile and all its data.');
  console.log('⚠️  Workspace will NOT be deleted (can be manually removed).');

  const confirm = await prompt('Continue? [y/N]: ');
  if (confirm.toLowerCase() !== 'y') {
    console.log('Cancelled.');
    return;
  }

  const profileDir = getProfileDir(profileName);
  if (!fs.existsSync(profileDir)) {
    throw new Error(`Profile not found: ${profileName}`);
  }

  // Remove profile directory (workaround for rm blocking)
  function removeRecursive(dir: string): void {
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    } catch (err) {
      // Fallback: manual recursive delete
      const stat = fs.statSync(dir);
      if (stat.isDirectory()) {
        const entries = fs.readdirSync(dir);
        for (const entry of entries) {
          removeRecursive(path.join(dir, entry));
        }
        fs.rmdirSync(dir);
      } else {
        fs.unlinkSync(dir);
      }
    }
  }
  removeRecursive(profileDir);

  // Remove from .env if it was active
  if (process.env.FFT_PROFILE === profileName) {
    const projectRoot = process.cwd();
    const envPath = readEnvPath(projectRoot);
    upsertEnvValue(envPath, 'FFT_PROFILE', '');
  }

  console.log(`✅ Profile "${profileName}" removed`);
}

async function prompt(question: string): Promise<string> {
  const readline = (await import('readline')).createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    readline.question(question, (answer) => {
      readline.close();
      resolve(answer);
    });
  });
}

function printStatus(): void {
  const explicit = (process.env.FFT_PROFILE || '').trim() || '(unset)';
  const featureOverride = (process.env.FEATURE_FARM || '').trim() || '(unset)';
  console.log(
    [
      'FFT profile status',
      `resolved_profile: ${FFT_PROFILE}`,
      `feature_farm: ${FEATURE_FARM}`,
      `detection_source: ${PROFILE_DETECTION.source}`,
      `detection_reason: ${PROFILE_DETECTION.reason}`,
      `env.FFT_PROFILE: ${explicit}`,
      `env.FEATURE_FARM: ${featureOverride}`,
    ].join('\n'),
  );
}

async function main(): Promise<void> {
  try {
    ensureDirectories();

    const args = parseArgs(process.argv.slice(2));
    const projectRoot = process.cwd();
    const envPath = readEnvPath(projectRoot);

    if (args.command === 'status') {
      printStatus();
      return;
    }

    if (args.command === 'install') {
      await installProfile(args.source!);
      return;
    }

    if (args.command === 'list') {
      listProfiles();
      return;
    }

    if (args.command === 'activate') {
      activateProfile(args.profile!);
      return;
    }

    if (args.command === 'switch') {
      switchProfile(args.profile!);
      return;
    }

    if (args.command === 'remove') {
      await removeProfile(args.profile!);
      return;
    }

    // Legacy commands (set, apply) - DISABLED for now
    // Use new activate/switch commands instead
    if (args.command === 'set' || args.command === 'apply') {
      throw new Error(`Legacy command "${args.command}" is deprecated. Use "activate" or "switch" instead.`);
    }

    console.log(`Set profile=${args.profile}${args.writeEnv ? ' (persisted in .env)' : ''}`);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    console.error('');
    console.error(usage());
    process.exit(2);
  }
}

main();
