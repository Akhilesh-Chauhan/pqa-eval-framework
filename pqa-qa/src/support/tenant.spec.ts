import { test, expect } from '@playwright/test';
import { classifyTenantResponse, activeSlugs, pickTenantPair } from './tenant.js';
import type { TenantProbe } from './tenant.js';

test('a 200 with a tenant name is active', () => {
  const p = classifyTenantResponse('commerce', 200, {
    data: { tenant: { tenantName: 'Ministry of Commerce and Industry', status: 'active' } },
  });
  expect(p.status).toBe('active');
  expect(p.tenantName).toBe('Ministry of Commerce and Industry');
});

test('a 200 reporting a non-active status is suspended, not active', () => {
  const p = classifyTenantResponse('railways', 200, {
    data: { tenant: { tenantName: 'Ministry of Railways', status: 'suspended' } },
  });
  expect(p.status).toBe('suspended');
});

test('a 404 is not-found', () => {
  expect(classifyTenantResponse('nope', 404, { error: 'TENANT_NOT_FOUND' }).status).toBe('not-found');
});

test('a 403 is suspended — the API signals an inactive tenant that way', () => {
  expect(classifyTenantResponse('paused', 403, { error: 'TENANT_INACTIVE' }).status).toBe('suspended');
});

test('a 503 is error, not not-found — config service down must not read as absent', () => {
  const p = classifyTenantResponse('commerce', 503, {});
  expect(p.status).toBe('error');
  expect(p.detail).toContain('503');
});

test('a 200 with an unparseable body is error, not active', () => {
  expect(classifyTenantResponse('commerce', 200, null).status).toBe('error');
});

const probes = (spec: Array<[string, TenantProbe['status']]>): TenantProbe[] =>
  spec.map(([slug, status]) => ({ slug, status }));

test('activeSlugs returns only active tenants, in candidate order', () => {
  expect(activeSlugs(probes([
    ['commerce', 'active'], ['railways', 'suspended'], ['mohfw', 'active'],
  ]))).toEqual(['commerce', 'mohfw']);
});

test('pickTenantPair needs two active tenants', () => {
  expect(pickTenantPair(probes([['commerce', 'active']]))).toBeNull();
  expect(pickTenantPair(probes([['commerce', 'active'], ['mohfw', 'active']])))
    .toEqual({ primary: 'commerce', secondary: 'mohfw' });
});
