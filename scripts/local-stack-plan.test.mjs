import assert from 'node:assert/strict';
import test from 'node:test';

import { frontendComposeArguments } from './local-stack-plan.mjs';

test('seeded local lifecycle rebuilds both frontends from the current working tree', () => {
  assert.deepEqual(frontendComposeArguments(), [
    'up',
    '--detach',
    '--build',
    'supplier-web',
    'tmmin-web',
  ]);
});
