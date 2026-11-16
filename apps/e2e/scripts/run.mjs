import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

import { parseOptions, planJourneys } from './plan.mjs';

/*
 * Browser journey runner.
 *
 * One disposable PostgreSQL container serves the whole run. It is migrated and bootstrapped once
 * and that database becomes a template; every journey then gets its own database cloned from the
 * template, so journeys stay isolated without paying for a container, a migration and a bootstrap
 * each.
 *
 * Journeys run on `--workers` parallel workers. Each worker owns its ports, builds both web
 * applications once against its API origin, keeps the two web servers up for all of its journeys
 * and only restarts the API (whose database and in-memory limiters are per journey).
 *
 * `--shard=<index>/<total>` selects a deterministic slice of the journeys so that separate CI
 * machines can split one suite.
 */

const workspaceRoot = resolve(import.meta.dirname, '../../..');
const e2eRoot = resolve(import.meta.dirname, '..');
const composeFile = resolve(e2eRoot, 'compose.yaml');
const databaseUser = 'supplier_henkaten_e2e';
const databasePassword = 'supplier_henkaten_e2e_local_only';
const templateDatabase = 'supplier_henkaten_e2e';

const options = parseOptions(process.argv.slice(2), process.env);
const specs = readdirSync(resolve(e2eRoot, 'tests'))
  .filter((name) => name.endsWith('.spec.ts'))
  .sort();
const journeys = planJourneys(specs, options, (name) => resolve(e2eRoot, 'tests', name));
const workerCount = Math.max(1, Math.min(options.workers, journeys.length));
const runId = process.pid;
const composeProject = `henkaten-e2e-${runId}`;
const scratchRoot = resolve(workspaceRoot, `tmp/e2e-run-${runId}`);
const bootstrapPassword = `E2e-Bootstrap-${runId}-Password`;

const children = new Set();
let postgresPort;
let composeStarted = false;
let stopping = false;
let failed = false;

function log(label, text) {
  for (const line of String(text).split('\n')) {
    if (line.trim()) process.stdout.write(`[${label}] ${line}\n`);
  }
}

async function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0 }, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Unable to allocate a loopback port.'));
        return;
      }
      const { port } = address;
      server.close(() => resolvePort(port));
    });
  });
}

/**
 * Children are started in their own process group so that a package-manager shim which re-launches
 * itself cannot leave grandchildren behind holding the runner's pipes open.
 */
function launch(command, arguments_, { env, cwd, label }) {
  const child = spawn(command, arguments_, {
    cwd: cwd ?? workspaceRoot,
    env: env ?? process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  children.add(child);
  child.once('exit', () => children.delete(child));
  let output = '';
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (chunk) => {
      output += String(chunk);
      if (label) log(label, chunk);
    });
  }
  child.captured = () => output;
  return child;
}

function run(command, arguments_, settings = {}) {
  return new Promise((resolveRun, reject) => {
    const child = launch(command, arguments_, settings);
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolveRun(child.captured().trim());
      else
        reject(
          new Error(
            `${command} ${arguments_.join(' ')} failed with exit code ${code}.` +
              (settings.label ? '' : `\n${child.captured()}`),
          ),
        );
    });
  });
}

function signalGroup(child, signal) {
  try {
    process.kill(-child.pid, signal);
  } catch {
    // The group has already exited.
  }
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  signalGroup(child, 'SIGTERM');
  await Promise.race([
    new Promise((resolveExit) => child.once('exit', resolveExit)),
    new Promise((resolveWait) => setTimeout(resolveWait, 5_000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) signalGroup(child, 'SIGKILL');
}

function compose(arguments_, settings = {}) {
  return run(
    'docker',
    ['compose', '-f', composeFile, '--project-name', composeProject, ...arguments_],
    {
      ...settings,
      env: { ...process.env, E2E_POSTGRES_PORT: String(postgresPort) },
    },
  );
}

function sql(statement, database = 'postgres') {
  return compose([
    'exec',
    '-T',
    'postgres',
    'psql',
    '--username',
    databaseUser,
    '--dbname',
    database,
    '--tuples-only',
    '--no-align',
    '--set',
    'ON_ERROR_STOP=1',
    '--command',
    statement,
  ]);
}

function databaseUrl(database) {
  return `postgresql://${databaseUser}:${databasePassword}@127.0.0.1:${postgresPort}/${database}`;
}

async function waitFor(label, url) {
  for (let attempt = 1; attempt <= 120; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The process may still be opening its socket.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`${label} did not become ready at ${url}.`);
}

/** Environment shared by every journey of the run. Per-journey values are added by the worker. */
function baseEnvironment(extra) {
  return {
    ...process.env,
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    LOG_LEVEL: 'warn',
    SESSION_CSRF_SECRET: `e2e-csrf-${runId}-secret-at-least-32-characters`,
    AUTH_THROTTLE_SECRET: `e2e-throttle-${runId}-secret-at-least-thirty-two`,
    AUTH_IP_LOGIN_LIMIT: '500',
    AUTH_GLOBAL_LIMIT_PER_MINUTE: '2000',
    OUTBOX_ENABLED: 'true',
    OUTBOX_POLL_MS: '100',
    REALTIME_POLL_MS: '100',
    TMMIN_BOOTSTRAP_USERNAME: 'e2e.bootstrap',
    TMMIN_BOOTSTRAP_DISPLAY_NAME: 'E2E Bootstrap Admin',
    TMMIN_BOOTSTRAP_PASSWORD: bootstrapPassword,
    E2E_BOOTSTRAP_USERNAME: 'e2e.bootstrap',
    E2E_BOOTSTRAP_PASSWORD: bootstrapPassword,
    ...extra,
  };
}

async function prepareDatabase() {
  postgresPort = await freePort();
  composeStarted = true;
  await compose(['up', '--detach', '--wait']);
  const version = await sql(
    "SELECT current_setting('server_version_num'), default_version FROM pg_available_extensions WHERE name = 'vector';",
    templateDatabase,
  );
  const [serverVersion, vectorVersion] = version.split('|');
  if (!serverVersion?.startsWith('18') || vectorVersion !== '0.8.5') {
    throw new Error(`Unexpected PostgreSQL/pgvector runtime: ${version || 'no result'}.`);
  }
  // The compose database is migrated and bootstrapped once, then only ever used as a template.
  const environment = baseEnvironment({
    // The CLI validates the full API configuration but never listens or serves these origins.
    PORT: '3000',
    DATABASE_URL: databaseUrl(templateDatabase),
    RELEASE_SHA: `e2e-template-${runId}`,
    CORS_ALLOWED_ORIGINS: 'http://127.0.0.1:5173,http://127.0.0.1:5174',
    SUPPLIER_APP_ORIGIN: 'http://127.0.0.1:5173',
    TMMIN_APP_ORIGIN: 'http://127.0.0.1:5174',
    PHOTO_STORAGE_ROOT: resolve(scratchRoot, 'template-photos'),
  });
  await run('pnpm', ['--filter', '@tmmin-henkaten/api', 'run', 'prisma:migrate:deploy'], {
    env: environment,
  });
  await run('pnpm', ['admin:bootstrap'], { env: environment });
}

async function cloneDatabase(database) {
  // A template cannot be copied while another copy of it is starting, so retry briefly.
  for (let attempt = 1; ; attempt += 1) {
    try {
      await sql(`CREATE DATABASE "${database}" TEMPLATE "${templateDatabase}"`);
      return;
    } catch (error) {
      if (attempt >= 20) throw error;
      await new Promise((resolveWait) => setTimeout(resolveWait, 150 * attempt));
    }
  }
}

async function startWorker(workerIndex, queue) {
  const label = workerCount > 1 ? `w${workerIndex + 1}` : 'e2e';
  const [apiPort, supplierPort, tmminPort] = await Promise.all([
    freePort(),
    freePort(),
    freePort(),
  ]);
  const apiOrigin = `http://127.0.0.1:${apiPort}`;
  const supplierOrigin = `http://127.0.0.1:${supplierPort}`;
  const tmminOrigin = `http://127.0.0.1:${tmminPort}`;
  const workerRoot = resolve(scratchRoot, `worker-${workerIndex}`);
  const workerEnvironment = baseEnvironment({
    PORT: String(apiPort),
    CORS_ALLOWED_ORIGINS: `${supplierOrigin},${tmminOrigin}`,
    SUPPLIER_APP_ORIGIN: supplierOrigin,
    TMMIN_APP_ORIGIN: tmminOrigin,
    VITE_API_ORIGIN: apiOrigin,
    E2E_API_ORIGIN: apiOrigin,
    E2E_SUPPLIER_ORIGIN: supplierOrigin,
    E2E_TMMIN_ORIGIN: tmminOrigin,
  });

  // The API origin is compiled into the web bundles, so each worker builds them once for its own
  // origin. Type checking is the quality job's responsibility and is not repeated here.
  const webs = [
    ['supplier', '@tmmin-henkaten/supplier-web', supplierPort, supplierOrigin],
    ['tmmin', '@tmmin-henkaten/tmmin-web', tmminPort, tmminOrigin],
  ];
  await Promise.all(
    webs.map(([name, workspace]) =>
      run(
        'pnpm',
        [
          '--filter',
          workspace,
          'exec',
          'vite',
          'build',
          '--outDir',
          resolve(workerRoot, name),
          '--emptyOutDir',
          '--logLevel',
          'warn',
        ],
        // Build output is shown only when the build fails.
        { env: workerEnvironment },
      ),
    ),
  );
  const servers = webs.map(([name, workspace, port]) =>
    launch(
      'pnpm',
      [
        '--filter',
        workspace,
        'exec',
        'vite',
        'preview',
        '--outDir',
        resolve(workerRoot, name),
        '--host',
        '127.0.0.1',
        '--port',
        String(port),
        '--strictPort',
      ],
      { env: workerEnvironment, label: `${label}:${name}` },
    ),
  );
  await Promise.all(webs.map(([name, , , origin]) => waitFor(`${name} web`, origin)));

  try {
    while (!failed && !stopping) {
      const journey = queue.shift();
      if (!journey) break;
      await runJourney(journey, { label, workerRoot, workerEnvironment, apiOrigin });
    }
  } finally {
    await Promise.all(servers.map((server) => stop(server)));
  }
}

async function runJourney(journey, { label, workerRoot, workerEnvironment, apiOrigin }) {
  const { spec, browserProject, index } = journey;
  const name = spec.replace('.spec.ts', '');
  const epoch = `${name}-${browserProject}-${runId}-${index}`;
  const database = `e2e_${runId}_${index}`;
  const photoRoot = resolve(workerRoot, `photos-${index}`);
  const environment = {
    ...workerEnvironment,
    DATABASE_URL: databaseUrl(database),
    RELEASE_SHA: `e2e-${epoch}`,
    PHOTO_STORAGE_ROOT: photoRoot,
    E2E_EPOCH: epoch,
    E2E_CHANGED_PASSWORD: `E2e-Changed-${runId}-${index}-Password`,
  };
  const started = Date.now();
  let api;
  try {
    await cloneDatabase(database);
    api = launch('pnpm', ['--filter', '@tmmin-henkaten/api', 'exec', 'node', 'dist/main.js'], {
      env: environment,
      label: `${label}:api`,
    });
    await waitFor('API readiness', `${apiOrigin}/ready`);
    await run('pnpm', ['exec', 'playwright', 'test', spec, `--project=${browserProject}`], {
      cwd: e2eRoot,
      env: environment,
      label: `${label}:${name}`,
    });
    log(label, `PASS ${name} [${browserProject}] in ${elapsed(started)}`);
  } catch (error) {
    failed = true;
    log(label, `FAIL ${name} [${browserProject}] in ${elapsed(started)}`);
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  } finally {
    await stop(api);
    await sql(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`).catch(() => undefined);
    rmSync(photoRoot, { recursive: true, force: true });
  }
}

function elapsed(since) {
  return `${((Date.now() - since) / 1_000).toFixed(1)}s`;
}

async function cleanup() {
  if (stopping) return;
  stopping = true;
  await Promise.all([...children].map((child) => stop(child)));
  if (composeStarted) {
    await compose(['down', '--volumes', '--remove-orphans']).catch((error) =>
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`),
    );
    composeStarted = false;
  }
  rmSync(scratchRoot, { recursive: true, force: true });
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    void cleanup().finally(() => process.exit(128 + (signal === 'SIGINT' ? 2 : 15)));
  });
}

for (const directory of ['blob-report', 'playwright-report', 'test-results/e2e']) {
  mkdirSync(resolve(workspaceRoot, directory), { recursive: true });
}
mkdirSync(scratchRoot, { recursive: true });

const started = Date.now();
log(
  'e2e',
  `${journeys.length} journey(s) on ${workerCount} worker(s)` +
    (options.shard ? `, shard ${options.shard.index}/${options.shard.total}` : ''),
);
try {
  await prepareDatabase();
  log('e2e', `PostgreSQL template ready in ${elapsed(started)}`);
  const queue = [...journeys];
  const results = await Promise.allSettled(
    Array.from({ length: workerCount }, (_, workerIndex) => startWorker(workerIndex, queue)),
  );
  for (const result of results) {
    if (result.status === 'rejected') {
      failed = true;
      const { reason } = result;
      process.stderr.write(`${reason instanceof Error ? reason.stack : String(reason)}\n`);
    }
  }
  if (!failed && queue.length > 0) failed = true;
} catch (error) {
  failed = true;
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
} finally {
  await cleanup();
}

log('e2e', `${failed ? 'FAILED' : 'PASSED'}: ${journeys.length} journey(s) in ${elapsed(started)}`);
// Exit explicitly: every child has been stopped, so nothing useful can still be pending.
process.exit(failed ? 1 : 0);
