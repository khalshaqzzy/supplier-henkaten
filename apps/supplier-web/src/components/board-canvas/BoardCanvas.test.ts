import { describe, expect, it } from 'vitest';

import type { BoardLayoutDocument } from '@tmmin-henkaten/contracts';

import { boundedTransform, resolveBoardMpVisual } from './BoardCanvas';
import { machineAssetDisplayLabel, machineAssets } from './machineAssets';

const document: BoardLayoutDocument = {
  schemaVersion: 1,
  canvas: { width: 2_400, height: 1_350, background: 'LIGHT_GRID' },
  nodes: [],
};

describe('Assignment Board canvas editor primitives', () => {
  it('ships the complete curated machine catalog with stable unique keys', () => {
    expect(machineAssets).toHaveLength(24);
    expect(new Set(machineAssets.map(({ key }) => key)).size).toBe(24);
    expect(machineAssets.filter(({ style }) => style === 'SIMPLE_2D')).toHaveLength(12);
    expect(new Set(machineAssets.map(machineAssetDisplayLabel)).size).toBe(24);
    expect(
      machineAssets.every(({ src, description }) => src.length > 0 && description.length > 0),
    ).toBe(true);
  });

  it('normalizes transforms to the grid and keeps nodes inside logical bounds', () => {
    expect(
      boundedTransform(
        {
          x: 2_399,
          y: -40,
          width: 201,
          height: 99,
          rotation: 999,
          zIndex: 9_999,
          locked: false,
        },
        document,
      ),
    ).toEqual({
      x: 2_200,
      y: 0,
      width: 200,
      height: 100,
      rotation: 360,
      zIndex: 2_000,
      locked: false,
    });
  });

  it('prefers the live MP thumbnail and retains initials-only fallback', () => {
    expect(
      resolveBoardMpVisual({
        memberId: '00000000-0000-4000-8000-000000000001',
        name: 'MP Photo',
        registrationNumber: 'REG-1',
        photoThumbnailUrl: '/api/v1/supplier/master-data/members/photo/thumbnail?v=2',
        initials: 'MP',
      }),
    ).toMatchObject({
      photoSource: expect.stringContaining('/photo/thumbnail?v=2'),
      fallback: 'MP',
    });
    expect(
      resolveBoardMpVisual({
        memberId: null,
        name: null,
        registrationNumber: null,
        photoThumbnailUrl: null,
        initials: 'AB',
      }),
    ).toEqual({ photoSource: null, fallback: 'AB' });
  });
});
