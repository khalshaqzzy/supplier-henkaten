# Security, Privacy, and Accepted-Risk Baseline

Status: Normative implementation baseline

Date: 2026-07-23

Source: `.agent/PRD.md`

## 1. Data Classification

| Class | Examples | Minimum handling |
|---|---|---|
| Public | public health endpoint status without topology | no secrets; fixed schema |
| Internal | opaque IDs, line/job/part operational data, aggregate counts | authenticated least privilege |
| Confidential | Henkaten details, approval comments, assignment state, audit | tenant/role/object authorization |
| PII | member name, registration number, photo, actor display snapshot | Hosted only; least privilege; no logs |
| Credential/secret | password, password hash, session/client token, CSRF token, DB/runtime secret | never returned/logged/audited; hashed or secret-managed |

Freeform cause, detail, and comments are Confidential and may accidentally contain PII or secrets.
They are never emitted to logs and are sanitized before external display or audit summary.

## 2. Hosted PII Matrix

| Data | Stored | Typical authorized viewers | Log/audit value |
|---|---:|---|---|
| member name | yes | permitted supplier roles; TMMIN support/monitoring where required | opaque actor ID or safe snapshot only |
| registration number | yes | Hosted board/master-data roles | never logged; audit says field changed |
| member photo | optional | authorized Hosted board/master-data roles | never logged/audited |
| approval actor snapshot | yes, immutable | authorized history/audit roles | safe role/opaque actor context |
| username | yes | account owner/admin | never included in domain logs |
| password/session/client secret | hashed/secret metadata only | no viewer | never |

Hosted PII is logically retained permanently under the current product policy. Governance/legal
approval is required before production.

## 3. External Data Policy

Allowed:

- supplier-local opaque person reference;
- role;
- optional display name;
- event timestamps;
- sanitized optional approval comment;
- operational line/shift/job/part/change/checklist snapshots.

Forbidden:

- registration number;
- photo or biometric/media content;
- username;
- password, token, credential, or secret;
- email or phone;
- health, attendance, or skill information.

External contracts do not declare forbidden fields. Unknown fields are rejected at the ingestion
boundary. Documentation warns suppliers not to place PII or secrets in freeform content.

Pure External provisioning stores supplier organization metadata only: no platform Supplier Admin,
member name, registration number, photo, username, or password. Hosted Preparation is an explicit
privacy-boundary crossing: the TMMIN Admin must acknowledge privacy handling before a preparation
admin and later Hosted master data may be created. Preparation does not authorize External PII to
enter monitoring event contracts.

## 4. Authorization and Enumeration

- Backend authorization is default deny.
- Supplier scope comes from the authenticated principal.
- A resource outside the tenant or visibility scope returns `404`.
- A visible resource with a disallowed capability returns `403`.
- TMMIN cross-tenant access uses explicit privileged guards and audit.
- External clients can ingest only for their supplier and active source epoch.
- Frontend visibility is not an access control.

## 5. Session, Cookie, and CSRF Baseline

- Opaque 256-bit minimum session token; SHA-256 hash at rest.
- Separate Supplier and TMMIN sessions/cookies.
- Hosted cookies: `__Host-`, Secure, HttpOnly, Path `/`, no Domain.
- Same-origin browser `/api` proxy.
- Idle timeout 30 minutes; absolute timeout 12 hours.
- Synchronizer CSRF token required on browser mutations.
- Session revocation on password/role/account/source security changes.
- Login errors do not reveal supplier-code or username existence.

## 6. Logging and Audit Redaction

Never log or store in audit before/after payload:

- password or password hash;
- session, CSRF, or client token/secret;
- Cookie or Authorization header;
- database/runtime/deployment secrets;
- registration number;
- photo bytes/path;
- full freeform cause/detail/comment;
- External raw payload.

Structured logs may contain safe opaque IDs, environment, release SHA, route template, status,
duration, correlation ID, error code, and tenant ID where authorized.

## 7. File-upload Threat Boundary

- Hosted member photos only.
- Maximum 2 MB before decode and a bounded decoded-pixel count.
- Signature and MIME must agree.
- Reject animated, malformed, or unsupported formats.
- Normalize with Sharp, strip metadata, and emit safe WebP.
- Store in a private persistent volume using server-generated paths.
- Serve through authenticated API with `nosniff`.
- External contracts reject photo content and URLs.

## 8. Minimum Engineering Gates

Effective from the repository foundation:

- exact package versions and committed pnpm lockfile;
- strict Node engine and package-manager pins;
- no committed `.env`, secret, token, or generated private file;
- Gitleaks CI scan;
- fixtures contain no real PII or credential;
- External fixtures/contracts contain no forbidden PII fields;
- lint import boundaries prevent test fixture use in production source;
- GitHub workflow permissions are least privilege;
- Docker cleanup leaves no agent-started runtime behind.

Later security gates add tenant/role negative tests, CSRF/CORS tests, CodeQL, dependency review, Trivy,
container hardening, and security finding closure.

## 9. Accepted Risks

| Risk | Severity | Status | Engineering consequence |
|---|---|---|---|
| no database/photo backup or recovery | Critical | Accepted | prevent destructive operations; never claim recoverability |
| single VM/failure domain | Critical | Accepted | health/readiness and restart only; no HA claim |
| destructive migration without recovery | Critical | Accepted | forward-only expand/contract and migration review |
| automatic production deployment | High | Accepted | mandatory CI/security/smoke gates and compatible rollback |
| in-app-only warning | High | Accepted | persistent warning/aging; no offline delivery claim |
| permanent Hosted PII retention | High | governance approval required | production launch blocked pending written approval |
| cross-line Man vacancy cascade | High | mitigated by design | reservation, lock order, issue, notification, hard gate |
| supplier-attested External correctness | High | mitigated by design | schema/version/source badge/ingestion health |

## 10. Launch Blockers

Production is blocked until TMMIN provides or approves:

- production domains, DNS, VM, and deployment credentials;
- runtime and database secrets;
- designated privileged bootstrap users;
- governance/privacy approval for permanent Hosted PII;
- written acceptance of no backup/recovery/HA;
- written acceptance of automatic production deployment;
- representative Hosted and External UAT participants.

These blockers do not prevent local implementation.

## 11. Verification Ownership

| Control | Primary implementation | Final validation |
|---|---|---|
| dependency/secret baseline | repository foundation | CI/security hardening |
| tenant/object authorization | tenancy/auth foundation | backend hardening and E2E |
| sessions/CSRF | authentication | security negative suite |
| photo boundary | member management | upload security tests |
| External PII/source scope | external ingestion | contract/security UAT |
| migration safety | persistence/deployment | release rehearsal |
| accepted-risk sign-off | release readiness | production launch |
