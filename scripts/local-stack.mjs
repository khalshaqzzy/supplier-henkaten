import { spawnSync } from 'node:child_process';

const composeArguments = ['compose', '--profile', 'fullstack'];
const endpoints = [
  ['API readiness', `http://127.0.0.1:${process.env.API_PORT ?? '3000'}/ready`],
  ['Supplier web', `http://127.0.0.1:${process.env.SUPPLIER_WEB_PORT ?? '5173'}`],
  ['TMMIN web', `http://127.0.0.1:${process.env.TMMIN_WEB_PORT ?? '5174'}`],
];

function runDocker(arguments_) {
  const result = spawnSync('docker', [...composeArguments, ...arguments_], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`docker ${[...composeArguments, ...arguments_].join(' ')} failed.`);
  }
}

async function waitForEndpoint(label, url) {
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        process.stdout.write(`${label} ready at ${url} after ${attempt} check(s).\n`);
        return;
      }
    } catch {
      // Startup races are expected until the health dependency chain has completed.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`${label} did not become ready at ${url} within 60 seconds.`);
}

const command = process.argv[2];

if (command === 'wait') {
  for (const [label, url] of endpoints) await waitForEndpoint(label, url);
} else if (command === 'destroy') {
  process.stdout.write(
    'Destroying supplier-henkaten-local containers and the PostgreSQL/member-photo volumes.\n',
  );
  runDocker(['down', '--volumes', '--remove-orphans']);
} else {
  process.stderr.write('Usage: node scripts/local-stack.mjs <wait|destroy>\n');
  process.exitCode = 1;
}
