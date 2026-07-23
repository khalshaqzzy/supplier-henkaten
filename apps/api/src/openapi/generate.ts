import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { buildOpenApiDocument } from './document.js';

const artifact = resolve(process.cwd(), 'openapi/openapi.json');
const output = `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`;
const mode = process.argv[2];

if (mode === '--write') {
  await mkdir(dirname(artifact), { recursive: true });
  await writeFile(artifact, output, 'utf8');
  process.stdout.write(`Wrote ${artifact}\n`);
} else if (mode === '--check') {
  const committed = await readFile(artifact, 'utf8').catch(() => '');
  if (committed !== output) {
    process.stderr.write('OpenAPI artifact drift detected. Run pnpm openapi:generate.\n');
    process.exitCode = 1;
  }
} else {
  throw new Error('Expected --write or --check.');
}
