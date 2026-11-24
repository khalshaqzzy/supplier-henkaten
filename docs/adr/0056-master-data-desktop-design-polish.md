# ADR 0056: Master Data desktop design polish

- Status: Accepted
- Date: 2026-11-24

## Context

The Supplier Portal Master Data area (`/master-data` and its Member, Line & Job, Part, Shift
Template, Checklist 4M, Part import and Line Setup pages) had grown screen by screen. A design
review of every page at 1440 px found that the shell, tokens, Member detail and Line Setup were
sound, while the remaining screens felt unfinished:

- rendering defects: the member photo stacked above the name in the Member list, the *Buat jadwal*
  label rendered grey on orange because a descendant selector leaked into the button, the checklist
  editor targeted a non-existent `.hds-panel__content` class so its actions had no spacing, and two
  stylesheets referenced undefined tokens (`--hds-focus-ring`, `--hds-color-text-subtle`);
- weak hierarchy: form submit buttons fell back to the secondary variant, statuses were plain text
  (`Aktif`, raw `ACTIVE`, `Mp`, `Qc`) and destructive bulk actions looked like neutral ones;
- generic detail pages: Line, Part and Shift detail were titled *Edit data* with the breadcrumb
  `Supplier / Edit data`, and a 680 px form card sat above full-width Status and Jobs panels;
- an uninformative hub: six identical cards with the same icon and no data, and Checklist 4M cards
  that repeated the category (`MAN Man`);
- browser-native `window.confirm` dialogs on checklist publish/deactivate and member photo removal.

The work had to keep the familiar layout, stay within the existing slate and orange tokens and the
`packages/ui` components, require no API change, and target desktop; mobile had only to avoid
regressions.

## Decision

1. **Defect fixes.** `.person-summary` is a flex row; the rotation empty-state selector is scoped
   to its helper text; the checklist editor uses `.hds-panel__body`; undefined tokens are replaced
   by `--hds-focus-color` and `--hds-text-tertiary`; the pager places the arrow after *Berikutnya*;
   *Hapus semua part* and lifecycle *Hapus* use a danger outline.
2. **One primary action per view.** *Buat data*, *Simpan perubahan*, *Simpan draft*,
   *Publish versi baru*, *Selesai* and the empty-state create link use the primary variant.
3. **Status vocabulary.** `StatusBadge` renders Aktif/Arsip in all four master tables and in detail
   headers. Account state (`Akun aktif`, `Akun nonaktif`, `Tanpa akun`) and timestamps come from a
   shared `masterFormat.ts`, reused by Member detail and checklist version history. Member roles use
   `memberRoleLabels`.
4. **Detail headers.** `PageHeader` accepts an optional `breadcrumbs` prop, so Master Data pages
   show `Supplier / Master Data / <list> / <item>`; without the prop pages are unchanged. Line,
   Part and Shift detail are titled with the record (`NPM-L1 · Press & Stamping`,
   `<TMMIN Part Number> · <name>`, the template name) with a status badge, and show *Edit data*
   only while the record loads. The form, Jobs and Status panels share one 880 px column; Jobs
   precede the destructive Status panel. A two-column rail like Member detail was considered and
   rejected to keep the single-column layout familiar.
5. **Overview with readiness data.** Each hub card has its own icon and shows an active count and a
   readiness badge (*Lengkap*, *Perlu dilengkapi*, *Opsional*) from the existing
   `GET /supplier/setup-readiness`, sharing the `setup-readiness` query key with `/setup` and
   refetching on mount. Area summaries come from one `setupAreaStatus` helper used by both pages,
   and area names are unified to *Member & Akun* and *Line & Job*. Checklist 4M cards use the
   4M colour dot (`FourMDot`) instead of an icon, in a 2 × 2 grid; 4M categories are represented by
   their colour dots throughout the portal.
6. **Job rows.** Edit, move up, move down and delete are icon buttons with tooltips and descriptive
   accessible names; order numbers use the `01`–`04` pill shared with Line Setup; an *Arsip* badge
   appears only on archived jobs.
7. **In-app confirmations.** Checklist publish, checklist activate/deactivate and member photo
   removal use the `packages/ui` `AlertDialog`; deactivate and photo removal use the destructive
   confirm style.
8. **Polish.** Shift day chips use an orange tint instead of solid blocks; the rotation empty state
   is a flat inset row with a secondary CTA; Part import uses a dashed drop zone with drag and drop,
   a *Pilih file* affordance, a Download icon and design tokens; the Line Setup selected shift row
   has a visible border and the line selector shows `code · name`; panel titles on product pages
   are semibold.

## Alternatives considered

- **Two-column detail layout** (form and Jobs left, Status rail right): more consistent with Member
  detail but a larger change to a layout users know.
- **Icon-only hub cards without data:** less informative; readiness data was already available.
- **Checklist per-category counts on the Checklist 4M cards:** would need four extra draft
  requests; deferred.
- **Mobile list-card redesign and drawer shadow fix:** out of scope for a desktop-focused change.

## Consequences

- Master Data screens share one header, status and action vocabulary, and destructive actions are
  visually distinct.
- `PageHeader.breadcrumbs`, `masterFormat.ts` and `setupAreaStatus` are reusable by other pages.
- The `onboarding` browser journey confirms checklist publish through the dialog, and the member
  photo unit test confirms removal through the dialog.
- The `.product-page .hds-panel__header h2` weight applies to every Supplier Portal page, not only
  Master Data.

## Validation

- Desktop (1440 px) before/after captures of all 18 Master Data screens plus the delete dialog and
  an empty filter state; 390 px captures checked for regressions.
- Two independent design reviews before and after the change.
- Local CI parity (format, lint, typecheck, unit, OpenAPI, build, Docker database checks,
  integration, browser journeys, Gitleaks) recorded in the session handoff.

## Risks and follow-up

- Tooltips do not open on disabled reorder buttons (first row up, last row down); their accessible
  names remain.
- Focus returns to the page body when a confirmed action removes its trigger (photo removal),
  matching the previous native confirm.
- Optional: per-category item counts on the Checklist 4M cards, and mobile list-card density.
