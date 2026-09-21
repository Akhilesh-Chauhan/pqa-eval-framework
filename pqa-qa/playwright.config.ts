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
    {
      name: 'unit',
      testMatch: /.*\.spec\.ts$/,
      testDir: './src/support',
    },
    {
      name: 'isolation',
      testMatch: /.*\.spec\.ts$/,
      testDir: './src/isolation',
      dependencies: ['unit'],
    },
  ],
});
