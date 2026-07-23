# Coding Agent Rules

Document status: Active
Purpose: operating rules for Codex and future agents when reading or updating `.agent/`

## 1. Why This Folder Exists

The `.agent/` folder is the project memory and execution layer for this project.

It exists to:

- preserve product, features, architecture decisions, and implementation intent across sessions
- prevent re-deciding decisions that are already locked
- keep implementation aligned with requirements
- record roadmap status, deployment assumptions, and recommended next steps
- make future sessions aware that of the last session's progress
- document changes readable to developers product owners


## 2. Required Read Order

For most implementation sessions, read in this order:

1. `.agent/rules.md`
2. `.agent/PRD.md`
3. `.agent/sessionHandoff.md`, if present
4. `.agent/implementationPhases.md`
5. `.agent/releaseExecutionChecklist.md`, if present and relevant
6. deployment or environment docs only after they are recreated for deployment work
7. relevant ADRs under `docs/adr/` if present

## 3. Source-of-truth Files

- `PRD.md`: product contract, clinical safety posture, users, workflows, data model, API scope, AI decisions, deployment scope, acceptance criteria.
- `implementationPhases.md`: implementation roadmap, phase/subphase sequencing, progress state, dependencies, acceptance checks, and next recommended task.
- `sessionHandoff.md`: latest session handoff, current objective, changed files, decisions, blockers, checks run, and next recommended action.
- `releaseExecutionChecklist.md`: operator checklist for release windows, if present and relevant.
- Deployment/environment docs: future source-of-truth files to recreate only when deployment work is ready.

If code and docs disagree, do not silently pick one. Inspect the current repo state, identify the mismatch, and update the relevant `.agent` file as part of the same work when the change is intentional.

## 4 Local Development Runtime Rules

Future agents must preserve these development-environment decisions:

- Local development database must run as a Docker-managed PostgreSQL instance with pgvector enabled or provisioned through the local Compose setup.
- Do not require developers to install or use a host-machine PostgreSQL service for normal local development.
- Local app and tests should read database connection details from environment variables that point to the Docker database.
- Automated tests may use isolated Docker databases, disposable schemas, transactions, or test containers, but must not depend on a manually configured host PostgreSQL instance.
- Frontend clients must never connect directly to the database; all database access goes through the backend API.

## 4.1 End-of-task Process And Container Cleanup

Future agents must treat runtime cleanup as part of finishing a task:

- Shut down dev servers, long-running shells, file watchers, background workers, and other processes started during the session after they are no longer needed.
- Run `docker compose down` or the equivalent project-specific shutdown command after tasks that start Docker containers, unless the user explicitly asks to keep them running.
- Before final response, confirm there are no agent-started long-running processes or containers still needed for the completed task.
- If a process or container must remain running for the user to inspect the app, state that explicitly and include the URL or reason.

## 5. When To Update `.agent`

Update `.agent` when implementation changes:

- product scope
- API contracts or shared schemas
- feature or functionality changes
- database entities or migration assumptions
- deployment topology, domains, secrets, VM paths, or scripts
- test strategy, acceptance criteria, or release process

Do not let `.agent` become stale after major implementation sessions.

## 5.1 Required Progress Updates

Every substantive task or session must update:

1. `.agent/sessionHandoff.md`
2. `.agent/implementationPhases.md`
3. `docs/adr/`

Update `.agent/sessionHandoff.md` at the end of each substantive task/session with:

- current objective
- files changed
- current phase and subphase
- completed work
- decisions made
- blockers or open questions
- next recommended action
- tests and checks run

Update `.agent/implementationPhases.md` whenever:

- a phase or subphase starts
- a phase or subphase completes
- a phase or subphase becomes blocked
- a phase or subphase is deferred
- dependencies, acceptance checks, scope, or sequencing materially change

Implementation phase progress rules:

- keep only one current phase/subphase marked `in_progress`
- mark completed subphases `done`
- preserve blockers and deferred work explicitly
- never silently skip a phase dependency
- if implementation diverges from the roadmap, update the roadmap in the same session

Create or update an ADR under `docs/adr/` after every substantive task/session. The ADR must record the meaningful decision, implementation direction, tradeoffs, consequences, validation, and follow-up work from the session. If the session extends an existing decision, update the existing ADR instead of creating a duplicate.

## 6. When To Add Files

Add a new `.agent` file when:

- a new phase needs a dedicated kickoff document
- a major session needs handoff context
- a new operational area becomes too large for an existing doc
- a durable architecture decision needs an ADR under `docs/adr/`

Use these naming patterns:

- `sessionHandoff.md`
- stable docs in `camelCase.md`
- ADRs in `docs/adr/000N-kebab-case-title.md`

Do not add scratch files or duplicate content that belongs in an existing source-of-truth document.

## 7. ADR Rules

Use ADRs for durable architecture decisions such as:

- features or functionality additions or changes
- backend or routing changes
- PostgreSQL/pgvector schema strategy
- deployment topology or rollback behavior
- file storage and media processing
- etc

ADRs must include status, date, context, decision, rationale, alternatives considered, implementation details, consequences, validation plan, risks, and follow-up work. ADRs must be comprehensive enough that a future agent can understand why the decision was made without reading the full chat transcript. However, ADR should be written professionally, as if human / developers will be the primary reader. Thus, ADR should not be mentioning anything related to 'phases', users' prompt /request, and should be written in passive and explanatory form.

## 8. Commit and Commit Message Rules

Only commit to `staging` branch unless other branch is specified.

Use conventional commit prefixes:

- `feat:` for user-visible features or new capabilities
- `fix:` for bug fixes, regressions, security fixes, and broken behavior
- `docs:` for documentation-only changes
- `test:` for test-only changes
- `refactor:` for behavior-preserving restructuring
- `ci:` for GitHub Actions and automation changes
- `build:` for build systems, Dockerfiles, and packaging
- `chore:` for maintenance and repo hygiene

Commit subjects should be behavior-based, imperative, concise, and specific. They should describe the observable behavior or capability change, not the implementation phase or roadmap position.

Good examples:

- `docs: require Docker PostgreSQL for local development`
- `feat: add ambient session transcript correction`
- `fix: preserve rule warnings in generated summaries`

Avoid commit subjects that reference phases or sequencing instead of behavior:

- `phase 2 database work`
- `implement phase 6`
- `docs: update phase roadmap`

## 9. Content Rules

When updating `.agent`:

- write for future implementation sessions, not external marketing
- separate locked product decisions from current repo status
- state whether a feature is implemented, planned, deferred, or externally provisioned
- preserve clinical safety constraints explicitly
- avoid unsupported assumptions about hospital policy, external integrations, or clinical validation
- keep deployment secrets out of repo docs except as names/placeholders

## 10. Required End-of-session Updates

After every substantive task/session, update:

1. `.agent/implementationPhases.md`
2. `.agent/sessionHandoff.md`
3. `docs/adr/`

Also update, when relevant:

4. `.agent/releaseExecutionChecklist.md` if preparing a rollout
5. deployment/environment docs after they are recreated for deployment work

If the session only makes small local edits, update only the docs that actually changed in meaning.
