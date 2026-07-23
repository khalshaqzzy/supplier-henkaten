import { z } from 'zod';

import { utcTimestampSchema } from './common.js';

export const healthResponseSchema = z
  .object({
    status: z.literal('ok'),
    service: z.string().min(1).max(100),
    releaseSha: z.string().min(1).max(128),
    checkedAt: utcTimestampSchema,
  })
  .strict();
export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const readinessCheckSchema = z
  .object({
    name: z.string().min(1).max(100),
    status: z.enum(['ready', 'not_ready']),
  })
  .strict();

export const readinessResponseSchema = z
  .object({
    status: z.enum(['ready', 'not_ready']),
    service: z.string().min(1).max(100),
    releaseSha: z.string().min(1).max(128),
    checkedAt: utcTimestampSchema,
    checks: z.array(readinessCheckSchema),
  })
  .strict()
  .superRefine((value, context) => {
    const hasFailedCheck = value.checks.some((check) => check.status === 'not_ready');
    if ((value.status === 'not_ready') !== hasFailedCheck) {
      context.addIssue({
        code: 'custom',
        message: 'Readiness status must reflect the included checks.',
      });
    }
  });
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;
