import { describe, expect, it } from 'vitest';

import type { BoardLayoutDocument } from '@tmmin-henkaten/contracts';

import {
  boundedTransform,
  constrainCanvasCamera,
  fitCanvasCamera,
  resizeCanvasCamera,
  resolveBoardMpVisual,
  zoomCanvasCamera,
} from './BoardCanvas';
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

  it('fits and centers the complete logical canvas even below 25 percent', () => {
    const camera = fitCanvasCamera(document, { width: 420, height: 720 });

    expect(camera.scale).toBeCloseTo(0.155);
    expect(camera.x).toBeCloseTo(24);
    expect(camera.y).toBeGreaterThan(24);
    expect(camera.x + document.canvas.width * camera.scale).toBeLessThanOrEqual(396);
    expect(camera.y + document.canvas.height * camera.scale).toBeLessThanOrEqual(696);
  });

  it('uses the limiting fullscreen axis to maximize the complete canvas', () => {
    const normal = fitCanvasCamera(document, { width: 420, height: 720 });
    const fullscreen = fitCanvasCamera(document, { width: 1_600, height: 1_000 });

    expect(fullscreen.scale).toBeGreaterThan(normal.scale);
    expect(fullscreen.scale).toBeCloseTo(1_552 / 2_400);
    expect(fullscreen.x).toBeCloseTo(24);
    expect(fullscreen.y).toBeGreaterThan(24);
  });

  it('preserves the logical viewport center when editor panels resize the Stage', () => {
    const previousViewport = { width: 1_200, height: 720 };
    const nextViewport = { width: 700, height: 720 };
    const previous = fitCanvasCamera(document, previousViewport);
    const next = resizeCanvasCamera(previous, previousViewport, nextViewport, document);
    const previousCenter = {
      x: (previousViewport.width / 2 - previous.x) / previous.scale,
      y: (previousViewport.height / 2 - previous.y) / previous.scale,
    };
    const nextCenter = {
      x: (nextViewport.width / 2 - next.x) / next.scale,
      y: (nextViewport.height / 2 - next.y) / next.scale,
    };

    expect(nextCenter.x).toBeCloseTo(previousCenter.x);
    expect(nextCenter.y).toBeCloseTo(previousCenter.y);
    expect(next.scale).toBeLessThan(previous.scale);
  });

  it('keeps the logical point below the pointer stable while zooming', () => {
    const viewport = { width: 1_200, height: 720 };
    const camera = fitCanvasCamera(document, viewport);
    const anchor = { x: 360, y: 260 };
    const logicalBefore = {
      x: (anchor.x - camera.x) / camera.scale,
      y: (anchor.y - camera.y) / camera.scale,
    };
    const zoomed = zoomCanvasCamera(camera, 0.8, anchor, viewport, document);

    expect((anchor.x - zoomed.x) / zoomed.scale).toBeCloseTo(logicalBefore.x);
    expect((anchor.y - zoomed.y) / zoomed.scale).toBeCloseTo(logicalBefore.y);
  });

  it('keeps a recoverable canvas edge after an extreme pan', () => {
    const camera = constrainCanvasCamera(
      { scale: 0.5, x: -99_999, y: 99_999 },
      { width: 1_200, height: 720 },
      document,
    );

    expect(camera.x + document.canvas.width * camera.scale).toBe(64);
    expect(camera.y).toBe(720 - 64);
  });
});
