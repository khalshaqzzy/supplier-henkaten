import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tokenFamilies } from './tokens';

const componentSources = [
  'components/primitives.tsx',
  'components/advanced.tsx',
  'components/data-display.tsx',
  'components/domain.tsx',
].map((file) => readFileSync(resolve(import.meta.dirname, file), 'utf8'));

describe('HDS token contract', () => {
  it('does not use raw colors in reusable component implementation', () => {
    for (const source of componentSources) {
      expect(source).not.toMatch(/#[\da-f]{3,8}\b/iu);
      expect(source).not.toMatch(/\brgba?\(/u);
    }
  });

  it('keeps reusable visual values in token metadata', () => {
    for (const source of componentSources) {
      expect(source).not.toMatch(/\bsideOffset=\{\d+/u);
      expect(source).not.toMatch(/\bdelayDuration=\{\d+/u);
      expect(source).not.toMatch(/\bfontSize:\s*\d+/u);
      expect(source).not.toMatch(/\bstrokeWidth=\{\d+/u);
    }
  });

  it('publishes every required token family for the rendered showcase', () => {
    expect(Object.keys(tokenFamilies)).toEqual(
      expect.arrayContaining([
        'Raw neutral',
        'Raw orange',
        'Semantic',
        'States',
        'Typography',
        'Spacing',
        'Shape',
        'Elevation',
        'Motion',
        'Density',
        'Layers',
        'Breakpoints',
        'Focus',
        'Chart',
        'Component',
      ]),
    );
    for (const family of Object.values(tokenFamilies)) {
      expect(family.length).toBeGreaterThan(0);
    }
  });

  it('defines a reduced-motion fallback', () => {
    const css = readFileSync(resolve(import.meta.dirname, 'styles.css'), 'utf8');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('--hds-duration-instant');
  });
});
