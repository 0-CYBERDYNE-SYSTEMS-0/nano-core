import assert from 'node:assert/strict';
import test from 'node:test';

test('profile module resolves to the single core profile', async () => {
  const mod = await import(`../src/profile.ts?case=${Date.now()}`);
  assert.equal(mod.FFT_PROFILE, 'core');
  assert.equal(mod.FEATURE_FARM, false);
  assert.equal(mod.PROFILE_DETECTION.source, 'hardcoded');
});
