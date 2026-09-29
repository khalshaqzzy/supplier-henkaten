# ADR 0043 — Hosted Henkaten Excel export

Date: 2026-09-29
Status: Accepted

## Context

Supplier Admin needs a complete, portable Henkaten trace for analysis and audit. TMMIN Admin needs the same capability from supplier detail. A synchronous HTTP export would hold a request open while reading a potentially large supplier history. The source mode may change, but this feature covers Hosted records only.

## Decision

- A durable PostgreSQL job stores requester, supplier, filters, progress, state, and one-hour expiry. A single API worker reads jobs and writes XLSX to the private file volume. Partial files are renamed only after workbook completion; expired files and jobs are removed.
- Supplier Admin and TMMIN Admin can request jobs. Status and download are restricted to the same user and realm that requested them. Supplier access also checks active Hosted mode and source epoch on each request. An impersonated Supplier Admin session records the initiating TMMIN operator in the audit entry.
- The record query is tenant scoped, filters `sourceMode = HOSTED`, and reads a repeatable snapshot in batches. The export supports all available Hosted history by default and splits data tabs at Excel's row limit.
- The workbook has `Ringkasan`, `Henkaten`, `Approval`, `Checklist`, and `Riwayat` tabs. The Henkaten identifier joins them. The summary uses styled cells as compact bar graphics; streaming XLSX output avoids holding full history in memory. Labels are brief and do not explain procedures.
- The Supplier Master Data and TMMIN supplier detail buttons open a shared filter sheet. The UI reflects queued, running, ready, and failed states, persists the current job ID per user in session storage, and shows a download action when ready.

## Consequences

ExcelJS and a forward-only job migration are required. The export directory uses private application storage and the existing persistent photo volume in Compose. Generation is serial per API process; the queue and job metadata survive restarts. Staging acceptance must check storage capacity and multi-instance worker coordination before scaling API replicas.

## Validation and follow-up

The fresh and previous-release upgrade paths applied the job migration. Integration tests read a generated workbook, verified traceability tabs and styling, and exercised Supplier/TMMIN authorization. The local full-stack reseed produced 240 Hosted records; browser smoke exported and downloaded 120 records for one supplier. Chromium visual checks covered desktop and mobile sheet layouts. Local CI parity and security results are recorded in the current session handoff. Staging UAT should exercise a larger history and review export storage retention and capacity before a production rollout.
