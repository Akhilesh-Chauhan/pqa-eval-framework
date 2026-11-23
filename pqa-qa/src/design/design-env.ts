import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { required } from '../support/env.js';

/** The portal people in the UI/UX design (qa/design-test-cases.md): the Executive (Session Command Centre),
 * the Parliament Section user and the Division officer. */
export type DesignPersona = 'executive' | 'parliament' | 'division';
export const DESIGN_PERSONAS: DesignPersona[] = ['executive', 'parliament', 'division'];

/** Saved portal cookies per persona. Written by `npm run qa:design:login -- <persona>`, kept current by the fixtures. */
export const designSessionFile = (slug: string, persona: DesignPersona): string =>
  join(dirname(fileURLToPath(import.meta.url)), '..', '.auth', `design-${slug}-${persona}.json`);

export interface DesignEnv {
  /** PQA_BASE_URL — the ministry portal origin. */
  portalUrl: string;
  /** PQA_DESIGN_TENANT — the tenant slug the design suite opens; unset, every portal case reports "not measured". */
  tenant?: string;
  /** PQA_DESIGN_ALLOW_WRITES=true lets `Auto-W` cases save, send and submit. Only ever on a QA-owned disposable tenant. */
  allowWrites: boolean;
  /** PQA_DESIGN_INVENTORY — design_inventory.json of the design snapshot the cases were written from. */
  inventory?: string;
  /** PQA_DESIGN_QUESTION_PDF — a QA-made question-only PDF for upload steps (never a Monsoon 2026 answer document). */
  questionPdf?: string;
  /** PQA_DESIGN_COLLAB_EMAIL — a tester-owned inbox for Input Collaboration Requests. */
  collabEmail?: string;
  /** PQA_DESIGN_GOLDEN_ROOT — PQA Builder/qa/golden, for the AI Assistant answer-quality cases. */
  goldenRoot?: string;
  /** PQA_DESIGN_QUALITY_LIMIT — how many golden rows/cases a quality case asks (default 10; 0 = all). */
  qualityLimit: number;
}

export function loadDesignEnv(src: NodeJS.ProcessEnv = process.env): DesignEnv {
  const opt = (key: string): string | undefined => src[key]?.trim() || undefined;
  return {
    portalUrl: required(src, 'PQA_BASE_URL').replace(/\/+$/, ''),
    tenant: opt('PQA_DESIGN_TENANT'),
    allowWrites: opt('PQA_DESIGN_ALLOW_WRITES') === 'true',
    inventory: opt('PQA_DESIGN_INVENTORY'),
    questionPdf: opt('PQA_DESIGN_QUESTION_PDF'),
    collabEmail: opt('PQA_DESIGN_COLLAB_EMAIL'),
    goldenRoot: opt('PQA_DESIGN_GOLDEN_ROOT'),
    qualityLimit: Number(opt('PQA_DESIGN_QUALITY_LIMIT') ?? 10),
  };
}
