import { describe, expect, it } from 'vitest';

import { createLocalSeedPlan } from './local-seed-plan.js';
import {
  LOCAL_SEED_MP_PORTRAIT_FILES,
  createLocalSeedCanvasDocument,
  loadLocalSeedPortraits,
  localSeedPortraitIndex,
} from './local-seed-visuals.js';

const jobs = Array.from({ length: 4 }, (_, index) => ({
  id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
}));

describe('local seed visual fixtures', () => {
  it('loads exactly four normalized ImageGen portraits below the upload limit', async () => {
    const portraits = await loadLocalSeedPortraits();
    expect(portraits.map(({ filename }) => filename)).toEqual(LOCAL_SEED_MP_PORTRAIT_FILES);
    expect(portraits.every(({ mimeType }) => mimeType === 'image/jpeg')).toBe(true);
    expect(portraits.every(({ buffer }) => buffer.byteLength < 2 * 1024 * 1024)).toBe(true);
  });

  it('gives every four-person line distinct portraits and repeats the catalog predictably', () => {
    expect(Array.from({ length: 12 }, (_, index) => localSeedPortraitIndex(index))).toEqual([
      0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3,
    ]);
    expect(() => localSeedPortraitIndex(-1)).toThrow();
    expect(() => localSeedPortraitIndex(12)).toThrow();
  });

  it('builds deterministic, bounded, one-job-per-slot canvas documents for all six lines', () => {
    for (const plan of createLocalSeedPlan()) {
      for (let lineIndex = 0; lineIndex < 3; lineIndex += 1) {
        const document = createLocalSeedCanvasDocument(plan, lineIndex, jobs);
        expect(createLocalSeedCanvasDocument(plan, lineIndex, jobs)).toEqual(document);
        expect(document.canvas).toEqual({
          width: 2_400,
          height: 1_350,
          background: 'LIGHT_GRID',
        });
        expect(new Set(document.nodes.map(({ id }) => id)).size).toBe(document.nodes.length);
        expect(
          document.nodes.filter((node) => node.type === 'JOB_SLOT').map(({ jobId }) => jobId),
        ).toEqual(jobs.map(({ id }) => id));
        expect(
          document.nodes
            .filter((node) => node.type === 'MACHINE_ASSET')
            .map(({ assetKey }) => assetKey),
        ).toEqual(plan.canvasLines[lineIndex]!.machines);
        const textLabels = document.nodes
          .filter((node) => node.type === 'TEXT')
          .map(({ text }) => text);
        expect(plan.jobNames[lineIndex]!.every((jobName) => !textLabels.includes(jobName))).toBe(
          true,
        );
        expect(
          document.nodes.every(
            ({ transform }) =>
              transform.x + transform.width <= document.canvas.width &&
              transform.y + transform.height <= document.canvas.height,
          ),
        ).toBe(true);
      }
    }
  });

  it('keeps the two suppliers on their explicitly selected machine families', () => {
    const [npm, gki] = createLocalSeedPlan();
    expect(
      npm!.canvasLines.flatMap(({ machines }) => machines).every((key) => !key.endsWith('_2D')),
    ).toBe(true);
    expect(
      gki!.canvasLines.flatMap(({ machines }) => machines).every((key) => key.endsWith('_2D')),
    ).toBe(true);
  });
});
