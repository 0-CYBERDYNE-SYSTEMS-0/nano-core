import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

function makeFixture(): { root: string; source: string; target: string; config: string } {
  const repoRoot = process.cwd();
  const root = mkdtempSync(path.join(tmpdir(), 'nano-core-sync-'));
  const source = path.join(root, 'FFT_nano');
  const target = path.join(root, 'nano-core');
  mkdirSync(source, { recursive: true });
  mkdirSync(target, { recursive: true });
  return {
    root,
    source,
    target,
    config: path.join(repoRoot, 'config', 'nano-core-sync.json'),
  };
}

function runSync(source: string, target: string, config: string): ReturnType<typeof spawnSync> {
  return spawnSync(
    process.execPath,
    [
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
    ],
    { cwd: process.cwd(), encoding: 'utf8' },
  );
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
          url: 'https://github.com/0-CYBERDYNE-SYSTEMS-0/FFT_nano.git',
        },
        bugs: { url: 'https://github.com/0-CYBERDYNE-SYSTEMS-0/FFT_nano/issues' },
        homepage: 'https://github.com/0-CYBERDYNE-SYSTEMS-0/FFT_nano#readme',
        bin: { fft: './bin/fft.js' },
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
