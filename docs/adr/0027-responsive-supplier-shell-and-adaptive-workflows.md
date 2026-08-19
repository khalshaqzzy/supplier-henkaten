# 0027 Responsive Supplier Shell and Adaptive Workflows

Status: Accepted

Date: 2026-08-05

## Context

The Supplier application was composed for a minimum 1280×720 desktop viewport and rejected
smaller screens. Shop-floor Line Leaders and other supplier roles need the same authoritative
workflow on phones and tablets without creating a second application or weakening capability,
tenant, source-mode, and lifecycle rules. The established desktop experience is already accepted
and must not regress.

## Decision

Supplier web supports mobile 360–767px, tablet 768–1279px, and desktop at least 1280px in portrait
and landscape. Desktop retains the existing sidebar/topbar, dense tables, dashboard, and board
composition. CSS adaptation is applied below 1280px: mobile uses a sticky compact header and modal
navigation drawer, tablet uses the same accessible drawer/rail pattern, and all original account,
notification, logout, skip-link, unread, keyboard, and focus behavior remains available.

Shared responsive patterns are used across every supplier role and Hosted Preparation route:
stacked filters/actions and forms, contained tablet tables, mobile card rows, adaptive grids,
full-screen mobile dialogs/sheets, and minimum 44×44px targets. Assignment Board becomes a
line-oriented single-column job-card view on mobile and an adaptive grid on tablet. Information and
status semantics are never removed; status is not color-only. The unsupported-viewport route and
gate are removed.

## Consequences

There remains one Supplier application, API contract, and authorization model. Responsive layouts
can change visual ordering but not domain ordering, validation, expected-version, or mutation
semantics. TMMIN web remains desktop-only. Official regression sizes are 390×844, 768×1024,
1024×768, 1280×720, and the existing wide desktop; 360 CSS px remains the minimum target.

## Alternatives Considered

- Separate mobile application: rejected because it duplicates security and lifecycle behavior.
- Scale the desktop canvas: rejected because it creates unreadable controls and page overflow.
- Remove dense workflows from mobile: rejected because all supplier workflows are in scope.
- Redesign desktop together with mobile: rejected because desktop behavior is already accepted.

## Validation

Role/workflow Playwright coverage, deterministic screenshots, document-overflow checks, primary
action visibility, keyboard/focus assertions, 44px target checks, and Axe scans are release gates.
Real Android/iPhone/iPad staging rehearsal remains required before Phase 16 UAT.
