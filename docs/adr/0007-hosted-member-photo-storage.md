# 0007 Hosted Member Photo Storage

Status: Accepted

Date: 2026-07-23

Scope: Hosted member photo ingestion, processing, private storage, and delivery

## Context

Hosted supplier boards may display an optional member photo. External supplier payloads must never
send photos. The selected single-VM topology has a persistent local volume but no object storage or
backup service.

## Decision

Hosted member photos accept JPG, PNG, or WebP input up to 2 MB. The server validates both declared
MIME and file signature, rejects animated or unsupported input, limits decoded pixels, applies
orientation, strips metadata, and writes normalized WebP derivatives using Sharp.

The storage adapter writes a bounded full-size image and a thumbnail under a server-generated
tenant/member/version path. Client filenames are not used. Writes use a temporary file followed by
an atomic rename. Database metadata is committed only after processing succeeds; replacement and
cleanup follow an explicitly recoverable sequence.

The photo volume is private. Files are served through an authenticated, tenant-authorized API and
are never mounted as public static content. Photos are unavailable in External API contracts.

## Rationale

Normalization removes metadata and reduces format-specific attack surface. Server-generated paths
prevent traversal and filename disclosure. An authenticated API preserves tenant isolation.
Persistent local storage matches the selected v1 topology.

## Alternatives Considered

- **Store originals unchanged:** rejected because metadata and malicious file structure would be
  retained.
- **Store binary data in PostgreSQL:** rejected because it increases database size and backup would
  still be unavailable.
- **Public Caddy volume:** rejected because authorization would be difficult to enforce safely.
- **Managed object storage:** deferred because it is out of scope for v1.
- **Accept photos from External suppliers:** rejected by the PII-minimization policy.

## Implementation Details

The decoded image limit is 25 megapixels. Full derivatives are WebP within 1024 by 1024 pixels
without enlargement at quality 82. Thumbnails are center-cropped 256 by 256 WebP at quality 80.
Paths contain opaque UUIDs only. Authorization is based on database metadata, never
the path supplied by a caller. Responses use a fixed safe content type, private cache policy, ETag,
and `X-Content-Type-Options: nosniff`.

## Consequences

The API performs image processing and authenticated delivery. The VM photo volume is a permanent
data dependency but a single point of failure. Photo loss cannot be recovered under the accepted v1
posture.

## Validation Plan

- Valid JPG/PNG/WebP processing tests.
- Signature/MIME mismatch, oversized, animated, malformed, and decompression-bomb tests.
- Metadata-removal and derivative-dimension tests.
- Cross-tenant and inactive-member authorization tests.
- Atomic replacement/failure cleanup tests.

## Risks

- Native Sharp/libvips packaging must match container architecture.
- Crafted images can consume CPU or memory without decoded-pixel limits.
- Disk exhaustion can interrupt writes and application operation.
- There is no photo backup or restore mechanism.

## Validation Evidence

Sharp processing, private authenticated delivery, signature/MIME checks, bounded decode,
transactional metadata replacement, and idempotent outbox cleanup are implemented and exercised by
integration tests.

## Follow-up

Production containers must mount the configured photo root as a private persistent volume.
