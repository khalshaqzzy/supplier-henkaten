import { describe, expect, it } from 'vitest';

import {
  boardLayoutDocumentSchema,
  boardLayoutSaveRequestSchema,
  boardMachineAssetKeySchema,
} from './board-layout.js';

const jobId = '00000000-0000-4000-8000-000000000001';

function document() {
  return {
    schemaVersion: 1 as const,
    canvas: { width: 2_400, height: 1_350, background: 'LIGHT_GRID' as const },
    nodes: [
      {
        id: 'job:one',
        type: 'JOB_SLOT' as const,
        jobId,
        transform: {
          x: 100,
          y: 100,
          width: 360,
          height: 190,
          rotation: 0,
          zIndex: 1,
          locked: false,
        },
      },
    ],
  };
}

describe('assignment board canvas contracts', () => {
  it('accepts a strict versioned document and create concurrency token', () => {
    expect(
      boardLayoutSaveRequestSchema.parse({ expectedVersion: null, document: document() }),
    ).toMatchObject({ expectedVersion: null, document: { schemaVersion: 1 } });
  });

  it('rejects duplicate job slots, out-of-bounds nodes, and unknown fields', () => {
    const source = document();
    expect(
      boardLayoutDocumentSchema.safeParse({
        ...source,
        nodes: [...source.nodes, { ...source.nodes[0], id: 'job:duplicate' }],
      }).success,
    ).toBe(false);
    expect(
      boardLayoutDocumentSchema.safeParse({
        ...source,
        nodes: [
          {
            ...source.nodes[0],
            transform: { ...source.nodes[0]!.transform, x: 2_200, width: 360 },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      boardLayoutDocumentSchema.safeParse({ ...source, liveMpName: 'must not be stored' }).success,
    ).toBe(false);
  });

  it('keeps the curated machine catalog closed to unknown asset keys', () => {
    expect(boardMachineAssetKeySchema.options).toHaveLength(24);
    expect(boardMachineAssetKeySchema.safeParse('USER_UPLOAD').success).toBe(false);
  });

  it('accepts both filled and outline rectangle discriminators', () => {
    const transform = {
      x: 10,
      y: 10,
      width: 100,
      height: 100,
      rotation: 0,
      zIndex: 2,
      locked: false,
    };
    for (const type of ['RECTANGLE', 'OUTLINE'] as const) {
      expect(
        boardLayoutDocumentSchema.safeParse({
          ...document(),
          nodes: [
            {
              id: `shape:${type}`,
              type,
              fill: '#ffffff',
              stroke: '#172033',
              strokeWidth: 2,
              opacity: 1,
              cornerRadius: 8,
              transform,
            },
          ],
        }).success,
      ).toBe(true);
    }
  });
});
