import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './src',
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 4,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['junit', { outputFile: 'playwright-report/junit.xml' }],
    // ['./src/support/gap-reporter.ts'],  <- enabled in Task 7
  ],
  projects: [
    // Support-layer unit tests. No network, no environment, no credentials.
    {
      name: 'unit',
      testDir: './src/support',
      testMatch: /.*\.spec\.ts$/,
    },
    // Probes the deployed target and authenticates personas. Only the
    // isolation project depends on it, so `npm run qa:unit` stays offline.
    {
      name: 'setup',
      testDir: './src/setup',
      testMatch: /.*\.setup\.ts$/,
    },
    {
      name: 'isolation',
      testDir: './src/isolation',
      testMatch: /.*\.spec\.ts$/,
      dependencies: ['unit', 'setup'],
    },
  ],
});
