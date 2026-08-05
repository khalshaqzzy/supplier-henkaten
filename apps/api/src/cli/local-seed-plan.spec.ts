import { describe, expect, it } from 'vitest';

import {
  LOCAL_SEED_CONFIRMATION,
  LOCAL_SEED_HENKATEN_PER_SUPPLIER,
  createLocalSeedPlan,
  assertLocalSeedEnvironment,
  localSeedSummary,
} from './local-seed-plan.js';

describe('local seed plan', () => {
  it('builds exactly two comprehensive but operationally distinct Hosted datasets', () => {
    const plan = createLocalSeedPlan();
    expect(plan).toHaveLength(2);
    expect(new Set(plan.map(({ code }) => code)).size).toBe(2);
    expect(createLocalSeedPlan()).toEqual(plan);
    const [npm, gki] = localSeedSummary(plan);
    expect(npm).toEqual({
      code: 'NPM',
      henkaten: LOCAL_SEED_HENKATEN_PER_SUPPLIER,
      categories: { MAN: 36, MACHINE: 34, MATERIAL: 27, METHOD: 23 },
      statuses: { APPROVED: 66, REJECTED: 20, CANCELLED: 26, OPEN: 8 },
    });
    expect(gki).toEqual({
      code: 'GKI',
      henkaten: LOCAL_SEED_HENKATEN_PER_SUPPLIER,
      categories: { MAN: 28, MACHINE: 26, MATERIAL: 38, METHOD: 28 },
      statuses: { APPROVED: 58, REJECTED: 29, CANCELLED: 25, OPEN: 8 },
    });
    const shiftLoads = plan.map((supplier) =>
      Array.from({ length: 36 }, (_, shiftIndex) =>
        supplier.historical.filter(
          ({ historicalShiftIndex }) => historicalShiftIndex === shiftIndex,
        ),
      ).map(({ length }) => length),
    );
    expect(shiftLoads[0]).not.toEqual(shiftLoads[1]);
    expect(
      shiftLoads.map((loads) =>
        [1, 2, 3, 4, 5, 6].map((load) => loads.filter((value) => value === load).length),
      )[0],
    ).not.toEqual(
      shiftLoads.map((loads) =>
        [1, 2, 3, 4, 5, 6].map((load) => loads.filter((value) => value === load).length),
      )[1],
    );
  });

  it('combines dense recent history with quarterly and annual-range evidence', () => {
    for (const supplier of createLocalSeedPlan()) {
      expect(supplier.historical).toHaveLength(108);
      expect(supplier.live).toHaveLength(12);
      const offsets = supplier.historical.map(({ historicalDayOffset }) => historicalDayOffset!);
      expect(offsets.every((offset) => offset >= 1 && offset <= 365)).toBe(true);
      expect(offsets.filter((offset) => offset <= 30).length).toBeGreaterThanOrEqual(30);
      expect(offsets.some((offset) => offset >= 90)).toBe(true);
      expect(offsets.some((offset) => offset >= 300)).toBe(true);
      expect(
        supplier.live.every(({ historicalDayOffset }) => historicalDayOffset === undefined),
      ).toBe(true);
    }
  });

  it('varies shift load, line, part, event time, resolution time, and checklist evidence', () => {
    for (const supplier of createLocalSeedPlan()) {
      const shifts = Array.from({ length: 36 }, (_, shiftIndex) =>
        supplier.historical.filter(
          ({ historicalShiftIndex }) => historicalShiftIndex === shiftIndex,
        ),
      );
      const loads = shifts.map(({ length }) => length);
      expect(loads.reduce((sum, load) => sum + load, 0)).toBe(108);
      expect(Math.min(...loads)).toBe(1);
      expect(Math.max(...loads)).toBe(6);
      expect(new Set(loads).size).toBeGreaterThanOrEqual(5);

      const lineLoads = [0, 1, 2].map(
        (lineIndex) =>
          supplier.historical.filter((record) => record.lineIndex === lineIndex).length,
      );
      expect(new Set(lineLoads).size).toBeGreaterThan(1);

      const partLoads = Array.from(
        { length: 8 },
        (_, partIndex) =>
          supplier.historical.filter((record) => record.partIndex === partIndex).length,
      );
      expect(partLoads.every((load) => load > 0)).toBe(true);
      expect(Math.max(...partLoads) - Math.min(...partLoads)).toBeGreaterThan(5);

      const eventMinutes = supplier.historical.map(({ eventMinuteOffset }) => eventMinuteOffset!);
      const resolutionMinutes = supplier.historical.map(
        ({ resolutionMinuteDelay }) => resolutionMinuteDelay!,
      );
      expect(Math.min(...eventMinutes)).toBeGreaterThanOrEqual(25);
      expect(Math.max(...eventMinutes)).toBeLessThan(400);
      expect(new Set(eventMinutes).size).toBeGreaterThan(30);
      expect(Math.min(...resolutionMinutes)).toBeGreaterThanOrEqual(18);
      expect(new Set(resolutionMinutes).size).toBeGreaterThan(30);
      expect(
        supplier.historical.some(
          ({ category, outcome }) => category === 'MAN' && outcome === 'CANCELLED_SHIFT_ENDED',
        ),
      ).toBe(false);
      expect(shifts[0]!.some(({ category }) => category === 'MAN')).toBe(false);
    }
  });

  it('retains every approval, rejection, withdrawal, cancellation, and open-route scenario', () => {
    const outcomes = new Set(
      createLocalSeedPlan().flatMap(({ historical, live }) =>
        [...historical, ...live].map(({ outcome }) => outcome),
      ),
    );
    expect(outcomes).toEqual(
      new Set([
        'APPROVED_SUPERVISOR_FIRST',
        'APPROVED_QC_FIRST',
        'REJECTED_SUPERVISOR',
        'REJECTED_QC',
        'CANCELLED_WITHDRAWN',
        'CANCELLED_SHIFT_ENDED',
        'OPEN_PENDING',
        'OPEN_SUPERVISOR_APPROVED',
        'OPEN_QC_APPROVED',
      ]),
    );
  });

  it('rejects non-local, production, test-database, missing-confirmation, CI, and push-enabled execution', () => {
    const valid = {
      NODE_ENV: 'development',
      LOCAL_SEED_CONFIRM: LOCAL_SEED_CONFIRMATION,
      LOCAL_SEED_API_ORIGIN: 'http://127.0.0.1:3000',
      DATABASE_URL: 'postgresql://user:password@postgres:5432/supplier_henkaten',
      POSTGRES_DB: 'supplier_henkaten',
    };
    expect(() => assertLocalSeedEnvironment(valid)).not.toThrow();
    expect(() => assertLocalSeedEnvironment({ ...valid, NODE_ENV: 'production' })).toThrow();
    expect(() => assertLocalSeedEnvironment({ ...valid, LOCAL_SEED_CONFIRM: '' })).toThrow();
    expect(() =>
      assertLocalSeedEnvironment({ ...valid, LOCAL_SEED_API_ORIGIN: 'https://example.com' }),
    ).toThrow();
    expect(() =>
      assertLocalSeedEnvironment({
        ...valid,
        DATABASE_URL: 'postgresql://user:password@postgres:5432/supplier_henkaten_test',
      }),
    ).toThrow();
    expect(() => assertLocalSeedEnvironment({ ...valid, CI: 'true' })).toThrow();
    expect(() => assertLocalSeedEnvironment({ ...valid, PUSH_ENABLED: 'true' })).toThrow(
      'push subscriptions must be activated on a real browser installation',
    );
  });
});
