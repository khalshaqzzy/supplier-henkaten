# ADR 0021: Shared Enterprise Design System and Public Showcase

- Status: Accepted
- Date: 2026-07-24

## Context

Phase 11 requires two frontend applications that remain visually and behaviorally consistent while
preserving separate Supplier and TMMIN identity realms. Eight approved reference images establish a
light, dense enterprise language: fixed sidebar, compact global header, restrained orange accent,
thin borders, white operational surfaces, metric cards, dense tables, contextual rails, readiness
cards, and explicit status semantics.

A duplicated per-app component layer would drift. A screenshot-only mockup would not prove keyboard,
focus, loading, validation, overlay, or domain-enum behavior. The system also needs an auditable
surface that remains available before authenticated feature routes exist.

## Decision

Create `packages/ui` as the single shared Henkaten Design System package consumed by
`apps/supplier-web` and `apps/tmmin-web`.

CSS custom properties prefixed `--hds-*` are the runtime token source. A typed token registry mirrors
the public families for documentation and automated coverage checks. Reusable implementations use
semantic or component tokens; raw color, radius, elevation, duration, spacing, and layer values do
not appear in the component layer.

The visual direction is derived from `.agent/design/`:

- light neutral canvas and white operational surfaces;
- compact controls and dense tables with clear hierarchy;
- orange only for primary action, current navigation, and selective emphasis;
- minimal elevation, small radii, thin borders, and functional motion;
- icon, label, and color combined for every operational status;
- PRD-authoritative 4M semantics: Man red, Machine blue, Material amber, Method green.

Unsupported screenshot behavior is not inherited. Export, Save Draft, Skills, Calendars, extra
source approvals, auto-accept, and tooling checks are excluded.

Both applications expose the same lazy-loaded `DesignSystemShowcase` at `/design`. The route:

- is public, always present in production builds, and not feature-flagged;
- is mounted before future session bootstrap and route guards;
- does not call session or application APIs;
- does not appear in product navigation;
- uses labelled, non-sensitive sample data only;
- sets `noindex,nofollow`;
- remains auditable at desktop, tablet, and mobile widths.

Production workflows remain out of scope for this decision. Root routes are explicit Phase 11
foundation placeholders until the typed API client and session boundary exist.

## Component and Behavior Contract

- React, TypeScript, Vite, Tailwind CSS v4 CSS-first setup, and shadcn-compatible workspace aliases.
- Radix primitives provide menu, popover, dialog, sheet, select, tabs, accordion, radio, checkbox,
  and switch keyboard/focus behavior.
- Lucide is the only functional icon family; `BrandLockup` is text plus a replaceable Lucide mark.
- TanStack Table provides sortable table behavior; Recharts consumes semantic chart tokens.
- Interactive APIs expose controlled/uncontrolled state where relevant.
- Loading actions use `aria-busy`, remain dimensionally stable, and block duplicate submit.
- Reduced-motion disables or simplifies recurring motion without hiding state.
- Domain components use type-only imports from `@tmmin-henkaten/contracts` rather than redefining
  lifecycle enums.

## Alternatives Considered

### Duplicate UI layers per application

Rejected because token, accessibility, and domain-semantic drift would be inevitable.

### Private or development-only showcase

Rejected because production artifact auditing and direct stakeholder review require the same
implementation that feature pages consume. The route is safe because it contains no real data or
backend dependency.

### Copy the reference screens literally

Rejected because screenshots include unsupported behavior and cannot define accessible interaction
contracts. PRD, `PAGES.md`, and executable backend contracts remain authoritative.

### Introduce dark mode

Rejected because no dark source reference or product requirement exists.

## Consequences

- Both realms share one visual and interaction contract without sharing sessions or product routes.
- Feature teams can compose production pages from tested primitives and domain semantics.
- The public documentation bundle is larger than a minimal application shell, so `/design` is
  code-split and loaded only when requested.
- Reference images remain source material under `.agent/design/` and are not copied to a public
  bundle.
- Changes to a public token or component require a rendered specimen and regression checks.

## Validation

- Public package exports compile in both applications.
- Unit tests cover loading semantics, duplicate-submit prevention, labels/errors, controlled
  selection, pagination boundaries, tabs keyboard behavior, menu/dialog Escape, focus return, and
  domain enum mapping.
- Token tests reject raw component colors and un-tokenized overlay/chart configuration.
- Both production applications build from the same package.
- Browser verification covers direct unauthenticated access, absence of API/session calls,
  responsive documentation, internal overflow containment, focus visibility, overlays, and
  reduced-motion behavior.

## Follow-up Work

- Implement Phase 11.3 typed API client without importing it into `/design`.
- Implement realm-specific session bootstrap and route guards after the public utility route.
- Add real-API Playwright infrastructure in the owning subphase.
- Use the eight composed specimens as visual references, not as substitutes for Phase 12/13
  production feature implementation.
