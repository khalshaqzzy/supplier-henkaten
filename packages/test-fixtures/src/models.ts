import type {
  ApprovalRoute,
  ApprovalRouteStatus,
  AssignmentIssueStatus,
  ExternalEventType,
  HealthResponse,
  HenkatenCategory,
  HenkatenStatus,
  MemberRole,
  ShiftRunStatus,
  SourceMode,
  UserRole,
} from '@tmmin-henkaten/contracts';

export interface SupplierFixture {
  id: string;
  code: string;
  name: string;
  sourceMode: SourceMode;
  sourceEpoch: number;
  timezone: string;
  active: boolean;
  version: number;
}

export interface UserFixture {
  id: string;
  supplierId?: string;
  username: string;
  role: UserRole;
  active: boolean;
  mustChangePassword: boolean;
  version: number;
}

export interface MemberFixture {
  id: string;
  supplierId: string;
  name: string;
  registrationNumber: string;
  role: MemberRole;
  active: boolean;
  version: number;
}

export interface LineFixture {
  id: string;
  supplierId: string;
  lineCode: string;
  lineName: string;
  displayOrder: number;
  active: boolean;
  version: number;
}

export interface JobFixture {
  id: string;
  supplierId: string;
  lineId: string;
  name: string;
  displayOrder: number;
  active: boolean;
  version: number;
}

export interface PartFixture {
  id: string;
  supplierId: string;
  partNumber: string;
  partName: string;
  active: boolean;
  version: number;
}

export interface ShiftFixture {
  id: string;
  supplierId: string;
  lineId: string;
  name: string;
  businessDate: string;
  timezone: string;
  status: ShiftRunStatus;
  version: number;
}

export interface ChecklistItemFixture {
  externalId: string;
  label: string;
  answer: 'YES';
}

export interface ChecklistVersionFixture {
  id: string;
  supplierId: string;
  category: HenkatenCategory;
  versionLabel: string;
  items: ChecklistItemFixture[];
}

export interface AssignmentFixture {
  id: string;
  supplierId: string;
  lineId: string;
  jobId: string;
  memberId: string | null;
  kind: 'DEFAULT' | 'WORKING';
  version: number;
}

export interface ApprovalRouteFixture {
  route: ApprovalRoute;
  status: ApprovalRouteStatus;
  actorRef?: string;
  decidedAt?: string;
}

export interface HenkatenFixture {
  id: string;
  supplierId: string;
  shiftRunId: string;
  lineId: string;
  jobId: string;
  partId: string;
  category: HenkatenCategory;
  status: HenkatenStatus;
  cause: string;
  detail: string;
  occurredAt: string;
  approvals: ApprovalRouteFixture[];
  version: number;
}

export interface ReservationFixture {
  id: string;
  supplierId: string;
  henkatenId: string;
  replacementMemberId: string;
  targetJobId: string;
  active: boolean;
  version: number;
}

export interface AssignmentIssueFixture {
  id: string;
  supplierId: string;
  originHenkatenId: string;
  lineId: string;
  jobId: string;
  status: AssignmentIssueStatus;
  version: number;
}

export interface ExternalEventFixture {
  schemaVersion: '1.0';
  eventId: string;
  sourceHenkatenId: string;
  sourceVersion: number;
  eventType: ExternalEventType;
  status: HenkatenStatus;
  occurredAt: string;
  line: {
    externalId: string;
    name: string;
  };
  shift: {
    externalId: string;
    name: string;
    businessDate: string;
    timezone: string;
  };
  job: {
    externalId: string;
    name: string;
  };
  part: {
    number: string;
    name: string;
  };
  changePoint: HenkatenCategory;
  change: {
    affectedObject: string;
    replacementObject: string;
    cause: string;
    detail: string;
  };
  checklist: {
    templateVersion: string;
    allPassed: true;
    items: ChecklistItemFixture[];
  };
  decisions: Array<{
    route: ApprovalRoute;
    decision: 'APPROVED' | 'REJECTED';
    actorRef: string;
    decidedAt: string;
  }>;
  metadata: {
    sourceSystem: string;
    sourceCorrelationId: string;
  };
}

export type HealthResponseFixture = HealthResponse;
