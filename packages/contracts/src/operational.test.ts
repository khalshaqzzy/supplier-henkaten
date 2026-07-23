import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  createHenkatenRequestSchema,
  emergencyStartShiftRequestSchema,
  prepareShiftRequestSchema,
} from './index.js';

const id = () => randomUUID();

describe('operational contracts', () => {
  it('accepts a durable shift slot and constrains emergency reasons', () => {
    expect(
      prepareShiftRequestSchema.parse({
        lineId: id(),
        shiftTemplateId: id(),
        businessDate: '2026-07-23',
      }),
    ).toBeTruthy();
    expect(() =>
      emergencyStartShiftRequestSchema.parse({
        expectedVersion: 1,
        reason: 'too short',
      }),
    ).toThrow();
  });

  it('discriminates Man references from non-Man freeform replacements', () => {
    const base = {
      shiftRunId: id(),
      jobId: id(),
      partId: id(),
      checklistVersionId: id(),
      checklistAnswers: [{ itemId: id(), answer: 'YES' }],
      cause: 'Planned change',
      detail: 'A traceable operational change.',
    };
    expect(
      createHenkatenRequestSchema.parse({
        ...base,
        category: 'MAN',
        targetWorkingAssignmentId: id(),
        targetAssignmentVersion: 1,
        replaced: { kind: 'VACANT' },
        replacementMpMemberId: id(),
      }).category,
    ).toBe('MAN');
    expect(() =>
      createHenkatenRequestSchema.parse({
        ...base,
        category: 'MACHINE',
        targetWorkingAssignmentId: id(),
        affectedObject: 'Old machine',
        replacementObject: 'New machine',
      }),
    ).toThrow();
  });

  it('enforces the 2,000 character submission evidence limit', () => {
    expect(() =>
      createHenkatenRequestSchema.parse({
        category: 'METHOD',
        shiftRunId: id(),
        jobId: id(),
        partId: id(),
        checklistVersionId: id(),
        checklistAnswers: [{ itemId: id(), answer: 'YES' }],
        cause: 'x'.repeat(2_001),
        detail: 'Valid detail',
        affectedObject: 'Old method',
        replacementObject: 'New method',
      }),
    ).toThrow();
  });
});
