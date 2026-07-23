import { spawnSync } from 'node:child_process';

const composeProject = 'supplier-henkaten-local';
const postgresService = 'postgres';
const expectedPostgresMajor = '18';
const expectedVectorVersion = '0.8.5';

try {
  process.loadEnvFile('.env');
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes('ENOENT')) {
    throw error;
  }
}

const databaseUser = process.env.POSTGRES_USER ?? 'supplier_henkaten';
const mainDatabase = process.env.POSTGRES_DB ?? 'supplier_henkaten';
const testDatabase = process.env.TEST_DATABASE_NAME ?? 'supplier_henkaten_test';

function assertIdentifier(name, value) {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) {
    throw new Error(`${name} must be a lowercase PostgreSQL identifier.`);
  }
}

assertIdentifier('POSTGRES_USER', databaseUser);
assertIdentifier('POSTGRES_DB', mainDatabase);
assertIdentifier('TEST_DATABASE_NAME', testDatabase);

if (!testDatabase.endsWith('_test')) {
  throw new Error('TEST_DATABASE_NAME must end with _test.');
}

function runDocker(arguments_, capture = false) {
  const result = spawnSync('docker', ['compose', ...arguments_], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: process.env,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });

  if (result.error !== undefined) {
    throw result.error;
  }

  if (result.status !== 0) {
    const detail = capture ? result.stderr.trim() : 'See Docker output above.';
    throw new Error(`docker compose ${arguments_.join(' ')} failed. ${detail}`);
  }

  return capture ? result.stdout.trim() : '';
}

function canRunDocker(arguments_) {
  const result = spawnSync('docker', ['compose', ...arguments_], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: process.env,
    stdio: 'ignore',
  });

  return result.status === 0;
}

function query(database, sql) {
  return runDocker(
    [
      'exec',
      '-T',
      postgresService,
      'psql',
      '--set',
      'ON_ERROR_STOP=1',
      '--username',
      databaseUser,
      '--dbname',
      database,
      '--tuples-only',
      '--no-align',
      '--command',
      sql,
    ],
    true,
  );
}

async function waitForPostgres() {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    if (
      canRunDocker([
        'exec',
        '-T',
        postgresService,
        'pg_isready',
        '--username',
        databaseUser,
        '--dbname',
        mainDatabase,
      ])
    ) {
      console.log(`PostgreSQL is ready after ${attempt} check(s).`);
      return;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 2_000);
    });
  }

  throw new Error('PostgreSQL did not become ready within 60 seconds.');
}

function verifyDatabase() {
  const serverVersion = query(mainDatabase, 'SHOW server_version;');
  const vectorVersionMain = query(
    mainDatabase,
    "SELECT extversion FROM pg_extension WHERE extname = 'vector';",
  );
  const vectorVersionTest = query(
    testDatabase,
    "SELECT extversion FROM pg_extension WHERE extname = 'vector';",
  );

  if (!serverVersion.startsWith(`${expectedPostgresMajor}.`)) {
    throw new Error(`Expected PostgreSQL ${expectedPostgresMajor}, received ${serverVersion}.`);
  }

  if (vectorVersionMain !== expectedVectorVersion || vectorVersionTest !== expectedVectorVersion) {
    throw new Error(
      `Expected vector ${expectedVectorVersion}; main=${vectorVersionMain}, test=${vectorVersionTest}.`,
    );
  }

  console.log(
    `Database verified: PostgreSQL ${serverVersion}, vector ${vectorVersionMain}, main=${mainDatabase}, test=${testDatabase}.`,
  );
}

function resetTestDatabase() {
  query('postgres', `DROP DATABASE IF EXISTS "${testDatabase}" WITH (FORCE);`);
  query('postgres', `CREATE DATABASE "${testDatabase}";`);
  query(testDatabase, 'CREATE EXTENSION IF NOT EXISTS vector;');
  console.log(`Reset disposable test database: ${testDatabase}.`);
}

const command = process.argv[2];

switch (command) {
  case 'up':
    runDocker(['up', '--detach', postgresService]);
    break;
  case 'wait':
    await waitForPostgres();
    break;
  case 'verify':
    verifyDatabase();
    break;
  case 'migrate':
    console.log('Database migration dispatcher: 0 registered migrations (Prisma begins later).');
    break;
  case 'test-reset':
    resetTestDatabase();
    break;
  case 'down':
    runDocker(['down', '--remove-orphans']);
    break;
  case 'destroy':
    console.log(`Destroying Docker Compose project and volume: ${composeProject}.`);
    runDocker(['down', '--volumes', '--remove-orphans']);
    break;
  default:
    console.error(
      'Usage: node scripts/database.mjs <up|wait|verify|migrate|test-reset|down|destroy>',
    );
    process.exitCode = 1;
}
