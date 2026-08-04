import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stateTokens, tokenFamilies, typographyTokens } from './tokens';

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

  it('keeps 4M colors synchronized between metadata and runtime CSS', () => {
    const expected = {
      '4m-man': '#DC2626',
      '4m-machine': '#2F6FED',
      '4m-material': '#D97706',
      '4m-method': '#16A34A',
    } as const;
    const css = readFileSync(resolve(import.meta.dirname, 'styles.css'), 'utf8');

    for (const [name, value] of Object.entries(expected)) {
      expect(stateTokens.find((entry) => entry.name === name)?.value).toBe(value);
      expect(css).toContain(`--hds-${name}: ${value.toLowerCase()};`);
    }
  });

  it('publishes the enlarged resolved typography scale in metadata and runtime CSS', () => {
    const expected = {
      'type-11-size': '0.75rem',
      'type-11-line': '1.125rem',
      'type-12-size': '0.8125rem',
      'type-12-line': '1.25rem',
      'type-13-size': '0.875rem',
      'type-13-line': '1.375rem',
      'type-14-size': '0.9375rem',
      'type-14-line': '1.4375rem',
      'type-16-size': '1.0625rem',
      'type-16-line': '1.625rem',
      'type-18-size': '1.1875rem',
      'type-18-line': '1.75rem',
      'type-20-size': '1.375rem',
      'type-20-line': '1.875rem',
      'type-24-size': '1.625rem',
      'type-24-line': '2.125rem',
      'type-30-size': '2rem',
      'type-30-line': '2.5rem',
    } as const;
    const css = readFileSync(resolve(import.meta.dirname, 'styles.css'), 'utf8');

    for (const [name, value] of Object.entries(expected)) {
      expect(typographyTokens.find((entry) => entry.name === name)?.value).toBe(value);
      expect(css).toContain(`--hds-${name}: ${value};`);
    }
  });
});
