import { readFileSync, statSync } from 'node:fs';
import { availableParallelism } from 'node:os';

/**
 * Parses runner options from the command line, falling back to the environment so that CI can
 * configure a run without changing the package scripts.
 *
 * --workers=<n>          parallel workers in this process (E2E_WORKERS)
 * --shard=<index>/<total> deterministic slice of the journeys (E2E_SHARD)
 * --spec=<name>          a single specification file
 * --edge                 also run the Edge smoke journeys tagged `@edge`
 * --edge-only            run only the Edge smoke journeys
 */
export function parseOptions(argv, env = {}, cpuCount = availableParallelism()) {
  const value = (name) => argv.find((argument) => argument.startsWith(`--${name}=`))?.split('=')[1];
  const edgeOnly = argv.includes('--edge-only');
  const edge = edgeOnly || argv.includes('--edge');
  if (edgeOnly && argv.includes('--chromium-only')) {
    throw new Error('Choose either Chromium-only or Edge-only coverage.');
  }

  const workersInput = value('workers') ?? env.E2E_WORKERS;
  // Each worker runs an API, two web servers and a browser, so leave half of the cores free.
  const workers =
    workersInput === undefined
      ? Math.max(1, Math.min(4, Math.floor(cpuCount / 2)))
      : Number(workersInput);
  if (!Number.isInteger(workers) || workers < 1 || workers > 16) {
    throw new Error('--workers must be an integer from 1 to 16.');
  }

  const shardInput = value('shard') ?? env.E2E_SHARD;
  let shard;
  if (shardInput) {
    const match = /^(\d+)\/(\d+)$/.exec(shardInput);
    const index = Number(match?.[1]);
    const total = Number(match?.[2]);
    if (!match || index < 1 || total < 1 || index > total) {
      throw new Error('--shard must look like <index>/<total>, for example 2/3.');
    }
    shard = { index, total };
  }

  return { workers, shard, spec: value('spec'), edge, edgeOnly };
}

/**
 * Builds the ordered journey list. Chromium runs every specification. Edge coverage is opt-in and
 * limited to specifications tagged `@edge`.
 *
 * Journeys are ordered largest specification first (file size is a stable stand-in for duration)
 * so that the long ones start early, and shards take every `total`-th journey of that order, which
 * spreads the long journeys evenly across shards.
 */
export function planJourneys(specs, options, pathOf, read = defaultRead) {
  const selected = specs.filter(
    (name) => !options.spec || name === options.spec || name === `${options.spec}.spec.ts`,
  );
  if (selected.length === 0) throw new Error('No Playwright journey specifications were found.');

  const described = selected
    .map((name) => ({ name, ...read(pathOf(name)) }))
    .sort((left, right) => right.size - left.size || left.name.localeCompare(right.name));
  const chromium = options.edgeOnly
    ? []
    : described.map(({ name }) => ({ spec: name, browserProject: 'chromium' }));
  const edge = options.edge
    ? described
        .filter(({ edge: tagged }) => tagged)
        .map(({ name }) => ({ spec: name, browserProject: 'msedge' }))
    : [];
  const journeys = [...chromium, ...edge]
    .map((journey, index) => ({ ...journey, index }))
    .filter(
      ({ index }) => !options.shard || index % options.shard.total === options.shard.index - 1,
    );
  if (journeys.length === 0) {
    throw new Error('No Playwright journey specifications matched the selected coverage.');
  }
  return journeys;
}

function defaultRead(path) {
  return { size: statSync(path).size, edge: readFileSync(path, 'utf8').includes('@edge') };
}
