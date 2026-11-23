// Keeps the saved Super Admin session from idling out (it ends after about 1 h without use) during a pause:
// every PQA_KEEPALIVE_MIN minutes (default 20) it calls GET /api/auth/session and saves any rotated cookies back.
// Run it ONLY while no test run is using the session — two processes refreshing one session invalidate it.
// Usage: node --env-file=.env scripts/keepalive.mjs   (stop it with Ctrl+C before starting a run)
import { request } from '@playwright/test';

const FILE = 'src/.auth/super-admin.json';
const everyMin = Number(process.env.PQA_KEEPALIVE_MIN ?? 20);
for (;;) {
  const ctx = await request.newContext({ baseURL: process.env.PQA_ADMIN_URL, storageState: FILE });
  const res = await ctx.get('/api/auth/session');
  if (res.status() === 200) await ctx.storageState({ path: FILE });
  console.log(`${new Date().toISOString()} session ${res.status()}`);
  await ctx.dispose();
  if (res.status() !== 200) process.exit(1); // gone: a new npm run qa:admin:login is needed
  await new Promise((r) => setTimeout(r, everyMin * 60_000));
}
