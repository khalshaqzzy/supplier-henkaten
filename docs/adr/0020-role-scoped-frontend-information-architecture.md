# ADR 0020: Role-scoped Frontend Information Architecture

- Status: Accepted
- Date: 2026-07-24

## Context

Enterprise Digital Henkaten Management requires two desktop web applications with different
identity realms and responsibilities. Supplier users operate Hosted workflows within one tenant,
while TMMIN users administer tenants and monitor Hosted and External records across suppliers.

The approved PRD defines the complete product behavior. The original backend freeze provided 140
HTTP operations and stable shared schemas. Supplier frontend resolution added two backward-
compatible reads, producing 142 operations. TMMIN resolution then added source summary, unified
cross-supplier Henkaten, current-Hosted Assignment Board, and sanitized External ingestion health,
producing 146 operations.

Without one route and behavior specification, feature implementation could duplicate navigation
decisions, conflate Hosted and External data, hide unsupported requirements, or move authorization
and domain policy into React.

## Decision

Two separate frontend applications and route trees will be used:

- `supplier-web` owns Supplier Admin, Supervisor, Line Leader, and QC experiences within a Supplier
  session.
- `tmmin-web` owns TMMIN Admin and TMMIN Quality administration and monitoring experiences within a
  separate TMMIN session.

The normative page, route, state, permission, and user-flow specification is maintained in
`.agent/PAGES.md`.

Navigation will be role/capability-scoped, but backend authorization remains authoritative. A hidden
route or action is not treated as access control, and all protected deep links revalidate
permission through the API.

Supplier Hosted Preparation uses a reduced application mode. It exposes only master-data,
checklist, default-assignment, setup progress, account, and logout capabilities. It does not expose
Shift operation, Henkaten submission/decision, Assignment Board, or normal Hosted monitoring.

Hosted and External monitoring use source-specific detail contracts:

- Hosted detail may contain checklist snapshots, approval routes, member and assignment references,
  movement, and Hosted audit evidence.
- External detail uses supplier-provided source identifiers, projection versions, snapshots, and
  event lineage. It does not require or infer Hosted photos, registration numbers, credentials, or
  Assignment Board data.

Frontend behavior is specified from the PRD first, then mapped to the executable API contract.
Unavailable requirements are marked `ADDITIVE API REQUIRED`; permission disagreements are marked
`POLICY MISMATCH`. Gaps may not be silently omitted or replaced with client-side business policy.

List filters, pagination, sorting, aggregation, readiness, and lifecycle decisions remain
server-authoritative. Frontend URL state may preserve a query, but it does not calculate results
from a partial cursor page and present them as complete.

## Rationale

Separate applications preserve realm boundaries and prevent Supplier Code authentication,
tenant-local cache keys, or supplier operational actions from leaking into the TMMIN experience.
Role-scoped route trees make workflows understandable while retaining defense in depth at the API.

Source-specific detail avoids inventing External PII or presenting TMMIN as the source of truth for
supplier decisions. Explicit contract-gap markers allow frontend planning to remain complete
without weakening the backend freeze: required additions can be limited to backward-compatible
read fields, filters, pagination, or read-only endpoints.

## Alternatives Considered

### One combined application

Rejected because it would combine identity realms, session bootstrap, route guards, cache
boundaries, and different tenant semantics in one runtime without product benefit.

### Limit pages to the current API

Rejected because it would silently drop approved PRD behavior such as complete dashboard
monitoring, cross-supplier exploration, and External ingestion diagnostics.

### Implement missing behavior in React

Rejected because client-side aggregation over cursor pages, duplicated readiness checks, or
permission logic would be incomplete and could diverge from backend policy.

### Use one generic Henkaten detail for Hosted and External

Rejected because the two sources have different identity, traceability, PII, assignment, and event
contracts.

## Implementation Details

- Public and forced-reset routes are separated from authenticated application routes.
- Filter state that must survive refresh is encoded in same-realm frontend URLs.
- One-time credentials exist only for the response lifecycle that created or rotated them.
- Loading, empty, forbidden, retryable error, optimistic conflict, stale, and realtime-disconnected
  behavior is required for applicable pages.
- High-impact mutations require consequence review and current optimistic version.
- TMMIN Quality remains read-only for supplier domain state; notification read/unread changes only
  user-local state.
- The route catalog and user flows are traced against PRD acceptance scenarios and the OpenAPI
  operation set.

## Consequences

- Frontend teams have one decision-complete route and behavior contract.
- Some pages cannot reach full PRD acceptance until additive read-model gaps are implemented.
- Shared page behavior can be standardized without prescribing visual design in the page
  specification.
- Permission or source-mode changes require synchronized updates to PRD, shared contracts, backend
  policy tests, `PAGES.md`, and frontend route tests.
- New filters cannot be simulated over a partially loaded result set.

## Validation

- Every proposed page is assigned to an identity realm and permitted role/session purpose.
- Every current action maps to a frozen API operation; missing reads are named in the contract-gap
  register.
- Critical PRD flows are covered: provisioning, Hosted Preparation, source cutover, master data,
  default assignment, Shift lifecycle, four-category Henkaten, parallel approval, Withdraw and
  Clone, Man cascade, warning lifecycle, External credential lifecycle, and monitoring.
- Hosted and External detail behavior is explicitly separated.
- Page specifications contain no component, CSS, token, spacing, typography, or layout direction.

## Phase 11–12 Additive Contract Resolution

The Supplier gaps identified while defining this architecture were resolved additively:

- Supplier session now carries authoritative capabilities and Supplier context;
- Hosted Preparation capabilities are restricted by backend purpose policy;
- setup readiness reuses the same evaluator as source-governance preflight;
- Supplier dashboard filtering and aggregates are server-side and role-scoped;
- Assignment Board exposes active override context;
- Hosted Henkaten reads expose immutable source mode and epoch;
- Henkaten creation options expose only the published checklist, searchable active parts, and
  reservation/assignment-aware MP candidates required by Line Leader submission;
- audit events retain nullable line-scope evidence, allowing Admin/QC tenant scope and
  Supervisor/Line Leader allowed-line scope.

These changes preserve the decision that React is not a policy or aggregation authority.

## TMMIN Additive Contract Resolution

The TMMIN gap register is resolved through backward-compatible contracts and backend policy:

- supplier and Quality-user lists have server search/status/source/sort/cursor behavior;
- Supplier detail includes the current Supplier Admin, active Hosted Preparation, warning count,
  and source-specific data timestamps;
- source governance has a reloadable current/preparation/preflight/history summary;
- dashboard aggregates and filters reconcile Hosted and External data server-side;
- a discriminated cross-supplier explorer preserves source-specific identity and lineage;
- warning reads expose source-aware operational context without lifecycle mutation;
- current Hosted Assignment Board has a TMMIN read-only endpoint;
- External health exposes authoritative freshness and accepted/duplicate/rejected activity through
  safe error and correlation fields;
- Quality receives a default-deny operational audit projection and no credential administration
  evidence;
- notification context contains Supplier identity for safe TMMIN deep links.

The resulting application keeps Quality controls absent and retains backend `403` denial as the
authorization boundary.

## Risks

- Additive read-model work may expand during real frontend integration if current response shapes
  are insufficient for safe drill-down or recovery.
- Capability mismatches can lead to misleading navigation if the PRD and backend are not reconciled
  before role-scoped audit pages are released.
- A stale page specification could cause route or API drift if contract changes are not reflected
  in the same change.

## Follow-up Work

- Use `.agent/PAGES.md` as the route and behavior input for frontend Phases 11–14.
- Resolve contract gaps through backward-compatible contract changes with authorization and
  reconciliation tests.
- Add cross-realm full-stack E2E and realtime propagation tests during release integration.
