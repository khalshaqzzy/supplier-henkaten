import type { BoardMachineAssetKey } from '@tmmin-henkaten/contracts';

export const LOCAL_SEED_CONFIRMATION = 'supplier-henkaten-local-seed';
export const LOCAL_SEED_SUPPLIER_COUNT = 2;
export const LOCAL_SEED_HISTORICAL_SHIFT_COUNT = 36;
export const LOCAL_SEED_HISTORICAL_HENKATEN_COUNT = 108;
export const LOCAL_SEED_HENKATEN_PER_SUPPLIER = LOCAL_SEED_HISTORICAL_HENKATEN_COUNT + 12;

export type SeedCategory = 'MAN' | 'MACHINE' | 'MATERIAL' | 'METHOD';
export type SeedOutcome =
  | 'APPROVED_SUPERVISOR_FIRST'
  | 'APPROVED_QC_FIRST'
  | 'REJECTED_SUPERVISOR'
  | 'REJECTED_QC'
  | 'CANCELLED_WITHDRAWN'
  | 'CANCELLED_SHIFT_ENDED'
  | 'OPEN_PENDING'
  | 'OPEN_SUPERVISOR_APPROVED'
  | 'OPEN_QC_APPROVED';

export type SeedHenkatenPlan = {
  category: SeedCategory;
  outcome: SeedOutcome;
  historicalShiftIndex?: number;
  historicalDayOffset?: number;
  lineIndex?: number;
  shiftTemplateIndex?: number;
  jobIndex?: number;
  partIndex?: number;
  narrativeVariant?: number;
  eventMinuteOffset?: number;
  resolutionMinuteDelay?: number;
};

export type SupplierSeedPlan = {
  code: string;
  name: string;
  accent: string;
  lineNames: string[];
  jobNames: string[][];
  canvasLines: Array<{
    subtitle: string;
    zoneFill: string;
    machines: [
      BoardMachineAssetKey,
      BoardMachineAssetKey,
      BoardMachineAssetKey,
      BoardMachineAssetKey,
    ];
  }>;
  parts: Array<{ number: string; name: string }>;
  historical: SeedHenkatenPlan[];
  live: SeedHenkatenPlan[];
};

type HistoricalProfile = {
  seed: number;
  shiftLoads: number[];
  categoryCounts: Record<SeedCategory, number>;
  outcomeCounts: Partial<Record<SeedOutcome, number>>;
  partWeights: number[];
};

const categories: SeedCategory[] = ['MAN', 'MACHINE', 'MATERIAL', 'METHOD'];
const baseShiftLoads = [
  1, 2, 3, 5, 4, 2, 3, 1, 6, 4, 2, 3, 2, 5, 3, 1, 4, 3, 6, 2, 2, 4, 3, 1, 3, 5, 2, 4, 1, 3, 4, 2, 5,
  3, 2, 2,
];
const materialSupplierShiftLoads = shuffle(
  [
    ...Array.from({ length: 4 }, () => 1),
    ...Array.from({ length: 11 }, () => 2),
    ...Array.from({ length: 10 }, () => 3),
    ...Array.from({ length: 5 }, () => 4),
    ...Array.from({ length: 4 }, () => 5),
    ...Array.from({ length: 2 }, () => 6),
  ],
  73,
);

const live: SeedHenkatenPlan[] = [
  { category: 'MAN', outcome: 'APPROVED_SUPERVISOR_FIRST' },
  { category: 'MAN', outcome: 'APPROVED_QC_FIRST' },
  { category: 'MAN', outcome: 'APPROVED_SUPERVISOR_FIRST' },
  { category: 'MAN', outcome: 'OPEN_SUPERVISOR_APPROVED' },
  { category: 'MACHINE', outcome: 'OPEN_PENDING' },
  { category: 'MACHINE', outcome: 'OPEN_QC_APPROVED' },
  { category: 'MACHINE', outcome: 'OPEN_SUPERVISOR_APPROVED' },
  { category: 'MATERIAL', outcome: 'OPEN_PENDING' },
  { category: 'MATERIAL', outcome: 'OPEN_SUPERVISOR_APPROVED' },
  { category: 'MATERIAL', outcome: 'OPEN_QC_APPROVED' },
  { category: 'METHOD', outcome: 'OPEN_PENDING' },
  { category: 'METHOD', outcome: 'REJECTED_SUPERVISOR' },
];

const profiles: HistoricalProfile[] = [
  {
    seed: 17,
    shiftLoads: baseShiftLoads,
    categoryCounts: { MAN: 32, MACHINE: 31, MATERIAL: 24, METHOD: 21 },
    outcomeCounts: {
      APPROVED_SUPERVISOR_FIRST: 38,
      APPROVED_QC_FIRST: 25,
      REJECTED_SUPERVISOR: 11,
      REJECTED_QC: 8,
      CANCELLED_WITHDRAWN: 10,
      CANCELLED_SHIFT_ENDED: 16,
    },
    partWeights: [0, 0, 0, 1, 1, 2, 2, 3, 4, 5, 6, 7],
  },
  {
    seed: 43,
    shiftLoads: materialSupplierShiftLoads,
    categoryCounts: { MAN: 24, MACHINE: 23, MATERIAL: 35, METHOD: 26 },
    outcomeCounts: {
      APPROVED_SUPERVISOR_FIRST: 23,
      APPROVED_QC_FIRST: 32,
      REJECTED_SUPERVISOR: 12,
      REJECTED_QC: 16,
      CANCELLED_WITHDRAWN: 15,
      CANCELLED_SHIFT_ENDED: 10,
    },
    partWeights: [0, 1, 1, 1, 2, 2, 2, 3, 3, 4, 5, 6, 7],
  },
];

function historicalPlan(profile: HistoricalProfile, supplierIndex: number): SeedHenkatenPlan[] {
  const historicalCategories = shuffle(expandCounts(profile.categoryCounts), profile.seed);
  const historicalOutcomes = shuffle(expandCounts(profile.outcomeCounts), profile.seed + 101);
  avoidPersistentManReservations(historicalCategories, historicalOutcomes);
  avoidEmergencyShiftManChanges(historicalCategories, profile.shiftLoads[0]!);
  const records: SeedHenkatenPlan[] = [];
  let recordIndex = 0;
  for (let shiftIndex = 0; shiftIndex < profile.shiftLoads.length; shiftIndex += 1) {
    const shiftLoad = profile.shiftLoads[shiftIndex]!;
    const lineIndex =
      shiftIndex === 0 ? 0 : (shiftIndex + Math.floor(shiftIndex / 4) + supplierIndex) % 3;
    for (let localIndex = 0; localIndex < shiftLoad; localIndex += 1) {
      const outcome = historicalOutcomes[recordIndex]!;
      const resolutionMinuteDelay = outcome.startsWith('APPROVED_')
        ? 48 + ((recordIndex * 17 + profile.seed) % 83)
        : outcome.startsWith('REJECTED_')
          ? 18 + ((recordIndex * 11 + profile.seed) % 29)
          : 35 + ((recordIndex * 23 + profile.seed) % 116);
      records.push({
        category: historicalCategories[recordIndex]!,
        outcome,
        historicalShiftIndex: shiftIndex,
        historicalDayOffset: historicalOffset(shiftIndex, supplierIndex),
        lineIndex,
        shiftTemplateIndex: (shiftIndex * 2 + Math.floor(shiftIndex / 5) + supplierIndex) % 3,
        jobIndex: (recordIndex + Math.floor(recordIndex / 7) + supplierIndex) % 4,
        partIndex:
          profile.partWeights[
            (recordIndex * 5 + shiftIndex * 3 + supplierIndex) % profile.partWeights.length
          ]!,
        narrativeVariant: (recordIndex * 7 + shiftIndex + supplierIndex) % 5,
        eventMinuteOffset:
          25 +
          ((shiftIndex * 37 + supplierIndex * 23) % 75) +
          localIndex * (28 + ((shiftIndex * 11) % 14)),
        resolutionMinuteDelay,
      });
      recordIndex += 1;
    }
  }
  return records;
}

function avoidEmergencyShiftManChanges(
  plannedCategories: SeedCategory[],
  emergencyShiftLoad: number,
): void {
  for (let index = 0; index < emergencyShiftLoad; index += 1) {
    if (plannedCategories[index] !== 'MAN') continue;
    const replacementIndex = plannedCategories.findIndex(
      (category, candidate) => candidate >= emergencyShiftLoad && category !== 'MAN',
    );
    if (replacementIndex < 0) {
      throw new Error('Unable to keep emergency-start assignment evidence conflict-free.');
    }
    [plannedCategories[index], plannedCategories[replacementIndex]] = [
      plannedCategories[replacementIndex]!,
      plannedCategories[index]!,
    ];
  }
}

function avoidPersistentManReservations(
  plannedCategories: SeedCategory[],
  plannedOutcomes: SeedOutcome[],
): void {
  for (let index = 0; index < plannedOutcomes.length; index += 1) {
    if (plannedOutcomes[index] !== 'CANCELLED_SHIFT_ENDED' || plannedCategories[index] !== 'MAN') {
      continue;
    }
    const replacementIndex = plannedCategories.findIndex(
      (category, candidate) =>
        candidate > index &&
        category !== 'MAN' &&
        plannedOutcomes[candidate] !== 'CANCELLED_SHIFT_ENDED',
    );
    if (replacementIndex < 0) {
      throw new Error('Unable to distribute historical Man reservation scenarios safely.');
    }
    [plannedCategories[index], plannedCategories[replacementIndex]] = [
      plannedCategories[replacementIndex]!,
      plannedCategories[index]!,
    ];
  }
}

function historicalOffset(group: number, supplierIndex: number): number {
  const stagger = supplierIndex === 0 ? 0 : group % 3;
  if (group < 12) return 3 + group * 2 + stagger;
  if (group < 24) return 35 + (group - 12) * 7 + stagger;
  return 130 + (group - 24) * 20 + stagger;
}

function expandCounts<T extends string>(counts: Partial<Record<T, number>>): T[] {
  return Object.entries(counts).flatMap(([value, count]) =>
    Array.from({ length: count as number }, () => value as T),
  );
}

function shuffle<T>(values: T[], initialSeed: number): T[] {
  const result = [...values];
  let state = initialSeed >>> 0;
  for (let index = result.length - 1; index > 0; index -= 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    const target = state % (index + 1);
    [result[index], result[target]] = [result[target]!, result[index]!];
  }
  return result;
}

export function createLocalSeedPlan(): SupplierSeedPlan[] {
  return [
    {
      code: 'NPM',
      name: 'PT Nusantara Presisi Mobil',
      accent: '#2563eb',
      lineNames: ['Press & Stamping', 'Body Welding', 'Final Inspection'],
      jobNames: [
        ['Blank Loading', 'Press Forming', 'Trimming', 'Panel Check'],
        ['Jig Loading', 'Spot Welding', 'Stud Welding', 'Dimensional Check'],
        ['Visual Check', 'Torque Audit', 'Functional Check', 'Packing Release'],
      ],
      canvasLines: [
        {
          subtitle: 'Material flow · forming · transfer · dimensional assurance',
          zoneFill: '#eef4ff',
          machines: ['MATERIAL_RACK', 'PRESS_STAMPING', 'STRAIGHT_CONVEYOR', 'INSPECTION_CMM'],
        },
        {
          subtitle: 'Fixture loading · robotic joining · spot reinforcement · geometry check',
          zoneFill: '#eef4ff',
          machines: ['ASSEMBLY_FIXTURE', 'WELDING_ROBOT', 'SPOT_WELDING', 'INSPECTION_CMM'],
        },
        {
          subtitle: 'Final inspection · torque assurance · transfer · release packing',
          zoneFill: '#eef4ff',
          machines: ['INSPECTION_CMM', 'TORQUE_STATION', 'STRAIGHT_CONVEYOR', 'PACKING_STATION'],
        },
      ],
      parts: [
        { number: 'NPM-61110-A', name: 'Panel Inner RH' },
        { number: 'NPM-61120-A', name: 'Panel Inner LH' },
        { number: 'NPM-53601-B', name: 'Front Member Reinforcement' },
        { number: 'NPM-53712-C', name: 'Bracket Instrument Panel' },
        { number: 'NPM-57341-A', name: 'Seat Cross Member' },
        { number: 'NPM-61631-B', name: 'Quarter Panel Support' },
        { number: 'NPM-90119-T', name: 'Weld Nut M8' },
        { number: 'NPM-91511-S', name: 'Body Clip Retainer' },
      ],
      historical: historicalPlan(profiles[0]!, 0),
      live,
    },
    {
      code: 'GKI',
      name: 'PT Garuda Komponen Indonesia',
      accent: '#b45309',
      lineNames: ['Injection Molding', 'Component Assembly', 'Outgoing Quality'],
      jobNames: [
        ['Material Drying', 'Molding', 'Gate Cutting', 'Appearance Check'],
        ['Component Feeding', 'Sub Assembly', 'Torque Process', 'Leak Test'],
        ['Sampling', 'Dimension Check', 'Function Test', 'Shipment Release'],
      ],
      canvasLines: [
        {
          subtitle: 'Material preparation · molding · transfer · appearance assurance',
          zoneFill: '#fff7ed',
          machines: [
            'MATERIAL_RACK_2D',
            'INJECTION_MOLDING_2D',
            'STRAIGHT_CONVEYOR_2D',
            'INSPECTION_CMM_2D',
          ],
        },
        {
          subtitle: 'Component feeding · fixture assembly · torque control · line transfer',
          zoneFill: '#fff7ed',
          machines: [
            'MATERIAL_RACK_2D',
            'ASSEMBLY_FIXTURE_2D',
            'TORQUE_STATION_2D',
            'ROLLER_CONVEYOR_2D',
          ],
        },
        {
          subtitle: 'Dimensional assurance · functional control · transfer · shipment release',
          zoneFill: '#fff7ed',
          machines: [
            'INSPECTION_CMM_2D',
            'TORQUE_STATION_2D',
            'ROLLER_CONVEYOR_2D',
            'PACKING_STATION_2D',
          ],
        },
      ],
      parts: [
        { number: 'GKI-17700-P', name: 'Air Cleaner Housing' },
        { number: 'GKI-17701-P', name: 'Air Cleaner Cover' },
        { number: 'GKI-16571-R', name: 'Radiator Reservoir' },
        { number: 'GKI-85315-W', name: 'Washer Tank Body' },
        { number: 'GKI-77251-C', name: 'Console Side Cover' },
        { number: 'GKI-55420-D', name: 'Instrument Panel Duct' },
        { number: 'GKI-90467-G', name: 'Resin Grommet' },
        { number: 'GKI-90189-F', name: 'Plastic Fastener' },
      ],
      historical: historicalPlan(profiles[1]!, 1),
      live,
    },
  ];
}

export function localSeedSummary(plan: SupplierSeedPlan[]) {
  return plan.map((supplier) => {
    const records = [...supplier.historical, ...supplier.live];
    return {
      code: supplier.code,
      henkaten: records.length,
      categories: Object.fromEntries(
        categories.map((category) => [
          category,
          records.filter((record) => record.category === category).length,
        ]),
      ),
      statuses: {
        APPROVED: records.filter((record) => record.outcome.startsWith('APPROVED_')).length,
        REJECTED: records.filter((record) => record.outcome.startsWith('REJECTED_')).length,
        CANCELLED: records.filter((record) => record.outcome.startsWith('CANCELLED_')).length,
        OPEN: records.filter((record) => record.outcome.startsWith('OPEN_')).length,
      },
    };
  });
}

export function assertLocalSeedEnvironment(environment: NodeJS.ProcessEnv): void {
  if (environment.NODE_ENV !== 'development') {
    throw new Error('Local seed requires NODE_ENV=development.');
  }
  if (environment.LOCAL_SEED_CONFIRM !== LOCAL_SEED_CONFIRMATION) {
    throw new Error('Local seed confirmation marker is missing or invalid.');
  }
  const apiOrigin = new URL(environment.LOCAL_SEED_API_ORIGIN ?? 'http://127.0.0.1:3000');
  if (!['127.0.0.1', 'localhost', '::1'].includes(apiOrigin.hostname)) {
    throw new Error('Local seed API origin must be loopback-only.');
  }
  const databaseUrl = new URL(environment.DATABASE_URL ?? '');
  if (databaseUrl.protocol !== 'postgresql:') {
    throw new Error('Local seed requires a PostgreSQL DATABASE_URL.');
  }
  if (!['postgres', '127.0.0.1', 'localhost', '::1'].includes(databaseUrl.hostname)) {
    throw new Error('Local seed database host is not the local Compose PostgreSQL service.');
  }
  const expectedDatabase = environment.POSTGRES_DB ?? 'supplier_henkaten';
  if (databaseUrl.pathname.slice(1) !== expectedDatabase || expectedDatabase.endsWith('_test')) {
    throw new Error('Local seed must target the local main database, never the test database.');
  }
  if (environment.CI === 'true') {
    throw new Error('Local interactive seed is disabled in CI.');
  }
  if (environment.PUSH_ENABLED === 'true') {
    throw new Error(
      'Local seed requires PUSH_ENABLED=false; push subscriptions must be activated on a real browser installation.',
    );
  }
}
