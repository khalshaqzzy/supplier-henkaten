import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const workspaceRoot = resolve(import.meta.dirname, '../../..');
const e2eRoot = resolve(import.meta.dirname, '..');
const chromiumOnly = process.argv.includes('--chromium-only');
const edgeOnly = process.argv.includes('--edge-only');
if (chromiumOnly && edgeOnly) throw new Error('Choose either Chromium-only or Edge-only coverage.');
const specFilter = process.argv.find((argument) => argument.startsWith('--spec='))?.slice(7);
const specs = readdirSync(resolve(e2eRoot, 'tests'))
  .filter((name) => name.endsWith('.spec.ts'))
  .filter((name) => !specFilter || name === specFilter || name === `${specFilter}.spec.ts`)
  .sort();

if (specs.length === 0) throw new Error('No Playwright journey specifications were found.');

const edgeSpecs = specs.filter((name) =>
  readFileSync(resolve(e2eRoot, 'tests', name), 'utf8').includes('@edge'),
);
const journeys = edgeOnly
  ? edgeSpecs.map((spec) => ({ spec, browserProject: 'msedge' }))
  : chromiumOnly
    ? specs.map((spec) => ({ spec, browserProject: 'chromium' }))
    : [
        ...specs.map((spec) => ({ spec, browserProject: 'chromium' })),
        ...edgeSpecs.map((spec) => ({ spec, browserProject: 'msedge' })),
      ];

if (journeys.length === 0) {
  throw new Error('No Playwright journey specifications matched the selected browser coverage.');
}

const runningChildren = new Set();
let activeCompose;
let activePhotoRoot;
let stopping = false;

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    void cleanup().finally(() => process.exit(128 + (signal === 'SIGINT' ? 2 : 15)));
  });
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

function run(command, arguments_, options = {}) {
  const result = spawnSync(command, arguments_, {
    cwd: options.cwd ?? workspaceRoot,
    env: options.env ?? process.env,
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = options.capture ? `\n${result.stdout}\n${result.stderr}` : '';
    throw new Error(`${command} ${arguments_.join(' ')} failed.${detail}`);
  }
  return result.stdout?.trim() ?? '';
}

function start(command, arguments_, environment, label) {
  const child = spawn(command, arguments_, {
    cwd: workspaceRoot,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  runningChildren.add(child);
  child.stdout.on('data', (chunk) => process.stdout.write(`[${label}] ${String(chunk)}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[${label}] ${String(chunk)}`));
  child.once('exit', () => runningChildren.delete(child));
  return child;
}

function verifyPostgres(project, postgresPort) {
  const output = run(
    'docker',
    [
      'compose',
      '-f',
      resolve(e2eRoot, 'compose.yaml'),
      '--project-name',
      project,
      'exec',
      '-T',
      'postgres',
      'psql',
      '--username',
      'supplier_henkaten_e2e',
      '--dbname',
      'supplier_henkaten_e2e',
      '--tuples-only',
      '--no-align',
      '--command',
      "SELECT current_setting('server_version_num'), default_version FROM pg_available_extensions WHERE name = 'vector';",
    ],
    {
      capture: true,
      env: { ...process.env, E2E_POSTGRES_PORT: String(postgresPort) },
    },
  );
  const [serverVersion, vectorVersion] = output.split('|');
  if (!serverVersion?.startsWith('18') || vectorVersion !== '0.8.5') {
    throw new Error(`Unexpected PostgreSQL/pgvector runtime: ${output || 'no result'}.`);
  }
}

async function waitFor(label, url) {
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The child process may still be compiling or opening its socket.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  throw new Error(`${label} did not become ready at ${url}.`);
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolveExit) => child.once('exit', resolveExit)),
    new Promise((resolveWait) => setTimeout(resolveWait, 5_000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}

async function cleanup() {
  if (stopping) return;
  stopping = true;
  await Promise.all([...runningChildren].map((child) => stopChild(child)));
  if (activeCompose) {
    run(
      'docker',
      [
        'compose',
        '-f',
        resolve(e2eRoot, 'compose.yaml'),
        '--project-name',
        activeCompose.project,
        'down',
        '--volumes',
        '--remove-orphans',
      ],
      { env: { ...process.env, E2E_POSTGRES_PORT: String(activeCompose.postgresPort) } },
    );
    activeCompose = undefined;
  }
  if (activePhotoRoot) {
    rmSync(activePhotoRoot, { recursive: true, force: true });
    activePhotoRoot = undefined;
  }
  stopping = false;
}

mkdirSync(resolve(workspaceRoot, 'blob-report'), { recursive: true });
mkdirSync(resolve(workspaceRoot, 'playwright-report'), { recursive: true });
mkdirSync(resolve(workspaceRoot, 'test-results/e2e'), { recursive: true });

let failed = false;
for (const [index, { spec, browserProject }] of journeys.entries()) {
  const epoch = `${spec.replace('.spec.ts', '')}-${browserProject}-${process.pid}-${index}`;
  const project = `henkaten-e2e-${process.pid}-${index}`;
  const [postgresPort, apiPort, supplierPort, tmminPort] = await Promise.all([
    freePort(),
    freePort(),
    freePort(),
    freePort(),
  ]);
  const databaseUrl = `postgresql://supplier_henkaten_e2e:supplier_henkaten_e2e_local_only@127.0.0.1:${postgresPort}/supplier_henkaten_e2e`;
  const supplierOrigin = `http://127.0.0.1:${supplierPort}`;
  const tmminOrigin = `http://127.0.0.1:${tmminPort}`;
  const apiOrigin = `http://127.0.0.1:${apiPort}`;
  const bootstrapPassword = `E2e-Bootstrap-${process.pid}-${index}-Password`;
  const photoRoot = resolve(workspaceRoot, `tmp/e2e-photos-${epoch}`);
  const environment = {
    ...process.env,
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: String(apiPort),
    DATABASE_URL: databaseUrl,
    RELEASE_SHA: `e2e-${epoch}`,
    LOG_LEVEL: 'warn',
    CORS_ALLOWED_ORIGINS: `${supplierOrigin},${tmminOrigin}`,
    SUPPLIER_APP_ORIGIN: supplierOrigin,
    TMMIN_APP_ORIGIN: tmminOrigin,
    SESSION_CSRF_SECRET: `e2e-csrf-${process.pid}-${index}-secret-at-least-32`,
    AUTH_THROTTLE_SECRET: `e2e-throttle-${process.pid}-${index}-secret-at-least-thirty-two`,
    AUTH_IP_LOGIN_LIMIT: '500',
    AUTH_GLOBAL_LIMIT_PER_MINUTE: '2000',
    OUTBOX_ENABLED: 'true',
    OUTBOX_POLL_MS: '100',
    REALTIME_POLL_MS: '100',
    PHOTO_STORAGE_ROOT: photoRoot,
    TMMIN_BOOTSTRAP_USERNAME: 'e2e.bootstrap',
    TMMIN_BOOTSTRAP_DISPLAY_NAME: 'E2E Bootstrap Admin',
    TMMIN_BOOTSTRAP_PASSWORD: bootstrapPassword,
    VITE_API_ORIGIN: apiOrigin,
    E2E_EPOCH: epoch,
    E2E_API_ORIGIN: apiOrigin,
    E2E_SUPPLIER_ORIGIN: supplierOrigin,
    E2E_TMMIN_ORIGIN: tmminOrigin,
    E2E_BOOTSTRAP_USERNAME: 'e2e.bootstrap',
    E2E_BOOTSTRAP_PASSWORD: bootstrapPassword,
    E2E_CHANGED_PASSWORD: `E2e-Changed-${process.pid}-${index}-Password`,
  };

  try {
    activeCompose = { project, postgresPort };
    activePhotoRoot = photoRoot;
    run(
      'docker',
      [
        'compose',
        '-f',
        resolve(e2eRoot, 'compose.yaml'),
        '--project-name',
        project,
        'up',
        '--detach',
        '--wait',
      ],
      { env: { ...process.env, E2E_POSTGRES_PORT: String(postgresPort) } },
    );
    verifyPostgres(project, postgresPort);
    run('pnpm', ['--filter', '@tmmin-henkaten/api', 'run', 'prisma:migrate:deploy'], {
      env: environment,
    });
    run('pnpm', ['admin:bootstrap'], { env: environment });

    const api = start(
      'pnpm',
      ['--filter', '@tmmin-henkaten/api', 'exec', 'node', 'dist/main.js'],
      environment,
      'api',
    );
    const supplier = start(
      'pnpm',
      [
        '--filter',
        '@tmmin-henkaten/supplier-web',
        'exec',
        'vite',
        '--host',
        '127.0.0.1',
        '--port',
        String(supplierPort),
        '--strictPort',
      ],
      environment,
      'supplier',
    );
    const tmmin = start(
      'pnpm',
      [
        '--filter',
        '@tmmin-henkaten/tmmin-web',
        'exec',
        'vite',
        '--host',
        '127.0.0.1',
        '--port',
        String(tmminPort),
        '--strictPort',
      ],
      environment,
      'tmmin',
    );
    await Promise.all([
      waitFor('API readiness', `${apiOrigin}/ready`),
      waitFor('Supplier web', supplierOrigin),
      waitFor('TMMIN web', tmminOrigin),
    ]);
    run('pnpm', ['exec', 'playwright', 'test', spec, `--project=${browserProject}`], {
      cwd: e2eRoot,
      env: environment,
    });
    await Promise.all([stopChild(api), stopChild(supplier), stopChild(tmmin)]);
  } catch (error) {
    failed = true;
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  } finally {
    await cleanup();
  }
  if (failed) break;
}

process.exitCode = failed ? 1 : 0;
