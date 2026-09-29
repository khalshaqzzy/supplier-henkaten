# ADR 0041: Compact Supplier dashboard filter

Status: Accepted
Date: 2026-09-29

## Context

The Supplier Overview placed all dashboard filter fields in a large grid above the metrics. On desktop, the grid occupied substantial vertical space and gave infrequently used approval and trend controls the same prominence as the period, status, category, and line controls. The dashboard query, URL parameters, and apply/reset interaction were already established and must remain authoritative.

## Decision

The desktop dashboard filter uses one horizontal toolbar. Period, status, 4M category, and line remain visible. Period is a grouped trigger containing the selected range; its popover retains separate native start and end date inputs. Shift Template, part, approval route, approval status, and trend interval are available in a second anchored popover. Both popovers float above the dashboard rather than increasing the toolbar's layout height.

The toolbar keeps a single Apply action and a Reset action. Draft values do not change the dashboard query until Apply is selected. Reset clears the URL-backed filters. The badge on Filter lainnya counts applied non-default filters inside that popover; it does not count available fields or unapplied edits. The last-updated value stays in the toolbar, with a labeled icon at compact desktop widths and full text when space permits. The component remains keyboard accessible through the existing design-system popover behavior and native form controls.

## Rationale and alternatives considered

Keeping all fields visible in one desktop row would require narrow inputs and reduce readability at the 1280 px desktop boundary. An inline expandable second row would violate the one-row requirement and move the metrics when opened. A full-page drawer would add unnecessary travel for a local dashboard action. Anchored popovers keep the primary workflow fast while preserving all filter capabilities in the same location. Shared neutral surfaces, hairlines, radius, type scale, and orange primary action retain the portal's existing visual language.

## Implementation and consequences

The change is scoped to the Supplier Overview filter markup and its page-specific CSS. No dashboard query parameter, API contract, backend behavior, chart, metric, navigation item, or shared filter component is changed. At desktop widths of 1280 px and above, toolbar controls stay in one CSS grid row. Below the desktop boundary, controls may reflow to remain readable. The period summary is derived from the existing draft dates without converting them through a timezone. The existing query conversion and URL synchronization remain unchanged.

## Validation plan, risks, and follow-up

Unit coverage checks that advanced and period edits remain drafts until Apply, that their query values are preserved, and that Reset restores the default state. Browser coverage checks one-row containment and absence of document overflow at 1280, 1440, and 1672 px, plus access to the advanced fields. The small desktop timestamp relies on a labeled icon and title; physical-device and assistive-technology acceptance remains part of the existing Supplier responsive gate. The popover overlays dashboard content while open, but does not move or resize the widgets. No schema or seed update is required.
