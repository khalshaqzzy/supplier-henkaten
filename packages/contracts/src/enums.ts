import { z } from 'zod';

export const sourceModeSchema = z.enum(['HOSTED', 'EXTERNAL']);
export type SourceMode = z.infer<typeof sourceModeSchema>;

export const identityRealmSchema = z.enum(['TMMIN', 'SUPPLIER']);
export type IdentityRealm = z.infer<typeof identityRealmSchema>;

export const userRoleSchema = z.enum([
  'TMMIN_ADMIN',
  'TMMIN_QUALITY',
  'SUPPLIER_ADMIN',
  'SUPERVISOR',
  'LINE_LEADER',
  'QC',
]);
export type UserRole = z.infer<typeof userRoleSchema>;

export const userStatusSchema = z.enum(['ACTIVE', 'INACTIVE']);
export type UserStatus = z.infer<typeof userStatusSchema>;

export const sessionPurposeSchema = z.enum(['NORMAL', 'HOSTED_PREPARATION']);
export type SessionPurpose = z.infer<typeof sessionPurposeSchema>;

export const hostedPreparationStatusSchema = z.enum(['ACTIVE', 'COMPLETED', 'CANCELLED']);
export type HostedPreparationStatus = z.infer<typeof hostedPreparationStatusSchema>;

export const capabilitySchema = z.enum([
  'TMMIN_SUPPLIER_READ',
  'TMMIN_SUPPLIER_MANAGE',
  'TMMIN_QUALITY_MANAGE',
  'TMMIN_SOURCE_MANAGE',
  'SUPPLIER_SELF_SERVICE',
  'SUPPLIER_MASTER_DATA_MANAGE',
  'SUPPLIER_MASTER_DATA_READ',
  'TMMIN_MASTER_DATA_READ',
  'SUPPLIER_HOSTED_PREPARATION',
  'SUPPLIER_SHIFT_READ',
  'SUPPLIER_SHIFT_OPERATE',
  'SUPPLIER_SHIFT_OVERRIDE',
  'TMMIN_SHIFT_READ',
  'SUPPLIER_HENKATEN_READ',
  'SUPPLIER_HENKATEN_SUBMIT',
  'SUPPLIER_HENKATEN_WITHDRAW',
  'TMMIN_HENKATEN_READ',
]);
export type Capability = z.infer<typeof capabilitySchema>;

export const memberRoleSchema = z.enum(['SUPERVISOR', 'LINE_LEADER', 'MP', 'QC']);
export type MemberRole = z.infer<typeof memberRoleSchema>;

export const shiftRunStatusSchema = z.enum(['NOT_STARTED', 'ACTIVE', 'ENDED']);
export type ShiftRunStatus = z.infer<typeof shiftRunStatusSchema>;

export const workingAssignmentStateSchema = z.enum([
  'ASSIGNED',
  'VACANT',
  'CONFLICTED',
  'RESERVED',
]);
export type WorkingAssignmentState = z.infer<typeof workingAssignmentStateSchema>;

export const assignmentIssueTypeSchema = z.enum(['VACANCY', 'CONFLICT']);
export type AssignmentIssueType = z.infer<typeof assignmentIssueTypeSchema>;

export const henkatenCategorySchema = z.enum(['MAN', 'MACHINE', 'MATERIAL', 'METHOD']);
export type HenkatenCategory = z.infer<typeof henkatenCategorySchema>;

export const henkatenStatusSchema = z.enum(['OPEN', 'APPROVED', 'REJECTED', 'CANCELLED']);
export type HenkatenStatus = z.infer<typeof henkatenStatusSchema>;

export const approvalRouteSchema = z.enum(['SUPERVISOR', 'QC']);
export type ApprovalRoute = z.infer<typeof approvalRouteSchema>;

export const approvalRouteStatusSchema = z.enum([
  'PENDING',
  'APPROVED',
  'REJECTED',
  'NOT_REQUIRED',
]);
export type ApprovalRouteStatus = z.infer<typeof approvalRouteStatusSchema>;

export const approvalDecisionSchema = z.enum(['APPROVED', 'REJECTED']);
export type ApprovalDecision = z.infer<typeof approvalDecisionSchema>;

export const cancellationReasonSchema = z.enum(['WITHDRAWN', 'SHIFT_ENDED']);
export type CancellationReason = z.infer<typeof cancellationReasonSchema>;

export const assignmentIssueStatusSchema = z.enum(['OPEN', 'RESOLVED', 'CLOSED_SHIFT_ENDED']);
export type AssignmentIssueStatus = z.infer<typeof assignmentIssueStatusSchema>;

export const checklistAnswerSchema = z.enum(['YES', 'NO']);
export type ChecklistAnswer = z.infer<typeof checklistAnswerSchema>;

export const warningStatusSchema = z.enum(['OPEN', 'CLOSED']);
export type WarningStatus = z.infer<typeof warningStatusSchema>;

export const externalEventTypeSchema = z.enum([
  'HENKATEN_OPENED',
  'HENKATEN_OPEN_UPDATED',
  'HENKATEN_APPROVED',
  'HENKATEN_REJECTED',
  'HENKATEN_CANCELLED',
]);
export type ExternalEventType = z.infer<typeof externalEventTypeSchema>;

export const ingestionResultStatusSchema = z.enum(['ACCEPTED', 'DUPLICATE', 'REJECTED']);
export type IngestionResultStatus = z.infer<typeof ingestionResultStatusSchema>;

export const domainEventTypeSchema = z.enum([
  'SUPPLIER_SOURCE_MODE_CHANGED',
  'MEMBER_CREATED',
  'MEMBER_UPDATED',
  'MEMBER_STATUS_CHANGED',
  'MEMBER_ACCOUNT_STATUS_CHANGED',
  'MEMBER_PHOTO_REPLACED',
  'MEMBER_PHOTO_REMOVED',
  'MEMBER_PHOTO_CLEANUP_REQUESTED',
  'MASTER_DATA_CHANGED',
  'MASTER_DATA_REORDERED',
  'CHECKLIST_VERSION_PUBLISHED',
  'DEFAULT_ASSIGNMENT_CHANGED',
  'SESSION_REVOKED',
  'SHIFT_STARTED',
  'SHIFT_STARTED_WITH_OVERRIDE',
  'SHIFT_ENDED',
  'HENKATEN_OPENED',
  'HENKATEN_APPROVAL_RECORDED',
  'HENKATEN_APPROVED',
  'HENKATEN_REJECTED',
  'HENKATEN_CANCELLED',
  'MP_RESERVED',
  'MP_RESERVATION_RELEASED',
  'MP_MOVED',
  'ASSIGNMENT_ISSUE_OPENED',
  'ASSIGNMENT_ISSUE_RESOLVED',
  'WARNING_OPENED',
  'WARNING_CLOSED',
  'NOTIFICATION_REQUESTED',
  'EXTERNAL_INGESTION_ACCEPTED',
  'EXTERNAL_INGESTION_REJECTED',
  'EXTERNAL_PROJECTION_UPDATED',
]);
export type DomainEventType = z.infer<typeof domainEventTypeSchema>;

export const publicErrorCodeSchema = z.enum([
  'VALIDATION_FAILED',
  'AUTHENTICATION_FAILED',
  'SESSION_EXPIRED',
  'FORBIDDEN',
  'RESOURCE_NOT_FOUND',
  'VERSION_CONFLICT',
  'STATE_CONFLICT',
  'IDEMPOTENCY_CONFLICT',
  'RESERVATION_CONFLICT',
  'INVALID_TRANSITION',
  'SOURCE_VERSION_OUT_OF_ORDER',
  'SOURCE_MODE_MISMATCH',
  'PAYLOAD_TOO_LARGE',
  'RATE_LIMITED',
  'NOT_READY',
  'INTERNAL_ERROR',
  'CAPACITY_EXCEEDED',
  'RESOURCE_IN_USE',
  'IMMUTABLE_FIELD',
  'INVALID_IMAGE',
  'CHECKLIST_NOT_PUBLISHED',
]);
export type PublicErrorCode = z.infer<typeof publicErrorCodeSchema>;
