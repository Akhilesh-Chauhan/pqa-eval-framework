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
    // UI/UX design conformance: cases written only from the shared design's FINAL page (PQA Builder/qa/design-test-cases.md, DS-*).
    // Portal personas sign in once each with `npm run qa:design:login -- <persona>`; a persona without a saved
    // session reports "not measured". One session per persona whose refresh cookie rotates: one worker.
    {
      name: 'design-session',
      testDir: './src/design',
      testMatch: /session\.setup\.ts$/,
    },
    {
      name: 'design-portal',
      testDir: './src/design/portal',
      testMatch: /.*\.spec\.ts$/,
      dependencies: ['design-session'],
      workers: 1,
    },
    // AI Assistant ingestion golden dataset (PQA Builder/qa/specs/2026-10-13-golden-ingestion-dataset-design.md).
    // Writes only to the disposable tenant PQA_INGEST_TENANT (qi + 4 hex). Order: provision → ingestion → retire.
    // Defined only for the qa:ingest* scripts (PQA_INGEST=1): a plain `npm run qa` must never start a multi-hour
    // run next to the retire project that archives its tenant.
    ...(process.env.PQA_INGEST === '1'
      ? [
        {
          name: 'ingestion-provision',
          testDir: './src/ingestion',
          testMatch: /provision\.spec\.ts$/,
          dependencies: ['admin-session'],
          workers: 1,
          use: { baseURL: process.env.PQA_ADMIN_URL, storageState: SESSION_FILE },
        },
        {
          name: 'ingestion',
          testDir: './src/ingestion',
          testMatch: /\d-[a-z-]+\.spec\.ts$/,
          dependencies: ['admin-session'],
          workers: 1,
          // 330 s config-cache waits; a batch may take the route's full 300 s.
          timeout: 600_000,
          use: { baseURL: process.env.PQA_ADMIN_URL, storageState: SESSION_FILE },
        },
        {
          name: 'ingestion-retire',
          testDir: './src/ingestion',
          testMatch: /retire\.spec\.ts$/,
          dependencies: ['admin-session'],
          workers: 1,
          use: { baseURL: process.env.PQA_ADMIN_URL, storageState: SESSION_FILE },
        },
        ]
      : []),
  ],
});
