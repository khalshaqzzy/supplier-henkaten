# ADR 0055: Delete modes, weekly shift schedules, automatic rotation and read-only cross-line visibility

- Status: Accepted
- Date: 2026-11-23

## Context

Supplier Admins could only deactivate master data. A Line with Jobs or Line–Shift assignments
could not be retired without first clearing each one by hand, and a deactivated Member, Part, Line
or Shift Template kept its registration number, username, part number or code reserved forever.

A Shift Template had a single start/end time for every day. Plants run shorter Fridays, Saturday
overtime and Sunday off days, which the template could not express. Rotating day and night crews
required a Supplier Admin to press *Tukar waktu shift* every week.

Supervisors and Line Leaders could only see Henkaten, the Assignment Board and the Overview for the
Line–Shifts they were assigned to, so they had no view of neighbouring lines. Only Supplier Admins
could edit the board layout, even though the assigned Supervisor runs the line.

## Decision

1. **Delete modes.** Lines, Jobs, Members, Parts and Shift Templates expose
   `GET …/:id/delete-preview` and `POST …/:id/delete` with `{expectedVersion, mode: ARCHIVE |
   PERMANENT}`; the dialog requires an explicit consent checkbox before either mode. *Arsipkan* deactivates the record, keeps its code reserved and can be
   reversed with *Aktifkan kembali*. *Hapus permanen* tombstones the row with `deletedAt`, removes
   it from every list and frees its code, number or username. Rows are never physically deleted:
   historical Henkaten, ShiftRun, approvals and audit keep their foreign keys (all `ON DELETE
   RESTRICT`). Partial unique indexes `… WHERE "deletedAt" IS NULL` replace the previous unique
   indexes under the declared drop-index policy, and `CHECK ("deletedAt" IS NULL OR active = false)`
   keeps tombstones inactive. Permanent delete is also available from the archive.
2. **Non-blocking Line delete.** Deleting a Line cascades: its Jobs are archived or tombstoned, its
   Line–Shifts are released and their assignments cleared. The only blocker is an **Open Henkaten**
   on the Line (or Job, Member, Part, Shift Template). The preview lists up to 20 of them with deep
   links and the dialog shows *Tutup Henkaten berikut terlebih dahulu, lalu periksa lagi* with a
   re-check button. Henkaten are never cancelled implicitly.
3. **Weekly shift schedules.** `ShiftTemplate.weeklySchedule` (JSONB, seven entries
   `{dayOfWeek 1–7, isOff, startMinute?, endMinute?}` with at least one working day) is optional;
   `null` means the same hours every day, so existing templates need no backfill.
   `startMinute`/`endMinute` remain and mirror the first working day for older readers.
   Occurrence resolution skips off days and uses each day's own hours; an overnight shift belongs to
   its start day. The manual swap copies the weekly schedule.
4. **Automatic weekly rotation.** New tables `ShiftRotationSchedule` (name, ordered
   `shiftTemplateIds UUID[]` of 2–10 distinct shifts, `dayOfWeek`, execute time, IANA `timezone`, `enabled`,
   `nextRunAt`, `version`) and `ShiftRotationExecution` (unique on `(scheduleId, scheduledForAt)`,
   `SCHEDULE | MANUAL`, `APPLIED | SKIPPED`). Each run gives shift *i* the hours of shift *i+1*
   (cyclic for three or more). An in-process worker (`SHIFT_ROTATION_ENABLED`, default `true`;
   `SHIFT_ROTATION_POLL_MS`, default 30 s) claims due schedules with `FOR UPDATE SKIP LOCKED` under
   the supplier setup mutation lock, runs a missed week once (no backfill of every missed week), and
   always moves `nextRunAt` past now. A shift may belong to only one enabled schedule. Archiving or
   deleting a member shift pauses the schedule. Runs bump Line–Shift versions, write
   `SHIFT_TIMES_ROTATED` audit (SYSTEM actor when scheduled) and the existing `SHIFT_TIMES_SWAPPED`
   Outbox event so boards and open forms refresh. *Jalankan sekarang* runs one manually.
5. **Read-only cross-line visibility.** `GET /henkatens`, the Assignment Board and the dashboard
   take `scope=ALL | ASSIGNED` (default `ALL`). Supervisors and Line Leaders read every line of
   their supplier; the UI offers *Semua line | Line saya*. Henkaten detail returns
   `permissions {assigned, canDecide, canWithdraw, canClone, canReroute}`, and the board marks each
   line `assigned`. Unassigned viewers see *Hanya lihat*. Decisions, Withdraw, Clone, Reroute, the
   approval queue (forced `ASSIGNED`), notifications and the audit activity feed stay restricted to
   assigned lines. Realtime subscriptions accept every supplier line so read-only views stay live.
6. **Board layout editing.** `SUPPLIER_BOARD_LAYOUT_MANAGE` is granted to Supervisors. The layout is
   readable by every supplier role on any active line and editable by Supplier Admin and by the
   line's assigned Supervisor or Line Leader.

## Consequences

- The migration is additive except the declared index replacements; old code keeps working against
  the new schema because it never writes `deletedAt` and the partial indexes still enforce
  uniqueness among live rows. `weeklySchedule = null` preserves current behaviour.
- New response fields `assigned` and `permissions` are optional in the contracts so the new web
  works against an older API; the UI treats a missing value as assigned (the older API only served
  assigned records and enforces actions server-side).
- Every query that lists master data or resolves codes filters `deletedAt: null`.
- The rotation worker runs in every API replica; `SKIP LOCKED` and the execution unique key keep
  runs single. Integration and browser tests disable it and drive `runDue` directly.

## Deviations from the plan

- Weekly hours live in a JSONB column rather than a per-day table, and rotation membership is a
  `UUID[]` column rather than a join table: both are always read and written as a whole and are
  validated by Zod on every write.
- There is no "last QC" blocker for Member delete; only Open Henkaten block.
- Parts keep their existing tombstone-and-restore semantics; the new delete endpoints wrap them.
- The older activate/deactivate endpoints remain for compatibility with the setup workbook.
- The dashboard activity feed stays restricted to assigned lines because it exposes actor names.
