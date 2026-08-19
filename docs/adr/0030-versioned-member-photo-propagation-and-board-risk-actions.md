# 0030 Versioned Member Photo Propagation and Board Risk Actions

Status: Accepted

Date: 2026-08-11

## Context

Member-photo upload was already private, normalized, audited, and tenant-scoped, but the Supplier
UI did not expose the complete lifecycle. Stable thumbnail paths combined with a five-minute
private browser cache could show the replaced image after a successful mutation. First upload also
did not emit an outbox event, so an already-open Assignment Board had no realtime invalidation.

The Assignment Board risk rail already linked vacancies to Shift resolution and Open Man
reservations to Henkaten detail, but the links appeared as unstyled text. A generic `RESERVED` row
could also duplicate the actionable reservation row without providing an action.

## Decision

Member photo `version` is a monotonically increasing generation for each member across upload,
replacement, removal, and later restoration. Upload and removal lock the member row before reading
or changing photo state. Member and board presenters append the current generation as `?v=` to
private photo URLs; endpoint authorization and cache headers remain unchanged.

After normalization, replacement compares both generated checksums with the current photo while
holding that lock. Byte-equivalent output is rejected as `STATE_CONFLICT`; it does not create a
generation, audit success, cleanup request, or realtime invalidation. The Assignment Board
read-model version and last-updated timestamp include the effective MP photo generation.

Every successful upload, replacement, or removal enqueues `MEMBER_PHOTO_CHANGED` in the same
transaction. Its supplier-scoped payload contains only the opaque member ID. This event exists for
realtime read-model invalidation; physical deletion continues through the separate cleanup event.

Supplier Admin manages photos from member detail only. The editor provides initials fallback,
preview, set/replace, confirmed versioned removal, client feedback, and invalidates member list,
member detail, and board queries. Other roles and `/board` remain read-only.

Board operational risks distinguish two actionable kinds: `ISSUE` for vacant/conflicted working
assignments and `RESERVATION` for Open Man Henkaten indicators. Generic `RESERVED` state does not
produce a second row. Issues use a primary `Buka resolusi` link-button; reservations use a secondary
`Buka Henkaten` link-button. Both preserve the existing authoritative routes and lifecycle.

## Consequences

- No migration or new endpoint is required. Existing photo URL schemas remain compatible strings.
- Photo generations may skip a number when removal increments the prior resource version; they are
  monotonic cache tokens, not a gapless business sequence.
- The outbox gains a safe invalidation event even when no superseded file requires cleanup.
- Browser caches can retain immutable prior generations without presenting them as current.
- Board risk rows are actionable and non-duplicative without moving resolution authority into the
  browser.

## Alternatives Considered

- Disable photo caching entirely: rejected because private thumbnails are read frequently and a
  generation token provides deterministic freshness without removing useful caching.
- Use photo UUID as the query token: rejected because the existing optimistic version can provide a
  clear per-member generation contract.
- Add upload controls to `/board`: rejected because the board is an operational read surface and
  photo mutation belongs to Supplier Admin master data.
- Style the duplicate `RESERVED` row: rejected because it still lacks an independent authoritative
  target and repeats the Open Man reservation.

## Validation

Unit/component tests cover typed removal, file validation, repeated selection, preview/removal,
query invalidation, risk deduplication, routes, accessible names, and button variants. PostgreSQL
tests cover generation progression, stale removal, a single current record, changed events, tenant
isolation, and versioned board output. Browser inspection covers desktop/mobile action treatments,
44 px targets, and horizontal-overflow absence.
