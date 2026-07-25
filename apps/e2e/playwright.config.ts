import { defineConfig, devices } from '@playwright/test';

const epoch = process.env.E2E_EPOCH ?? 'local';
const edgeExecutablePath = process.env.E2E_EDGE_EXECUTABLE_PATH;

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  outputDir: `../../test-results/e2e/${epoch}`,
  reporter: [
    ['line'],
    ['blob', { outputFile: `../../blob-report/${epoch}.zip` }],
    ['html', { outputFolder: `../../playwright-report/${epoch}`, open: 'never' }],
  ],
  use: {
    baseURL: process.env.E2E_SUPPLIER_ORIGIN,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    viewport: { width: 1280, height: 720 },
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'msedge',
      grep: /@edge/,
      use: {
        ...devices['Desktop Edge'],
        ...(edgeExecutablePath ? { channel: undefined, executablePath: edgeExecutablePath } : {}),
      },
    },
  ],
});
