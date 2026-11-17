# ADR 0054: Several Line Leaders per Line–Shift, admin username changes and internal part numbers

- Status: Accepted
- Date: 2026-11-17

## Context

A Line–Shift stored its Line Leader in the single column `LineShift.lineLeaderMemberId`. A partial
unique index (`LineShift_one_active_line_leader_key`) allowed a member to lead only one active
Line–Shift, and the assignment, role-change, readiness and workbook paths all enforced one leader
per Line–Shift. On real lines several leaders often share one Line–Shift, and one leader often
covers several lines of the same shift. Henkaten visibility and Withdraw for Line Leaders were
derived from that single column, and Henkaten submission resolved the occurrence from the one
Line–Shift the leader could hold.

Usernames could only be changed through the setup workbook. Correcting a misspelled or reassigned
login otherwise required a new account, which lost the account history.

Parts carried one number, the TMMIN part number, which is the key TMMIN uses for affected-part
monitoring. Suppliers also identify parts by their own internal numbers, which are not known to
TMMIN, may repeat across TMMIN numbers and must not leave the supplier.

## Decision

1. Line–Shift leadership is stored in a new table `LineShiftLineLeader` (`lineShiftId`, `memberId`,
   `position`), unique per Line–Shift and member, with at most 10 leaders per Line–Shift
   (`MAX_LINE_LEADERS_PER_LINE_SHIFT`). A member may lead any number of Line–Shifts, including
   overlapping ones. The migration backfills one row per existing leader and drops the
   one-active-Line–Shift index under the declared drop-index policy.
2. `LineShift.lineLeaderMemberId` is kept and maintained as a mirror of the first leader so that a
   compatible rollback of the application still reads a valid leader. New code reads only the
   leader table. The assignment contract replaces `lineLeaderMemberId` with `lineLeaderMemberIds`,
   and Line–Shift and board responses return `lineLeaders`.
3. All leaders of a Line–Shift are co-leaders. Line Leader Henkaten scope is the union of the
   existing responsibility rule, the legacy Shift Run leader and membership in the leader set of the
   Henkaten's Line–Shift. Co-leaders therefore see, and may withdraw, Open Henkaten submitted by one
   another. Supervisor and QC routing is unchanged.
4. Henkaten submission locks the leader's active Line–Shifts and uses the submitted `lineShiftId`.
   Without one, the single assigned Line–Shift is used; with several, the request is rejected and
   the form asks for a choice.
5. Role handover replaces the outgoing leader inside each leader set and keeps the position order.
   Readiness reports a Line–Shift without leaders and each unusable leader separately.
6. The setup workbook *Kode LL* column accepts up to 10 comma-separated member codes. Each code is
   resolved and validated separately; repeated codes in one cell are rejected.
7. Admins rename usernames through dedicated commands. The Supplier Admin renames Supervisor, Line
   Leader and QC accounts (`PATCH /members/:id/account`). The TMMIN Admin renames TMMIN Quality
   users (`PATCH /tmmin/quality-users/:id`) and the Supplier Admin of a supplier
   (`PATCH /tmmin/suppliers/:id/supplier-admin`, guarded by the supplier version). Uniqueness is
   checked per realm and supplier with an explicit conflict. The password hash, authorization epoch
   and sessions are kept, and the previous and new usernames are audited. The member account
   command previously revoked sessions on a username change; it no longer does.
8. `Part` gains an optional `internalPartNumber` with a normalized search column and a non-unique
   index. `HenkatenPart` gains `internalPartNumberSnapshot`, written at submission. Existing
   immutable `HenkatenPart` rows are not backfilled and read as having no internal number.
9. The internal number is supplier-only. Supplier part reads, searches, Henkaten views and the
   supplier export include it. TMMIN part reads use a separate schema without the field, TMMIN
   searches ignore it, and the TMMIN export, warnings and External API are unchanged. Supplier
   screens label the key *TMMIN Part Number*; TMMIN screens keep *Part Number*.
10. Part imports and the setup workbook treat a missing internal column as "keep the stored value";
    an empty cell in a present column clears it.

## Rationale

- A child table expresses many-to-many leadership directly and keeps leader order for display, while
  the mirror column keeps the previous release readable during a rollback window.
- Deriving co-leader scope from the current leader set, rather than copying leaders onto each
  Henkaten, keeps visibility in line with the current assignment.
- Keeping sessions on a rename avoids logging out a user for a cosmetic change; authorization does
  not depend on the username.
- A separate TMMIN part schema makes the privacy boundary explicit in the generated contract rather
  than relying on presenters alone.

## Consequences

- One additive migration with backfill and one declared index drop; the mirror column can be
  removed in a later migration once rollback to the single-leader release is no longer needed.
- The assignment request and Line–Shift/board responses change shape; the OpenAPI document,
  generated client, seed and browser journeys are updated accordingly.
- The single-leader occupancy and conflict checks are removed from assignment, activation, role
  change and workbook paths.
- Supplier workbooks and part files from earlier templates remain importable: *Part number* is an
  accepted alias for *TMMIN Part Number*, and the internal column is optional.
