import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

type Fixture = { root: string; source: string; target: string; config: string };

function makeFixture(opts: { configOverrides?: Record<string, unknown> } = {}): Fixture {
  const repoRoot = process.cwd();
  const root = mkdtempSync(path.join(tmpdir(), 'nano-core-sync-'));
  const source = path.join(root, 'FFT_nano');
  const target = path.join(root, 'nano-core');
  mkdirSync(source, { recursive: true });
  mkdirSync(target, { recursive: true });
  let configPath: string;
  if (opts.configOverrides) {
    const configDir = path.join(root, 'config');
    mkdirSync(configDir, { recursive: true });
    configPath = path.join(configDir, 'nano-core-sync.json');
    const baseConfig = JSON.parse(
      readFileSync(path.join(repoRoot, 'config', 'nano-core-sync.json'), 'utf8'),
    );
    const merged = { ...baseConfig, ...opts.configOverrides };
    writeFileSync(configPath, JSON.stringify(merged, null, 2), 'utf8');
  } else {
    configPath = path.join(repoRoot, 'config', 'nano-core-sync.json');
  }
  return { root, source, target, config: configPath };
}

function runSync(
  source: string,
  target: string,
  config: string,
  opts: { dryRun?: boolean } = {},
): ReturnType<typeof spawnSync> {
  const args = [
    'scripts/sync-nano-core.mjs',
    'sync',
    '--source',
    source,
    '--target',
    target,
    '--config',
    config,
    '--source-sha',
    'abc1234',
    '--workflow-url',
    'https://example.invalid/run',
  ];
  if (opts.dryRun) args.push('--dry-run');
  return spawnSync(process.execPath, args, { cwd: process.cwd(), encoding: 'utf8' });
}

test('sync copies allowlisted core files and writes source marker', () => {
  const { source, target, config } = makeFixture();
  mkdirSync(path.join(source, 'src'), { recursive: true });
  writeFileSync(path.join(source, 'src', 'index.ts'), 'export const answer = 42;\n', 'utf8');
  writeFileSync(path.join(source, 'README.md'), 'not allowlisted\n', 'utf8');

  const result = runSync(source, target, config);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(path.join(target, 'src', 'index.ts'), 'utf8'), 'export const answer = 42;\n');
  assert.match(readFileSync(path.join(target, 'SYNC_SOURCE.md'), 'utf8'), /Source commit: abc1234/);
});

test('sync does not copy blocked farm/agriculture paths', () => {
  const { source, target, config } = makeFixture();
  mkdirSync(path.join(source, 'src'), { recursive: true });
  mkdirSync(path.join(source, 'docs', 'technical-paper'), { recursive: true });
  mkdirSync(path.join(source, 'skills', 'runtime', 'farm-helper'), { recursive: true });
  mkdirSync(path.join(source, 'scripts'), { recursive: true });
  writeFileSync(path.join(source, 'src', 'index.ts'), 'export const ok = true;\n', 'utf8');
  writeFileSync(path.join(source, 'docs', 'technical-paper', 'farm.md'), 'farm content\n', 'utf8');
  writeFileSync(path.join(source, 'skills', 'runtime', 'farm-helper', 'SKILL.md'), 'farm skill\n', 'utf8');
  writeFileSync(path.join(source, 'scripts', 'farm-bootstrap.sh'), '#!/usr/bin/env bash\n', 'utf8');

  const result = runSync(source, target, config);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(path.join(target, 'src', 'index.ts'), 'utf8'), 'export const ok = true;\n');
  assert.throws(() => readFileSync(path.join(target, 'docs', 'technical-paper', 'farm.md'), 'utf8'));
  assert.throws(() =>
    readFileSync(path.join(target, 'skills', 'runtime', 'farm-helper', 'SKILL.md'), 'utf8'),
  );
  assert.throws(() => readFileSync(path.join(target, 'scripts', 'farm-bootstrap.sh'), 'utf8'));
});

test('sync skips an allowlisted core file that contains farming terms', () => {
  const { source, target, config } = makeFixture();
  mkdirSync(path.join(source, 'src'), { recursive: true });
  writeFileSync(path.join(source, 'src', 'index.ts'), 'export const label = "irrigation";\n', 'utf8');

  const result = runSync(source, target, config);

  assert.equal(result.status, 0, result.stderr);
  assert.throws(() => readFileSync(path.join(target, 'src', 'index.ts'), 'utf8'));
  assert.match(readFileSync(path.join(target, 'SYNC_SOURCE.md'), 'utf8'), /src\/index\.ts/);
});

test('sync rewrites package metadata for nano-core', () => {
  const { source, target, config } = makeFixture();
  writeFileSync(
    path.join(source, 'package.json'),
    JSON.stringify(
      {
        name: 'FFT_nano',
        description: 'old description',
        repository: {
          type: 'git',
          url: 'https://github.com/0-CYBERDYNE-SYSTEMS-0/nano-core.git',
        },
        bugs: { url: 'https://github.com/0-CYBERDYNE-SYSTEMS-0/nano-core/issues' },
        homepage: 'https://github.com/0-CYBERDYNE-SYSTEMS-0/nano-core#readme',
        bin: { nano: './bin/nano.js' },
      },
      null,
      2,
    ),
    'utf8',
  );

  const result = runSync(source, target, config);

  assert.equal(result.status, 0, result.stderr);
  const pkg = JSON.parse(readFileSync(path.join(target, 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'nano-core');
  assert.equal(pkg.repository.url, 'https://github.com/0-CYBERDYNE-SYSTEMS-0/nano-core.git');
  assert.deepEqual(pkg.bin, { nano: './bin/nano.js', 'nano-core': './bin/nano.js' });
  assert.deepEqual(pkg.keywords, [
    'autonomous-agents',
    'ai-agents',
    'llm',
    'llm-agents',
    'nodejs',
    'typescript',
    'telegram-bot',
    'whatsapp-bot',
    'raspberry-pi',
    'open-source',
    'automation',
    'persistent-memory',
    'local-first-ai',
  ]);
});

test('fileMappings renames a file during sync', () => {
  const { source, target, config } = makeFixture();
  mkdirSync(path.join(source, 'src', 'edge'), { recursive: true });
  writeFileSync(
    path.join(source, 'src', 'farm-action-gateway.ts'),
    'export const greeting = "hello world";\n',
    'utf8',
  );

  const result = runSync(source, target, config);

  assert.equal(result.status, 0, result.stderr);
  // Source rel should not exist at the target
  assert.throws(() => readFileSync(path.join(target, 'src', 'farm-action-gateway.ts'), 'utf8'));
  // Target rel should have the source content
  assert.equal(
    readFileSync(path.join(target, 'src', 'edge', 'bridge.ts'), 'utf8'),
    'export const greeting = "hello world";\n',
  );
});

test('fileScopedReplacements only fire on the scoped target file', () => {
  const { source, target, config } = makeFixture();
  mkdirSync(path.join(source, 'src', 'edge'), { recursive: true });
  mkdirSync(path.join(source, 'src', 'unscoped'), { recursive: true });
  writeFileSync(
    path.join(source, 'src', 'farm-action-gateway.ts'),
    'export const label = "FarmActionGateway";\n',
    'utf8',
  );
  writeFileSync(
    path.join(source, 'src', 'unscoped', 'control.ts'),
    'export const label = "FarmActionGateway";\n',
    'utf8',
  );

  const result = runSync(source, target, config);

  assert.equal(result.status, 0, result.stderr);
  const mapped = readFileSync(path.join(target, 'src', 'edge', 'bridge.ts'), 'utf8');
  assert.ok(mapped.includes('EdgeBridge'), `expected EdgeBridge in mapped file, got: ${mapped}`);
  assert.ok(
    !mapped.includes('FarmActionGateway'),
    `expected no FarmActionGateway in mapped file, got: ${mapped}`,
  );
  // Unscoped file should keep the original text
  const control = readFileSync(path.join(target, 'src', 'unscoped', 'control.ts'), 'utf8');
  assert.ok(
    control.includes('FarmActionGateway'),
    `expected FarmActionGateway in control file, got: ${control}`,
  );
});

test('mapped file in forbiddenTermExemptions is exempt at the target path', () => {
  const { source, target, config } = makeFixture({
    configOverrides: {
      fileMappings: [{ from: 'src/farm-foo.ts', to: 'src/edge/safe.ts' }],
      allowedPaths: ['src/'],
      forbiddenTerms: ['\\bfarm\\b'],
      forbiddenTermExemptions: ['src/edge/safe.ts'],
      skipForbiddenFiles: true,
    },
  });
  mkdirSync(path.join(source, 'src', 'edge'), { recursive: true });
  writeFileSync(
    path.join(source, 'src', 'farm-foo.ts'),
    'export const label = "farm life on the ranch";\n',
    'utf8',
  );

  const result = runSync(source, target, config);

  assert.equal(result.status, 0, result.stderr);
  // The mapped target is in exemptions, so the forbidden source term is allowed
  assert.equal(
    readFileSync(path.join(target, 'src', 'edge', 'safe.ts'), 'utf8'),
    'export const label = "farm life on the ranch";\n',
  );
});

test('mapped file NOT in forbiddenTermExemptions is still scanned at the target path', () => {
  const { source, target, config } = makeFixture({
    configOverrides: {
      fileMappings: [{ from: 'src/farm-foo.ts', to: 'src/edge/checked.ts' }],
      allowedPaths: ['src/'],
      forbiddenTerms: ['\\bfarm\\b'],
      forbiddenTermExemptions: [],
      skipForbiddenFiles: true,
    },
  });
  mkdirSync(path.join(source, 'src', 'edge'), { recursive: true });
  writeFileSync(
    path.join(source, 'src', 'farm-foo.ts'),
    'export const label = "farm life on the ranch";\n',
    'utf8',
  );

  const result = runSync(source, target, config);

  assert.equal(result.status, 0, result.stderr);
  // Source rel is renamed, so neither the source rel nor an unmapped target exists
  assert.throws(() => readFileSync(path.join(target, 'src', 'farm-foo.ts'), 'utf8'));
  assert.throws(() => readFileSync(path.join(target, 'src', 'edge', 'checked.ts'), 'utf8'));
  // The SYNC_SOURCE.md should report the skipped file using the target rel
  const syncSource = readFileSync(path.join(target, 'SYNC_SOURCE.md'), 'utf8');
  assert.match(syncSource, /src\/edge\/checked\.ts/);
});

test('package.json transform still applies when a source file is mapped to package.json', () => {
  const { source, target, config } = makeFixture({
    configOverrides: {
      fileMappings: [{ from: 'my-pkg.json', to: 'package.json' }],
      allowedPaths: ['package.json'],
      packageJson: { name: 'nano-core' },
    },
  });
  writeFileSync(
    path.join(source, 'my-pkg.json'),
    JSON.stringify({ name: 'old-name', version: '1.0.0' }, null, 2),
    'utf8',
  );

  const result = runSync(source, target, config);

  assert.equal(result.status, 0, result.stderr);
  // Source rel should not exist at target
  assert.throws(() => readFileSync(path.join(target, 'my-pkg.json'), 'utf8'));
  // Target rel should exist with the transform applied
  const pkg = JSON.parse(readFileSync(path.join(target, 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'nano-core');
  assert.equal(pkg.version, '1.0.0');
});

test('dry-run does not write any files to the target', () => {
  const { source, target, config } = makeFixture();
  mkdirSync(path.join(source, 'src', 'edge'), { recursive: true });
  writeFileSync(
    path.join(source, 'src', 'index.ts'),
    'export const answer = 42;\n',
    'utf8',
  );
  writeFileSync(
    path.join(source, 'src', 'farm-action-gateway.ts'),
    'export const greeting = "hi";\n',
    'utf8',
  );

  const result = runSync(source, target, config, { dryRun: true });

  assert.equal(result.status, 0, result.stderr);
  // No files should be written on dry-run
  const targetFiles = readdirSync(target);
  assert.deepEqual(targetFiles, [], `expected empty target, got: ${targetFiles.join(', ')}`);
  // Dry-run output should report the metrics
  assert.match(result.stdout, /Dry run: \d+ copy\(s\)/);
  assert.match(result.stdout, /\d+ rename\(s\)/);
  assert.match(result.stdout, /\d+ skip\(s\)/);
});
