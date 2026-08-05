# 0028 Supplier PWA Worker, Cache, and Update Policy

Status: Accepted

Date: 2026-08-05

## Context

Supplier users need an installable application and Web Push, but Henkaten data, member photos,
session responses, forms, and mutations must not persist offline. A generated worker would split
push and cache behavior across opaque code and make security regression testing harder.

## Decision

Supplier web uses Vite PWA `injectManifest` with one custom TypeScript service worker. The manifest
has stable root ID/scope/start URL, standalone display, brand theme/background, 192/512/maskable
icons, and an Apple touch icon. The precache contains only hashed JS/CSS/fonts, icons, and the
offline status document. Navigation is network-first with the offline document as fallback.

All `/api/**`, session/auth responses, member-photo paths, manifest, worker, cross-origin requests,
and non-GET requests bypass runtime caching. There is no IndexedDB domain store, offline draft,
background sync, or queued mutation. Existing mutation-uncertain handling remains authoritative.

A ready worker update is shown to the user. `skipWaiting` is sent only after explicit activation,
so an active form or mutation is not interrupted. HTML, manifest, worker, and release identity use
non-stale cache headers; hashed assets use one-year immutable caching. CSP permits only same-origin
workers/manifests. A click target is accepted only when it is a relative same-origin path and still
passes normal login/capability checks.

## Consequences

Offline use communicates status and retry but cannot read or mutate domain data. Installation does
not imply push permission. A broken/stale worker is recoverable by disabling push, unregistering
the worker/site data, and reloading online; server Notification state is unaffected.

## Alternatives Considered

- `generateSW`: rejected because custom push, click, cache-exclusion, and update rules need one
  inspectable worker.
- Offline domain cache/drafts: rejected because of PII, stale decisions, and mutation ambiguity.
- Immediate worker activation: rejected because it can interrupt active workflows.

## Validation

Production build verifies manifest and worker generation. Unit/E2E and deployment smoke verify
cache exclusions, offline fallback, installability, update prompting, safe deep links, icons,
release identity, CSP, and cache headers.
