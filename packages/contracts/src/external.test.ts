import { describe, expect, it } from 'vitest';

import { externalBatchRequestSchema, externalHenkatenEventSchema } from './external.js';

const opened = {
  schemaVersion: '1.0',
  eventId: 'event-1',
  sourceHenkatenId: 'supplier-henkaten-1',
  sourceVersion: 1,
  eventType: 'HENKATEN_OPENED',
  status: 'OPEN',
  occurredAt: '2026-07-23T02:00:00.000Z',
  line: { externalId: 'L1', name: 'Assembly' },
  shift: {
    externalId: 'S1',
    name: 'Shift 1',
    businessDate: '2026-07-23',
    timezone: 'Asia/Jakarta',
  },
  job: { externalId: 'J1', name: 'Torque' },
  part: { number: '61023-0K100-A1', name: 'Example Part' },
  changePoint: 'MACHINE',
  change: {
    affectedObject: 'Tool A',
    replacementObject: 'Tool B',
    cause: 'Controlled replacement',
    detail: 'Qualified replacement tool.',
  },
  checklist: {
    templateVersion: 'machine-v1',
    allPassed: true,
    items: [{ externalId: 'Q1', label: 'Parameter verified', answer: 'YES' }],
  },
  decisions: [],
  metadata: { sourceSystem: 'supplier-app' },
};

describe('external API contracts', () => {
  it('accepts a self-contained Open event and rejects forbidden PII fields', () => {
    expect(externalHenkatenEventSchema.parse(opened).occurredAt).toBe('2026-07-23T02:00:00.000Z');
    expect(
      externalHenkatenEventSchema.safeParse({
        ...opened,
        email: 'operator@example.com',
      }).success,
    ).toBe(false);
  });

  it('enforces terminal decision evidence and keeps batch item validation independent', () => {
    expect(
      externalHenkatenEventSchema.safeParse({
        ...opened,
        sourceVersion: 2,
        eventId: 'event-2',
        eventType: 'HENKATEN_APPROVED',
        status: 'APPROVED',
      }).success,
    ).toBe(false);
    expect(
      externalBatchRequestSchema.parse({ events: [opened, { forbidden: true }] }).events,
    ).toHaveLength(2);
  });
});
