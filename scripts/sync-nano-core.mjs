#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const DEFAULT_CONFIG = 'config/nano-core-sync.json';

function usage() {
  console.error(`Usage:
  node scripts/sync-nano-core.mjs sync --source <FFT_nano checkout> --target <nano-core checkout> [--config <path>] [--source-sha <sha>] [--workflow-url <url>] [--dry-run]
  node scripts/sync-nano-core.mjs scan --target <nano-core checkout> [--config <path>] [--changed-only]`);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      args._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    if (key === 'dry-run' || key === 'changed-only') {
      args[key] = true;
      continue;
    }
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }
    args[key] = value;
    i += 1;
  }
  return args;
}

function normalizeRel(filePath) {
  return filePath.split(path.sep).join('/').replace(/^\/+/, '');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadConfig(configPath) {
  const config = readJson(configPath);
  return {
    ...config,
    allowedPaths: config.allowedPaths ?? [],
    blockedPaths: config.blockedPaths ?? [],
    blockedPathPatterns: (config.blockedPathPatterns ?? []).map((pattern) => new RegExp(pattern, 'i')),
    textReplacements: config.textReplacements ?? [],
    forbiddenTerms: (config.forbiddenTerms ?? []).map((term) => new RegExp(term, 'i')),
    forbiddenTermExemptions: new Set(config.forbiddenTermExemptions ?? []),
    fileMappings: new Map((config.fileMappings ?? []).map((mapping) => [mapping.from, mapping.to])),
    fileScopedReplacements: new Map(
      (config.fileScopedReplacements ?? []).map((entry) => [entry.file, entry.replacements ?? []]),
    ),
  };
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function assertInside(root, target) {
  if (!isInside(root, target)) {
    throw new Error(`Refusing path outside root: ${target}`);
  }
}

function pathMatches(rel, entries) {
  return entries.some((entry) => {
    if (entry.endsWith('*')) return rel.startsWith(entry.slice(0, -1));
    if (entry.endsWith('/')) return rel === entry.slice(0, -1) || rel.startsWith(entry);
    return rel === entry || rel.startsWith(`${entry}/`);
  });
}

function shouldCopy(rel, config) {
  if (!pathMatches(rel, config.allowedPaths)) return false;
  if (pathMatches(rel, config.blockedPaths)) return false;
  if (config.blockedPathPatterns.some((pattern) => pattern.test(rel))) return false;
  return true;
}

function walk(root, options = {}) {
  const out = [];
  const skip = new Set(options.skip ?? []);
  const resolve = options.resolve ?? ((rel) => rel);

  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      const rel = normalizeRel(path.relative(root, abs));
      const checkRel = resolve(rel);
      if (
        skip.has(entry.name) ||
        pathMatches(`${checkRel}${entry.isDirectory() ? '/' : ''}`, options.blocked ?? []) ||
        (options.blockedPatterns ?? []).some((pattern) => pattern.test(checkRel))
      ) {
        continue;
      }
      if (entry.isDirectory()) {
        visit(abs);
      } else if (entry.isFile()) {
        out.push(rel);
      }
    }
  }

  visit(root);
  return out.sort();
}

function mkdirp(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function copyFile(sourceRoot, targetRoot, sourceRel, targetRel, config, dryRun = false) {
  const source = path.join(sourceRoot, sourceRel);
  const target = path.join(targetRoot, targetRel);
  assertInside(sourceRoot, source);
  assertInside(targetRoot, target);

  const content = fs.readFileSync(source);
  if (isProbablyText(content)) {
    let text = content.toString('utf8');
    for (const replacement of config.textReplacements) {
      text = text.split(replacement.from).join(replacement.to);
    }
    if (targetRel === 'package.json') text = transformPackageJson(text, config);
    const scopedReplacements = config.fileScopedReplacements.get(targetRel) ?? [];
    if (scopedReplacements.length > 0) {
      for (const replacement of scopedReplacements) {
        text = text.split(replacement.from).join(replacement.to);
      }
    }
    const findings = scanText(config, targetRel, text);
    if (findings.length > 0 && config.skipForbiddenFiles) {
      return {
        copied: false,
        skipped: findings,
        scopedReplacementsApplied: scopedReplacements.length,
      };
    }
    if (!dryRun) {
      mkdirp(target);
      fs.writeFileSync(target, text, 'utf8');
    }
    return {
      copied: true,
      skipped: [],
      scopedReplacementsApplied: scopedReplacements.length,
    };
  }
  if (!dryRun) {
    mkdirp(target);
    fs.writeFileSync(target, content);
  }
  return { copied: true, skipped: [], scopedReplacementsApplied: 0 };
}

function isProbablyText(buffer) {
  if (buffer.includes(0)) return false;
  const sample = buffer.subarray(0, Math.min(buffer.length, 8000));
  return sample.every((byte) => byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126));
}

function transformPackageJson(text, config) {
  const pkg = JSON.parse(text);
  const packageConfig = config.packageJson ?? {};
  if (packageConfig.name) pkg.name = packageConfig.name;
  if (packageConfig.description) pkg.description = packageConfig.description;
  if (packageConfig.repositoryUrl) {
    pkg.repository = { ...(pkg.repository ?? {}), type: 'git', url: packageConfig.repositoryUrl };
  }
  if (packageConfig.bugsUrl) pkg.bugs = { ...(pkg.bugs ?? {}), url: packageConfig.bugsUrl };
  if (packageConfig.homepage) pkg.homepage = packageConfig.homepage;
  if (packageConfig.bin) pkg.bin = packageConfig.bin;
  if (pkg.scripts && packageConfig.removeScriptPatterns) {
    const scriptPatterns = packageConfig.removeScriptPatterns.map((pattern) => new RegExp(pattern, 'i'));
    for (const key of Object.keys(pkg.scripts)) {
      if (scriptPatterns.some((pattern) => pattern.test(key))) delete pkg.scripts[key];
    }
  }
  if (packageConfig.keywords) pkg.keywords = packageConfig.keywords;
  return `${JSON.stringify(pkg, null, 2)}\n`;
}

function writeSyncSource(targetRoot, sourceSha, workflowUrl, skippedFiles = [], dryRun = false) {
  const body = [
    '# nano-core Sync Source',
    '',
    'This checkout is generated from the shared/core surface of `FFT_nano`.',
    '',
    `- Source repo: https://github.com/0-CYBERDYNE-SYSTEMS-0/nano-core`,
    `- Source commit: ${sourceSha || 'unknown'}`,
    `- Workflow run: ${workflowUrl || 'unknown'}`,
    `- Generated at: ${new Date().toISOString()}`,
    '',
    '## Skipped Source Files',
    '',
    ...(skippedFiles.length > 0
      ? skippedFiles.map((entry) => `- \`${entry.rel}\`: ${entry.findings.join(', ')}`)
      : ['None.']),
    '',
  ].join('\n');
  if (dryRun) return body;
  fs.writeFileSync(path.join(targetRoot, 'SYNC_SOURCE.md'), body, 'utf8');
  return body;
}

function gitChangedFiles(root) {
  const output = execFileSync('git', ['diff', '--name-only'], { cwd: root, encoding: 'utf8' });
  return output.split('\n').map((line) => line.trim()).filter(Boolean);
}

function scanFiles(targetRoot, config, files) {
  const findings = [];
  for (const rel of files) {
    if (config.forbiddenTermExemptions.has(rel)) continue;
    const abs = path.join(targetRoot, rel);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
    const content = fs.readFileSync(abs);
    if (!isProbablyText(content)) continue;
    findings.push(...scanText(config, rel, content.toString('utf8')));
  }
  return findings;
}

function scanText(config, rel, text) {
  if (config.forbiddenTermExemptions.has(rel)) return [];
  const findings = [];
  for (const pattern of config.forbiddenTerms) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) findings.push(`${rel}: matches ${pattern}`);
  }
  return findings;
}

function sync(args) {
  const sourceRoot = path.resolve(args.source ?? '');
  const targetRoot = path.resolve(args.target ?? '');
  if (!sourceRoot || !targetRoot || !fs.existsSync(sourceRoot) || !fs.existsSync(targetRoot)) {
    throw new Error('sync requires existing --source and --target directories');
  }
  const configPath = path.resolve(args.config ?? path.join(process.cwd(), DEFAULT_CONFIG));
  const config = loadConfig(configPath);
  const dryRun = Boolean(args['dry-run']);

  const sourceFiles = walk(sourceRoot, {
    skip: ['.git', 'node_modules', 'dist'],
    blocked: config.blockedPaths,
    blockedPatterns: config.blockedPathPatterns,
    resolve: (rel) => config.fileMappings.get(rel) ?? rel,
  }).filter((rel) => shouldCopy(config.fileMappings.get(rel) ?? rel, config));

  const copiedFiles = [];
  const skippedFiles = [];
  let mappingsApplied = 0;
  let scopedReplacementsApplied = 0;
  let inProcessFindings = 0;
  for (const sourceRel of sourceFiles) {
    const targetRel = config.fileMappings.get(sourceRel) ?? sourceRel;
    if (targetRel !== sourceRel) mappingsApplied += 1;
    const result = copyFile(sourceRoot, targetRoot, sourceRel, targetRel, config, dryRun);
    scopedReplacementsApplied += result.scopedReplacementsApplied;
    if (result.copied) copiedFiles.push(targetRel);
    else {
      skippedFiles.push({ rel: targetRel, findings: result.skipped });
      inProcessFindings += result.skipped.length;
    }
  }
  writeSyncSource(targetRoot, args['source-sha'], args['workflow-url'], skippedFiles, dryRun);

  const changedFiles = !dryRun && fs.existsSync(path.join(targetRoot, '.git'))
    ? gitChangedFiles(targetRoot)
    : [...copiedFiles, 'SYNC_SOURCE.md'];
  const findings = scanFiles(targetRoot, config, [...copiedFiles, 'SYNC_SOURCE.md']);
  const forbiddenFindings = inProcessFindings + findings.length;

  if (args['dry-run']) {
    process.stdout.write(
      `Dry run: ${copiedFiles.length} copy(s) (${mappingsApplied} rename(s), ${scopedReplacementsApplied} scoped replacement(s)); ${skippedFiles.length} skip(s); ${forbiddenFindings} forbidden finding(s).\n`,
    );
  } else {
    if (findings.length > 0) {
      throw new Error(`Forbidden core-surface terms found:\n${findings.join('\n')}`);
    }
    process.stdout.write(
      `Synced ${copiedFiles.length} file(s) (${mappingsApplied} rename(s), ${scopedReplacementsApplied} scoped replacement(s)); skipped ${skippedFiles.length} contaminated file(s); ${changedFiles.length} changed file(s).\n`,
    );
  }
}

function scan(args) {
  const targetRoot = path.resolve(args.target ?? '.');
  if (!fs.existsSync(targetRoot)) throw new Error(`Missing target: ${targetRoot}`);
  const configPath = path.resolve(args.config ?? path.join(targetRoot, DEFAULT_CONFIG));
  const config = loadConfig(configPath);
  const files =
    args['changed-only'] && fs.existsSync(path.join(targetRoot, '.git'))
      ? gitChangedFiles(targetRoot)
      : walk(targetRoot, {
          skip: ['.git', 'node_modules', 'dist'],
          blocked: config.blockedPaths,
          blockedPatterns: config.blockedPathPatterns,
        });
  const findings = scanFiles(targetRoot, config, files);
  if (findings.length > 0) {
    throw new Error(`Forbidden core-surface terms found:\n${findings.join('\n')}`);
  }
  process.stdout.write(`Core surface scan passed (${files.length} file(s)).\n`);
}

try {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  if (command === 'sync') sync(args);
  else if (command === 'scan') scan(args);
  else {
    usage();
    process.exitCode = 2;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
