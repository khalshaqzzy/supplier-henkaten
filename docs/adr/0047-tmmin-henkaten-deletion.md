# ADR 0047: TMMIN Henkaten deletion with internal historical retention

Status: Accepted
Date: 2026-10-09

## Context

Withdraw cancels an Open Hosted record and preserves it in operational history. TMMIN monitoring
requires a separate removal action for individual records and all records of one supplier. Both
TMMIN Admin and TMMIN Quality require this action for every lifecycle status, both source modes,
and historical source epochs. Existing PostgreSQL triggers prohibit physical deletion and terminal
updates, while read models, notifications, exports and External ingestion independently expose
record evidence. A list-only filter would therefore be insufficient.

## Decision

Deletion is an irreversible visibility change with internal historical retention. The existing
business status, checklist, decisions, PCR, movement and other evidence remain stored. No Cancelled
transition is generated. No restore action or user-facing archive is provided. Both TMMIN roles
receive a dedicated deletion capability; Supplier roles receive none. Removal applies to active
and inactive suppliers and every retained source epoch.

Current effective MP placement is preserved when a Man record is removed, including Approved
records. Internal occurrence assignment calculation may still use retained change evidence, but
record indicators and links must disappear. Ordinary subsequent assignment changes and the next
recurrence keep their existing rules. Deletion must not invoke Withdraw or assignment restoration.

## Implementation plan

1. Add one-way deletion metadata to Hosted Henkaten and External projections, plus visibility
   metadata for associated warning, PCR, ingestion, notification, outbox and audit records.
   Preserve all existing foreign keys and payloads. Add an immutable deletion-command receipt,
   bound to supplier, authenticated actor, idempotency key and canonical request digest.
2. Extend database guards to permit only deletion metadata on terminal Henkaten. Evidence and
   audit content remain immutable; audit suppression metadata is one-way. Deletion metadata may
   neither be cleared nor combined with evidence/business-status changes. Fresh and upgrade
   migrations must not delete data or disable triggers.
3. Expose a supplier-wide deletion preview, an individual DELETE for Hosted/External, and a
   supplier-wide DELETE. Require a reason, an individual expected version, a bulk preview revision
   and the supplier code for bulk confirmation. The preview reports Hosted/External/total counts
   and a deterministic revision of visible IDs and versions across all epochs.
4. Revalidate TMMIN authority at the mutation boundary and lock Supplier, matching other operational
   writers. Under a serializable transaction, check receipt before mutable preconditions, reject
   key reuse with different input, verify version/revision, suppress the selected aggregate and
   related user-facing evidence, and append a minimal deletion audit and invalidation event.
   An exact retry returns the original receipt without deleting newly submitted records.
5. Apply visibility checks to individual reads, lists, history, clone links, approval/PCR writes,
   dashboards/counts/trends, warning groups, board indicators, recent activity, audit, notifications,
   External health/projection reads and setup/source-governance blockers. Submission retries for
   removed aggregates must not re-expose or recreate them. Clones that survive deletion of their
   source must not expose a link to that source.
6. Reject new updates to a deleted External identity within its source epoch; retain ordering and
   idempotency evidence internally. Serialize notification creation and PCR completion with
   deletion, suppress pending outbox/push work, and filter realtime replay. Already delivered OS
   notifications and user-downloaded files cannot be recalled, but their application links must
   resolve to unavailable records.
7. Invalidate previous export jobs for the supplier. Running export publication and file access
   must recheck invalidation so a pre-deletion snapshot cannot become downloadable afterward.
   New exports exclude removed records and removed clone-source identifiers. Temporary invalidated
   artifacts are removed through existing expiry cleanup.
8. Add a reusable TMMIN deletion dialog using existing tokens/components. Individual detail has
   a secondary destructive action, identifier/context, required reason and explicit confirmation.
   Supplier detail exposes a separated Henkaten action panel for both roles, with a preview count,
   required supplier-code entry and reason. Keep the dialog open on failure, prevent double submit,
   preserve the same payload/key while outcome is uncertain, and refresh stale previews before
   reconfirmation. Show truthful loading and concise success feedback; remove stale detail cache
   and return to the filtered Explorer after individual success.
9. Validate responsive layouts, keyboard/focus handling, screen-reader errors, contrast and reduced
   motion. Test destructive flows on Chromium and Edge, including the Quality supplier detail,
   unavailable deleted deep links, empty supplier data and the supplier boundary.
10. Update PRD, handoff and roadmap; regenerate contracts/OpenAPI/client; run the repository's clean
    CI parity, fresh/upgrade migration, seed compatibility, browser and security/deployment gates.
    Commit to the feature branch, push and create a comprehensive PR targeting main. Do not merge
    or deploy as part of delivery; verify required remote checks before claiming completion.

## Rationale and alternatives

Visibility deletion satisfies removal from normal application use while preserving internal
historical evidence and existing restrictive foreign keys. Physical purge was not selected.
Changing status to Cancelled was rejected because it misrepresents deletion and would restore Man
assignment. UI-only hiding was rejected because it leaves direct APIs, warnings and exports visible.
Returning success without an idempotent receipt was rejected because a lost bulk response followed
by retry could remove records created after the initial operation.

## Consequences and risks

All user-facing readers and derived counts need a consistent visibility boundary. Internal retained
rows must remain available only to explicitly internal paths. Permanent retention remains valid
internally, but the earlier prohibition on TMMIN removal from the application is superseded.
Maintaining effective MP while hiding Man records requires separating board indicators from
assignment state. Background workers and export snapshots require write-boundary checks, not
only query filters. Removal does not erase third-party deliveries or locally downloaded copies.

## Validation and follow-up

Integration coverage must prove both TMMIN roles, Supplier denial, all statuses and epochs, Hosted
and External, preserved status/evidence/MP, hidden details and every derived surface, stale preview,
version conflicts, exact/conflicting retries, concurrent submission/approval/ingestion, late PCR
and notification work, surviving clone behavior, export invalidation and one-way database guards.
Seed fixtures remain compatible with nullable metadata; a fresh seed smoke is still required.
Implementation evidence and exact command results will be recorded in the session handoff.

Implementation validation covers both TMMIN roles and all Hosted statuses; External Approved/Open
browser deletion and retained ordering; mixed source/epoch bulk removal; supplier isolation;
unchanged operational MP context; one-way database guards; stale revisions and versions;
concurrent exact retries/submission; hidden dashboard, warnings, audit and board evidence;
late notification replay and leased PCR completion; surviving clone source-link suppression;
owned export status/download invalidation; and responsive keyboard/axe browser flows.

Release parity also refreshes the security baseline: sharp 0.35.5, proxy-addr 2.0.8 and source-map-js
1.2.2 address newly reported advisories. Frontend runtime packages require pcre2 >=10.49-r0 and
libtiff >=4.7.2-r0. The expired CVE-2026-14456 exception is removed: the current
[Debian tracker](https://security-tracker.debian.org/tracker/CVE-2026-14456) marks bookworm unaffected
because the vulnerable QUIC server code was introduced in OpenSSL 3.5. Existing exact, unexpired
exceptions remain scoped and are validated. No scanner severity or coverage is relaxed.

Local check results and delivery details are recorded in the session handoff. Staging/device UAT
and governance gates remain separate from implementation verification. Bulk deletion retains
supplier locking and a bounded 60-second transaction timeout; exceptionally large suppliers may
need measured batching or an asynchronous operation in future. No application undo is available.
