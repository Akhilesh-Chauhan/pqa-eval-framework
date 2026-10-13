import type { Page } from '@playwright/test';
import { test, expect, blockWrites } from './fixtures.js';

// /admins on the shared env. Completing an invite creates a PERMANENT super admin (no deactivate
// or delete), so no invite is ever sent: the OTP routes are aborted by blockWrites or answered by
// the test itself (registered after blockWrites, so they win).

const INTRO =
  'Add a platform administrator. The confirmation code goes to the platform operator inbox. The new admin later signs in with a code sent to their own @digitalindia.gov.in address.';
const DOMAIN_MSG = 'Super Admin email must be a @digitalindia.gov.in address.';
const GENERIC = 'Something went wrong. Please try again.';
const INVITEE = 'qa.new@digitalindia.gov.in';
const LABEL: Record<string, string> = { PENDING_FIRST_LOGIN: 'Pending first login', ACTIVE: 'Active', DEACTIVATED: 'Deactivated' };

type Admin = { name: string; email: string; status: string };
// A6 documents the body only as "{users}": accept it bare or inside the usual {data} envelope.
const usersOf = (body: any): Admin[] => body.data?.users ?? body.users;

const items = (page: Page) => page.getByRole('main').getByRole('listitem');
const item = (page: Page, email: string) => items(page).filter({ has: page.getByText(email, { exact: true }) });
const nameField = (page: Page) => page.getByRole('textbox', { name: 'Admin name' });
const emailField = (page: Page) => page.getByRole('textbox', { name: 'Admin email' });
const sendCode = (page: Page) => page.getByRole('button', { name: 'Send confirmation code' });
const addAdmin = (page: Page) => page.getByRole('button', { name: 'Add admin' });
const otpField = (page: Page) => page.locator('#admin-invite-otp');
const helper = (email: string) => `Enter the code sent to the platform operator inbox for ${email}.`;

/** The real GET /api/admins with its user list replaced, so the envelope stays the server's own. */
async function fakeAdmins(page: Page, users: Admin[]): Promise<void> {
  await page.route('**/api/admins', async (route) => {
    const body = await (await route.fetch()).json();
    const holder = body.data?.users ? body.data : body;
    holder.users = users.map((u, i) => ({ ...holder.users[0], id: `qa-${i}`, ...u }));
    await route.fulfill({ json: body });
  });
}

/** Answers POST /api/admins/otp/{phase} in the browser: no code is sent and no admin is created. */
async function answerOtp(page: Page, phase: 'request' | 'verify', status: number, json: object, delayMs = 0): Promise<void> {
  await page.route(`**/api/admins/otp/${phase}`, async (route) => {
    await new Promise((r) => setTimeout(r, delayMs));
    await route.fulfill({ status, json });
  });
}

async function fillInvite(page: Page, name: string, email: string): Promise<void> {
  await nameField(page).fill(name);
  await emailField(page).fill(email);
}

test.describe('A5.1 Admin list', () => {
  test('SA-ADM-01 intro copy', async ({ page }) => {
    await test.step('Open /admins', () => page.goto('/admins'));
    await test.step(`Expect "${INTRO}"`, async () => {
      await expect(page.getByText(INTRO, { exact: true })).toBeVisible();
    });
  });

  test('SA-ADM-02 a stacked list of name, email, status matching GET /api/admins; the signed-in admin is Active', async ({ page, env }) => {
    const users = await test.step('GET /api/admins', async () => {
      const res = await page.request.get('/api/admins');
      expect(res.status()).toBe(200);
      return usersOf(await res.json());
    });
    await test.step('Open /admins', () => page.goto('/admins'));
    await test.step(`Expect ${users.length} list entries (no table), each name / email / status`, async () => {
      await expect(items(page)).toHaveCount(users.length);
      await expect(page.getByRole('table')).toHaveCount(0);
      for (const u of users) await expect.soft(item(page, u.email).locator('p')).toHaveText([u.name, u.email, LABEL[u.status] ?? u.status]);
    });
    await test.step(`Expect ${env.adminEmail} shown "Active"`, async () => {
      await expect(item(page, env.adminEmail).locator('p').last()).toHaveText('Active');
    });
  });

  test('SA-ADM-03 status labels; an unknown code is shown verbatim', async ({ page }) => {
    const fake: Admin[] = [
      { name: 'QA Pending', email: 'qa.pending@digitalindia.gov.in', status: 'PENDING_FIRST_LOGIN' },
      { name: 'QA Active', email: 'qa.active@digitalindia.gov.in', status: 'ACTIVE' },
      { name: 'QA Deactivated', email: 'qa.deactivated@digitalindia.gov.in', status: 'DEACTIVATED' },
      { name: 'QA Weird', email: 'qa.weird@digitalindia.gov.in', status: 'WEIRD_CODE' },
    ];
    await fakeAdmins(page, fake);
    await test.step('Open /admins with GET /api/admins answered by the test: one user per status plus WEIRD_CODE', () => page.goto('/admins'));
    await test.step('Expect "Pending first login", "Active", "Deactivated", "WEIRD_CODE"', async () => {
      for (const u of fake) await expect.soft(item(page, u.email).locator('p').last()).toHaveText(LABEL[u.status] ?? u.status);
    });
  });

  test('SA-ADM-04 loading state', async ({ page }) => {
    await page.route('**/api/admins', async (route) => {
      await new Promise((r) => setTimeout(r, 2_000));
      await route.fallback();
    });
    await test.step('Open /admins with GET /api/admins delayed 2 s', () => page.goto('/admins'));
    await test.step('Expect "Loading admins…", then the list', async () => {
      await expect(page.getByText('Loading admins…')).toBeVisible();
      await expect(items(page).first()).toBeVisible();
    });
  });

  test('SA-ADM-05 empty state', async ({ page }) => {
    await fakeAdmins(page, []);
    await test.step('Open /admins with GET /api/admins answered with an empty list', () => page.goto('/admins'));
    await test.step('Expect "No admins yet."', async () => {
      await expect(page.getByText('No admins yet.')).toBeVisible();
    });
  });

  test('SA-ADM-06 a failed load shows the server message, else "Could not load admins"', async ({ page }) => {
    const message = 'QA mock: identity unreachable';
    await page.route('**/api/admins', (route) => route.fulfill({ status: 502, json: { error: { message } } }));
    await test.step(`Open /admins with GET /api/admins answered 502 "${message}"`, () => page.goto('/admins'));
    await test.step(`Expect "${message}" in an alert`, async () => {
      await expect(page.getByRole('alert').filter({ hasText: message })).toBeVisible();
    });
    await page.route('**/api/admins', (route) => route.fulfill({ status: 502, json: { error: {} } }));
    await test.step('Open /admins again with 502 and no message', () => page.goto('/admins'));
    await test.step('Expect "Could not load admins" in an alert', async () => {
      await expect(page.getByRole('alert').filter({ hasText: 'Could not load admins' })).toBeVisible();
    });
  });

  test('SA-ADM-07 the list is read-only (known gap)', async ({ page }) => {
    await test.step('Open /admins', () => page.goto('/admins'));
    await test.step('Expect no edit, deactivate, resend-invitation or delete control on any entry', async () => {
      await expect(items(page).first()).toBeVisible();
      await expect(items(page).locator('button, a, input, select')).toHaveCount(0);
    });
  });
});

test.describe('A5.2 Add an administrator', () => {
  test('SA-ADM-08 Send confirmation code stays disabled while the name is blank', async ({ page }) => {
    const writes = await blockWrites(page);
    await test.step(`Open /admins; email ${INVITEE}, name blank`, async () => {
      await page.goto('/admins');
      await emailField(page).fill(INVITEE);
    });
    await test.step('Expect Send confirmation code disabled', async () => {
      await expect(sendCode(page)).toBeDisabled();
    });
    await test.step('Type a name: expect it enabled (not pressed), nothing sent', async () => {
      await nameField(page).fill('QA');
      await expect(sendCode(page)).toBeEnabled();
      expect(writes).toEqual([]);
    });
  });

  test('SA-ADM-09 a non-government address is refused in the browser and nothing is sent', async ({ page }) => {
    const writes = await blockWrites(page);
    await test.step('Open /admins; name "QA", email someone@gmail.com; press Send confirmation code', async () => {
      await page.goto('/admins');
      await fillInvite(page, 'QA', 'someone@gmail.com');
      await sendCode(page).click();
    });
    await test.step(`Expect "${DOMAIN_MSG}" and no request`, async () => {
      await expect(page.getByText(DOMAIN_MSG)).toBeVisible();
      expect(writes).toEqual([]);
    });
  });

  for (const email of ['x@digitalindia.gov.in.evil.com', 'x@evil-digitalindia.gov.in', 'x@sub.digitalindia.gov.in', 'x@digitalindia.gov.in ']) {
    test(`SA-ADM-10 look-alike domain refused in the browser: "${email}"`, async ({ page }) => {
      const writes = await blockWrites(page);
      await test.step(`Open /admins; name "QA", email "${email}"; press Send confirmation code`, async () => {
        await page.goto('/admins');
        await fillInvite(page, 'QA', email);
        await sendCode(page).click();
      });
      await test.step(`Expect "${DOMAIN_MSG}" and no request`, async () => {
        await expect(page.getByText(DOMAIN_MSG)).toBeVisible();
        expect(writes).toEqual([]);
      });
    });
  }

  test('SA-ADM-10 (question) upper-case x@DIGITALINDIA.GOV.IN — record what happens', async ({ page }) => {
    const writes = await blockWrites(page);
    await test.step('Open /admins; name "QA", email x@DIGITALINDIA.GOV.IN; press Send confirmation code', async () => {
      await page.goto('/admins');
      await fillInvite(page, 'QA', 'x@DIGITALINDIA.GOV.IN');
      await sendCode(page).click();
    });
    await test.step('Record whether the browser refuses it or attempts a request (aborted by the test)', async () => {
      await expect.poll(async () => writes.length > 0 || (await page.getByText(DOMAIN_MSG).isVisible())).toBe(true);
      const seen = writes.length ? 'accepted by the browser (request attempted, aborted by the test)' : 'refused with the domain message';
      test.info().annotations.push({ type: 'question', description: `x@DIGITALINDIA.GOV.IN: ${seen}` });
    });
  });

  test('SA-ADM-11 phase 2 names the operator inbox and the new address', async ({ page }) => {
    const writes = await blockWrites(page);
    await answerOtp(page, 'request', 200, { data: {} }, 1_500);
    await test.step(`Open /admins; name "QA Invitee", email ${INVITEE}; press Send confirmation code (answered by the test, no email)`, async () => {
      await page.goto('/admins');
      await fillInvite(page, 'QA Invitee', INVITEE);
      await sendCode(page).click();
    });
    await test.step(`Expect "Sending…", then "${helper(INVITEE)}"`, async () => {
      await expect(page.getByRole('button', { name: 'Sending…' })).toBeVisible();
      await expect(page.getByText(helper(INVITEE))).toBeVisible();
      expect(writes).toEqual([]);
    });
  });

  test('SA-ADM-12 the code field keeps digits only; Add admin needs exactly 6', async ({ page }) => {
    const writes = await blockWrites(page);
    await answerOtp(page, 'request', 200, { data: {} });
    await test.step(`Open /admins; request a code for ${INVITEE} (answered by the test)`, async () => {
      await page.goto('/admins');
      await fillInvite(page, 'QA Invitee', INVITEE);
      await sendCode(page).click();
      await expect(otpField(page)).toBeVisible();
    });
    await test.step('Type "12a3-45": expect "12345" and Add admin disabled', async () => {
      await otpField(page).pressSequentially('12a3-45');
      await expect(otpField(page)).toHaveValue('12345');
      await expect(addAdmin(page)).toBeDisabled();
    });
    await test.step('Type a 6th digit: expect Add admin enabled (not pressed)', async () => {
      await otpField(page).pressSequentially('6');
      await expect(otpField(page)).toHaveValue('123456');
      await expect(addAdmin(page)).toBeEnabled();
      expect(writes).toEqual([]);
    });
  });

  test('SA-ADM-13 phase failure messages, with the generic fallback when the server gives none', async ({ page }) => {
    const writes = await blockWrites(page);
    await test.step(`Open /admins; name "QA Invitee", email ${INVITEE}`, async () => {
      await page.goto('/admins');
      await fillInvite(page, 'QA Invitee', INVITEE);
    });
    await answerOtp(page, 'request', 502, { error: { message: 'Could not send a code' } });
    await test.step('Send confirmation code, answered 502 "Could not send a code": expect that message', async () => {
      await sendCode(page).click();
      await expect(page.getByText('Could not send a code')).toBeVisible();
    });
    await answerOtp(page, 'request', 502, { error: {} });
    await test.step(`Send again, answered 502 with no message: expect "${GENERIC}"`, async () => {
      await sendCode(page).click();
      await expect(page.getByText(GENERIC)).toBeVisible();
    });
    await answerOtp(page, 'request', 200, { data: {} });
    await answerOtp(page, 'verify', 400, { error: { message: 'Could not verify' } });
    await test.step('Send again (answered OK); enter 123456, Add admin answered 400 "Could not verify": expect that message', async () => {
      await sendCode(page).click();
      await otpField(page).fill('123456');
      await addAdmin(page).click();
      await expect(page.getByText('Could not verify')).toBeVisible();
    });
    await answerOtp(page, 'verify', 400, { error: {} });
    await test.step(`Add admin again, answered 400 with no message: expect "${GENERIC}"`, async () => {
      await otpField(page).fill('123456');
      await addAdmin(page).click();
      await expect(page.getByText(GENERIC)).toBeVisible();
      expect(writes).toEqual([]);
    });
  });
});
