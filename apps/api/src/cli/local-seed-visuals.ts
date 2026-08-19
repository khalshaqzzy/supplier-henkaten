import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  boardLayoutDocumentSchema,
  type BoardLayoutDocument,
  type BoardLayoutNode,
  type BoardMachineAssetKey,
} from '@tmmin-henkaten/contracts';
import sharp from 'sharp';

import type { SupplierSeedPlan } from './local-seed-plan.js';

export const LOCAL_SEED_MP_PORTRAIT_FILES = [
  'mp-operator-01.jpg',
  'mp-operator-02.jpg',
  'mp-operator-03.jpg',
  'mp-operator-04.jpg',
] as const;

export type LocalSeedPortrait = {
  buffer: Buffer;
  filename: (typeof LOCAL_SEED_MP_PORTRAIT_FILES)[number];
  mimeType: 'image/jpeg';
};

export async function loadLocalSeedPortraits(): Promise<LocalSeedPortrait[]> {
  return Promise.all(
    LOCAL_SEED_MP_PORTRAIT_FILES.map(async (filename) => {
      const path = fileURLToPath(
        new URL(`../../../../scripts/assets/local-seed/mp-portraits/${filename}`, import.meta.url),
      );
      const buffer = await readFile(path);
      if (buffer.byteLength >= 2 * 1024 * 1024) {
        throw new Error(`Local seed portrait ${filename} exceeds 2 MiB.`);
      }
      const metadata = await sharp(buffer, { animated: false, pages: 1 }).metadata();
      if (
        metadata.format !== 'jpeg' ||
        metadata.width !== 768 ||
        metadata.height !== 1024 ||
        (metadata.pages ?? 1) !== 1
      ) {
        throw new Error(`Local seed portrait ${filename} must be a single 768x1024 JPEG.`);
      }
      return { buffer, filename, mimeType: 'image/jpeg' as const };
    }),
  );
}

export function localSeedPortraitIndex(mpIndex: number): number {
  if (!Number.isInteger(mpIndex) || mpIndex < 0 || mpIndex >= 12) {
    throw new Error('Assigned local-seed MP index must be an integer from 0 through 11.');
  }
  return mpIndex % LOCAL_SEED_MP_PORTRAIT_FILES.length;
}

export function createLocalSeedCanvasDocument(
  plan: SupplierSeedPlan,
  lineIndex: number,
  jobs: ReadonlyArray<{ id: string }>,
): BoardLayoutDocument {
  const line = plan.canvasLines[lineIndex];
  const jobNames = plan.jobNames[lineIndex];
  if (!line || !jobNames || jobs.length !== 4 || jobNames.length !== 4) {
    throw new Error(
      `Canvas seed requires exactly four jobs for ${plan.code} line ${lineIndex + 1}.`,
    );
  }

  const stationX = [185, 755, 1325, 1895] as const;
  const cardX = [205, 775, 1345, 1915] as const;
  const nodes: BoardLayoutNode[] = [
    rectangle('seed:machine-zone', 70, 180, 2_260, 470, line.zoneFill, '#cbd5e1', 0, true),
    rectangle('seed:people-zone', 70, 700, 2_260, 560, '#ffffff', '#cbd5e1', 1, true),
    outline('seed:production-outline', 45, 155, 2_310, 1_145, plan.accent, 2, true),
    textNode(
      'seed:title',
      80,
      35,
      2_240,
      60,
      `${plan.code} · ${plan.lineNames[lineIndex]}`,
      '#172033',
      42,
      20,
      true,
    ),
    textNode('seed:subtitle', 80, 100, 2_240, 36, line.subtitle, plan.accent, 20, 21, true),
    textNode('seed:machine-label', 95, 190, 260, 34, 'PROCESS EQUIPMENT', '#475467', 16, 22, true),
    textNode('seed:people-label', 95, 710, 260, 34, 'LIVE ASSIGNMENT', '#475467', 16, 23, true),
  ];

  for (let index = 0; index < 4; index += 1) {
    nodes.push(
      textNode(
        `seed:station:${index + 1}`,
        120 + index * 570,
        230,
        470,
        38,
        `STATION ${String(index + 1).padStart(2, '0')}`,
        '#344054',
        18,
        24 + index,
        true,
      ),
      machineNode(
        `seed:machine:${index + 1}`,
        stationX[index]!,
        290,
        line.machines[index]!,
        30 + index,
      ),
      jobNode(jobs[index]!.id, cardX[index]!, 780, 50 + index),
    );
    if (index < 3) {
      nodes.push(
        arrowNode(`seed:flow:${index + 1}`, 565 + index * 570, 405, plan.accent, 40 + index),
      );
    }
  }

  return boardLayoutDocumentSchema.parse({
    schemaVersion: 1,
    canvas: { width: 2_400, height: 1_350, background: 'LIGHT_GRID' },
    nodes,
  });
}

function transform(
  x: number,
  y: number,
  width: number,
  height: number,
  zIndex: number,
  locked = false,
) {
  return { x, y, width, height, rotation: 0, zIndex, locked };
}

function rectangle(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
  stroke: string,
  zIndex: number,
  locked: boolean,
): BoardLayoutNode {
  return {
    id,
    type: 'RECTANGLE',
    transform: transform(x, y, width, height, zIndex, locked),
    fill,
    stroke,
    strokeWidth: 2,
    opacity: 0.88,
    cornerRadius: 28,
  };
}

function outline(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  stroke: string,
  zIndex: number,
  locked: boolean,
): BoardLayoutNode {
  return {
    id,
    type: 'OUTLINE',
    transform: transform(x, y, width, height, zIndex, locked),
    fill: '#ffffff',
    stroke,
    strokeWidth: 3,
    opacity: 0.7,
    cornerRadius: 32,
  };
}

function textNode(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  text: string,
  color: string,
  fontSize: number,
  zIndex: number,
  locked: boolean,
): BoardLayoutNode {
  return {
    id,
    type: 'TEXT',
    transform: transform(x, y, width, height, zIndex, locked),
    text,
    color,
    fontSize,
    align: 'left',
  };
}

function machineNode(
  id: string,
  x: number,
  y: number,
  assetKey: BoardMachineAssetKey,
  zIndex: number,
): BoardLayoutNode {
  return {
    id,
    type: 'MACHINE_ASSET',
    transform: transform(x, y, 340, 280, zIndex),
    assetKey,
    opacity: 1,
  };
}

function arrowNode(
  id: string,
  x: number,
  y: number,
  color: string,
  zIndex: number,
): BoardLayoutNode {
  return {
    id,
    type: 'ARROW',
    transform: transform(x, y, 130, 44, zIndex),
    color,
    strokeWidth: 7,
  };
}

function jobNode(jobId: string, x: number, y: number, zIndex: number): BoardLayoutNode {
  return {
    id: `job:${jobId}`,
    type: 'JOB_SLOT',
    jobId,
    transform: transform(x, y, 300, 440, zIndex),
  };
}
