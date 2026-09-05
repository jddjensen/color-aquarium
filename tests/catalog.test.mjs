import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { FISH, SPECIES_LABELS } from '../public/js/catalog.js';

test('every catalog animal has full art and an optimized thumbnail', () => {
  assert.equal(FISH.length, 15);
  assert.equal(new Set(FISH.map((fish) => fish.id)).size, FISH.length);
  for (const fish of FISH) {
    assert.equal(SPECIES_LABELS[fish.id], fish.label);
    assert.equal(existsSync(`public${fish.src}`), true, fish.src);
    assert.equal(existsSync(`public${fish.thumbnail}`), true, fish.thumbnail);
  }
});

test('browser runtime is self-hosted and module based', () => {
  const pages = ['public/color.html', 'public/aquarium.html', 'public/operator.html'];
  for (const page of pages) assert.match(readFileSync(page, 'utf8'), /type="module"/);
  const scripts = ['public/color.js', 'public/aquarium.js', ...pages];
  for (const file of scripts) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /(?:src=|from\s+)["']https?:\/\//);
  }
});
