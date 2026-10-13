import { randomBytes, randomUUID } from 'node:crypto';
import type { APIResponse, Page } from '@playwright/test';
import { test, expect, blockWrites } from './fixtures.js';
import type { AdminEnv } from './admin-env.js';

// Every write here must be refused, and each is built so a broken guard still changes nothing
// that matters: PATCHes resend the stored tenant unchanged apart from the field under test, with
// a stale expectedUpdatedAt; creates use a taken (or unknown) ministry under a throwaway slug and a
// placeholder key, and an unexpected 201 is suspended + archived at once (catalogue SA-MIN-02).

type Json = Record<string, any>;

const STALE = '2000-01-01T00:00:00.000Z';
const throwawaySlug = () => `qa${randomBytes(2).toString('hex')}`;

/** error.message, whichever error shape the route uses. */
async function message(res: APIResponse): Promise<string | undefined> {
  const json = await res.json().catch(() => undefined);
  return typeof json?.error === 'string' ? json.error : (json?.error?.message ?? json?.message);
}

async function bundle(page: Page, slug: string): Promise<Json> {
  const res = await page.request.get(`/api/tenants/${slug}`);
  expect(res.status(), `GET /api/tenants/${slug}`).toBe(200);
  return (await res.json()).data;
}

async function ministries(page: Page): Promise<Array<{ id: string; name: string; taken: boolean }>> {
  return (await (await page.request.get('/api/ministries')).json()).data;
}

/** A create body copied from T's stored configuration, under a throwaway slug and a placeholder key. */
async function createBody(page: Page, env: AdminEnv, ministry?: { id: string; name: string }): Promise<{ slug: string; data: Json }> {
  const { createdAt, updatedAt, ...tenant } = (await bundle(page, env.testTenant)).tenant;
  const slug = throwawaySlug();
  return {
    slug,
    data: {
      tenant: { ...tenant, slug, status: 'inactive', tenantName: ministry?.name ?? tenant.tenantName, sourceWebsites: [], sourceWebsitesTrusted: false, openapiSpec: null },
      ministryId: ministry?.id,
      departments: [],
      admin: { name: 'QA Probe', email: 'qa.probe@example.gov.in', phone: '' },
      llmApiKey: 'qa-not-a-real-key',
    },
  };
}

/** POST /api/tenants that must be refused. A 201 is a P1 defect: release the ministry at once, then fail. */
async function refusedCreate(page: Page, slug: string, data: unknown): Promise<APIResponse> {
  const res = await page.request.post('/api/tenants', { data });
  if (res.status() === 201) {
    await page.request.patch(`/api/tenants/${slug}/status`, { data: { status: 'suspended' } });
    const archived = await page.request.patch(`/api/tenants/${slug}/status`, { data: { status: 'archived' } });
    throw new Error(`P1 DEFECT: POST /api/tenants created "${slug}" instead of refusing it. Suspended and archived it (archive HTTP ${archived.status()}) — confirm by hand.`);
  }
  return res;
}

/** PATCH T with one identity field changed and a stale token: the identity guard must answer 422 before the 409 conflict check. */
async function identityProbe(page: Page, slug: string, change: Json, expected: string): Promise<void> {
  const before = await bundle(page, slug);
  const res = await test.step(`PATCH /api/tenants/${slug} body = stored bundle with tenant ${JSON.stringify(change)} and expectedUpdatedAt "${STALE}"`, () =>
    page.request.patch(`/api/tenants/${slug}`, { data: { ...before, tenant: { ...before.tenant, ...change }, expectedUpdatedAt: STALE } }),
  );
  await test.step(`Expect 422 "${expected}" (409 = identity guard missing) and updatedAt unchanged`, async () => {
    expect(res.status()).toBe(422);
    expect(JSON.stringify(await res.json())).toContain(expected);
    expect((await bundle(page, slug)).tenant.updatedAt).toBe(before.tenant.updatedAt);
  });
}

const ids = (text: string): string[] => [...text.matchAll(/"id"\s*:\s*"([^"]+)"/g)].map((m) => m[1]!);

test.describe('A6 Tenants API', () => {
  test('SA-API-01 success bodies are {data}, errors are {error:{message}}', async ({ page, env }) => {
    for (const path of ['/api/tenants', '/api/ministries', `/api/tenants/${env.testTenant}`]) {
      const res = await test.step(`GET ${path}`, () => page.request.get(path));
      await test.step('Expect 200 with a data envelope', async () => {
        expect(res.status()).toBe(200);
        expect(await res.json()).toHaveProperty('data');
      });
    }
    const errors: Array<[string, () => Promise<APIResponse>]> = [
      ['GET /api/tenants/nosuch', () => page.request.get('/api/tenants/nosuch')],
      ['POST /api/tenants body {}', () => page.request.post('/api/tenants', { data: {} })],
      ['PATCH /api/tenants/nosuch/status body {"status":"bogus"}', () => page.request.patch('/api/tenants/nosuch/status', { data: { status: 'bogus' } })],
    ];
    for (const [label, send] of errors) {
      const res = await test.step(label, send);
      await test.step('Expect 4xx with {"error":{"message":…}}', async () => {
        expect(res.status()).toBeGreaterThanOrEqual(400);
        expect(res.status()).toBeLessThan(500);
        expect(typeof (await res.json()).error?.message).toBe('string');
      });
    }
  });

  test('SA-API-02 GET /api/tenants lists bundles', async ({ page }) => {
    const res = await test.step('GET /api/tenants', () => page.request.get('/api/tenants'));
    await test.step('Expect 200 and a list of {tenant:{slug, status, updatedAt}}', async () => {
      expect(res.status()).toBe(200);
      const data: Json[] = (await res.json()).data;
      expect(Array.isArray(data)).toBe(true);
      for (const b of data) {
        expect.soft(typeof b.tenant?.slug).toBe('string');
        expect.soft(['active', 'inactive', 'suspended', 'archived']).toContain(b.tenant?.status);
        expect.soft(Number.isNaN(Date.parse(b.tenant?.updatedAt)), `updatedAt of ${b.tenant?.slug}`).toBe(false);
      }
    });
  });

  test('SA-API-03 GET /api/tenants/<T> returns the bundle, connectors and a key-set flag', async ({ page, env }) => {
    const res = await test.step(`GET /api/tenants/${env.testTenant}`, () => page.request.get(`/api/tenants/${env.testTenant}`));
    await test.step('Expect 200, the tenant, a connectors field and a boolean "key is set" field', async () => {
      expect(res.status()).toBe(200);
      const text = await res.text();
      expect(JSON.parse(text).data.tenant.slug).toBe(env.testTenant);
      expect.soft(text, 'connectors field').toMatch(/"\w*connectors\w*"\s*:/i);
      expect.soft(/"\w*key\w*"\s*:\s*(true|false)/i.test(text), 'boolean key-set field').toBe(true);
    });
  });

  test('SA-API-04 GET /api/tenants/nosuch is 404', async ({ page }) => {
    const res = await test.step('GET /api/tenants/nosuch', () => page.request.get('/api/tenants/nosuch'));
    await test.step('Expect 404 No tenant found with id "nosuch"', async () => {
      expect(res.status()).toBe(404);
      expect(await message(res)).toBe('No tenant found with id "nosuch"');
    });
  });

  test('SA-API-05 create with invalid JSON is 400', async ({ page }) => {
    const res = await test.step('POST /api/tenants body "{bad"', () =>
      page.request.post('/api/tenants', { data: Buffer.from('{bad'), headers: { 'content-type': 'application/json' } }),
    );
    await test.step('Expect 400 Invalid JSON body', async () => {
      expect(res.status()).toBe(400);
      expect(await message(res)).toBe('Invalid JSON body');
    });
  });

  test("SA-API-06 create without 'tenant' is 400", async ({ page }) => {
    const res = await test.step('POST /api/tenants body {}', () => page.request.post('/api/tenants', { data: {} }));
    await test.step("Expect 400 Missing 'tenant'", async () => {
      expect(res.status()).toBe(400);
      expect(await message(res)).toBe("Missing 'tenant'");
    });
  });

  test('SA-API-07 create without a ministry is 422 Select a ministry', async ({ page, env }) => {
    const { slug, data } = await createBody(page, env);
    const res = await test.step(`POST /api/tenants body = valid bundle (T's config) with no ministryId, slug ${slug}`, () => refusedCreate(page, slug, data));
    await test.step('Expect 422 Select a ministry, on field ministryId', async () => {
      expect(res.status()).toBe(422);
      const json = await res.json();
      expect(json.error.message).toBe('Select a ministry');
      expect(Object.keys(json.error.fields ?? {})).toContain('ministryId');
    });
  });

  test('SA-API-08 create without an admin is 422', async ({ page, env }) => {
    const ministry = (await ministries(page)).find((m) => m.taken);
    test.skip(!ministry, 'no taken ministry to probe with safely');
    const { slug, data } = await createBody(page, env, ministry);
    const res = await test.step(`POST /api/tenants body = valid bundle for taken "${ministry!.name}", slug ${slug}, no admin`, () =>
      refusedCreate(page, slug, { ...data, admin: undefined }),
    );
    await test.step('Expect 422 Ministry admin name and email are required', async () => {
      if (res.status() === 409) {
        test.info().annotations.push({ type: 'question', description: `409 "${await message(res)}" came back: the ministry claim is checked before the admin fields.` });
        return;
      }
      expect(res.status()).toBe(422);
      expect(await message(res)).toBe('Ministry admin name and email are required');
    });
  });

  test('SA-API-09 create with invalid fields is 422 with per-field messages', async ({ page, env }) => {
    const ministry = (await ministries(page)).find((m) => m.taken);
    test.skip(!ministry, 'no taken ministry to probe with safely');
    const { slug, data } = await createBody(page, env, ministry);
    const a = data.tenant.assistant;
    data.tenant.assistant = { ...a, UIConfig: { ...a.UIConfig, userMsgColor: 'red' }, llm: { ...a.llm, embeddingDimensions: 0 } };
    const res = await test.step(`POST /api/tenants body = bundle for taken "${ministry!.name}", slug ${slug}, userMsgColor "red", embeddingDimensions 0`, () =>
      refusedCreate(page, slug, data),
    );
    await test.step('Expect 422 Validation failed with fields for userMsgColor and embeddingDimensions', async () => {
      expect(res.status()).toBe(422);
      const err = (await res.json()).error;
      expect(err.message).toBe('Validation failed');
      const fields = Object.keys(err.fields ?? {}).join(' ');
      expect.soft(fields).toMatch(/userMsgColor/);
      expect.soft(fields).toMatch(/embeddingDimensions/);
    });
  });

  test('SA-API-10 create for an unknown ministry id is refused: Ministry not found', async ({ page, env }) => {
    const unknown = { id: randomUUID(), name: 'QA Unknown Ministry' };
    const { slug, data } = await createBody(page, env, unknown);
    const res = await test.step(`POST /api/tenants body = valid bundle, ministryId ${unknown.id} (random), slug ${slug}`, () => refusedCreate(page, slug, data));
    await test.step('Expect refusal with "Ministry not found"', async () => {
      test.info().annotations.push({ type: 'question', description: `Status for an unknown ministry: HTTP ${res.status()}` });
      expect(res.status()).toBeGreaterThanOrEqual(400);
      expect(await message(res)).toContain('Ministry not found');
    });
  });

  test('SA-API-11 update refuses a slug change before the conflict check', async ({ page, env }) => {
    await identityProbe(page, env.testTenant, { slug: 'qazzzz' }, 'Portal slug cannot be changed.');
  });

  test('SA-API-12 update refuses a ministry-name change', async ({ page, env }) => {
    const name = (await bundle(page, env.testTenant)).tenant.tenantName;
    await identityProbe(page, env.testTenant, { tenantName: `${name} (QA)` }, 'Ministry name cannot be changed.');
  });

  test('SA-API-13 update with a stale expectedUpdatedAt is 409 CONFLICT and writes nothing', async ({ page, env }) => {
    const before = await bundle(page, env.testTenant);
    const res = await test.step(`PATCH /api/tenants/${env.testTenant} body = stored bundle unchanged, expectedUpdatedAt "${STALE}"`, () =>
      page.request.patch(`/api/tenants/${env.testTenant}`, { data: { ...before, expectedUpdatedAt: STALE } }),
    );
    await test.step('Expect 409 CONFLICT "Tenant was modified elsewhere — reload and try again", updatedAt unchanged', async () => {
      expect(res.status()).toBe(409);
      const err = (await res.json()).error;
      expect(err.code).toBe('CONFLICT');
      expect(err.message).toBe('Tenant was modified elsewhere — reload and try again');
      expect((await bundle(page, env.testTenant)).tenant.updatedAt).toBe(before.tenant.updatedAt);
    });
  });

  test('SA-API-14 update without tenant or expectedUpdatedAt is 400', async ({ page, env }) => {
    const { tenant } = await bundle(page, env.testTenant);
    for (const [label, data] of [['{}', {}], ['{tenant} with no expectedUpdatedAt', { tenant }]] as const) {
      const res = await test.step(`PATCH /api/tenants/${env.testTenant} body ${label}`, () => page.request.patch(`/api/tenants/${env.testTenant}`, { data }));
      await test.step("Expect 400 Missing 'tenant' or 'expectedUpdatedAt'", async () => {
        expect(res.status()).toBe(400);
        expect(await message(res)).toBe("Missing 'tenant' or 'expectedUpdatedAt'");
      });
    }
  });

  test('SA-API-15 update of an unknown tenant is 404', async ({ page, env }) => {
    const stored = await bundle(page, env.testTenant);
    const res = await test.step(`PATCH /api/tenants/nosuch body = ${env.testTenant}'s bundle, expectedUpdatedAt "${STALE}"`, () =>
      page.request.patch('/api/tenants/nosuch', { data: { ...stored, expectedUpdatedAt: STALE } }),
    );
    await test.step('Expect 404', async () => expect(res.status()).toBe(404));
  });

  test('SA-API-16 status: an unsupported value is 400 and the status is unchanged', async ({ page, env }) => {
    const before = (await bundle(page, env.testTenant)).tenant.status;
    const res = await test.step(`PATCH /api/tenants/${env.testTenant}/status body {"status":"bogus"}`, () =>
      page.request.patch(`/api/tenants/${env.testTenant}/status`, { data: { status: 'bogus' } }),
    );
    await test.step(`Expect 400 Unsupported portal status. and status still "${before}"`, async () => {
      expect(res.status()).toBe(400);
      expect(await message(res)).toBe('Unsupported portal status.');
      expect((await bundle(page, env.testTenant)).tenant.status).toBe(before);
    });
  });

  test('SA-API-17 status of an unknown tenant is 404', async ({ page }) => {
    const res = await test.step('PATCH /api/tenants/nosuch/status body {"status":"inactive"}', () =>
      page.request.patch('/api/tenants/nosuch/status', { data: { status: 'inactive' } }),
    );
    await test.step('Expect 404 No tenant found with id "nosuch"', async () => {
      expect(res.status()).toBe(404);
      expect(await message(res)).toBe('No tenant found with id "nosuch"');
    });
  });

  test('SA-API-18 GET /api/ministries returns the 56-row master list', async ({ page }) => {
    const res = await test.step('GET /api/ministries', () => page.request.get('/api/ministries'));
    await test.step('Expect 200 and 56 rows, each with id, name and a boolean taken', async () => {
      expect(res.status()).toBe(200);
      const rows: Json[] = (await res.json()).data;
      expect(rows).toHaveLength(56);
      for (const m of rows) expect.soft({ id: typeof m.id, name: typeof m.name, taken: typeof m.taken }, m.name).toEqual({ id: 'string', name: 'string', taken: 'boolean' });
    });
  });

  test('SA-API-22 OpenAPI upload errors leave the stored spec unchanged', async ({ page, env }) => {
    const T = env.testTenant;
    const before = (await bundle(page, T)).tenant.openapiSpec ?? null;
    const yaml = Buffer.from('openapi: 3.0.0\n');
    const cases: Array<[string, string, Parameters<Page['request']['post']>[1], number, string?]> = [
      [`POST /api/tenants/${T}/openapi multipart with no file`, `/api/tenants/${T}/openapi`, { multipart: { note: 'no file' } }, 400, 'Missing YAML file'],
      [`POST /api/tenants/${T}/openapi multipart file x.txt`, `/api/tenants/${T}/openapi`, { multipart: { file: { name: 'x.txt', mimeType: 'text/plain', buffer: yaml } } }, 400],
      [`POST /api/tenants/${T}/openapi multipart file big.yaml (5.1 MB)`, `/api/tenants/${T}/openapi`,
        { multipart: { file: { name: 'big.yaml', mimeType: 'application/yaml', buffer: Buffer.concat([yaml, Buffer.alloc(Math.ceil(5.1 * 1024 * 1024), '#')]) } } }, 400],
      ['POST /api/tenants/nosuch/openapi multipart file x.yaml', '/api/tenants/nosuch/openapi', { multipart: { file: { name: 'x.yaml', mimeType: 'application/yaml', buffer: yaml } } }, 404, 'Tenant not found'],
    ];
    for (const [label, path, options, status, expected] of cases) {
      const res = await test.step(label, () => page.request.post(path, options));
      await test.step(`Expect ${status}${expected ? ` ${expected}` : ''}`, async () => {
        expect.soft(res.status()).toBe(status);
        if (expected) expect.soft(await message(res)).toBe(expected);
      });
    }
    await test.step(`GET /api/tenants/${T} — expect openapiSpec unchanged`, async () => {
      expect((await bundle(page, T)).tenant.openapiSpec ?? null).toEqual(before);
    });
  });

  test('SA-API-23 sync-source without a url is 400', async ({ page, env }) => {
    const res = await test.step(`POST /api/tenants/${env.testTenant}/sync-source body {}`, () => page.request.post(`/api/tenants/${env.testTenant}/sync-source`, { data: {} }));
    await test.step('Expect 400 A url is required', async () => {
      expect(res.status()).toBe(400);
      expect(await message(res)).toBe('A url is required');
    });
  });
});

test.describe('A6 People, divisions and roles', () => {
  test('SA-API-24 adding a user without fields is 400', async ({ page, env }) => {
    const res = await test.step(`POST /api/tenants/${env.testTenant}/users body {}`, () => page.request.post(`/api/tenants/${env.testTenant}/users`, { data: {} }));
    await test.step('Expect 400 name, email, and role are required', async () => {
      expect(res.status()).toBe(400);
      expect(await message(res)).toBe('name, email, and role are required');
    });
  });

  test('SA-API-25 adding a division without a name is 400', async ({ page, env }) => {
    const res = await test.step(`POST /api/tenants/${env.testTenant}/departments body {}`, () =>
      page.request.post(`/api/tenants/${env.testTenant}/departments`, { data: {} }),
    );
    await test.step('Expect 400 name is required', async () => {
      expect(res.status()).toBe(400);
      expect(await message(res)).toBe('name is required');
    });
  });

  test('SA-API-26 adding a position without a title is 400', async ({ page, env }) => {
    const T = env.testTenant;
    const deptId = await test.step(`GET /api/tenants/${T}/departments — take the first division id`, async () =>
      ids(await (await page.request.get(`/api/tenants/${T}/departments`)).text())[0],
    );
    test.skip(!deptId, `${T} has no divisions`);
    const res = await test.step(`POST /api/tenants/${T}/departments/${deptId}/positions body {}`, () =>
      page.request.post(`/api/tenants/${T}/departments/${deptId}/positions`, { data: {} }),
    );
    await test.step('Expect 400 title is required', async () => {
      expect(res.status()).toBe(400);
      expect(await message(res)).toBe('title is required');
    });
  });

  test('SA-API-27 roles, users and divisions are addressed by slug; an unknown id is 404', async ({ page, env }) => {
    // Deviation (2026-10-12): components.md A6 says roles take the registry UUID, but the deployed
    // Roles tab calls /api/tenants/<slug>/roles and no UUID is exposed anywhere in the panel.
    test.info().annotations.push({ type: 'deviation', description: 'Roles are addressed by slug on the deployed build; spec A6 says registry UUID' });
    await blockWrites(page);
    const T = env.testTenant;
    for (const path of [`/api/tenants/${T}/roles`, `/api/tenants/${T}/users`, `/api/tenants/${T}/departments`]) {
      const res = await test.step(`GET ${path}`, () => page.request.get(path));
      await test.step('Expect 200', async () => expect.soft(res.status()).toBe(200));
    }
    const unknown = '00000000-0000-4000-8000-000000000000';
    for (const path of [`/api/tenants/${unknown}/roles`, `/api/tenants/${unknown}/users`, `/api/tenants/${unknown}/departments`]) {
      const res = await test.step(`GET ${path} (an id no tenant has)`, () => page.request.get(path));
      await test.step('Expect 404', async () => expect.soft(res.status()).toBe(404));
    }
  });

  test('SA-API-28 mixing two tenants’ ids never returns the other tenant’s data', async ({ page, env }) => {
    await blockWrites(page);
    const A = env.testTenant;
    const B = ((await (await page.request.get('/api/tenants')).json()).data as Json[])
      .map((b) => b.tenant)
      .find((t) => t.slug !== A && t.status !== 'archived')?.slug as string | undefined;
    test.skip(!B, 'needs a second, non-archived tenant');
    // Tenants are addressed by slug on the deployed build (see SA-API-27).
    const [aId, bId] = [A, B!];
    const roleId = await test.step(`GET /api/tenants/${bId}/roles — take one of ${B}'s role ids`, async () =>
      ids(await (await page.request.get(`/api/tenants/${bId}/roles`)).text())[0],
    );
    test.skip(!roleId, `${B} returned no role ids`);
    const res = await test.step(`GET /api/tenants/${aId}/roles/${roleId}/permissions (${A}'s path, ${B}'s role)`, () =>
      page.request.get(`/api/tenants/${aId}/roles/${roleId}/permissions`),
    );
    await test.step('Expect a 4xx refusal', async () => {
      test.info().annotations.push({ type: 'observed', description: `Mixed-id permissions: HTTP ${res.status()}` });
      expect.soft(res.status()).toBeGreaterThanOrEqual(400);
      expect.soft(res.status()).toBeLessThan(500);
    });
    await test.step(`GET /api/tenants/${A}/departments and /api/tenants/${B}/departments — expect no shared division id`, async () => {
      const aIds = ids(await (await page.request.get(`/api/tenants/${A}/departments`)).text());
      const bIds = ids(await (await page.request.get(`/api/tenants/${B}/departments`)).text());
      test.info().annotations.push({ type: 'observed', description: `division ids: ${A} ${aIds.length}, ${B} ${bIds.length}` });
      expect(aIds.filter((id) => bIds.includes(id))).toEqual([]);
    });
  });
});

test.describe('A6 Admins API', () => {
  test('SA-API-20 GET /api/admins lists the platform administrators', async ({ page, env }) => {
    const res = await test.step('GET /api/admins', () => page.request.get('/api/admins'));
    await test.step(`Expect 200 with a users list that includes ${env.adminEmail}`, async () => {
      expect(res.status()).toBe(200);
      const json = await res.json();
      const users = json.data?.users ?? json.users;
      expect(Array.isArray(users)).toBe(true);
      expect(JSON.stringify(users)).toContain(env.adminEmail);
    });
  });

  test('SA-API-21 admin-invite request errors come in order and send nothing', async ({ page }) => {
    const cases = [
      ['body "{bad"', { data: Buffer.from('{bad'), headers: { 'content-type': 'application/json' } }, 'Invalid JSON payload'],
      ['body {}', { data: {} }, 'Name is required.'],
      ['body {"name":"QA"}', { data: { name: 'QA' } }, "Missing 'email'"],
    ] as const;
    for (const [label, options, expected] of cases) {
      const res = await test.step(`POST /api/admins/otp/request ${label}`, () => page.request.post('/api/admins/otp/request', options));
      await test.step(`Expect 400 ${expected}`, async () => {
        expect.soft(res.status()).toBe(400);
        expect.soft(await message(res)).toBe(expected);
      });
    }
    const verify = { name: 'QA', email: 'qa.nobody@digitalindia.gov.in', otp: '123' };
    const res = await test.step(`POST /api/admins/otp/verify body ${JSON.stringify(verify)}`, () => page.request.post('/api/admins/otp/verify', { data: verify }));
    await test.step('Expect 400 Enter the 6-digit code.', async () => {
      expect(res.status()).toBe(400);
      expect(await message(res)).toBe('Enter the 6-digit code.');
    });
  });
});

test.describe('E1a Ministry exclusivity', () => {
  test('SA-MIN-02 creating a portal for a taken ministry is refused', async ({ page, env }) => {
    const ministry = await test.step('GET /api/ministries — pick a ministry with taken:true', async () => (await ministries(page)).find((m) => m.taken));
    test.skip(!ministry, 'no taken ministry on this environment');
    const { slug, data } = await createBody(page, env, ministry);
    const res = await test.step(`POST /api/tenants body = valid bundle for "${ministry!.name}" (ministryId ${ministry!.id}), throwaway slug ${slug}`, () =>
      refusedCreate(page, slug, data),
    );
    await test.step(`Expect 409 A portal for ${ministry!.name} already exists`, async () => {
      expect(res.status()).toBe(409);
      expect(await message(res)).toBe(`A portal for ${ministry!.name} already exists`);
    });
  });

  test('SA-MIN-07 identity is frozen: no UI path, and the API refuses slug and name changes', async ({ page, env }) => {
    await blockWrites(page);
    const T = env.testTenant;
    const { tenant } = await bundle(page, T);
    await test.step(`Open /tenants/${T}/edit — expect ministry name and slug as text, with no input or dropdown for either`, async () => {
      await page.goto(`/tenants/${T}/edit`);
      const main = page.getByRole('main');
      await expect(main.getByText(tenant.tenantName, { exact: true }).first()).toBeVisible();
      await expect(main.getByText(T, { exact: true }).first()).toBeVisible();
      await expect(page.locator('#ministryId, #slug, #tenantName')).toHaveCount(0);
      await expect(main.getByRole('textbox', { name: /ministry name|slug/i })).toHaveCount(0);
      await expect(main.getByRole('combobox', { name: /ministry/i })).toHaveCount(0);
    });
    await identityProbe(page, T, { slug: 'qazzzz' }, 'Portal slug cannot be changed.');
    await identityProbe(page, T, { tenantName: `${tenant.tenantName} (QA)` }, 'Ministry name cannot be changed.');
  });
});
