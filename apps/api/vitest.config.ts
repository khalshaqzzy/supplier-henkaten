import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  oxc: false,
  plugins: [swc.vite()],
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.spec.ts'],
          exclude: ['src/**/*.integration.spec.ts', 'src/**/*.baseline.spec.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'integration',
          include: ['src/**/*.integration.spec.ts'],
          environment: 'node',
          fileParallelism: false,
          maxWorkers: 1,
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
      {
        test: {
          name: 'baseline',
          include: ['src/**/*.baseline.spec.ts'],
          environment: 'node',
          fileParallelism: false,
          maxWorkers: 1,
          testTimeout: 120_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
