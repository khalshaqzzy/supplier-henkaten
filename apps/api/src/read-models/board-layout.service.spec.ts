import { describe, expect, it } from 'vitest';

import type { BoardLayoutDocument } from '@tmmin-henkaten/contracts';

import { generatedDocument, reconcileDocument } from './board-layout.service.js';

const jobA = '00000000-0000-4000-8000-000000000001';
const jobB = '00000000-0000-4000-8000-000000000002';
const inactiveJob = '00000000-0000-4000-8000-000000000003';

describe('BoardLayout reconciliation', () => {
  it('keeps existing job coordinates, removes inactive jobs, and adds every new job once', () => {
    const source: BoardLayoutDocument = {
      schemaVersion: 1,
      canvas: { width: 2_400, height: 1_350, background: 'LIGHT_GRID' },
      nodes: [
        slot(jobA, 430, 270),
        slot(inactiveJob, 800, 270),
        {
          id: 'machine:press',
          type: 'MACHINE_ASSET',
          assetKey: 'PRESS_STAMPING',
          opacity: 1,
          transform: transform(1_200, 400, 410, 380, 20),
        },
      ],
    };

    const result = reconcileDocument(source, [
      { jobId: jobA, displayOrder: 1 },
      { jobId: jobB, displayOrder: 2 },
    ]);

    const existing = result.document.nodes.find(
      (node) => node.type === 'JOB_SLOT' && node.jobId === jobA,
    );
    expect(existing?.transform).toMatchObject({ x: 430, y: 270 });
    expect(result.reconciliation).toEqual({ addedJobIds: [jobB], removedJobIds: [inactiveJob] });
    expect(
      result.document.nodes.filter((node) => node.type === 'JOB_SLOT' && node.jobId === jobB),
    ).toHaveLength(1);
    expect(result.document.nodes.some((node) => node.id === 'machine:press')).toBe(true);
  });

  it('generates deterministic minimum canvas geometry', () => {
    expect(
      generatedDocument([
        { jobId: jobA, displayOrder: 1 },
        { jobId: jobB, displayOrder: 2 },
      ]),
    ).toMatchObject({
      canvas: { width: 2_400, height: 1_350 },
      nodes: [
        { id: `job:${jobA}`, transform: { x: 100, y: 140 } },
        { id: `job:${jobB}`, transform: { x: 670, y: 140 } },
      ],
    });
  });
});

function slot(jobId: string, x: number, y: number) {
  return {
    id: `job:${jobId}`,
    type: 'JOB_SLOT' as const,
    jobId,
    transform: transform(x, y, 360, 190, 10),
  };
}

function transform(x: number, y: number, width: number, height: number, zIndex: number) {
  return { x, y, width, height, rotation: 0, zIndex, locked: false };
}
