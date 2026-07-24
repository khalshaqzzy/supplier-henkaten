# Session Handoff — Enterprise Design System dan Public `/design`

Tanggal: 2026-07-24

Branch: `staging`

Status repository: Phase 0–10 selesai; Phase 11 `in_progress`; Phase 11.1 dan 11.2 selesai

## 1. Current Objective and Outcome

Frontend Phase 11 sekarang memiliki fondasi React/Vite untuk dua identity realm serta shared Henkaten
Design System:

- `apps/supplier-web` berjalan pada dev port `5173`;
- `apps/tmmin-web` berjalan pada dev port `5174`;
- `packages/ui` menjadi runtime source bersama untuk token, primitive, domain component, composed
  pattern, dan `DesignSystemShowcase`;
- `/design` tersedia langsung tanpa login pada kedua app, dipasang sebelum future session guard,
  tidak muncul dalam product navigation, memakai sample data non-sensitif, dan menetapkan
  `noindex,nofollow`;
- root route selain `/design` tetap berupa explicit frontend-foundation placeholder. Production
  workflows dan API integration belum termasuk dalam pekerjaan ini.

`DesignSystemShowcase` memvisualisasikan seluruh token contract, public component catalog, domain
semantics, accessibility contract, usage guidance, dan delapan critical product patterns dari
`.agent/design/`.

## 2. Deep Visual Analysis dan Direction

Delapan reference image dianalisis sebagai satu enterprise UI family. Ciri yang dipertahankan:

- fixed sidebar, compact global header, canvas hampir putih, white surface, border tipis, dan
  elevation rendah;
- hierarchy page heading yang tegas, body copy ringkas, control 36 px, row 44 px, dan data density
  tinggi;
- filter bar, stat cards, dense data table, timeline, contextual right rail, readiness, dan blocker
  sebagai pola utama;
- orange terang untuk brand/current navigation/primary emphasis serta state colors yang vivid tetapi
  tidak saling mencampur;
- status selalu memiliki icon dan label selain color;
- radius kecil, motion singkat, tanpa gradient, glow, glass, oversized radius, atau decorative
  background.

Revisi visual terakhir meningkatkan fidelity dengan:

- brand accent `#FF5A1F`;
- accessible primary action `#D63F07` untuk mempertahankan white-text contrast, dengan bright
  orange tetap dipakai pada brand mark dan current navigation;
- information accent `#2F6FED`, success `#16A34A`, warning `#F59E0B`, dan danger `#F04438`;
- 4M contract tetap PRD-authoritative: Man blue, Machine green, Material amber, Method red;
- seluruh delapan pattern sekarang dirender di dalam full Supplier/TMMIN shell, bukan sebagai panel
  terisolasi.

Screenshot hanya menjadi visual input. Behavior yang tidak didukung PRD seperti Export, Save Draft,
Skills, Calendars, source approval tambahan, auto-accept, dan tooling checks tidak diwarisi.

## 3. Files dan Architecture

Frontend workspace:

- `apps/supplier-web/` — Supplier Vite app, independent root placeholder, public `/design`;
- `apps/tmmin-web/` — TMMIN Vite app, independent root placeholder, public `/design`;
- `packages/ui/` — CSS-first Tailwind v4 foundation, shadcn-compatible aliases, Radix behavior,
  Lucide, self-hosted Inter Variable, TanStack Table, Recharts, tests, dan public barrel;
- `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, dan `eslint.config.js` — workspace scripts,
  dependencies, dan typed lint coverage.

Documentation:

- `.agent/PAGES.md` — public utility route `/design` dan behavior constraint;
- `.agent/implementationPhases.md` — Phase 11 `in_progress`, 11.1/11.2 completed, 11.3 next;
- `docs/adr/0021-shared-enterprise-design-system-and-public-showcase.md` — shared design-system
  architecture dan permanent public showcase decision;
- `.agent/sessionHandoff.md` — current implementation evidence.

Tidak ada backend API, OpenAPI operation, shared domain schema, database, atau migration yang
diubah. Reference image di `.agent/design/` tidak disalin ke public bundle. Existing `.DS_Store`
tetap merupakan perubahan milik pengguna.

## 4. Token dan Component Coverage

CSS runtime token dan typed metadata memakai prefix `--hds-*`, meliputi:

- raw neutral/orange, semantic surface/text/border/action;
- neutral/info/success/warning/danger serta Hosted/External source;
- lifecycle, approval, assignment, freshness, realtime, Shift, source, 4M, dan chart roles;
- typography, spacing, control height, density, radius, elevation, focus, motion, layering, dan
  breakpoints.

Public components mencakup:

- actions, fields, selection, date, navigation, feedback, overlays, and failure states;
- card, panel, stat, table, chart, timeline, stepper, accordion, and activity patterns;
- 4M, source, Henkaten status, approval, assignment, freshness, realtime, people, filters,
  readiness, blockers, one-time secret, form error, dan last-updated semantics.

Controlled/uncontrolled behavior, loading/duplicate-submit prevention, keyboard navigation, Escape,
focus containment/return, reduced motion, and accessible label/error association diuji pada shared
package.

## 5. `/design` Sections dan Product Proof

Long-form showcase menyediakan anchor navigation untuk:

1. Overview dan context/density controls;
2. raw/semantic/domain tokens;
3. live component state matrices;
4. domain semantics;
5. Supplier Overview;
6. Assignment Board;
7. Create Man Henkaten;
8. Henkaten Detail/Approval;
9. Blocked Shift Preflight;
10. Default Assignment + Atomic Move;
11. TMMIN Global Overview;
12. Source Governance;
13. accessibility contract;
14. guidelines dan public coverage report.

Seluruh angka dan identity dalam pattern diberi label `Sample data` dan tidak merepresentasikan
operasi aktual.

## 6. Validation Evidence

Runtime validation dilakukan dengan Node.js `22.23.1` dan pnpm `11.16.0`:

- `pnpm install --frozen-lockfile` — passed;
- `pnpm validate` — passed:
  - runtime check;
  - Prettier check;
  - ESLint;
  - workspace typecheck;
  - 57 unit tests total, termasuk 14 shared UI tests;
  - OpenAPI freeze check;
  - full workspace build;
- shared UI tests mencakup controlled selection, switch, pagination boundary, loading
  `aria-busy`, duplicate-submit prevention, label/error association, tabs arrow keys, menu/dialog
  Escape, focus return, domain mapping, token scans, reduced motion, dan automated axe scan tanpa
  blocking violation.

Browser evidence:

- direct unauthenticated `/design` access berhasil pada Supplier dan TMMIN;
- latest 1440×900 visual audit memastikan full shell fidelity, `noindex,nofollow`, bright token
  output, dan tidak ada page-level horizontal overflow;
- documentation layout telah diaudit pada 1280×720, 768, dan 390 widths; wide product canvases
  mempertahankan desktop specimen melalui container-local scrolling;
- visible 2 px blue focus ring dengan 2 px offset, tabs/menu/dialog keyboard behavior, overlay
  layering, standard motion, dan reduced-motion mode diperiksa;
- source inspection memastikan `/design` tidak memanggil session/API bootstrap.

Build menghasilkan warning non-blocking bahwa lazy-loaded showcase chunk melebihi 500 kB. Route
tersebut sudah dipisahkan dari root product bundle dengan dynamic import; further section-level
splitting dapat dilakukan bila download budget untuk utility route ditetapkan.

## 7. Known Gaps dan Non-goals

- Phase 11.3 typed API client belum dibuat.
- Session bootstrap, CSRF client, forced reset, route guards, dan product workflows masih planned.
- Delapan composed specimens adalah implementation proof untuk design system, bukan production
  feature pages.
- Light theme saja; dark theme tidak memiliki source reference.
- Product UI tetap desktop minimum 1280 px. Responsive support pada task ini ditujukan untuk
  dokumentasi `/design`.
- API contract gaps tetap berada di `.agent/PAGES.md`; frontend tidak menyimulasikan missing policy
  dengan client-only logic.

## 8. Next Recommended Action

Mulai Phase 11.3:

1. generate request/response types dari shared Zod/OpenAPI contract;
2. implement shared fetch boundary untuk cookies, CSRF, correlation ID, problem details, cursor,
   upload, dan SSE;
3. lanjutkan Phase 11.4 realm-specific session bootstrap dan route guards;
4. pertahankan `/design` di luar session boundary;
5. gunakan shared component catalog dan product specimens sebagai rujukan implementasi Phase 12–14.
