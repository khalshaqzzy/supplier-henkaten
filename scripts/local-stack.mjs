import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { frontendComposeArguments, localStackEndpoints } from './local-stack-plan.mjs';

const workspaceRoot = process.cwd();
const composeArguments = ['compose', '--profile', 'fullstack'];
const composeProject = 'supplier-henkaten-local';
const postgresVolume = 'supplier-henkaten-local-postgres-data';
const photoVolume = 'supplier-henkaten-local-member-photos';
const credentialPath = resolve(workspaceRoot, '.local/seed-credentials.json');
const endpoints = localStackEndpoints({
  apiPort: process.env.API_PORT ?? '3000',
  supplierWebPort: process.env.SUPPLIER_WEB_PORT ?? '5173',
  tmminWebPort: process.env.TMMIN_WEB_PORT ?? '5174',
});

function run(command, arguments_, environment = process.env, capture = false) {
  const result = spawnSync(command, arguments_, {
    cwd: workspaceRoot,
    env: environment,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = capture ? result.stderr.trim() : 'See command output above.';
    throw new Error(`${command} ${arguments_.join(' ')} failed. ${detail}`);
  }
  return capture ? result.stdout.trim() : '';
}

function runDocker(arguments_, environment = process.env, capture = false) {
  return run('docker', [...composeArguments, ...arguments_], environment, capture);
}

async function waitForEndpoint(label, url) {
  for (let attempt = 1; attempt <= 90; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        process.stdout.write(`${label} ready at ${url} after ${attempt} check(s).\n`);
        return;
      }
    } catch {
      // Startup races are expected until the health dependency chain has completed.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 1_000));
  }
  throw new Error(`${label} did not become ready at ${url} within 90 seconds.`);
}

function assertWorkspace() {
  const manifest = JSON.parse(readFileSync(resolve(workspaceRoot, 'package.json'), 'utf8'));
  if (manifest.name !== 'supplier-henkaten') {
    throw new Error('Local stack command must run from the supplier-henkaten workspace root.');
  }
  if (process.env.NODE_ENV === 'production' || process.env.CI === 'true') {
    throw new Error('Destructive local stack commands are disabled in production and CI.');
  }
  const config = runDocker(['config', '--format', 'json'], process.env, true);
  const parsed = JSON.parse(config);
  if (parsed.name !== composeProject) {
    throw new Error(`Expected Compose project ${composeProject}, received ${String(parsed.name)}.`);
  }
}

function prepareCredentialDirectory() {
  const directory = resolve(workspaceRoot, '.local');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  rmSync(credentialPath, { force: true });
}

function removePhotoVolume() {
  const inspect = spawnSync(
    'docker',
    ['volume', 'inspect', photoVolume, '--format', '{{json .Labels}}'],
    {
      cwd: workspaceRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  if (inspect.status !== 0) return;
  const labels = JSON.parse(inspect.stdout.trim());
  if (
    labels['com.docker.compose.project'] !== composeProject ||
    labels['com.docker.compose.volume'] !== 'member-photos'
  ) {
    throw new Error(`Refusing to remove volume ${photoVolume}: Compose ownership labels mismatch.`);
  }
  run('docker', ['volume', 'rm', photoVolume]);
}

async function waitForPostgres() {
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    const result = spawnSync(
      'docker',
      [
        'compose',
        'exec',
        '-T',
        'postgres',
        'pg_isready',
        '--username',
        process.env.POSTGRES_USER ?? 'supplier_henkaten',
        '--dbname',
        process.env.POSTGRES_DB ?? 'supplier_henkaten',
      ],
      { cwd: workspaceRoot, env: process.env, stdio: 'ignore' },
    );
    if (result.status === 0) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 1_000));
  }
  throw new Error('PostgreSQL did not become ready within 60 seconds.');
}

async function startCore() {
  runDocker(['up', '--detach', '--build', 'postgres', 'migrate', 'api']);
  await waitForEndpoint(endpoints[0][0], endpoints[0][1]);
}

async function startFrontends() {
  runDocker(frontendComposeArguments());
  await Promise.all(endpoints.slice(1).map(([label, url]) => waitForEndpoint(label, url)));
}

function bootstrapAndSeed() {
  const environment = {
    ...process.env,
    NODE_ENV: 'development',
    LOCAL_SEED_CONFIRM: 'supplier-henkaten-local-seed',
    LOCAL_SEED_API_ORIGIN: 'http://127.0.0.1:3000',
    LOCAL_SEED_CREDENTIALS_PATH: '/workspace/.local/seed-credentials.json',
    TMMIN_BOOTSTRAP_USERNAME: 'local.bootstrap',
    TMMIN_BOOTSTRAP_DISPLAY_NAME: 'Local TMMIN Administrator',
    TMMIN_BOOTSTRAP_PASSWORD: `L0cal!${randomBytes(24).toString('base64url')}`,
  };
  const forwarded = [
    'TMMIN_BOOTSTRAP_USERNAME',
    'TMMIN_BOOTSTRAP_DISPLAY_NAME',
    'TMMIN_BOOTSTRAP_PASSWORD',
  ].flatMap((name) => ['-e', name]);
  runDocker(
    [
      'exec',
      '-T',
      ...forwarded,
      'api',
      'pnpm',
      '--filter',
      '@tmmin-henkaten/api',
      'run',
      'admin:bootstrap',
    ],
    environment,
  );
  runDocker(
    [
      'exec',
      '-T',
      ...forwarded,
      '-e',
      'LOCAL_SEED_CONFIRM',
      '-e',
      'LOCAL_SEED_API_ORIGIN',
      '-e',
      'LOCAL_SEED_CREDENTIALS_PATH',
      'api',
      'pnpm',
      '--filter',
      '@tmmin-henkaten/api',
      'run',
      'local:seed',
    ],
    environment,
  );
}

async function runSeedLifecycle(mode) {
  assertWorkspace();
  prepareCredentialDirectory();
  process.env.AUTH_IP_LOGIN_LIMIT = '1000';
  process.env.AUTH_GLOBAL_LIMIT_PER_MINUTE = '20000';
  if (mode === 'start-clean') {
    process.stdout.write(
      `Clean start will remove ${postgresVolume} and ${photoVolume}, then create a new seeded stack.\n`,
    );
    runDocker(['down', '--volumes', '--remove-orphans']);
  } else {
    process.stdout.write(
      `Reseed will reset the main database and ${photoVolume}; the disposable test database is preserved.\n`,
    );
    runDocker(['down', '--remove-orphans']);
    run('docker', ['compose', 'up', '--detach', 'postgres']);
    await waitForPostgres();
    run('node', ['scripts/database.mjs', 'main-reset'], {
      ...process.env,
      NODE_ENV: 'development',
    });
    run('docker', ['compose', 'down', '--remove-orphans']);
    removePhotoVolume();
  }
  await startCore();
  bootstrapAndSeed();
  await startFrontends();
  process.stdout.write(
    `Local full stack seeded and ready. Credentials: ${credentialPath}\nSupplier: ${endpoints[1][1]}\nTMMIN: ${endpoints[2][1]}\n`,
  );
}

const command = process.argv[2];

try {
  if (command === 'wait') {
    for (const [label, url] of endpoints) await waitForEndpoint(label, url);
  } else if (command === 'destroy') {
    process.stdout.write(
      `Destroying ${composeProject} containers and volumes ${postgresVolume}, ${photoVolume}.\n`,
    );
    runDocker(['down', '--volumes', '--remove-orphans']);
  } else if (command === 'start-clean' || command === 'reseed') {
    await runSeedLifecycle(command);
  } else {
    process.stderr.write('Usage: node scripts/local-stack.mjs <wait|destroy|start-clean|reseed>\n');
    process.exitCode = 1;
  }
} catch (error) {
  rmSync(credentialPath, { force: true });
  const message = error instanceof Error ? error.message : 'Unknown local stack failure';
  process.stderr.write(`Local stack command failed: ${message}\n`);
  process.exitCode = 1;
}
