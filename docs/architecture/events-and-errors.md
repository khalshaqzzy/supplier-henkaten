# Domain Events and Public Error Registry

Status: Normative implementation baseline

Date: 2026-07-23

## 1. Event Envelope

All durable internal events use this logical envelope:

| Field | Rule |
|---|---|
| `eventId` | opaque UUID, globally unique |
| `eventType` | value from the registry below |
| `schemaVersion` | positive integer owned per event type |
| `aggregateType` | stable aggregate identifier |
| `aggregateId` | opaque UUID |
| `aggregateVersion` | version after the committed mutation |
| `supplierId` | tenant ID or null for global TMMIN-only event |
| `occurredAt` | authoritative UTC timestamp |
| `actor` | sanitized user/client/system identity and role |
| `correlationId` | request or job correlation identifier |
| `causationId` | source command/event ID when applicable |
| `payload` | event-specific sanitized object |

Events use SCREAMING_SNAKE_CASE names and past-tense business meaning. Event payloads do not contain
passwords, hashes, session/client tokens, cookies, authorization headers, registration numbers,
photo bytes/paths, or unsanitized freeform data.

## 2. Event Registry

| Event type | Producer | Primary consumers |
|---|---|---|
| `SUPPLIER_SOURCE_MODE_CHANGED` | Supplier service | identity revocation, monitoring, audit |
| `MEMBER_CREATED` / `MEMBER_UPDATED` / `MEMBER_STATUS_CHANGED` | Member service | future board/read models |
| `MEMBER_ACCOUNT_STATUS_CHANGED` | Member service | identity monitoring |
| `MEMBER_PHOTO_REPLACED` / `MEMBER_PHOTO_REMOVED` | Photo service | future board/read models |
| `MEMBER_PHOTO_CLEANUP_REQUESTED` | Photo service | private-volume cleanup handler |
| `MASTER_DATA_CHANGED` / `MASTER_DATA_REORDERED` | Master Data service | future board/read models |
| `CHECKLIST_VERSION_PUBLISHED` | Checklist service | shift preflight and Henkaten configuration |
| `DEFAULT_ASSIGNMENT_CHANGED` | Assignment service | shift preflight and future board read model |
| `SESSION_REVOKED` | Identity service | session monitoring/audit |
| `SHIFT_STARTED` | Shift service | board, notification, metrics |
| `SHIFT_STARTED_WITH_OVERRIDE` | Shift service | board, notification, TMMIN visibility |
| `SHIFT_ENDED` | Shift service | board, notification, metrics |
| `HENKATEN_OPENED` | Henkaten service | warning, approval queues, notification, board |
| `HENKATEN_APPROVAL_RECORDED` | Henkaten service | queue/read model, notification |
| `HENKATEN_APPROVED` | Henkaten service | warning, board, dashboard, notification |
| `HENKATEN_REJECTED` | Henkaten service | warning, board, dashboard, notification |
| `HENKATEN_CANCELLED` | Henkaten/Shift service | warning, board, dashboard, notification |
| `MP_RESERVED` | Henkaten service | board, conflict monitoring |
| `MP_RESERVATION_RELEASED` | Henkaten/Shift service | board, conflict monitoring |
| `MP_MOVED` | Henkaten service | board, assignment read model, notification |
| `ASSIGNMENT_ISSUE_OPENED` | Henkaten service | board, shift preflight, notification |
| `ASSIGNMENT_ISSUE_RESOLVED` | Shift/Assignment service | board, shift preflight, notification |
| `WARNING_OPENED` | Henkaten/External service | TMMIN dashboard/notification |
| `WARNING_CLOSED` | Henkaten/External service | TMMIN dashboard/notification |
| `NOTIFICATION_REQUESTED` | domain services | notification materializer |
| `EXTERNAL_INGESTION_ACCEPTED` | External service | ingestion health, metrics |
| `EXTERNAL_INGESTION_REJECTED` | External service | ingestion health, TMMIN notification |
| `EXTERNAL_PROJECTION_UPDATED` | External service | warning, dashboard, metrics |

An event type is added only with a schema, owner, idempotency rule, consumer list, and compatibility
decision. Additive optional payload fields keep the same schema version. Breaking changes require a
new schema version and consumer migration.

## 3. Outbox Processing Contract

- The event and business state commit atomically.
- `eventId` is the idempotency key for consumers.
- A successful consumer records its outcome before the event is considered processed.
- Retries use bounded backoff and preserve the same event ID.
- A failed event remains observable; it is not silently deleted.
- Tenant authorization is evaluated before an event is exposed through SSE.

## 4. Public Problem Details

HTTP errors use `application/problem+json`:

```json
{
  "type": "https://supplier-henkaten.example/problems/validation-failed",
  "title": "Validation failed",
  "status": 400,
  "detail": "One or more fields are invalid.",
  "code": "VALIDATION_FAILED",
  "correlationId": "corr_01",
  "fieldErrors": [
    {
      "path": "limit",
      "code": "too_big",
      "message": "Must be less than or equal to 100."
    }
  ]
}
```

`detail` and field messages are safe for the caller. Stack traces, SQL, internal topology, secret
values, and cross-tenant existence are never returned.

## 5. Canonical Error Codes

| Code | Default status | Meaning |
|---|---:|---|
| `VALIDATION_FAILED` | 400 | malformed or field-invalid internal request |
| `AUTHENTICATION_FAILED` | 401 | generic invalid login or credential |
| `SESSION_EXPIRED` | 401 | missing valid session due to expiry/revocation |
| `FORBIDDEN` | 403 | caller can identify resource but lacks capability |
| `RESOURCE_NOT_FOUND` | 404 | absent or outside caller visibility/tenant |
| `VERSION_CONFLICT` | 409 | expected mutable version is stale |
| `STATE_CONFLICT` | 409 | valid request conflicts with current state |
| `IDEMPOTENCY_CONFLICT` | 409 | reused idempotency/event ID has different payload |
| `RESERVATION_CONFLICT` | 409 | MP or target already has conflicting reservation |
| `PAYLOAD_TOO_LARGE` | 413 | request/upload exceeds permitted size |
| `INVALID_TRANSITION` | 422 | well-formed command cannot transition current state |
| `SOURCE_VERSION_OUT_OF_ORDER` | 422 | external source version is stale or has a gap |
| `SOURCE_MODE_MISMATCH` | 403 | credential/operation does not match active source |
| `RATE_LIMITED` | 429 | request limit exceeded; include `Retry-After` |
| `NOT_READY` | 503 | process alive but critical dependency/init is unavailable |
| `INTERNAL_ERROR` | 500 | unexpected safe server error |
| `CAPACITY_EXCEEDED` | 409 | active tenant resource limit has been reached |
| `RESOURCE_IN_USE` | 409 | deactivation is blocked by an active reference |
| `IMMUTABLE_FIELD` | 409 | request attempts to change immutable domain identity |
| `INVALID_IMAGE` | 400 | uploaded member photo fails size/signature/decode policy |
| `CHECKLIST_NOT_PUBLISHED` | 409 | checklist category lacks a usable published version |

External schema/business validation may use `422` with `VALIDATION_FAILED`; malformed JSON remains
`400`.

## 6. Conflict Precedence

When several checks could fail, use this order:

1. authentication;
2. source mode/credential scope;
3. tenant/object visibility;
4. role/capability;
5. syntax/schema validation that does not expose hidden data;
6. idempotency identity/hash;
7. expected version;
8. state transition and domain conflicts.

This order prevents validation responses from revealing hidden resource state.

## 7. Correlation and Audit

The API accepts `X-Correlation-ID` only when it matches the shared safe schema; otherwise it creates
a new value. The resulting value appears in response headers, Problem Details, structured logs,
audit, outbox events, and external ingestion acknowledgements.

Security logs may contain safe opaque actor/client/supplier IDs but not display names, registration
numbers, photos, credentials, comments, causes, or detail text.
