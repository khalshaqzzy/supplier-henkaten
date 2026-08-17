import { z } from 'zod';

import { opaqueIdSchema, optimisticVersionSchema, utcTimestampSchema } from './common.js';

export const boardMachineAssetKeySchema = z.enum([
  'PRESS_STAMPING',
  'INJECTION_MOLDING',
  'WELDING_ROBOT',
  'SPOT_WELDING',
  'CNC_MACHINING',
  'STRAIGHT_CONVEYOR',
  'ROLLER_CONVEYOR',
  'ASSEMBLY_FIXTURE',
  'INSPECTION_CMM',
  'TORQUE_STATION',
  'MATERIAL_RACK',
  'PACKING_STATION',
  'PRESS_STAMPING_2D',
  'INJECTION_MOLDING_2D',
  'WELDING_ROBOT_2D',
  'SPOT_WELDING_2D',
  'CNC_MACHINING_2D',
  'STRAIGHT_CONVEYOR_2D',
  'ROLLER_CONVEYOR_2D',
  'ASSEMBLY_FIXTURE_2D',
  'INSPECTION_CMM_2D',
  'TORQUE_STATION_2D',
  'MATERIAL_RACK_2D',
  'PACKING_STATION_2D',
]);
export type BoardMachineAssetKey = z.infer<typeof boardMachineAssetKeySchema>;

const coordinateSchema = z.number().finite().min(0).max(12_000);
const sizeSchema = z.number().finite().min(20).max(12_000);
const rotationSchema = z.number().finite().min(-360).max(360);
const zIndexSchema = z.number().int().min(0).max(2_000);
const colorSchema = z.string().regex(/^#[0-9a-f]{6}$/i, 'Expected a six-digit hex color.');

export const boardNodeTransformSchema = z
  .object({
    x: coordinateSchema,
    y: coordinateSchema,
    width: sizeSchema,
    height: sizeSchema,
    rotation: rotationSchema.default(0),
    zIndex: zIndexSchema,
    locked: z.boolean().default(false),
  })
  .strict();

const nodeBase = {
  id: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z0-9:_-]+$/),
  transform: boardNodeTransformSchema,
};

export const boardJobSlotNodeSchema = z
  .object({
    ...nodeBase,
    type: z.literal('JOB_SLOT'),
    jobId: opaqueIdSchema,
  })
  .strict();

export const boardMachineNodeSchema = z
  .object({
    ...nodeBase,
    type: z.literal('MACHINE_ASSET'),
    assetKey: boardMachineAssetKeySchema,
    opacity: z.number().finite().min(0.2).max(1).default(1),
  })
  .strict();

export const boardRectangleNodeSchema = z
  .object({
    ...nodeBase,
    type: z.enum(['RECTANGLE', 'OUTLINE']),
    fill: colorSchema,
    stroke: colorSchema,
    strokeWidth: z.number().finite().min(1).max(20),
    opacity: z.number().finite().min(0.1).max(1),
    cornerRadius: z.number().finite().min(0).max(80),
  })
  .strict();

export const boardArrowNodeSchema = z
  .object({
    ...nodeBase,
    type: z.literal('ARROW'),
    color: colorSchema,
    strokeWidth: z.number().finite().min(2).max(24),
  })
  .strict();

export const boardTextNodeSchema = z
  .object({
    ...nodeBase,
    type: z.literal('TEXT'),
    text: z.string().trim().min(1).max(200),
    color: colorSchema,
    fontSize: z.number().finite().min(12).max(96),
    align: z.enum(['left', 'center', 'right']),
  })
  .strict();

export const boardLayoutNodeSchema = z.discriminatedUnion('type', [
  boardJobSlotNodeSchema,
  boardMachineNodeSchema,
  boardRectangleNodeSchema,
  boardArrowNodeSchema,
  boardTextNodeSchema,
]);
export type BoardLayoutNode = z.infer<typeof boardLayoutNodeSchema>;

export const boardLayoutDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    canvas: z
      .object({
        width: z.number().int().min(2_400).max(12_000),
        height: z.number().int().min(1_350).max(8_000),
        background: z.enum(['LIGHT_GRID', 'PLAIN']),
      })
      .strict(),
    nodes: z.array(boardLayoutNodeSchema).max(2_000),
  })
  .strict()
  .superRefine((document, context) => {
    const ids = new Set<string>();
    const jobIds = new Set<string>();
    for (const [index, node] of document.nodes.entries()) {
      if (ids.has(node.id)) {
        context.addIssue({
          code: 'custom',
          path: ['nodes', index, 'id'],
          message: 'Duplicate node id.',
        });
      }
      ids.add(node.id);
      if (node.type === 'JOB_SLOT') {
        if (jobIds.has(node.jobId)) {
          context.addIssue({
            code: 'custom',
            path: ['nodes', index, 'jobId'],
            message: 'A job may appear only once.',
          });
        }
        jobIds.add(node.jobId);
      }
      const { x, y, width, height } = node.transform;
      if (x + width > document.canvas.width || y + height > document.canvas.height) {
        context.addIssue({
          code: 'custom',
          path: ['nodes', index, 'transform'],
          message: 'Node must remain inside the logical canvas.',
        });
      }
    }
  });
export type BoardLayoutDocument = z.infer<typeof boardLayoutDocumentSchema>;

export const boardLayoutSaveRequestSchema = z
  .object({
    expectedVersion: optimisticVersionSchema.nullable(),
    document: boardLayoutDocumentSchema,
  })
  .strict();
export type BoardLayoutSaveRequest = z.infer<typeof boardLayoutSaveRequestSchema>;

export const boardLayoutResponseSchema = z
  .object({
    id: opaqueIdSchema.nullable(),
    lineId: opaqueIdSchema,
    source: z.enum(['SAVED', 'GENERATED']),
    version: optimisticVersionSchema.nullable(),
    schemaVersion: z.literal(1),
    canEdit: z.boolean(),
    updatedAt: utcTimestampSchema.nullable(),
    updatedBy: z.string().nullable(),
    reconciliation: z
      .object({
        addedJobIds: z.array(opaqueIdSchema),
        removedJobIds: z.array(opaqueIdSchema),
      })
      .strict(),
    document: boardLayoutDocumentSchema,
  })
  .strict();
export type BoardLayoutResponse = z.infer<typeof boardLayoutResponseSchema>;
