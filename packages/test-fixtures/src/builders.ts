import type {
  HenkatenCategory,
  HenkatenStatus,
  MemberRole,
  SourceMode,
  UserRole,
} from '@tmmin-henkaten/contracts';

import type {
  ApprovalRouteFixture,
  AssignmentFixture,
  AssignmentIssueFixture,
  ChecklistVersionFixture,
  ExternalEventFixture,
  HealthResponseFixture,
  HenkatenFixture,
  JobFixture,
  LineFixture,
  MemberFixture,
  PartFixture,
  ReservationFixture,
  ShiftFixture,
  SupplierFixture,
  UserFixture,
} from './models.js';

export const FIXED_NOW = '2026-01-15T00:00:00.000Z';
export const FIXED_BUSINESS_DATE = '2026-01-15';

export function deterministicUuid(sequence: number): string {
  if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence > 999_999_999_999) {
    throw new Error('Fixture sequence must be an integer between 0 and 999999999999.');
  }

  return `00000000-0000-4000-8000-${sequence.toString().padStart(12, '0')}`;
}

function merge<T>(base: T, overrides: Partial<T>): T {
  return { ...base, ...overrides };
}

export function buildSupplier(
  overrides: Partial<SupplierFixture> = {},
  sequence = 1,
): SupplierFixture {
  const sourceMode: SourceMode = overrides.sourceMode ?? 'HOSTED';
  return merge(
    {
      id: deterministicUuid(sequence),
      code: `TEST-SUP-${sequence.toString().padStart(3, '0')}`,
      name: `Example Supplier ${sequence}`,
      sourceMode,
      sourceEpoch: 1,
      timezone: 'Asia/Jakarta',
      active: true,
      version: 1,
    },
    overrides,
  );
}

export function buildHostedSupplier(
  overrides: Partial<SupplierFixture> = {},
  sequence = 1,
): SupplierFixture {
  return buildSupplier({ ...overrides, sourceMode: 'HOSTED' }, sequence);
}

export function buildExternalSupplier(
  overrides: Partial<SupplierFixture> = {},
  sequence = 2,
): SupplierFixture {
  return buildSupplier({ ...overrides, sourceMode: 'EXTERNAL' }, sequence);
}

export function buildUser(
  role: UserRole,
  overrides: Partial<UserFixture> = {},
  sequence = 100,
): UserFixture {
  const isTmmin = role === 'TMMIN_ADMIN' || role === 'TMMIN_QUALITY';
  const base: UserFixture = {
    id: deterministicUuid(sequence),
    username: `example_user_${sequence}`,
    role,
    active: true,
    mustChangePassword: false,
    version: 1,
  };

  if (!isTmmin) {
    base.supplierId = deterministicUuid(1);
  }

  return merge(base, overrides);
}

export function buildMember(
  role: MemberRole = 'MP',
  overrides: Partial<MemberFixture> = {},
  sequence = 200,
): MemberFixture {
  return merge(
    {
      id: deterministicUuid(sequence),
      supplierId: deterministicUuid(1),
      name: `Example ${role} ${sequence}`,
      registrationNumber: `TEST-REG-${sequence}`,
      role,
      active: true,
      version: 1,
    },
    overrides,
  );
}

export function buildLine(overrides: Partial<LineFixture> = {}, sequence = 300): LineFixture {
  return merge(
    {
      id: deterministicUuid(sequence),
      supplierId: deterministicUuid(1),
      lineCode: `TEST-LINE-${sequence}`,
      lineName: `Example Line ${sequence}`,
      displayOrder: 1,
      active: true,
      version: 1,
    },
    overrides,
  );
}

export function buildJob(overrides: Partial<JobFixture> = {}, sequence = 400): JobFixture {
  return merge(
    {
      id: deterministicUuid(sequence),
      supplierId: deterministicUuid(1),
      lineId: deterministicUuid(300),
      name: `Example Job ${sequence}`,
      displayOrder: 1,
      active: true,
      version: 1,
    },
    overrides,
  );
}

export function buildPart(overrides: Partial<PartFixture> = {}, sequence = 500): PartFixture {
  return merge(
    {
      id: deterministicUuid(sequence),
      supplierId: deterministicUuid(1),
      partNumber: `TEST-PART-${sequence}`,
      partName: `Example Part ${sequence}`,
      active: true,
      version: 1,
    },
    overrides,
  );
}

export function buildShift(overrides: Partial<ShiftFixture> = {}, sequence = 600): ShiftFixture {
  return merge(
    {
      id: deterministicUuid(sequence),
      supplierId: deterministicUuid(1),
      lineId: deterministicUuid(300),
      name: 'Example Shift 1',
      businessDate: FIXED_BUSINESS_DATE,
      timezone: 'Asia/Jakarta',
      status: 'NOT_STARTED',
      version: 1,
    },
    overrides,
  );
}

export function buildChecklistVersion(
  category: HenkatenCategory = 'MAN',
  overrides: Partial<ChecklistVersionFixture> = {},
  sequence = 700,
): ChecklistVersionFixture {
  return merge(
    {
      id: deterministicUuid(sequence),
      supplierId: deterministicUuid(1),
      category,
      versionLabel: `${category.toLowerCase()}-v1`,
      items: [
        {
          externalId: 'TEST-CHECK-01',
          label: 'Example condition has been verified',
          answer: 'YES',
        },
      ],
    },
    overrides,
  );
}

export function buildAssignment(
  kind: AssignmentFixture['kind'] = 'DEFAULT',
  overrides: Partial<AssignmentFixture> = {},
  sequence = 800,
): AssignmentFixture {
  return merge(
    {
      id: deterministicUuid(sequence),
      supplierId: deterministicUuid(1),
      lineId: deterministicUuid(300),
      jobId: deterministicUuid(400),
      memberId: deterministicUuid(200),
      kind,
      version: 1,
    },
    overrides,
  );
}

function defaultApprovalRoutes(status: HenkatenStatus): ApprovalRouteFixture[] {
  if (status === 'APPROVED') {
    return [
      {
        route: 'SUPERVISOR',
        status: 'APPROVED',
        actorRef: 'actor-supervisor',
        decidedAt: FIXED_NOW,
      },
      { route: 'QC', status: 'APPROVED', actorRef: 'actor-qc', decidedAt: FIXED_NOW },
    ];
  }

  if (status === 'REJECTED') {
    return [
      {
        route: 'SUPERVISOR',
        status: 'REJECTED',
        actorRef: 'actor-supervisor',
        decidedAt: FIXED_NOW,
      },
      { route: 'QC', status: 'NOT_REQUIRED' },
    ];
  }

  if (status === 'CANCELLED') {
    return [
      { route: 'SUPERVISOR', status: 'NOT_REQUIRED' },
      { route: 'QC', status: 'NOT_REQUIRED' },
    ];
  }

  return [
    { route: 'SUPERVISOR', status: 'PENDING' },
    { route: 'QC', status: 'PENDING' },
  ];
}

export function buildHenkaten(
  category: HenkatenCategory = 'MAN',
  status: HenkatenStatus = 'OPEN',
  overrides: Partial<HenkatenFixture> = {},
  sequence = 900,
): HenkatenFixture {
  return merge(
    {
      id: deterministicUuid(sequence),
      supplierId: deterministicUuid(1),
      shiftRunId: deterministicUuid(600),
      lineId: deterministicUuid(300),
      jobId: deterministicUuid(400),
      partId: deterministicUuid(500),
      category,
      status,
      cause: 'Example controlled change',
      detail: 'Example non-production change detail',
      occurredAt: FIXED_NOW,
      approvals: defaultApprovalRoutes(status),
      version: 1,
    },
    overrides,
  );
}

export function buildReservation(
  overrides: Partial<ReservationFixture> = {},
  sequence = 1_000,
): ReservationFixture {
  return merge(
    {
      id: deterministicUuid(sequence),
      supplierId: deterministicUuid(1),
      henkatenId: deterministicUuid(900),
      replacementMemberId: deterministicUuid(201),
      targetJobId: deterministicUuid(400),
      active: true,
      version: 1,
    },
    overrides,
  );
}

export function buildAssignmentIssue(
  overrides: Partial<AssignmentIssueFixture> = {},
  sequence = 1_100,
): AssignmentIssueFixture {
  return merge(
    {
      id: deterministicUuid(sequence),
      supplierId: deterministicUuid(1),
      originHenkatenId: deterministicUuid(900),
      lineId: deterministicUuid(301),
      jobId: deterministicUuid(401),
      status: 'OPEN',
      version: 1,
    },
    overrides,
  );
}

export function buildExternalEvent(
  overrides: Partial<ExternalEventFixture> = {},
  sequence = 1_200,
): ExternalEventFixture {
  return merge(
    {
      schemaVersion: '1.0',
      eventId: `test-event-${sequence}`,
      sourceHenkatenId: `test-source-henkaten-${sequence}`,
      sourceVersion: 1,
      eventType: 'HENKATEN_OPENED',
      status: 'OPEN',
      occurredAt: FIXED_NOW,
      line: { externalId: 'TEST-LINE-01', name: 'Example Line' },
      shift: {
        externalId: 'TEST-SHIFT-01',
        name: 'Example Shift',
        businessDate: FIXED_BUSINESS_DATE,
        timezone: 'Asia/Jakarta',
      },
      job: { externalId: 'TEST-JOB-01', name: 'Example Job' },
      part: { number: 'TEST-PART-001', name: 'Example Part' },
      changePoint: 'MACHINE',
      change: {
        affectedObject: 'Example Machine A',
        replacementObject: 'Example Machine B',
        cause: 'Example controlled replacement',
        detail: 'Example external change detail',
      },
      checklist: {
        templateVersion: 'machine-v1',
        allPassed: true,
        items: [
          {
            externalId: 'TEST-CHECK-01',
            label: 'Example parameter has been verified',
            answer: 'YES',
          },
        ],
      },
      decisions: [],
      metadata: {
        sourceSystem: 'example-supplier-system',
        sourceCorrelationId: `test-correlation-${sequence}`,
      },
    },
    overrides,
  );
}

export function buildHealthResponse(
  overrides: Partial<HealthResponseFixture> = {},
): HealthResponseFixture {
  return merge(
    {
      status: 'ok',
      service: 'api',
      releaseSha: 'development',
      checkedAt: FIXED_NOW,
    },
    overrides,
  );
}
