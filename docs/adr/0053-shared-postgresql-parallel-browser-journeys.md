# ADR 0053: Template-cloned databases, parallel workers and Chromium-only browser journeys

- Status: Accepted
- Date: 2026-11-16
- Amends: ADR 0026 (browser journey runtime and browser coverage)

## Context

The browser journey job determined the duration of the whole pipeline: about 20 minutes, while
every other job finished in under five. A measured pull-request run executed 24 journeys in
sequence (13 specifications in Chromium and 11 of the same specifications again in Microsoft
Edge). Of 1,078 seconds spent on journeys, only 400 were test execution. The remaining 63% was
fixed setup repeated for every journey, about 28 seconds each:

- a new PostgreSQL container, network and volume (about 6 s);
- all migrations and the operator bootstrap (about 5 s);
- a full Supplier web build including a type check (about 12 s, of which bundling took 1.4 s);
- starting the API and both web servers (about 5 s).

ADR 0026 specified Edge coverage as a small set of tagged critical smoke journeys. Over time the
`@edge` tag was applied to 11 of 13 specifications, so Edge repeated almost the entire suite and
accounted for 45% of journey time. Edge and Chrome share the Chromium engine; the suite contains no
Edge-specific step or assertion, and no Edge-only failure had been recorded.

Locally the sequential runner could also remain alive after all journeys had passed: a package
manager shim re-launched itself, the runner signalled only the outer process, and the orphaned
inner processes kept the runner's output pipes open.

## Decision

1. **One PostgreSQL per run.** The runner starts a single disposable PostgreSQL/pgvector container,
   applies migrations and the operator bootstrap once to the Compose database, and treats that
   database as a template. Each journey receives its own database created with
   `CREATE DATABASE … TEMPLATE …` and dropped afterwards.
2. **Web applications are built once per worker.** Each worker allocates its ports once, builds the
   Supplier and TMMIN bundles once for its API origin into a private output directory, and serves
   both with `vite preview` for all of its journeys. The type check is not repeated; it belongs to
   the quality job.
3. **The API is restarted per journey** with the journey's database, storage root and release
   identity, so in-memory limiters and realtime state never carry over.
4. **Parallel workers and shards.** `--workers=<n>` (or `E2E_WORKERS`) runs journeys on parallel
   workers that pull from a shared queue. `--shard=<index>/<total>` (or `E2E_SHARD`) selects a
   deterministic slice so separate machines can split the suite. Locally the default is half of the
   available cores, capped at four. The pipeline runs three shards with two workers each.
5. **Chromium is the automated browser.** Automated Edge journeys are deferred: the pipeline
   installs and runs Chromium only. The `msedge` Playwright project and the `@edge` tags are kept,
   and `pnpm test:e2e:edge` or `--edge` runs the Edge smoke set on demand.
6. **Process groups.** Every child process is started in its own process group and stopped by
   signalling the group; the runner exits explicitly after cleanup.

## Rationale

- Cloning a template database is a file copy inside PostgreSQL and takes well under a second,
  while giving each journey the same guarantee as before: a database that contains only migrations
  and the bootstrap identity and that no other journey can see.
- The API origin is compiled into the web bundles. Keeping a worker's ports stable for its whole
  lifetime makes one build per worker sufficient; with a single worker this is one build per run.
- Serving the TMMIN application from a production build instead of the development server removes
  the dependency-optimisation cache that parallel development servers would share, and exercises
  the same artefact type as deployment.
- A shared queue balances uneven journey durations between local workers without configuration.
  Shards order journeys by specification size (a stable proxy for duration) and take every n-th
  journey, which spreads long journeys across shards and needs no stored timing data.
- Running identical specifications in a second Chromium-based browser doubles cost for little
  additional defect detection. Supported-browser acceptance for Edge and for mobile devices remains
  a staging device rehearsal, which automated desktop journeys never replaced.

## Alternatives considered

- **Keep one container per journey and only parallelise.** Simple, but each parallel journey would
  still pay container start, migrations and bootstrap, and many concurrent containers contend for
  disk and memory.
- **Schemas instead of databases.** Requires schema-qualified connections throughout Prisma and the
  raw SQL, and extensions/enums are database-level.
- **Truncate tables between journeys in one database.** Prevents parallel journeys and conflicts
  with the database triggers that make Henkaten evidence immutable.
- **Runtime-configured API origin.** Would allow one build for all workers but changes how the
  production applications read their configuration; a per-worker build costs a few seconds once.
- **Playwright's own `--shard`/`workers`.** Playwright cannot provision an isolated API and
  database per test file, which the journeys rely on.
- **Edge smoke on protected branches only.** Keeps some automated Edge signal, but still requires
  installing a second browser and maintaining a tagged subset; deferred until an Edge-specific
  risk is identified.

## Implementation

- `apps/e2e/scripts/plan.mjs`: option parsing and journey planning (coverage, ordering, shards),
  covered by `scripts/e2e-plan.test.mjs`.
- `apps/e2e/scripts/run.mjs`: asynchronous runner with the shared PostgreSQL, template cloning with
  a short retry (a template cannot be copied while another copy is starting), per-worker builds and
  web servers, per-journey API, grouped process termination, prefixed output per worker and
  journey, a `PASS`/`FAIL` line with duration per journey and a final summary line.
- A failing journey stops workers from taking further journeys; running journeys finish, and the
  run exits non-zero.
- Journey indexes are assigned before sharding, so database names, report folders and release
  identities are unique across shards and workers.
- `.github/workflows/ci.yml`: `browser-e2e` is a three-way matrix (`E2E_SHARD`, `E2E_WORKERS=2`),
  installs Chromium only, and uploads failure artefacts per shard. The required release gate still
  depends on the job, which succeeds only when every shard succeeds.
- Scripts: `pnpm test:e2e` (Chromium), `pnpm test:e2e:edge` (Edge smoke), `pnpm e2e:install`
  (Chromium) and `pnpm e2e:install:edge`. The redundant `test:e2e:chromium` script is removed.

## Consequences

- Locally the complete suite ran in 52 seconds on four workers (previously about 12 minutes for
  Chromium plus Edge on the same machine).
- Journeys share one PostgreSQL server process. A journey that exhausts connections or crashes the
  server affects the others in that run; isolation of data is unchanged.
- Journeys run concurrently, so a journey must not depend on machine-wide exclusivity (fixed ports,
  shared files outside its own storage root). Current journeys already satisfy this.
- Edge is no longer exercised automatically. An Edge-only regression would be found by the on-demand
  Edge run or by the staging device rehearsal rather than by the pipeline.
- Journey output is interleaved between workers; each line carries its worker and journey prefix.

## Validation

- Planner unit tests cover default coverage and ordering, opt-in Edge coverage, shard partitioning
  without overlap or omission, unique indexes across shards, worker defaults and invalid options.
- The complete suite passed locally with four workers, with one worker for a single specification,
  and as three shards with two workers each; no container, process or scratch directory remained.
- Hosted pipeline duration is recorded in the session handoff once the pull-request run completes.

## Risks and follow-up

- Two workers per hosted runner assume the four-core runners available to this repository; on
  smaller runners `E2E_WORKERS` should be reduced.
- File size is only a proxy for duration; if shards become unbalanced, recorded durations can
  replace it.
- Re-enabling automated Edge coverage requires adding the Edge installation step and an `--edge`
  run on the chosen branches.
