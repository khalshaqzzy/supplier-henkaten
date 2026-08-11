# Session Handoff — Member Photo and Board Risk Actions

Date: 2026-08-11

Branch: `staging`

Status: member-photo management and polished Assignment Board risk actions are implementation- and
local-verification-complete in the working tree. Phase 15.9 remains `in_progress`; no hosted staging
deploy, real-device push, or Phase 16 UAT claim has been made.

## 1. Objective and Locked Decisions

- Complete optional member-photo management in Supplier Master Data with preview, set/replace,
  removal, validation, optimistic concurrency, and reliable cache refresh.
- Keep `/board` read-only for photos. Supplier Admin remains the only role with master-data mutation
  capability; other Supplier roles only consume photo/avatar output.
- Present actionable Assignment Issues and Open Man reservations as polished, accessible buttons
  linking to the existing authoritative resolution and Henkaten routes.
- Do not add an endpoint, table, migration, or new lifecycle authority.

## 2. Implementation Completed

- Member responses and board thumbnail URLs now include a monotonically increasing `?v=` token.
  Photo upload locks the member row, derives the next generation across current/superseded/deleted
  records, and preserves a single `CURRENT` photo.
- Replacement compares normalized full and thumbnail checksums under the member lock. An identical
  file is rejected as `STATE_CONFLICT` instead of creating a misleading new generation, while the
  successful upload response is written into the detail query cache before dependent refetches.
- Assignment Board `version` and `lastUpdatedAt` now include the effective MP photo generation, so
  downstream consumers can observe a photo-only read-model change.
- Upload, replacement, removal, and cleanup remain transactional/audited. A non-PII
  `MEMBER_PHOTO_CHANGED` outbox event is emitted for every successful change so an open board is
  invalidated even on the first upload; cleanup remains a separate event.
- The typed client removal operation now sends `expectedVersion` and accepts the endpoint's `204`
  response.
- Supplier Master Data provides a thumbnail/initials preview, contextual Set/Ganti Foto control,
  client-side type/size feedback, loading and success/error states, confirmed optimistic removal,
  repeat-file selection, list thumbnails, and member/list/board query invalidation.
- Board risks no longer create a duplicate dead-end row from generic `RESERVED` state. Vacancy and
  conflict rows expose primary `Buka resolusi`; Open Man reservations expose secondary
  `Buka Henkaten`.
- Board risk actions use design-system treatment, icons with clean accessible names, responsive
  grid layout, visible focus behavior, and 44 px mobile targets. Mobile board toolbar constraints
  were corrected to eliminate horizontal overflow at 390 px.

## 3. Contracts and Data

- No database migration and no public endpoint were added.
- Existing photo URL fields remain strings; their values now carry the cache generation query.
- Internal client signature: `removeMemberPhoto(id, expectedVersion): Promise<void>`.
- Internal outbox event: `MEMBER_PHOTO_CHANGED`, scoped by supplier/member and containing only the
  opaque member ID.
- OpenAPI and generated client checks remain clean without regeneration diff.

## 4. Verification Completed Locally

- API client unit: 11/11.
- Supplier web unit/component: 39/39, including file validation, repeated upload, preview/removal,
  route/class checks, and reserved-row deduplication.
- Targeted PostgreSQL integration after fresh 10-migration deploy: 19/19, including first upload,
  distinct replacement, identical-replacement rejection, stale/current removal, monotonic restore,
  single-current invariant, event count, versioned board thumbnail, and initials fallback.
- Relevant API/API-client/Supplier TypeScript checks pass; OpenAPI check passes.
- Full repository formatting, lint, TypeScript, 165 unit tests, OpenAPI/generated-client check,
  production builds, and `git diff --check` pass. Frontend builds used the required explicit
  production API origin.
- All 38 API integration tests and all 6 isolated Chromium/Edge E2E runs pass. Deployment
  validation/harness, migration destructive check, actionlint, ShellCheck, Hadolint, Ubuntu
  bootstrap validation, Gitleaks, production-like container routing, and Trivy filesystem/image
  scans pass.
- New high-severity transitive advisories discovered during the pre-commit audit were resolved by
  pinning `js-yaml` 4.3.1 and `nanoid` 3.3.17; `pnpm audit --audit-level high` passes with only the
  repository's existing explicit exception remaining ignored.
- Browser inspection against the worktree confirms one primary resolution CTA and one secondary
  Henkaten CTA in seeded data, no console error on board, zero horizontal overflow, and 44 px CTA
  height at 390×844. Member photo detail confirms Set and Ganti/Hapus states, versioned thumbnail,
  96 px mobile preview, 44 px actions, and zero overflow.
- Agent-started API/Vite preview processes were stopped. Existing local Compose containers predated
  this session and were deliberately left running.

## 5. Remaining Release Work

1. Complete Phase 15.9/15.11 hosted staging baseline and stable staging VAPID provisioning.
2. Execute Android Chrome/Edge and iPhone/iPad Home Screen real-device push rehearsal, deployed
   cache-header validation, redeploy/rollback, and Supplier Line Leader acceptance.
3. Start Phase 16 UAT only after all staging launch gates pass.

## 6. Operational Boundaries

- Member photos and registration data remain private Hosted data and are never cached by the PWA or
  sent through External API.
- Photo event/audit payloads must not contain image bytes, paths, registration numbers, names, or
  credentials.
- Existing no-backup/no-PITR/no-HA and automatic production deployment risks remain unchanged.
