import assert from 'node:assert/strict';
import test from 'node:test';

import { parseOptions, planJourneys } from '../apps/e2e/scripts/plan.mjs';

const specs = ['a.spec.ts', 'b.spec.ts', 'c.spec.ts', 'd.spec.ts', 'e.spec.ts'];
const sizes = { a: 10, b: 50, c: 30, d: 40, e: 20 };
const edgeTagged = new Set(['b', 'e']);
const pathOf = (name) => name;
const read = (name) => {
  const key = name.replace('.spec.ts', '');
  return { size: sizes[key], edge: edgeTagged.has(key) };
};
const plan = (argv, env = {}) => planJourneys(specs, parseOptions(argv, env, 8), pathOf, read);
const names = (journeys) => journeys.map(({ spec, browserProject }) => `${browserProject}:${spec}`);

test('default coverage runs every specification once in Chromium, largest first', () => {
  assert.deepEqual(names(plan([])), [
    'chromium:b.spec.ts',
    'chromium:d.spec.ts',
    'chromium:c.spec.ts',
    'chromium:e.spec.ts',
    'chromium:a.spec.ts',
  ]);
});

test('Edge smoke coverage is opt-in and limited to tagged specifications', () => {
  assert.deepEqual(names(plan(['--edge'])).slice(5), ['msedge:b.spec.ts', 'msedge:e.spec.ts']);
  assert.deepEqual(names(plan(['--edge-only'])), ['msedge:b.spec.ts', 'msedge:e.spec.ts']);
});

test('shards partition the journeys without overlap or omission', () => {
  const shards = [1, 2, 3].map((index) => names(plan([`--shard=${index}/3`])));
  assert.deepEqual(shards, [
    ['chromium:b.spec.ts', 'chromium:e.spec.ts'],
    ['chromium:d.spec.ts', 'chromium:a.spec.ts'],
    ['chromium:c.spec.ts'],
  ]);
  assert.deepEqual(shards.flat().sort(), names(plan([])).sort());
  assert.deepEqual(names(plan([], { E2E_SHARD: '2/3' })), shards[1]);
});

test('journey indexes stay unique across shards so databases and reports never collide', () => {
  const indexes = [1, 2].flatMap((index) => plan([`--shard=${index}/2`]).map((j) => j.index));
  assert.equal(new Set(indexes).size, 5);
});

test('workers default to half of the cores, capped at four, and accept overrides', () => {
  assert.equal(parseOptions([], {}, 16).workers, 4);
  assert.equal(parseOptions([], {}, 4).workers, 2);
  assert.equal(parseOptions([], {}, 1).workers, 1);
  assert.equal(parseOptions(['--workers=3'], { E2E_WORKERS: '2' }, 8).workers, 3);
  assert.equal(parseOptions([], { E2E_WORKERS: '2' }, 8).workers, 2);
});

test('invalid options are rejected', () => {
  assert.throws(() => parseOptions(['--workers=0'], {}, 8));
  assert.throws(() => parseOptions(['--shard=4/3'], {}, 8));
  assert.throws(() => parseOptions(['--shard=x'], {}, 8));
  assert.throws(() => parseOptions(['--edge-only', '--chromium-only'], {}, 8));
  assert.throws(() => plan(['--spec=missing']));
});
