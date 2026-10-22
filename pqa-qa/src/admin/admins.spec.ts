import type { Page } from '@playwright/test';
import { test, expect, blockWrites } from './fixtures.js';

// /admins on the shared env. Completing an invite creates a PERMANENT super admin (no deactivate
// or delete), so no invite is ever sent: the OTP routes are aborted by blockWrites or answered by
// the test itself (registered after blockWrites, so they win).

// A5's intro copy; the live page words it differently (22 Oct), so SA-ADM-01 checks its two facts.
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
// Ids from A5.2: the live form opens from an "Add admin" button above the list (22 Oct).
const nameField = (page: Page) => page.locator('#admin-invite-name');
const emailField = (page: Page) => page.locator('#admin-invite-email');
const sendCode = (page: Page) => page.getByRole('button', { name: 'Send confirmation code' });
// Phase 2's code is six one-digit boxes, "Confirmation code digit N of 6", in group "Confirmation code" (22 Oct;
// A5.2 documents one #admin-invite-otp field).
const codeBoxes = (page: Page) => page.getByRole('group', { name: 'Confirmation code' }).getByRole('textbox');
const codeValue = async (page: Page): Promise<string> => (await codeBoxes(page).evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))).join('');
/** Clears the boxes and types `code` from the first one, as a person would. */
async function enterCode(page: Page, code: string): Promise<void> {
  for (let i = 0; i < (await codeBoxes(page).count()); i++) await codeBoxes(page).nth(i).fill('');
  await codeBoxes(page).first().click();
  await page.keyboard.type(code);
}
// Phase 2's submit, inside the dialog: the button that opens the form is also named "Add admin".
const addAdmin = (page: Page) => page.getByRole('dialog', { name: 'Add a Super Admin' }).getByRole('button', { name: 'Add admin' });
const status = (page: Page, email: string, label: string) => item(page, email).getByText(label, { exact: true });

/** Opens /admins and the add-admin form (it now opens from the "Add admin" button). */
async function openInvite(page: Page): Promise<void> {
  await page.goto('/admins');
  if (!(await nameField(page).isVisible())) await page.getByRole('main').getByRole('button', { name: 'Add admin' }).first().click();
  await expect(nameField(page)).toBeVisible();
}
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
    await test.step(`Expect the intro's two facts (A5: "${INTRO}")`, async () => {
      const main = page.getByRole('main');
      await expect(main.getByText(/confirmation code .*goes to the platform operator inbox/i)).toBeVisible();
      await expect(main.getByText(/signs in with a code sent to their own @digitalindia\.gov\.in address/i)).toBeVisible();
      if (!(await page.getByText(INTRO, { exact: true }).count())) test.info().annotations.push({ type: 'deviation', description: 'The intro is worded differently from A5 (same two facts).' });
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
      for (const u of users) {
        await expect.soft(item(page, u.email).locator('p').first(), u.email).toHaveText(u.name);
        await expect.soft(status(page, u.email, LABEL[u.status] ?? u.status), `${u.email} status`).toBeVisible();
      }
      // Live entries also carry a roles line (e.g. "Tenant Admin, Secretary") between email and status; A5.1 lists three lines.
      if ((await items(page).first().locator('p').count()) > 2) test.info().annotations.push({ type: 'deviation', description: 'Each entry shows a fourth line (roles) — A5.1 says name, email, status.' });
    });
    await test.step(`Expect ${env.adminEmail} shown "Active"`, async () => {
      await expect(status(page, env.adminEmail, 'Active')).toBeVisible();
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
      for (const u of fake) await expect.soft(status(page, u.email, LABEL[u.status] ?? u.status), u.email).toBeVisible();
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
      await openInvite(page);
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
      await openInvite(page);
      await fillInvite(page, 'QA', 'someone@gmail.com');
      await sendCode(page).click();
    });
    await test.step(`Expect "${DOMAIN_MSG}" and no request`, async () => {
      await expect(page.getByText(DOMAIN_MSG)).toBeVisible();
      expect(writes).toEqual([]);
    });
  });

  // 21 Oct spec (A5.2, §6.6): the raw value must match ^[^@\s]+@digitalindia\.gov\.in$ — no space anywhere, lower-case domain.
  for (const email of [
    'x@digitalindia.gov.in.evil.com', 'x@evil-digitalindia.gov.in', 'x@sub.digitalindia.gov.in',
    'x@digitalindia.gov.in ', ' x@digitalindia.gov.in', 'qa new@digitalindia.gov.in', 'x@DIGITALINDIA.GOV.IN',
  ]) {
    test(`SA-ADM-10 look-alike domain refused in the browser: "${email}"`, async ({ page }) => {
      const writes = await blockWrites(page);
      await test.step(`Open /admins; name "QA", email "${email}"; press Send confirmation code`, async () => {
        await openInvite(page);
        await fillInvite(page, 'QA', email);
        await sendCode(page).click();
      });
      await test.step(`Expect "${DOMAIN_MSG}" and no request`, async () => {
        await expect(page.getByText(DOMAIN_MSG)).toBeVisible();
        expect(writes).toEqual([]);
      });
    });
  }

  test('SA-ADM-11 phase 2 names the operator inbox and the new address', async ({ page }) => {
    const writes = await blockWrites(page);
    await answerOtp(page, 'request', 200, { data: {} }, 1_500);
    await test.step(`Open /admins; name "QA Invitee", email ${INVITEE}; press Send confirmation code (answered by the test, no email)`, async () => {
      await openInvite(page);
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
      await openInvite(page);
      await fillInvite(page, 'QA Invitee', INVITEE);
      await sendCode(page).click();
      await expect(codeBoxes(page)).toHaveCount(6);
    });
    await test.step('Type "12a3-45" into the code boxes: expect "12345" and Add admin disabled', async () => {
      await enterCode(page, '12a3-45');
      await expect.poll(() => codeValue(page)).toBe('12345');
      await expect(addAdmin(page)).toBeDisabled();
    });
    // The live form submits by itself on the 6th digit (22 Oct; A5.2 has Add admin pressed): answer that in the browser.
    const verifies: string[] = [];
    await page.route('**/api/admins/otp/verify', (route) => {
      verifies.push(route.request().postData() ?? '');
      return route.fulfill({ status: 400, json: { error: { message: 'QA mock: not verified' } } });
    });
    await test.step('Type a 6th digit: expect Add admin enabled; a verify request, if the form sends one itself, is answered by the test', async () => {
      expect(verifies, 'nothing is verified before six digits').toEqual([]);
      await page.keyboard.type('6');
      await expect.poll(() => codeValue(page)).toBe('123456');
      await page.waitForTimeout(1_000);
      if (verifies.length) test.info().annotations.push({ type: 'deviation', description: 'A5.2: Add admin is pressed to verify; the live form verifies on its own when the 6th digit is typed.' });
      else await expect(addAdmin(page)).toBeEnabled();
      expect(writes).toEqual([]);
    });
  });

  test('SA-ADM-13 phase failure messages, with the generic fallback when the server gives none', async ({ page }) => {
    const writes = await blockWrites(page);
    await test.step(`Open /admins; name "QA Invitee", email ${INVITEE}`, async () => {
      await openInvite(page);
      await fillInvite(page, 'QA Invitee', INVITEE);
    });
    await answerOtp(page, 'request', 502, { error: { message: 'Could not send a code' } });
    await test.step('Send confirmation code, answered 502 "Could not send a code": expect that message', async () => {
      await sendCode(page).click();
      await expect(page.getByText('Could not send a code')).toBeVisible();
    });
    await answerOtp(page, 'request', 502, { error: {} });
    await test.step(`Send again, answered 502 with no message: expect "${GENERIC}" and still on the details step`, async () => {
      await sendCode(page).click();
      // Soft: on 22 Oct the form moved on to "Enter the code sent to…" instead — the rest still runs.
      await expect.soft(page.getByText(GENERIC), 'a failed request with no message must not look like a sent code').toBeVisible();
      await expect.soft(codeBoxes(page)).toHaveCount(0);
    });
    await answerOtp(page, 'request', 200, { data: {} });
    await answerOtp(page, 'verify', 400, { error: { message: 'Could not verify' } });
    await test.step('Send again (answered OK); enter 123456, Add admin answered 400 "Could not verify": expect that message', async () => {
      if (await sendCode(page).isVisible()) await sendCode(page).click();
      await enterCode(page, '123456');
      await addAdmin(page).click();
      await expect(page.getByText('Could not verify')).toBeVisible();
    });
    await answerOtp(page, 'verify', 400, { error: {} });
    await test.step(`Add admin again, answered 400 with no message: expect "${GENERIC}"`, async () => {
      await enterCode(page, '123456');
      await addAdmin(page).click();
      await expect(page.getByText(GENERIC)).toBeVisible();
      expect(writes).toEqual([]);
    });
  });
});
