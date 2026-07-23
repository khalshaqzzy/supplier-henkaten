import { describe, expect, it } from 'vitest';

import { buildHealthResponse } from '@tmmin-henkaten/test-fixtures';

import { apiWorkspaceDescriptor, validateFoundationHealth } from './index.js';

describe('API workspace foundation', () => {
  it('imports shared contracts and test-only fixtures through package exports', () => {
    expect(apiWorkspaceDescriptor.runtime).toBe('compile-only');
    expect(() => validateFoundationHealth(buildHealthResponse())).not.toThrow();
  });
});
