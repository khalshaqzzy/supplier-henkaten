# ADR 0025: TMMIN Governance and Monitoring Composition

- Status: Accepted
- Date: 2026-07-26

## Context

TMMIN Admin governs Supplier identities, source transitions, External credentials, and privileged
users. TMMIN Quality monitors the same operational estate without changing Supplier, source,
credential, Henkaten, warning, Shift, or assignment state. Both roles need one coherent view across
Hosted and External sources, but those sources have different identities, lineage, privacy
constraints, and available operational detail.

The browser also spans a privileged identity realm. Cached monitoring data, one-time credentials,
CSRF state, or an intended destination must not survive logout, expiry, forced reset, or a principal
change. The visual references establish a dense desktop information hierarchy, while the PRD
deliberately excludes generic admin-dashboard controls and approval workflows that are not part of
the product.

## Decision

### Source-aware read composition

Cross-supplier monitoring is assembled in backend services and read models. Dashboard, warning,
Henkaten explorer, source summary, Assignment Board, and External health responses are filtered,
sorted, paginated, and aggregated before they reach the browser.

Unified Henkaten results use a discriminated `sourceMode` union:

- Hosted results retain immutable source epoch and link to the Hosted aggregate detail, checklist,
  decisions, assignments, and audit evidence.
- External results retain Supplier source ID/version, source epoch, snapshots, freshness, and
  accepted-event lineage without introducing Hosted-only member identity fields.

Assignment Board is readable only for the current Hosted source. Historical Hosted Henkaten and
Shift evidence remains readable after cutover.

### Read-only Quality policy

TMMIN Quality uses the monitoring pages in an explicitly read-only presentation. Mutation controls
are omitted rather than rendered disabled. Backend capabilities and guards remain authoritative and
return `403` for manually attempted supplier, user, credential, source, Henkaten, warning, Shift, or
assignment mutations.

Quality audit visibility is a default-deny allowlist covering operational Henkaten, warning,
Shift/override, assignment, source-state summary, notification, and sanitized ingestion evidence.
Account, password, credential, token, and privileged-administration events are excluded.

### Sanitized External diagnostics

External ingestion health is derived from persisted ingestion records and safe audit evidence.
Accepted, duplicate, and rejected attempts are counted authoritatively. Duplicate attempts add
sanitized audit evidence without storing the payload again. Diagnostic rows expose only safe error
codes, correlation/event identifiers, client/epoch status, and freshness timestamps; raw payloads,
secrets, tokens, and forbidden PII are never returned.

External warning notifications target TMMIN Admin and Quality. Rejected-ingestion notifications
target Admin only. All TMMIN deep links carry an explicit Supplier identifier.

### Session and cache boundary

Every TMMIN query key includes realm and principal ID. Logout, expiry, forced reset, or identity
change clears React Query, CSRF, form memory, intended destination, and one-time credentials.
Temporary passwords and External client secrets live only in component memory and disappear after
acknowledgement or navigation.

The typed browser boundary accepts schema-validated non-2xx success alternatives where the
operation defines them; readiness therefore parses `503 not_ready` without bypassing runtime
validation.

### Visual composition

The application uses the shared Henkaten Design System with a compact sidebar, 60 px top bar,
near-white canvas, thin borders, low elevation, dense tables, tabular numbers, selective orange,
visible focus, and reduced-motion-safe feedback.

Global Overview preserves the reference hierarchy of metrics, aging, trends, rankings, freshness,
and activity. Source Governance preserves the summary strip, preflight/blocker/readiness/history
composition and contextual consequence rail. It does not add global search, export, alert
configuration, fake live state, documentation controls, or an approval workflow absent from the
PRD.

The TMMIN-only composition layer now also owns labelled filters, page toolbars, source-split
metrics, section panels, table shells, breadcrumbs, freshness summaries, ranking lists, contextual
action rails, and layout-matched loading/empty/error states. Generic primitives remain in the
shared design-system package so this refinement does not silently restyle Supplier Portal
workflows.

Global Overview filters are authoritative in the URL. In the absence of URL values, the browser
requests the latest 30 days with daily granularity. Apply and reset explicitly update the query
string; the API remains responsible for applying every filter consistently to Hosted and External
records.

### Additive dashboard projection

The extended dashboard contract includes three additive projections:

- zero-filled trend buckets containing Hosted, External, total, and lifecycle outcome counts;
- a freshness summary containing fresh, warning, stale, and no-data counts;
- at most ten Supplier overview rows with source, Open Henkaten, active/aged warning, freshness, and
  last-data evidence.

Date bucketing, source/outcome classification, freshness aggregation, Supplier risk aggregation,
and deterministic sorting are backend responsibilities. The browser formats and presents these
values but does not infer readiness, missing buckets, period deltas, or a new risk score.

## Rationale

Server-side source-aware composition prevents a cursor page from becoming an accidental global
authority. A discriminated result preserves traceability while making impossible Hosted/External
field combinations unrepresentable. Sharing monitoring pages between Admin and Quality keeps the
information architecture consistent, while capability-scoped presentation and backend denial
provide defense in depth.

Memory-only credentials and principal-scoped caching reduce disclosure risk without introducing
persistent browser storage. Reusing the design system preserves interaction and accessibility
consistency while allowing the two approved monitoring references to drive page hierarchy.

## Alternatives Considered

### Aggregate in React

Rejected because browser pages do not hold the complete cursor set and cannot produce authoritative
aging, freshness, or cross-source rankings.

### Return one generic Henkaten shape

Rejected because it either leaks Hosted identity assumptions into External data or discards
traceability required for Hosted support.

### Give Quality credential reads but hide mutations

Rejected because credential inventory and administration evidence are outside the Quality
monitoring purpose. Hidden controls are not an authorization boundary.

### Persist one-time credentials for recovery

Rejected because redisplay conflicts with the one-time disclosure contract. Recovery is a new
rotate/reset operation with a new credential.

## Consequences

- Read-model and OpenAPI changes must remain synchronized with shared Zod and the generated client.
- Adding source-specific filters or fields requires backend implementation for both source branches
  or an explicit discriminated restriction.
- Dashboard projection additions must remain backward-compatible and must be regenerated into both
  OpenAPI and the typed client in the same change.
- Quality page changes require both visibility tests and direct backend mutation probes.
- Source cutover invalidates source-bound sessions and credentials and therefore always requires a
  current version, reason, privacy acknowledgement, and consequence confirmation.
- Desktop widths below the supported viewport present a safe unsupported state and allow logout;
  no mobile operational workflow is implied.

## Validation

- Runtime/OpenAPI reconciliation covers 130 paths and 146 operations.
- Contract tests cover source unions, safe health/audit shapes, notification Supplier context,
  privacy acknowledgement, and typed `503` readiness.
- PostgreSQL integration covers administration filters, source state and preflight, unified
  exploration, warnings, current-Hosted Board policy, ingestion outcomes, Quality audit scope, and
  direct Quality mutation denial.
- Frontend tests cover public routes, forced reset, intended destination, realm/cache isolation,
  role visibility, unsupported viewport, source-specific detail, and readiness states.
- Manual desktop review covers the approved overview and governance compositions, privileged and
  read-only shells, credentials, health, authentication, focus, overflow, and failure states.
- Pure read-model tests cover daily/weekly/monthly bucketing, zero buckets, and Hosted/External
  outcome classification. Frontend tests cover dashboard composition, filter apply/reset, URL
  propagation, and navigation collapse.

## Risks and Follow-up

- Cross-realm full-stack browser coverage and concurrent realtime behavior remain release-level
  integration work.
- Query plans must be re-measured if filter cardinality or the accepted capacity profile changes
  materially.
- Deployment automation, public domain, TLS, backup, restore, and rollback evidence remain
  separate operational concerns.
