# ADR 0051: Member detail workspace and shared Select component

- Status: Accepted
- Date: 2026-11-11

## Context

The Supplier member detail route (`/master-data/members/:memberId`) reused the generic master-data
form. It presented a page titled “Edit data”, a narrow form with a disabled role dropdown, and a
separate “Member & foto” panel that combined photo handling, account state, role change,
password reset and member archival in one row of mixed buttons. The username appeared twice,
destructive and routine actions sat side by side, and saving returned the user to the list even
though most member work (photo, account, role, status) happens on the detail page.

Across the Supplier portal, about forty filter and form controls used the browser-native
`<select>` through the shared `NativeSelect` wrapper. Native lists cannot show option
descriptions, right-aligned metadata, disabled reasons, grouping or search, render differently per
operating system, and look inconsistent next to the custom searchable member picker
(`SearchSelect`) and the Radix-based `Select` used only by the shift-swap dialog. The Radix select
also rejects empty-string option values, which most “Semua …” filters depend on.

## Decision

1. A dedicated `MemberDetailPage` replaces the generic form for existing members. The generic
   `MasterFormPage` continues to create members and to edit lines, parts and Shift Templates.
2. The shared UI package provides one `Select` component, built on Radix Popover with a custom
   listbox, and every Supplier-owned `NativeSelect` usage moves to it. `NativeSelect` remains
   exported for TMMIN pages and for the shared Henkaten export panel, which are outside this
   change.

## Implementation

### Member detail

- Header: avatar (photo or initials), member name as the page heading, breadcrumbs including the
  member list, role badge, member status and account status, plus a compact fact strip
  (registration, username, last update) that omits facts the member does not have.
- Two-column workspace on wide screens: main column with **Profil** and **Foto**, and a sticky rail
  with **Akun** and **Status member**. Between 768 and 1180 px the rail becomes a two-column row
  under the main column; on phones everything stacks.
- Profil sends only changed fields with `expectedVersion`, tracks unsaved state against the last
  saved values, enables *Simpan perubahan* only when something changed and is valid, offers
  *Batalkan* to discard, and guards `beforeunload` only while dirty. After saving, the page stays
  in place, updates the cached detail and invalidates list queries.
- Role is shown read-only with its description; the existing role-change dialog is the only way to
  change it and is placed outside the profile `<form>` because its portalled controls would
  otherwise bubble React submit events into the profile form. MP members show no role action.
- Foto keeps the same client validation (JPG/PNG/WebP, 2 MB), success and error messages and
  confirmation, and adds drag-and-drop onto the photo area.
- Akun shows username with a copy action and whether the password is still temporary; *Reset
  password* or *Aktifkan akun* (disabled while the member is archived). MP members show “Tanpa akun
  login”. One-time credentials appear above the workspace until acknowledged.
- Status member shows creation time and an outlined destructive *Hapus member* (or *Pulihkan
  member*) with the existing confirmation and navigation behaviour.
- Existing deep-link targets are preserved: `?focus=account` and `?focus=status` resolve to the
  Akun and Status member cards with the same initial-focus controls.
- Role labels and descriptions live in `memberRoles.ts` and are shared with the create form, whose
  role control now shows descriptions per role.

### Shared Select

- WAI-ARIA select-only combobox: a `button[role=combobox]` trigger named by `Field`, a wrapping
  `<label>`, `label` or `aria-label`; a portalled `listbox` with `aria-activedescendant`; options
  expose `aria-labelledby` (label) and `aria-describedby` (description and disabled reason).
- Keyboard: arrows, Home/End, PageUp/PageDown, Enter/Space, Alt+ArrowUp, Escape (focus returns to
  the trigger), Tab closes, and first-letter typeahead on short lists.
- `searchable="auto"` (default) adds a filter field above the list when there are more than eight
  options, with accent-insensitive multi-term matching across label, description, meta and hidden
  keywords, a result count and an empty state.
- Options support description, right-aligned `meta`, `disabled`, `disabledReason`, `group` and
  icon; triggers support `leadingIcon`, `sm`/`md` size, `invalid`, `required`, `name` (hidden form
  input) and pass-through `data-*` attributes (used by `data-focus-initial`).
- Empty-string values are valid options, so “Semua …” filters need no sentinels.
- Content renders above modals, is bounded to the viewport and trigger width (minimum 15 rem),
  and animates briefly only when motion is allowed. Touch pointers get 44 px targets.
- Each option carries `data-value` so unit and browser tests can commit a value exactly as they did
  with native `selectOptions`.

## Alternatives considered

- **Keep Radix Select and add a search box.** Radix Select manages focus and typeahead inside its
  content and does not support an input inside the list or empty-string values; working around
  both would fight the primitive.
- **Generalise `SearchSelect`.** It is specialised for member identity (avatars, clear option,
  member copy) and is kept for assignment pickers.
- **Style the native `<select>` only.** Native lists cannot be styled consistently and cannot show
  descriptions, metadata or search.
- **Replace the shared Henkaten export panel too.** The panel is shared with TMMIN; it was left
  unchanged to keep this change scoped to Supplier-owned screens.

## Consequences

- Supplier filters and forms present one consistent dropdown with richer option context.
- The member detail page becomes the single workspace for member profile, photo, account and
  status; saving no longer leaves it.
- Tests must use `chooseOption` helpers (`apps/supplier-web/src/test/select.ts`,
  `apps/e2e/tests/support.ts`) instead of native `selectOptions`.
- `NativeSelect` and `CompactNativeSelect` remain for TMMIN and the export panel until they are
  migrated.
- No API, contract, schema, migration or seed change.

## Validation

- UI package unit tests for the Select (Field naming, empty values, keyboard, typeahead,
  disabled options, search and empty state, groups, hidden input, axe).
- Supplier unit tests updated to the new interaction, including the member photo editor against
  the new photo panel.
- Browser journey `member-detail.spec.ts`: header, rail and role action; unsaved-state, discard and
  in-place save; MP variant; keyboard selection and accessible descriptions; filter select
  viewport bounds and focus return; axe on the page and the open list; screenshots at 1440, 1024,
  768, 390 and 320 px plus open-list states. Existing journeys that used native selects now use
  the shared helper.

## Risks and follow-up

- Very long lists (hundreds of options) render all rows; virtualisation can be added if a list
  grows beyond a few hundred entries.
- Migrate TMMIN `NativeSelect` usages and the shared Henkaten export panel in a separate change,
  then remove `NativeSelect`/`CompactNativeSelect`.
