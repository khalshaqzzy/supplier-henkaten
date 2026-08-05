import { describe, expect, it } from 'vitest';

import { resourceCell } from './SupportPages';

describe('Hosted support resource cells', () => {
  it('reads immutable Shift snapshot names from the nested API contract', () => {
    const shift = {
      line: { code: 'NPM-L1', name: 'Press & Stamping' },
      shift: { name: 'Shift Pagi' },
    };

    expect(resourceCell(shift, 'line.name')).toBe('Press & Stamping');
    expect(resourceCell(shift, 'shift.name')).toBe('Shift Pagi');
  });

  it('uses a safe placeholder when a nested value is unavailable', () => {
    expect(resourceCell({}, 'line.name')).toBe('—');
  });
});
