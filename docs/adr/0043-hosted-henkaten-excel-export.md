# ADR 0043 — Hosted Henkaten Excel export

Date: 2026-09-29
Status: Accepted

## Context

Supplier Admin needs a complete, portable Henkaten trace for analysis and audit. TMMIN Admin needs the same capability from supplier detail. A synchronous HTTP export would hold a request open while reading a potentially large supplier history. The source mode may change, but this feature covers Hosted records only.

## Decision

- A durable PostgreSQL job stores requester, supplier, filters, progress, state, and one-hour expiry. A single API worker reads jobs and writes XLSX to the private file volume. Partial files are renamed only after workbook completion; expired files and jobs are removed.
- Supplier Admin and TMMIN Admin can request jobs. Status and download are restricted to the same user and realm that requested them. Supplier access also checks active Hosted mode and source epoch on each request. An impersonated Supplier Admin session records the initiating TMMIN operator in the audit entry.
- The record query is tenant scoped, filters `sourceMode = HOSTED`, and reads a repeatable snapshot in batches. The API supports all available Hosted history when dates are absent and splits data tabs at Excel's row limit.
- The workbook has `Ringkasan`, `Henkaten`, `Approval`, `Checklist`, and `Riwayat` tabs. The Henkaten identifier joins them. The summary has KPI cards, six editable native Excel charts for status, 4M, Top 10 Line split by status, a maximum of 12 calendar months split by 4M, Top 10 Part, and PCR distribution, plus visible source tables. It also shows pending Supervisor/QC counts. The earlier styled-cell bars were replaced because they lacked chart axes and clear category labels. Detail tabs still stream to disk without holding full history in memory. A bounded OOXML ZIP pass adds chart and drawing parts after the streaming writer commits and before the private file is atomically published. Labels are brief and do not explain procedures.
- The six visuals answer separate operational questions: current lifecycle balance, source category, concentration by Line and Part, change over time, and PCR disposition. Stacked Line and month charts retain the mix behind each total. Every chart reads labeled cells on `Ringkasan`; source rows retain full names while chart labels shorten long identifiers for legibility. Charts use counts because the export does not contain a stable denominator for incident rates or a target threshold for performance scoring.
- The Supplier Master Data and TMMIN supplier detail buttons open a shared filter sheet. Its default dates span one calendar month back through the current supplier-local business date; an explicit all-period action preserves full-history export. The UI reflects queued, running, ready, and failed states, persists the current job ID per user in session storage, and shows a download action when ready.

## Consequences

ExcelJS, streaming ZIP readers/writers, and a forward-only job migration are required. Native chart injection adds temporary disk use during the ZIP pass; both intermediate files are removed on success or failure. The export directory uses private application storage and the existing persistent photo volume in Compose. Generation is serial per API process; the queue and job metadata survive restarts. Staging acceptance must check storage capacity and multi-instance worker coordination before scaling API replicas.

## Validation and follow-up

The fresh and previous-release upgrade paths applied the job migration. Integration tests read a generated workbook, verified traceability tabs and styling, and exercised Supplier/TMMIN authorization. The summary update adds checks for total reconciliation and six native chart parts; a generated workbook was opened in Microsoft Excel without repair prompts. The local full-stack reseed produced 240 Hosted records; browser smoke exported and downloaded 120 records for one supplier. Chromium visual checks covered desktop and mobile sheet layouts. Local CI parity and security results are recorded in the current session handoff. Staging UAT should exercise a larger history and review export storage retention, temporary ZIP capacity, and chart editing in an activated Excel installation before a production rollout.
