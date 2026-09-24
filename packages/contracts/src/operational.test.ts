import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  createHenkatenRequestSchema,
  decideHenkatenRequestSchema,
  endShiftRequestSchema,
  emergencyStartShiftRequestSchema,
  henkatenFormOptionsQuerySchema,
  henkatenFormOptionsSchema,
  henkatenListQuerySchema,
  prepareShiftRequestSchema,
  rerouteSupervisorRequestSchema,
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
      lineShiftId: id(),
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
        lineShiftJobAssignmentId: id(),
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
    expect(() =>
      createHenkatenRequestSchema.parse({
        ...base,
        lineShiftId: undefined,
        shiftRunId: id(),
        category: 'MAN',
        targetWorkingAssignmentId: id(),
        targetAssignmentVersion: 1,
        replaced: { kind: 'VACANT' },
        replacementMpMemberId: id(),
      }),
    ).toThrow();
  });

  it('enforces the 2,000 character submission evidence limit', () => {
    expect(() =>
      createHenkatenRequestSchema.parse({
        category: 'METHOD',
        lineShiftId: id(),
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

  it('accepts recurring Line–Shift Man replacement and rejects invalid decision evidence', () => {
    expect(
      createHenkatenRequestSchema.parse({
        category: 'MAN',
        lineShiftId: id(),
        jobId: id(),
        partId: id(),
        checklistVersionId: id(),
        checklistAnswers: [{ itemId: id(), answer: 'YES' }],
        cause: 'Replace assigned MP',
        detail: 'Apply the replacement for this scheduled occurrence.',
        lineShiftJobAssignmentId: id(),
        replacementMpMemberId: id(),
      }).category,
    ).toBe('MAN');
    expect(
      decideHenkatenRequestSchema.parse({
        expectedVersion: 2,
        decision: 'APPROVED',
        comment: 'Verified at the line.',
      }),
    ).toBeTruthy();
    expect(() =>
      decideHenkatenRequestSchema.parse({
        expectedVersion: 2,
        decision: 'APPROVED',
        comment: 'x'.repeat(2_001),
      }),
    ).toThrow();
  });

  it('constrains approval-route filters, reroutes, and shift-end versions', () => {
    expect(
      henkatenListQuerySchema.parse({
        approvalRoute: 'SUPERVISOR',
        approvalStatus: 'PENDING',
      }),
    ).toMatchObject({
      approvalRoute: 'SUPERVISOR',
      approvalStatus: 'PENDING',
    });
    expect(
      rerouteSupervisorRequestSchema.parse({
        expectedVersion: 1,
        supervisorMemberId: id(),
      }),
    ).toBeTruthy();
    expect(endShiftRequestSchema.parse({ expectedVersion: 3 })).toEqual({
      expectedVersion: 3,
    });
  });

  it('validates operational Henkaten form options without exposing account data', () => {
    expect(henkatenFormOptionsQuerySchema.parse({ category: 'MAN', part: 'door' })).toEqual({
      category: 'MAN',
      part: 'door',
    });
    expect(
      henkatenFormOptionsSchema.parse({
        generatedAt: '2026-07-24T00:00:00.000Z',
        checklist: {
          id: id(),
          category: 'MAN',
          versionNumber: 2,
          publishedAt: '2026-07-23T00:00:00.000Z',
          items: [{ id: id(), label: 'Replacement qualified', displayOrder: 1 }],
        },
        parts: [{ id: id(), partNumber: 'P-01', partName: 'Door trim' }],
        replacementMembers: [
          {
            id: id(),
            fullName: 'Operator Satu',
            registrationNumber: 'MP-001',
            reserved: false,
            currentAssignment: null,
          },
        ],
      }).replacementMembers,
    ).toHaveLength(1);
  });
});
