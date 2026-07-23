import { describe, expect, it } from 'vitest';

import { AppModule } from './index.js';

describe('API workspace foundation', () => {
  it('exports the Nest application module', () => {
    expect(AppModule).toBeTypeOf('function');
  });
});
