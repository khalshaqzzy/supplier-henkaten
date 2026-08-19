# 0031 Versioned Line Assignment Board Canvas

Status: Accepted

Date: 2026-08-17

## Context

The existing Assignment Board is an authoritative, accessible list/card read model, but line teams
also require a spatial representation of process zones, machines, flow arrows, and mandatory job
positions. Spatial layout must survive Line Leader changes without becoming a second assignment
authority or persisting member PII. Canvas rendering also cannot replace the existing mobile and
accessibility surface.

## Decision

A single shared `LineBoardLayout` is persisted per supplier and line. The JSON document is strictly
versioned and contains canvas bounds/background plus node geometry, style allowlist, z-index, lock
state, job IDs, and curated machine asset keys. Live member name, registration number, photo URL,
assignment state, and Henkaten data are never stored in the layout.

Every read reconciles the document against active included Working Assignments. Inactive job slots
are removed from the runtime result, missing jobs are deterministically appended to an overflow
grid, and duplicate slots are rejected. Existing slots remain in place when member assignment,
photo, vacancy, reservation, conflict, or 4M indicators change. A generated layout is returned when
no persisted document exists.

Supplier Admin may save any supplier line. A Line Leader may save only the line for which the
current active Shift Run identifies that member as Line Leader. Other Supplier roles and TMMIN
support receive read-only output. Mutation is Hosted-only and uses `expectedVersion` optimistic
concurrency. Each save emits a redacted node-count audit summary and `BOARD_LAYOUT_UPDATED` outbox
event containing only supplier, line, layout, and version identifiers.

The existing Assignment Board remains the default. The Canvas editor and exact Konva dependencies
are dynamically imported only after one line is selected and Canvas is opened. The Stage remains
viewport-sized while a bounded logical canvas supports pan, zoom, snapping, transforms, 50-step
history, and explicit save. Required job cards cannot be deleted, duplicated, or rotated. A DOM
Layers/Properties panel, numeric fields, keyboard movement, accessible labels, risk rail, and the
default board provide non-canvas access paths.

The Stage host uses inline-size containment and a viewport-bounded initial width before
`ResizeObserver` measurement. This prevents the initial Konva backing canvas from becoming the
grid's intrinsic width on tablet/mobile. Arrow nodes expose left/right endpoint handles in addition
to rotation, while machine assets keep proportional corner handles and job cards remain
non-rotatable. Generated and reset layouts use a vertical `300 x 440` job card; proportional resize
preserves that portrait direction, and a cover crop makes the live MP photo the dominant card area.

Machine images are a closed v1 catalog with two generated transparent visual families for the same
twelve industrial equipment types: polished soft-isometric cutouts and simple generic 2D icons.
Their 24-entry typed manifest provides distinct stable keys, style-aware labels, source, aspect
ratio, default size, and accessible description. User uploads and media-storage APIs are excluded.

The comprehensive development seed persists six representative layouts through the production
Supplier Admin API after active Shift Runs exist. Each 2400×1350 composition uses two locked
process zones, a locked title hierarchy, four labeled equipment stations, editable flow arrows and
machine assets, and four editable portrait job cards. NPM uses soft-isometric equipment and GKI uses
the corresponding simple 2D family so both catalog directions remain continuously inspectable.
Four fictional ImageGen MP portraits are reused across lines but never duplicated within the same
four-job baseline; the layout continues to store only job IDs and geometry, never portrait data.

## Rationale

Line ownership gives operations a stable shared spatial language while reconciliation prevents
layout state from drifting into an assignment database. A strict JSON document allows flexible
decoration without a polymorphic relational table and limits accepted node types, styles, sizes,
and counts. Lazy loading contains the editor's bundle and rendering cost so the canonical board's
initial path remains unchanged.

## Alternatives Considered

- Store a layout per user or per Shift Run: rejected because teams need one durable line layout and
  frequent duplicate layouts would drift.
- Persist card member content in JSON: rejected because it duplicates authoritative data, retains
  stale PII, and complicates photo/change propagation.
- Replace the default board with Canvas: rejected because canvas semantics, mobile operation, and
  accessibility do not match the existing board.
- Allow arbitrary image uploads: deferred because storage moderation, malware handling, tenancy,
  and lifecycle management are unnecessary for the curated v1 requirement.
- Model every visual node relationally: rejected because decorative shape evolution would require
  frequent migrations without improving assignment authority.

## Consequences

- Saved layouts are line configuration, not production or Henkaten records.
- Reads require lightweight reconciliation with active Working Assignments.
- Concurrent editors must explicitly resolve optimistic conflicts; local drafts are not server
  autosaves.
- Canvas intrinsic sizing cannot determine document width; the Stage is clipped and remeasured
  inside the responsive shell.
- TMMIN can inspect the same Hosted layout but cannot mutate it.
- Schema migration will be required before accepting a future document version.
- Local Canvas seed failures stop clean start/reseed when layout schema, active-job parity,
  portrait reuse, audit, or outbox invariants drift.

## Validation

Strict contract tests cover bounds, unknown fields/assets, duplicate slots, and discriminator
support. Service tests cover deterministic generation and reconciliation. Hosted integration covers
role scope, optimistic conflicts, TMMIN read-only access, redacted audit summaries, and safe outbox
payloads. Frontend checks cover the complete machine manifest and transform normalization, followed
by repository lint, typecheck, unit, integration, build, E2E, migration, accessibility, and visual
viewport verification.

The seeded visual factory additionally validates deterministic node IDs, bounds, one required slot
per active job, explicit machine-family mapping, and four normalized portrait assets. Clean start,
reseed, and direct browser inspection confirm saved version-1 layouts with responsive containment
and authoritative vacancy/photo rendering.

## Follow-up Work

- Add schema migration tooling before introducing a version other than `1`.
- Evaluate asset additions through the curated manifest rather than enabling general uploads.
- Retain the default board as the accessibility baseline as browser canvas APIs evolve.
