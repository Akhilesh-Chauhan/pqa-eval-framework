import { randomBytes } from 'node:crypto';

export const VERSION = '0.1.0';

export type PersonaName =
  | 'platform-admin'
  | 'parliament-admin'
  | 'parliament-member'
  | 'division-admin'
  | 'division-member';

export interface S3Creds {
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  tenantPrefix: string;
}

export interface OpenSearchCreds {
  endpoint: string;
  username: string;
  password: string;
  tenantIndex: string;
}

export interface QaEnv {
  baseUrl: string;
  tenantCandidates: string[];
  runId: string;
  userAgent: string;
  personaEmails: Partial<Record<PersonaName, string>>;
  s3?: S3Creds;
  openSearch?: OpenSearchCreds;
  postgresDsn?: string;
}

export class MissingEnvError extends Error {
  constructor(variable: string, detail: string) {
    super(`${variable}: ${detail}`);
    this.name = 'MissingEnvError';
  }
}

const PERSONA_VARS: Array<[PersonaName, string]> = [
  ['platform-admin', 'PLATFORM_SEED_EMAIL'],
  ['parliament-admin', 'PQA_PERSONA_PARLIAMENT_ADMIN_EMAIL'],
  ['parliament-member', 'PQA_PERSONA_PARLIAMENT_MEMBER_EMAIL'],
  ['division-admin', 'PQA_PERSONA_DIVISION_ADMIN_EMAIL'],
  ['division-member', 'PQA_PERSONA_DIVISION_MEMBER_EMAIL'],
];

function required(src: NodeJS.ProcessEnv, key: string): string {
  const value = src[key]?.trim();
  if (!value) throw new MissingEnvError(key, 'is required and was not set');
  return value;
}

function allOrNothing(
  src: NodeJS.ProcessEnv,
  keys: string[],
): Record<string, string> | undefined {
  const values = keys.map((k) => src[k]?.trim() ?? '');
  if (values.some((v) => !v)) return undefined;
  return Object.fromEntries(keys.map((k, i) => [k, values[i] as string]));
}

function readBaseUrl(src: NodeJS.ProcessEnv): string {
  const raw = required(src, 'PQA_BASE_URL');
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new MissingEnvError('PQA_BASE_URL', `is not a valid URL: ${raw}`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new MissingEnvError('PQA_BASE_URL', `must be http or https: ${raw}`);
  }
  return raw.replace(/\/+$/, '');
}

function readPersonas(src: NodeJS.ProcessEnv): Partial<Record<PersonaName, string>> {
  const out: Partial<Record<PersonaName, string>> = {};
  for (const [name, key] of PERSONA_VARS) {
    const email = src[key]?.trim();
    if (email) out[name] = email;
  }
  return out;
}

function readS3(src: NodeJS.ProcessEnv): S3Creds | undefined {
  const v = allOrNothing(src, [
    'PQA_S3_REGION',
    'PQA_S3_BUCKET',
    'PQA_S3_ACCESS_KEY_ID',
    'PQA_S3_SECRET_ACCESS_KEY',
    'PQA_S3_TENANT_PREFIX',
  ]);
  if (!v) return undefined;
  return {
    region: v['PQA_S3_REGION'] as string,
    bucket: v['PQA_S3_BUCKET'] as string,
    accessKeyId: v['PQA_S3_ACCESS_KEY_ID'] as string,
    secretAccessKey: v['PQA_S3_SECRET_ACCESS_KEY'] as string,
    tenantPrefix: v['PQA_S3_TENANT_PREFIX'] as string,
  };
}

function readOpenSearch(src: NodeJS.ProcessEnv): OpenSearchCreds | undefined {
  const v = allOrNothing(src, [
    'PQA_OPENSEARCH_ENDPOINT',
    'PQA_OPENSEARCH_USERNAME',
    'PQA_OPENSEARCH_PASSWORD',
    'PQA_OPENSEARCH_TENANT_INDEX',
  ]);
  if (!v) return undefined;
  return {
    endpoint: v['PQA_OPENSEARCH_ENDPOINT'] as string,
    username: v['PQA_OPENSEARCH_USERNAME'] as string,
    password: v['PQA_OPENSEARCH_PASSWORD'] as string,
    tenantIndex: v['PQA_OPENSEARCH_TENANT_INDEX'] as string,
  };
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): QaEnv {
  const baseUrl = readBaseUrl(source);

  const candidates = required(source, 'PQA_TENANT_CANDIDATES')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (candidates.length === 0) {
    throw new MissingEnvError('PQA_TENANT_CANDIDATES', 'contained no slugs');
  }

  const personaEmails = readPersonas(source);
  if (!personaEmails['platform-admin']) {
    throw new MissingEnvError('PLATFORM_SEED_EMAIL', 'is required and was not set');
  }

  const runId = source['PQA_RUN_ID']?.trim() || randomBytes(6).toString('hex');

  return {
    baseUrl,
    tenantCandidates: candidates,
    runId,
    userAgent: `pqa-qa/${VERSION} (run:${runId})`,
    personaEmails,
    s3: readS3(source),
    openSearch: readOpenSearch(source),
    postgresDsn: source['PQA_POSTGRES_DSN']?.trim() || undefined,
  };
}
