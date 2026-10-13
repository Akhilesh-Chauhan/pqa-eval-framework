import { defineConfig } from '@playwright/test';
import { SESSION_FILE } from './src/admin/admin-env.js';

// Credentials and targets live in .env (gitignored; template in .env.example).
// Variables already exported in the shell win over the file.
try {
  process.loadEnvFile();
} catch {
  // No .env — the suites report exactly which variable is missing.
}
// One id for the whole run. Workers inherit it, so names derived from it (the
// lifecycle slugs) stay the same when a worker restarts after a failure.
process.env.PQA_RUN_ID ||= Date.now().toString(36);

export default defineConfig({
  testDir: './src',
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 4,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['junit', { outputFile: 'playwright-report/junit.xml' }],
    ['./src/support/gap-reporter.ts'],
    ['./src/support/evidence-reporter.ts'],
    ['./src/support/html-report.ts'],
  ],
  // A screenshot of every test for the HTML report; the evidence reporter also files
  // failures with a REPRO.md. Do not pass --reporter on the command line: it replaces these.
  use: {
    screenshot: 'on',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
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
    // Super Admin panel. Run `npm run qa:admin:login` first (you type the OTP once).
    {
      name: 'admin-session',
      testDir: './src/admin',
      testMatch: /session\.setup\.ts$/,
    },
    // Signed-out checks: login page and route protection. Need no session.
    {
      name: 'admin-public',
      testDir: './src/admin/public',
      testMatch: /.*\.spec\.ts$/,
      use: { baseURL: process.env.PQA_ADMIN_URL },
    },
    {
      name: 'admin',
      testDir: './src/admin',
      testMatch: /.*\.spec\.ts$/,
      testIgnore: /\/public\//,
      dependencies: ['admin-session'],
      // One shared session whose refresh cookie rotates: run the tests one at a time.
      workers: 1,
      use: { baseURL: process.env.PQA_ADMIN_URL, storageState: SESSION_FILE },
    },
  ],
});
