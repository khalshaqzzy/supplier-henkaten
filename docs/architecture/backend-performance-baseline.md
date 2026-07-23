# Backend Performance Baseline

## Purpose and Boundary

This is the preliminary backend/frontend-readiness baseline. It measures the NestJS HTTP boundary
against Docker PostgreSQL 18.4 with pgvector 0.8.5 on the local Darwin arm64 development runtime,
Node.js 22.23.1, and pnpm 11.16.0.

It is not final staging concurrency certification. The later release load gate must still exercise
30 concurrent users per supplier, approval races, board/warning propagation, and staging-like VM
resources.

## Repeatable Profile

Run only against a freshly migrated disposable test database:

```text
pnpm db:up
pnpm db:wait
pnpm db:test:reset
pnpm db:test:migrate
NODE_ENV=test DATABASE_URL=<disposable _test database> ... pnpm test:baseline
pnpm db:down
```

The test refuses a non-`_test` database or a database that already contains suppliers.

Seed:

| Dimension | Value |
|---|---:|
| Suppliers | 42 |
| Lines per supplier | 20 |
| Members per supplier | 300 |
| Jobs per supplier | 500 |
| Current External projections per supplier | 500 |
| Permanent audit rows per supplier | 1,000 |

Each HTTP workload has three warmup calls. Reads/ingestion use 30 measured samples; standard
mutation uses 20. Unexpected HTTP status is an error.

## Measured Results

Local run on 2026-07-23:

| Workload | Samples | p50 | p95 | p99 | Max | Target p95 | Error rate |
|---|---:|---:|---:|---:|---:|---:|---:|
| TMMIN dashboard | 30 | 19.59 ms | 22.16 ms | 36.29 ms | 36.29 ms | 3,000 ms | 0% |
| External projection list | 30 | 2.16 ms | 2.81 ms | 2.91 ms | 2.91 ms | 2,000 ms | 0% |
| TMMIN audit list | 30 | 9.21 ms | 11.74 ms | 12.00 ms | 12.00 ms | 2,000 ms | 0% |
| Notification list | 30 | 1.08 ms | 1.87 ms | 2.12 ms | 2.12 ms | 2,000 ms | 0% |
| Standard audited mutation | 20 | 2.51 ms | 3.36 ms | 4.89 ms | 4.89 ms | 3,000 ms | 0% |
| External single ingest | 30 | 4.44 ms | 5.42 ms | 6.04 ms | 6.04 ms | 2,000 ms | 0% |

All preliminary server-boundary targets pass with substantial local headroom. Functional approval,
MP movement, warning, outbox, and board propagation behavior is covered by the PostgreSQL
integration suite; concurrent load certification remains a release gate.

## Query-plan Evidence

After `ANALYZE`, the bounded high-cardinality reads use:

| Query | Plan |
|---|---|
| Active jobs for one line | Index-only scan on `Job_supplierId_lineId_active_displayOrder_id_idx` |
| Active members for one supplier | Index-only scan on `Member_supplierId_active_fullName_id_idx` |
| External projections in cursor order | Index-only scan on `ExternalHenkatenProjection_supplierId_updatedAt_id_idx` |
| Supplier audit in cursor order | Index-only scan on `AuditEvent_supplierId_occurredAt_id_idx` |

Migration 008 also adds `(supplierId, occurredAt, id)` for outbox/SSE cursor recovery. The indexes
include deterministic ID tie-breakers used by pagination. Direct PostgreSQL aggregation remains
adequate; no N+1 client loading, cache, or materialized view is required.

## Interpretation

- Dashboard cost grows with global current projections and freshness rows, but its measured p95 is
  far below target at the accepted supplier/master-data capacity and deeper monitoring history.
- Audit pagination stays bounded and index-only despite 42,000 permanent audit rows.
- External ingestion includes bearer lookup, validation, serializable transaction, immutable raw
  event, projection, warning, audit, outbox, and HTTP serialization.
- The baseline measures sequential latency, not maximum throughput or saturation.
- Results must be re-captured when query shape, indexes, PostgreSQL version, or deployment resources
  materially change.
