import type { Locator, Page } from '@playwright/test';
import { test, expect, requireWrites } from '../fixtures.js';
import { notMeasured } from '../../support/annotations.js';
import { labels } from '../labels/qdetail.js';
import type { BaseLabels, DashboardLabels, FinalReviewLabels } from '../labels/qdetail.js';
import {
  button, card, dashboard, esc, eye, findQuestion, header, isFresh, isSaved, letters, notOverdue, openQuestion, panel,
  partWith, parts, progress, rx, shows, status, tag, timeline, waitingPart,
} from './qdetail-nav.js';

// DS-COLB: Input Collaboration Request on question detail. Of the three request designs (OQ-4) only the FINAL
// question detail one (one part, several recipients, officials by email) is automated. Any official email typed is
// the tester-owned PQA_DESIGN_COLLAB_EMAIL; department and division recipients belong to the disposable QA tenant.

const L = labels['QDetailFinalReview.dc.html']! as FinalReviewLabels;
const B = labels['QDetailBaseYourDesign.dc.html']! as BaseLabels;
const D = labels['FigmaTestingCal2-5g42-i92s.dc.html']! as DashboardLabels;

const PRE_Q = 'that is new, unstarred, admitted, due more than 2 days ahead, with no part drafted (PRE-Q)';
const PRE_WAIT = 'with a part waiting for input (PRE-WAIT)';

const blocked = (detail: string) => notMeasured(test.info(), { tracker: 'design-OQ', owner: 'UI/UX', detail });
const missing = (detail: string) => notMeasured(test.info(), { tracker: 'design-precondition', owner: 'QA', detail });
/** What the officer pastes as a recipient's reply (stands in for the prototype's "Fill sample reply"). */
const reply = () => `QA input ${new Date().toISOString()}: the figures for this part are confirmed.`;

const requestDialog = (page: Page) => page.getByRole('dialog', { name: L.inputRequest });
const recipients = (dlg: Locator) => dlg.getByRole('group', { name: L.selectRecipients }).getByRole('checkbox');
const removes = (dlg: Locator) => dlg.getByRole('button', { name: new RegExp(`^${esc(L.remove)} `) });
const radios = (dlg: Locator) => dlg.getByRole('radiogroup', { name: L.receivedFrom }).getByRole('radio');
const saveInput = (dlg: Locator) => dlg.getByRole('button', { name: new RegExp(`^(${esc(L.saveInputDraft)}|${esc(L.saveInput)})$`) });
/** The case's "part C": the last part. */
const lastPart = async (page: Page) => letters((await progress(page)).total).at(-1)!;
const received = (p: Page, k: string) => shows(card(p, k).getByText(L.receivedFrom));

async function openRequest(page: Page, k: string): Promise<Locator> {
  await button(card(page, k), L.inputRequest).click();
  const dlg = requestDialog(page);
  await expect(dlg).toBeVisible();
  return dlg;
}

async function viewRequest(page: Page, k: string): Promise<Locator> {
  await button(card(page, k), L.viewRequest).click();
  const dlg = page.getByRole('dialog', { name: `${L.inputRequestDlg} ${L.part} ${k}` });
  await expect(dlg).toBeVisible();
  return dlg;
}

/** Clean-up the design offers for a request this case sent. */
async function withdraw(page: Page, k: string): Promise<void> {
  await button(await viewRequest(page, k), L.withdraw).click();
  await expect(tag(card(page, k), L.tagWaiting)).toBeHidden();
}

test.describe('DS-COLB — Input collaboration and transfer (design)', () => {
  test('DS-COLB-01 Input Collaboration Request dialog for one part', async ({ as }) => {
    const page = await as('division');
    await findQuestion(page, PRE_Q, isFresh);
    const k = await lastPart(page);
    const dlg = await openRequest(page, k);
    await expect(dlg.locator(':focus')).toHaveCount(1);
    await expect(dlg).toContainText(`${L.subQuestion} ${k}`);
    await expect(dlg).toContainText(L.noRecipients);
    await expect(dlg.getByRole('searchbox', { name: L.search })).toHaveAttribute('placeholder', L.searchPh);
    await expect(recipients(dlg).first()).toBeVisible();
    await expect(dlg.getByRole('textbox', { name: L.officialEmail })).toHaveAttribute('placeholder', L.emailPh);
    await expect(button(dlg, L.add)).toBeVisible();
    await expect(dlg.getByLabel(L.neededBy)).not.toHaveValue('');
    await expect(dlg).toContainText(L.replyDue);
    await expect(button(dlg, L.sendRequest)).toBeVisible();
    await button(dlg, L.cancel).click();
  });

  test('DS-COLB-02 Search and select recipients', async ({ as }) => {
    const page = await as('division');
    await findQuestion(page, PRE_Q, isFresh);
    const k = await lastPart(page);
    const dlg = await openRequest(page, k);
    const boxes = recipients(dlg);
    const all = await boxes.count();
    if (all < 2) missing('fewer than two departments or divisions to send a request to');
    const find = dlg.getByRole('searchbox', { name: L.search });
    const name = (await boxes.first().ariaSnapshot()).match(/"(.+)"/)?.[1] ?? '';
    await find.fill(name.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 5).at(-1) ?? name);
    await expect(dlg.getByRole('checkbox', { name, exact: true })).toBeVisible();
    await find.fill('zzqx matches nothing');
    await expect(dlg).toContainText(L.noMatch);
    await expect(boxes).toHaveCount(0);
    await find.fill('');
    await expect(boxes).toHaveCount(all);
    await boxes.nth(0).check();
    await boxes.nth(1).check();
    await expect(removes(dlg)).toHaveCount(2); // one query card per recipient
    for (const q of await dlg.getByRole('textbox').and(dlg.locator('textarea')).all()) await expect(q).not.toHaveValue(''); // prefilled
    await expect(dlg).toContainText(`2 ${L.recipientsSelected}`);
    await expect(dlg).toContainText(new RegExp(`2 ${L.recipient}s ${esc(L.partSep)} ${k}`));
    await removes(dlg).first().click();
    await expect(removes(dlg)).toHaveCount(1);
    await expect(dlg).toContainText(`1 ${L.recipientSelected}`);
    await expect(dlg.getByRole('checkbox', { checked: true })).toHaveCount(1);
    await button(dlg, L.cancel).click();
  });

  test('DS-COLB-03 Request validation blocks sending', async ({ as, denv }) => {
    requireWrites(denv);
    const page = await as('division');
    await findQuestion(page, PRE_Q, isFresh);
    const k = await lastPart(page);
    const dlg = await openRequest(page, k);
    const send = button(dlg, L.sendRequest);
    await send.click();
    await expect(dlg.getByRole('alert')).toBeVisible(); // nothing selected
    await recipients(dlg).first().check();
    const query = dlg.getByRole('textbox').and(dlg.locator('textarea')).first();
    const text = await query.inputValue();
    await query.fill('');
    await send.click();
    await expect(dlg).toBeVisible(); // empty query blocks; its wording is not in the design snapshot
    await query.fill(text || 'Please share the figures for this part.');
    const date = dlg.getByLabel(L.neededBy);
    // The picker allows today up to the reply due date only (OQ-7).
    await expect(date).toHaveAttribute('min', new Date().toLocaleDateString('en-CA'));
    await expect(date).toHaveAttribute('max', /^\d{4}-\d{2}-\d{2}$/);
    await date.fill('2099-12-31');
    await send.click();
    await expect(dlg).toContainText(rx(L.chooseDate, L.whenDue));
    await expect(dlg).toBeVisible();
    await button(dlg, L.cancel).click();
    await expect(tag(card(page, k), L.tagWaiting)).toBeHidden(); // nothing was sent
  });

  test('DS-COLB-04 Add a government official by email', async ({ as, denv }) => {
    const official = denv.collabEmail;
    if (!official) missing('PQA_DESIGN_COLLAB_EMAIL not set');
    if (!/(^|[@.])(gov|nic)\.in$/i.test(official!)) missing('PQA_DESIGN_COLLAB_EMAIL does not end in gov.in or nic.in');
    const page = await as('division');
    await findQuestion(page, PRE_Q, isFresh);
    const k = await lastPart(page);
    const dlg = await openRequest(page, k);
    const email = dlg.getByRole('textbox', { name: L.officialEmail });
    // A non-government address is refused in the dialog (never sent); example.com is reserved for examples.
    await email.fill('qa.not.official@example.com');
    await button(dlg, L.add).click();
    await expect(removes(dlg)).toHaveCount(0);
    await email.fill(official!);
    await email.press('Enter');
    await expect(button(dlg, `${L.remove} ${official}`)).toBeVisible();
    await expect(email).toHaveValue('');
    await expect(dlg).toContainText(rx(`1 ${L.recipient}`, `${L.partSep} ${k}`)); // the official counts as a recipient
    await email.fill(official!);
    await button(dlg, L.add).click();
    await expect(button(dlg, `${L.remove} ${official}`)).toHaveCount(1); // already added
    await button(dlg, L.cancel).click();
  });

  test('DS-COLB-05 Cancel or close a request without sending', async ({ as }) => {
    const page = await as('division');
    await findQuestion(page, PRE_Q, isFresh);
    const k = await lastPart(page);
    const opener = button(card(page, k), L.inputRequest);
    const dlg = requestDialog(page);
    const closes = [() => button(dlg, L.cancel).click(), () => button(dlg, L.close).click(), () => page.keyboard.press('Escape')];
    for (const [i, close] of closes.entries()) {
      await opener.click();
      await expect(dlg).toContainText(L.noRecipients); // reopening starts empty
      await recipients(dlg).first().check();
      if (i === 0) {
        for (let t = 0; t < 30; t++) {
          await page.keyboard.press('Tab');
          await expect(dlg.locator(':focus'), 'Tab stays inside the dialog').toHaveCount(1);
        }
      }
      await close();
      await expect(dlg).toBeHidden();
      await expect(opener).toBeFocused();
      await expect(tag(card(page, k), L.tagWaiting)).toBeHidden();
    }
  });

  test('DS-COLB-06 Send a request', async ({ as, denv }) => {
    requireWrites(denv);
    const page = await as('division');
    const dno = await findQuestion(page, PRE_Q, isFresh);
    const k = await lastPart(page);
    const dlg = await openRequest(page, k);
    if ((await recipients(dlg).count()) < 2) missing('fewer than two departments or divisions to send a request to');
    await recipients(dlg).nth(0).check();
    await recipients(dlg).nth(1).check();
    await button(dlg, L.sendRequest).click();
    await expect(dlg).toBeHidden();
    await expect(status(page, rx(L.requestSent, `${L.forPart} ${k}`))).toBeVisible();
    const c = card(page, k);
    await expect(tag(c, L.tagWaiting)).toBeVisible();
    await expect(c).toContainText(rx(L.waitingFromCap, L.requested));
    await expect(button(c, L.viewRequest)).toBeVisible();
    await expect(parts(page)).toContainText(`1 ${L.waitingCount}`);
    await expect(button(page, new RegExp(`^${L.part} ${k}: ${esc(L.waitingFrom)} `))).toBeVisible();
    await expect(timeline(page)).toContainText(L.inputRequested);
    await expect(timeline(page)).toContainText(rx(`${L.partSep} ${k}`, L.needed));
    await dashboard(page);
    await expect(page.getByRole('row').filter({ has: eye(page, dno) })).toContainText(D.waitingForInput);
    await openQuestion(page, dno);
    await withdraw(page, k);
  });

  test('DS-COLB-07 Ask for inputs on an already saved part', async ({ as, denv }) => {
    requireWrites(denv);
    const page = await as('division');
    await findQuestion(page, 'that is unstarred, not overdue, with every answer saved and no input request (PRE-SAVED)', isSaved, notOverdue);
    const k = await lastPart(page);
    const dlg = await openRequest(page, k);
    await recipients(dlg).first().check();
    await button(dlg, L.sendRequest).click();
    await expect(dlg).toBeHidden();
    await expect(status(page, rx(L.requestSent, `${L.forPart} ${k}`))).toBeVisible();
    const c = card(page, k);
    await expect(tag(c, L.tagSaved)).toBeVisible(); // the saved answer stays
    await expect(tag(c, L.tagWaiting)).toBeVisible();
    await expect(button(page, L.reviewFinal)).toBeEnabled();
    await withdraw(page, k);
  });

  test('DS-COLB-08 View a pending request', async ({ as }) => {
    const page = await as('division');
    await findQuestion(page, PRE_WAIT, async (p) => !!(await waitingPart(p)));
    const k = (await waitingPart(page))!;
    const dlg = await viewRequest(page, k);
    await expect(dlg).toContainText(L.tagWaiting);
    await expect(dlg).toContainText(rx(L.sent, L.needed));
    await expect(dlg.getByText(L.waiting, { exact: true }).first()).toBeVisible();
    await expect(dlg).toContainText(L.recordInput);
    await expect(radios(dlg).first()).toBeVisible();
    await expect(dlg.getByRole('textbox', { name: L.inputText })).toHaveAttribute('placeholder', L.inputPh);
    for (const b of [L.withdraw, L.remind]) await expect(button(dlg, b)).toBeVisible();
    await expect(saveInput(dlg)).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('DS-COLB-09 Send a reminder', async ({ as, denv }) => {
    requireWrites(denv);
    const page = await as('division');
    await findQuestion(page, `${PRE_WAIT} and no reminder sent`, async (p) => {
      const k = await waitingPart(p);
      return !!k && !(await shows(card(p, k).getByText(L.reminderSent)));
    });
    const k = (await waitingPart(page))!;
    await button(await viewRequest(page, k), L.remind).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(status(page, rx(L.reminderSentTo, `${L.forPart} ${k}`))).toBeVisible();
    await expect(card(page, k)).toContainText(`${L.reminderSent} ${L.todayAt}`);
    const dlg = await viewRequest(page, k);
    await expect(dlg).toContainText(new RegExp(`${L.reminderSent} ${L.todayAt}`, 'i'));
    await expect(button(dlg, L.remind)).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(timeline(page)).toContainText(L.reminderSent);
  });

  test('DS-COLB-10 Withdraw a request', async ({ as, denv }) => {
    requireWrites(denv);
    const page = await as('division');
    // Both preconditions first, so a missing one does not leave half the case done.
    const none = await findQuestion(page, `${PRE_WAIT} with no input received yet`, async (p) => {
      const k = await waitingPart(p);
      return !!k && !(await received(p, k));
    });
    const some = await findQuestion(page, `${PRE_WAIT} with one of its replies recorded`, async (p) => {
      const k = await waitingPart(p);
      return !!k && (await received(p, k));
    });
    await openQuestion(page, none);
    let k = (await waitingPart(page))!;
    await button(await viewRequest(page, k), L.withdraw).click();
    await expect(status(page, rx(`${L.withdrawnA} ${k}`, L.withdrawnA2))).toBeVisible();
    await expect(tag(card(page, k), L.tagWaiting)).toBeHidden();
    await expect(button(card(page, k), L.draftWithAI)).toBeVisible();
    await expect(button(card(page, k), L.inputRequest)).toBeVisible();
    await expect(timeline(page)).toContainText(L.requestWithdrawn);
    await openQuestion(page, some);
    k = (await waitingPart(page))!;
    await button(await viewRequest(page, k), L.withdraw).click();
    await expect(status(page, rx(L.withdrawnFrom, `${L.withdrawnB2} ${L.alreadyReceived}`))).toBeVisible();
    await expect(timeline(page)).toContainText(L.requestWithdrawn);
  });

  test('DS-COLB-11 Recording an empty input is blocked', async ({ as, denv }) => {
    requireWrites(denv);
    const page = await as('division');
    await findQuestion(page, PRE_WAIT, async (p) => !!(await waitingPart(p)));
    const k = (await waitingPart(page))!;
    const dlg = await viewRequest(page, k);
    const input = dlg.getByRole('textbox', { name: L.inputText });
    await expect(input).toHaveValue('');
    await saveInput(dlg).click();
    await expect(dlg).toContainText(L.pasteFirst);
    await expect(input).toBeFocused();
    await expect(dlg).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(tag(card(page, k), L.tagWaiting)).toBeVisible(); // nothing recorded
  });

  test('DS-COLB-12 Record the input from one of several recipients', async ({ as, denv }) => {
    requireWrites(denv);
    const page = await as('division');
    await findQuestion(page, `${PRE_WAIT} with no reply recorded yet`, async (p) => {
      const k = await waitingPart(p);
      return !!k && !(await received(p, k));
    });
    const k = (await waitingPart(page))!;
    let dlg = await viewRequest(page, k);
    if ((await radios(dlg).count()) !== 2) missing(`the request on part ${k} is not to exactly two recipients`);
    const text = reply();
    await radios(dlg).first().check();
    await dlg.getByRole('textbox', { name: L.inputText }).fill(text);
    await button(dlg, L.saveInput).click();
    await expect(dlg).toBeHidden();
    await expect(status(page, rx(L.inputFrom, `${L.savedDot} ${L.part} ${k} ${L.stillWaits}`))).toBeVisible();
    await expect(card(page, k)).toContainText(L.receivedFrom);
    dlg = await viewRequest(page, k);
    await expect(dlg).toContainText(`1 of 2 ${L.inputsReceived}`);
    await expect(dlg).toContainText(L.INPUT_RECEIVED);
    await expect(dlg).toContainText(text);
    await expect(dlg).toContainText(L.recordInput);
    await expect(button(dlg, L.saveInputDraft)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(timeline(page)).toContainText(L.inputReceived);
  });

  test('DS-COLB-13 Save input and draft once every input is in', async ({ as, denv }) => {
    requireWrites(denv);
    const page = await as('division');
    await findQuestion(page, `${PRE_WAIT} with one of its two replies recorded`, async (p) => {
      const k = await waitingPart(p);
      return !!k && (await received(p, k));
    });
    const k = (await waitingPart(page))!;
    const dlg = await viewRequest(page, k);
    await dlg.getByRole('textbox', { name: L.inputText }).fill(reply());
    await button(dlg, L.saveInputDraft).click();
    await expect(dlg).toBeHidden();
    const ai = panel(page);
    await expect(ai.getByRole('heading', { name: `${L.subQuestion} ${k}` })).toBeVisible();
    await expect(ai).toContainText(rx(L.draftingWith, L.INPUTS, L.RECEIVED));
    await expect(ai).toContainText(rx(L.writtenWith, L.alongWith));
    await expect(status(page, rx(L.inputSaved, `${L.partLower} ${k}`))).toBeVisible();
    await expect(ai).toContainText(L.draftedWithInputs, { timeout: 120_000 });
    const got = ai.getByRole('group', { name: new RegExp(`^${esc(L.INPUTS_RECEIVED)} \\d+ ${L.OF} \\d+`) });
    await expect(got).toContainText(L.received);
    await expect(ai).toContainText(rx(L.everyDraft, L.theseInputs, L.listedFirst));
    const draft = ai.getByRole('group', { name: L.thisDraft }).last();
    await draft.getByRole('button', { name: new RegExp(`^\\d+ ${L.source}s?$`) }).click();
    await expect(ai.getByRole('list', { name: L.sourcesFor }).last().getByRole('button').first())
      .toHaveAccessibleName(new RegExp(`^${L.sourceN} 1: ${esc(L.inputFromThe)}`));
    await expect(button(ai.getByRole('group', { name: L.quickRequests }), L.useInputs)).toBeVisible();
    await expect(button(card(page, k), L.viewInputs)).toBeVisible();
    await got.getByRole('button', { name: new RegExp(`^${esc(L.viewInputFrom)} `) }).first().click();
    const closeInput = got.getByRole('button', { name: new RegExp(`^${esc(L.closeInputFrom)} `) }).first();
    await expect(closeInput).toBeVisible();
    await closeInput.click();
    await expect(timeline(page)).toContainText(L.aiDraftWithInputs);
  });

  test('DS-COLB-14 New input on a saved part drafts an update', async ({ as, denv }) => {
    requireWrites(denv);
    const page = await as('division');
    await findQuestion(page, 'with every answer saved and a saved part waiting for input', async (p) => {
      const { saved, total } = await progress(p);
      return total > 0 && saved === total && !!(await waitingPart(p));
    });
    const k = (await waitingPart(page))!;
    const dlg = await viewRequest(page, k);
    if ((await radios(dlg).count()) !== 1) missing(`the request on saved part ${k} is not to a single recipient`);
    await dlg.getByRole('textbox', { name: L.inputText }).fill(reply());
    await button(dlg, L.saveInputDraft).click();
    await expect(status(page, rx(L.inputSaved, `${L.anUpdateTo} ${L.partLower} ${k}`))).toBeVisible();
    await expect(tag(card(page, k), L.tagSaved)).toBeHidden({ timeout: 120_000 }); // until the update is saved
    await expect(button(page, L.reviewFinal)).toBeDisabled();
  });

  test('DS-COLB-15 View the inputs received', async ({ as }) => {
    const page = await as('division');
    const viewInputs = (c: Locator) => button(c, L.viewInputs).or(button(c, L.viewInput));
    await findQuestion(page, 'with a part whose inputs are all received', async (p) => !!(await partWith(p, viewInputs)));
    const k = (await partWith(page, viewInputs))!;
    await viewInputs(card(page, k)).click();
    const dlg = page.getByRole('dialog', { name: new RegExp(`^${L.input}s? ${esc(L.receivedDot)} ${L.part} ${k}$`) });
    await expect(dlg).toContainText(L.INPUT_RECEIVED);
    await expect(dlg).toContainText(L.inputReceived);
    await expect(dlg.getByRole('textbox')).toHaveCount(0); // no record field
    for (const b of [L.withdraw, L.remind, L.saveInput, L.saveInputDraft]) await expect(button(dlg, b)).toHaveCount(0);
    await button(dlg, L.close).last().click();
    await expect(dlg).toBeHidden();
  });

  test('DS-COLB-17 Draft-all layout of the request form', async () => {
    blocked('OQ-4: three request designs; only the QDetailFinalReview one (one part, several recipients) is automated');
  });

  test('DS-COLB-18 Forwarded (transferred) question is read only', async ({ as }) => {
    const page = await as('division');
    await findQuestion(page, 'that the division forwarded to another division, not yet accepted', (p) => status(p, B.forwardedTo).isVisible());
    await expect(status(page, B.forwardedTo)).toContainText(B.willAccept);
    await expect(button(page, B.withdrawTransfer)).toBeVisible();
    await expect(tag(header(page), B.forwarded)).toBeVisible();
    await expect(tag(parts(page), B.forwarded)).toBeVisible();
    for (const b of [B.draftWithAI, B.inputRequest, B.draftAll]) await expect(button(page, b)).toHaveCount(0);
    await expect(parts(page)).toContainText(rx(B.questionWith, B.cannotAct));
    await expect(page.getByText(rx(B.questionWith, B.efileTheirs))).toBeVisible();
  });

  test('DS-COLB-19 Withdraw a transfer', async ({ as, denv }) => {
    requireWrites(denv);
    const page = await as('division');
    await findQuestion(page, 'that the division forwarded to another division, not yet accepted', (p) => status(p, B.forwardedTo).isVisible());
    // FINAL base board: the question comes back to your division; no confirmation step is designed.
    await button(page, B.withdrawTransfer).click();
    await expect(status(page, B.forwardedTo)).toBeHidden();
    await expect(status(page, B.assignedOn)).toBeVisible();
    await expect(button(parts(page), B.draftWithAI).first()).toBeVisible();
    await expect(button(parts(page), B.inputRequest).first()).toBeVisible();
  });
});
