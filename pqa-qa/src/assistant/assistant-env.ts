import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAdminEnv } from '../admin/admin-env.js';
import type { AdminEnv } from '../admin/admin-env.js';
import { required } from '../support/env.js';

export interface AssistantEnv extends AdminEnv {
  /** PQA_ASSISTANT_TENANT — any slug; comind allowed (read-only use). */
  tenant: string;
  /** PQA_ASSISTANT_GOLDEN_DIR — the golden dataset folder. */
  goldenDir: string;
  /** PQA_ASSISTANT_RUN, else `<dataset>-<tenant>-<date>`: names the run folder. */
  runId: string;
  /** PQA_ASSISTANT_ADMIN_EMAIL, else PQA_ADMIN_TENANT_ADMIN_EMAIL: who signs in to the assistant. */
  adminEmail: string;
  /** PQA_ASSISTANT_STREAM: which assistant endpoint to exercise, default chat. */
  stream: 'chat' | 'generate';
  /** PQA_ASSISTANT_REPARSE=1: parse the golden files again instead of reusing the last run's. */
  reparse: boolean;
}

export function loadAssistantEnv(src: NodeJS.ProcessEnv = process.env, today = new Date()): AssistantEnv {
  const opt = (key: string): string | undefined => src[key]?.trim() || undefined;
  const admin = loadAdminEnv(src);
  const tenant = required(src, 'PQA_ASSISTANT_TENANT');
  const goldenDir = required(src, 'PQA_ASSISTANT_GOLDEN_DIR');
  const stream = opt('PQA_ASSISTANT_STREAM') ?? 'chat';
  if (stream !== 'chat' && stream !== 'generate') throw new Error(`PQA_ASSISTANT_STREAM=${stream} is not chat or generate`);
  return {
    ...admin,
    tenant,
    goldenDir,
    runId: opt('PQA_ASSISTANT_RUN') ?? `${basename(goldenDir)}-${tenant}-${today.toISOString().slice(0, 10)}`,
    adminEmail: opt('PQA_ASSISTANT_ADMIN_EMAIL') ?? required(src, 'PQA_ADMIN_TENANT_ADMIN_EMAIL'),
    stream,
    reparse: opt('PQA_ASSISTANT_REPARSE') === '1',
  };
}

/** Per-run output folder (<pqa-qa>/runs/assistant/<runId>); kept out of git by the root .gitignore. */
export const runDir = (runId: string): string => join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'runs', 'assistant', runId);
