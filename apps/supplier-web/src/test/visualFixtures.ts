import type { supplierApi } from '../app/api';

type SupplierDashboard = Awaited<ReturnType<typeof supplierApi.dashboard>>;

/**
 * Deterministic API-shaped data for visual and interaction review.
 * It is imported by tests only and is never used as a production fallback.
 */
export const supplierDashboardVisualFixture = {
  generatedAt: '2026-07-26T03:24:30.000Z',
  filterOptions: {
    lines: [
      {
        id: '10000000-0000-4000-8000-000000000001',
        code: 'SR-CS',
        name: 'SR CS Line',
      },
    ],
    shiftTemplates: [
      {
        id: '10000000-0000-4000-8000-000000000002',
        name: 'White (Day)',
      },
    ],
  },
  totals: {
    all: 178,
    open: 28,
    approved: 142,
    rejected: 6,
    cancelled: 2,
    activeWarnings: 11,
    unresolvedAssignmentIssues: 3,
    emergencyOverrides: 2,
  },
  pendingApprovals: { supervisor: 16, qc: 7 },
  approvalAging: [
    { bucket: 'UNDER_4_HOURS', count: 8 },
    { bucket: 'FOUR_TO_EIGHT_HOURS', count: 10 },
    { bucket: 'EIGHT_TO_24_HOURS', count: 12 },
    { bucket: 'OVER_24_HOURS', count: 3 },
  ],
  trend: [
    {
      periodStart: '2026-07-01T00:00:00.000Z',
      total: 42,
      man: 12,
      machine: 11,
      material: 10,
      method: 9,
      approved: 31,
      rejected: 7,
      cancelled: 4,
    },
    {
      periodStart: '2026-07-08T00:00:00.000Z',
      total: 55,
      man: 18,
      machine: 14,
      material: 13,
      method: 10,
      approved: 44,
      rejected: 8,
      cancelled: 3,
    },
    {
      periodStart: '2026-07-15T00:00:00.000Z',
      total: 48,
      man: 14,
      machine: 13,
      material: 12,
      method: 9,
      approved: 39,
      rejected: 6,
      cancelled: 3,
    },
    {
      periodStart: '2026-07-22T00:00:00.000Z',
      total: 63,
      man: 20,
      machine: 17,
      material: 14,
      method: 12,
      approved: 51,
      rejected: 9,
      cancelled: 3,
    },
  ],
  assignmentIssues: [
    { type: 'VACANCY', count: 2 },
    { type: 'CONFLICT', count: 1 },
  ],
  recentOverrides: [
    {
      shiftRunId: '10000000-0000-4000-8000-000000000003',
      lineId: '10000000-0000-4000-8000-000000000001',
      lineName: 'SR CS Line',
      businessDate: '2026-07-26',
      reason: 'Kontinuitas produksi dengan persetujuan Admin.',
      startedAt: '2026-07-26T00:00:00.000Z',
    },
  ],
  byCategory: [
    { label: 'MAN', count: 72 },
    { label: 'MACHINE', count: 44 },
    { label: 'MATERIAL', count: 35 },
    { label: 'METHOD', count: 27 },
  ],
  byLine: [
    { label: 'SR CS Line', count: 12 },
    { label: 'EG RM LH2', count: 7 },
    { label: 'Recheck LH', count: 5 },
  ],
  byPart: [
    { label: 'SPC-001', count: 9 },
    { label: '210-5001-AX', count: 6 },
    { label: 'OLRK-RCK-LH', count: 4 },
  ],
  outcomes: [
    { label: 'Approved', count: 142 },
    { label: 'Rejected', count: 6 },
    { label: 'Cancelled', count: 2 },
  ],
  recentActivity: [
    {
      id: '10000000-0000-4000-8000-000000000004',
      action: 'HENKATEN_APPROVED',
      resourceType: 'HENKATEN',
      resourceId: 'HKM-260726-0012',
      occurredAt: '2026-07-26T03:18:00.000Z',
    },
    {
      id: '10000000-0000-4000-8000-000000000005',
      action: 'ASSIGNMENT_ISSUE_OPENED',
      resourceType: 'ASSIGNMENT_ISSUE',
      resourceId: '10000000-0000-4000-8000-000000000006',
      occurredAt: '2026-07-26T03:08:00.000Z',
    },
  ],
} satisfies SupplierDashboard;
