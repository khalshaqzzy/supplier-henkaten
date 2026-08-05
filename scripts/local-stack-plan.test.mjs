import assert from 'node:assert/strict';
import test from 'node:test';

import { frontendComposeArguments, localStackEndpoints } from './local-stack-plan.mjs';

test('seeded local lifecycle rebuilds both frontends from the current working tree', () => {
  assert.deepEqual(frontendComposeArguments(), [
    'up',
    '--detach',
    '--build',
    'supplier-web',
    'tmmin-web',
  ]);
});

test('seeded local lifecycle reports the same localhost origins accepted by the API', () => {
  assert.deepEqual(
    localStackEndpoints({
      apiPort: '3100',
      supplierWebPort: '5273',
      tmminWebPort: '5274',
    }),
    [
      ['API readiness', 'http://127.0.0.1:3100/ready'],
      ['Supplier web', 'http://localhost:5273'],
      ['TMMIN web', 'http://localhost:5274'],
    ],
  );
});
