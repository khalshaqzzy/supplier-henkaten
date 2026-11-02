# ADR 0011: Permanent Master Data and Member Account Lifecycle

Status: Accepted

Date: 2026-07-23

## Context

Hosted suppliers require operational members and configuration that remain traceable after
assignment and Henkaten history are introduced. Correction workflows must not erase identity or
allow a person's approval role to change retrospectively. TMMIN support and Quality also require
controlled investigation access to Hosted operational data.

## Decision

Supplier master records are permanent from creation. Public hard-delete endpoints are not
provided; records are corrected in place or logically deactivated. The original immutable-role/deactivate-and-recreate policy is superseded for Supervisor, Line Leader
and QC by the reviewed transition described in the 2026-11-02 amendment below. MP role changes remain
prohibited, and generic profile/import updates cannot mutate role.

Supervisor, Line Leader, and QC members have one linked supplier-realm User. MP members cannot have
credentials. Member deactivation disables the linked account and revokes sessions atomically.
Reactivation of a member does not implicitly reactivate its account.

The active limits are 300 members, 20 lines, and 500 jobs per supplier. Capacity-changing
transactions lock the Supplier row before counting and writing.

TMMIN Admin and TMMIN Quality may read Hosted master data across tenants through explicit
read-only routes. This includes member name, registration number, and photo for investigation.
Every such read writes a safe audit event. TMMIN Quality cannot see Hosted Preparation data,
usernames, or credentials.

## Rationale

Permanent identity prevents broken historical references. Immutable role avoids silently changing
the meaning of past and future decisions. Supplier-row locking provides a deterministic capacity
boundary. Explicit TMMIN routes keep privileged access visible and auditable.

## Alternatives

- Pre-activation hard deletion was rejected because it creates a second lifecycle and weakens
  traceability.
- Mutable member roles were rejected because account, assignment, and approval meaning could drift.
- Counting all retained rows toward limits was rejected because long-term deactivated history
  would eventually prevent normal operations.
- Unscoped TMMIN repository access was rejected because it hides privileged authorization.

## Implementation Details

Member, User, and tenant relations use supplier-aware foreign keys. Operational User creation is
validated by a database trigger against the linked member role and supplier. Normalized
registration numbers and usernames remain reserved after deactivation.

Deactivation is blocked while current default assignments reference the entity. Later operational
modules extend reference protection for active shifts, Open Henkaten, reservations, and working
assignments.

## Consequences

Incorrect records remain stored and consume permanent retention. Operational support must use
deactivate-and-recreate for role mistakes. TMMIN Quality receives sensitive Hosted PII access, so
production privacy approval remains a launch blocker.

## Validation Plan

- Member-role and operational-account database constraints.
- Active-capacity and concurrency tests.
- Tenant and role negative tests.
- Session revocation and one-time credential tests.
- Audited TMMIN Admin/Quality reads and Hosted Preparation denial.

## Validation Evidence

Phase 4 PostgreSQL integration and Supertest suites verify that Supervisor, Line Leader, and QC
creation returns one-time credentials while MP creation cannot create an account; the database
trigger rejects an in-place member-role update; member deactivation is blocked by a current
Default Assignment; and TMMIN Quality can read Hosted member PII through the read-only route while
the access produces a redacted audit event. Cross-tenant and cross-realm mutation attempts are
rejected. A fresh migration and an upgrade from the Phase 3 schema both completed successfully on
PostgreSQL 18.

## Risks

Permanent PII retention and the absence of backups remain accepted high/critical risks.
Privileged reads may create audit volume and must not record the PII values themselves.

## Follow-up

Assignment Board and audit read views must reuse these authorization rules. Operational reference
contributors are added with Shift and Henkaten persistence.

## Lifecycle review, 2026-11-02

Static inspection confirms that role editing is disabled in the supplier form, excluded from the
strict update contract and blocked by the database trigger. Member deactivation retains both
the member and its linked User. Registration uniqueness covers active and inactive members;
supplier username uniqueness covers active and inactive accounts. Consequently, the correction
path described above cannot recreate a non-MP member with the original registration and username.
Changing only one identifier does not resolve both reservations. This is an unresolved product
workflow limitation; role immutability itself is implemented as specified.

The supplied screenshots show a disabled Line Leader role, a restore-member action and a failed
new Supervisor form using registration and username 120185. These are consistent with the retained
identity constraints, but the actual production error metadata and deployed release were not
inspected. The generic conflict response also covers transaction conflicts, so the screenshot
alone cannot identify the precise database exception. Member creation writes the member before
the User within one transaction; a retained registration would fail before username insertion.

No lifecycle policy is changed by this review. A supported transition requires an explicit decision
about persistent person identity, operational role history and account ownership. Any implementation
must address active Line–Shift assignments, Open Henkaten and pending approval responsibility,
preserve historical decision evidence, and revoke obsolete authorization. Fabricated registration
numbers and direct database role edits are not adopted as support procedures. Setup workbook import
does not provide a role-change alternative for an existing member.

Validation was limited to source, contract, schema, migration and existing test inspection. No new
tests were run and no production diagnosis or runtime acceptance is claimed. A regression journey
for archiving and attempting correction with the original identifiers remains follow-up work.

Deactivation guards now include planned/Active Shift Runs, active Working Assignments, Open
Henkaten, and active MP reservations. Line, Job, Part, Shift Template, checklist, and member
deactivation fail with `RESOURCE_IN_USE` when the operational references would be invalidated.


## Reviewed operational role transitions, 2026-11-02

Status: Accepted. Local implementation is subject to the validation evidence recorded in the project handoff.

### Context and decision

Permanent identifier reservations made the original correction procedure unusable for the same
person. Operational roles are now changed through a dedicated preview/commit command while the
Member and User identities are retained. The scope is limited to Supervisor, Line Leader and QC.
MP and administrative transitions are excluded. Username, registration, password, photo, import
code, account status and member active state are preserved. A role change is not an account restore.

The command is serialized with supplier setup mutations. Its review digest covers dependency and
candidate versions and LL occupancy. All current and inactive configuration references must be
explicitly handed to eligible same-tenant members of the old role. Pending Supervisor routes are
rerouted with append-only routing evidence. QC approvals remain pooled; the last available QC cannot
leave pending work without active QC coverage. Transactions are bounded to 1,000 dependencies.
Larger transitions require operational reassignment before the role command is reviewed again.

### Persistence and authorization

An append-only MemberRoleChange stores the transition, reason, resulting member version, actor,
selected handovers and an idempotency payload hash. The Member role trigger requires the matching
command and excludes MP transitions. A deferred database consistency trigger verifies that linked
Member/User roles agree at commit. Existing identifier uniqueness is unchanged.

Current HenkatenLineLeaderResponsibility is stored separately from the immutable creator and
occurrence context. Absence of an override retains historical occurrence-owner behavior. Subsequent
handovers use the current override first. Open responsibilities can transfer while completed
approval decisions, occurrence snapshots, checklist evidence and Man placement remain untouched.
Deleted records are excluded from visible handover work. Current role and assignment determine
approval eligibility, including approval of an earlier self-created submission after a role change.

Supplier Admin authorization, session and source epoch are revalidated under the mutation lock,
including the initiating operator session for delegated support. Operator attribution is recorded.
The changed account's authorization epoch is incremented and sessions/push subscriptions are revoked.
Queued submission, withdrawal and approval writes revalidate authority after the same lock so an old
principal cannot write after the transition. Relevant read scopes and notification routing use the
current responsibility. Current assignment/responsibility line scope is included in audit/realtime
scope without removing existing historical scope.

### Account activation and interface

The existing activation endpoint is exposed separately in Member & Akun. The member must be active;
an inactive account receives a new one-time temporary password and a required password change.
An already-active or stale account activation is rejected before another credential rotation.
Ambiguous activation results require state refresh; an explicit reset can recover a lost password.

The role interaction has separate role choice, explicit handover and final review stages. A required
reason, visible preserved account/member status and session consequence precede commit. Unknown
network outcomes lock form edits and retry the identical command. Stale reviews require fresh
replacement decisions. A full-height phone dialog keeps actions separate from scrollable content.

### Alternatives and consequences

Recreating the person with active-only unique indexes was rejected because it duplicates identity,
complicates account restoration and can detach historical references. Merely enabling a role dropdown
was rejected because it leaves assignments, sessions and routing inconsistent. Automatic assignment
clearing was rejected because it can strand operational work. Unrestricted MP conversion was excluded
because MP registration/privacy and credential lifecycle require a separate product decision.

Historical identities remain traceable without fabricated registration values or additional active
member capacity. Current role is no longer immutable; historical role must continue to come from
stored decision/audit evidence rather than joins to the current Member. Generic workbook imports
continue to reject role changes and point to the explicit action.

### Validation and recovery

Validation covers all six transitions, retained identity/password, archived correction, explicit
activation, authorization/source/delegation, exact handover coverage, wrong-role/tenant recipients,
occupied LL, stale and competing commands, double handover, original snapshots, Supervisor routing,
QC coverage and session revocation. Browser QA covers keyboard, responsive layouts, error/retry
states and accessibility. Fresh and main-to-current migration checks and seed smoke are required.

Migration is additive and invents no past transition history. After handovers exist, old application
binaries would ignore LL overrides and must not be restored as a recovery step. Recovery preserves
the widened reader and retained ledger, disables new commands if needed, and uses a forward fix.
Database evidence must not be deleted to make older binaries usable. Production acceptance and
operational monitoring remain follow-up work.


### Unified replacement selection, 2026-11-02

The handover interface presents a single replacement for the full reviewed scope. That person receives
all affected Line–Shift assignments, retained default line assignments and Open Henkaten responsibilities.
The final review shows one replacement name. Repeated resource selectors and dependency pagination
are removed. The client expands the common choice into all dependency identifiers in the existing
request. Backend exact-coverage, role/account eligibility, LL capacity, stale-review and atomicity
checks remain authoritative. No persistence or public API contract change is required.

The combined selector avoids making an administrator repeat the same decision for operational,
retained configuration and Open Henkaten references. Component coverage verifies all dependency
kinds and a 26-reference scope with one selector; browser coverage verifies a single choice transfers
current/default assignments and Henkaten authority together.

### Delivery dependencies, 2026-11-02

The role-change delivery includes minimal patched validation, upload, HTTP and routing dependencies
required by the repository's high-severity gates: Zod 4.6.6, Multer 2.5.0, body-parser 2.4.0,
Undici 7.30.1 and React Router DOM 7.18.2. The distroless cc-debian12 runtime is repinned to the
image index `sha256:9dac0a79194e45a7da0158a9c6da57b217585af0786db3845d1f0ec1a0dd182f`.
The obsolete React Router and OpenSSL advisory exceptions are removed. Remaining exact
documentation/test and local-development exceptions are revalidated with a future expiry; no
broad vulnerability suppression is introduced. The full-lockfile audit has no high/critical findings.

Zod regeneration updates OpenAPI datetime patterns to require seconds, expresses nullable scalar
schemas directly and adds starts-with metadata. Existing application timestamps include seconds;
the regenerated API client's TypeScript shapes are unchanged by this dependency update. Full unit,
integration and browser checks cover compatibility. Container scans verify the runtime patch
independently of the JavaScript audit. Deferred staging and device acceptance is still required
before operational release.

### Runtime scan compatibility, 2026-11-02

The latest distroless base still contains OpenSSL 3.0.20. The API therefore overlays the complete
authenticated Debian `libssl3=3.0.22-1~deb12u2` package payload and original control/md5 metadata
from a separate build stage; no package manager or root shell is added to the runtime. Both
frontend runtimes require Brotli >=1.2.1-r0 and curl/libcurl >=8.23.0-r0; PostgreSQL requires the
same Brotli/libcurl floors. This invalidates stale cached security-upgrade layers. Caddy pins and
asserts go-jose/v4 v4.1.6 after module tidy.

Go-jose/v3 has no upstream patch for CVE-2026-116587. Inspection of the exact compiled dependency
chain found `modules/standard -> modules/caddypki -> smallstep/certificates/authority ->
go.step.sm/crypto/jose -> go-jose/v3`. The configured Caddyfile disables admin and exposes only
three public-domain reverse proxies; it enables neither an internal CA/ACME server nor JWK
provisioning. The private-RSA JWK parser is outside this configured request path. One exact CVE
exception expires 2026-11-16 and must be re-reviewed before any PKI/provisioner/JWK configuration
change. The independent v4 path remains patched and version-asserted. Upstream evidence:
https://github.com/go-jose/go-jose/security/advisories/GHSA-mgcc-cww5-fp2q. This is a scoped residual
dependency risk, not a claim that the v3 code is patched.
