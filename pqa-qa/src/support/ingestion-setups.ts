import type { SetupId } from './golden-manifest.js';

/** The Admin Panel's 11 file types (pqa-builder apps/admin/src/lib/tenant-form-constants.ts FILE_TYPE_OPTIONS). */
export const FILE_TYPES = {
  PDF: { ext: '.pdf', mime: 'application/pdf' },
  DOC: { ext: '.doc', mime: 'application/msword' },
  DOCX: { ext: '.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  XLS: { ext: '.xls', mime: 'application/vnd.ms-excel' },
  XLSX: { ext: '.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  PPT: { ext: '.ppt', mime: 'application/vnd.ms-powerpoint' },
  PPTX: { ext: '.pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
  TXT: { ext: '.txt', mime: 'text/plain' },
  CSV: { ext: '.csv', mime: 'text/csv' },
  PNG: { ext: '.png', mime: 'image/png' },
  JPEG: { ext: '.jpeg', mime: 'image/jpeg' },
} as const;
export type FileTypeKey = keyof typeof FILE_TYPES;

export interface Setup {
  id: SetupId;
  types: FileTypeKey[];
  maxMb: number;
}

export const SETUPS: Setup[] = [
  { id: 'P1', types: ['PDF'], maxMb: 10 },
  { id: 'P2', types: Object.keys(FILE_TYPES) as FileTypeKey[], maxMb: 10 },
  { id: 'P3', types: ['PDF', 'DOCX', 'PNG'], maxMb: 10 },
  { id: 'P4', types: ['PDF'], maxMb: 1 },
];

/** The edit page's Save configuration body with its file rules replaced by the setup's. The input is not changed. */
export function withSetup(body: any, setup: Setup, updatedAt: string): any {
  const assistant = body.tenant.assistant;
  const types = setup.types.map((k) => FILE_TYPES[k]);
  return {
    ...body,
    expectedUpdatedAt: updatedAt,
    tenant: {
      ...body.tenant,
      assistant: {
        ...assistant,
        fileSupportType: {
          ...assistant.fileSupportType,
          extensions: types.map((t) => t.ext),
          mimeTypes: types.map((t) => t.mime),
          // Parliament question lists stay PDF only; PDF is in every setup, so this stays a subset.
          questionListMimeTypes: ['application/pdf'],
        },
        filesize: { bytes: setup.maxMb * 1024 * 1024, label: `${setup.maxMb} MB` },
      },
    },
  };
}

/** Does a file input's accept attribute offer exactly the setup's types (each by extension or MIME)? */
export function acceptMatches(accept: string, setup: Setup): { ok: boolean; missing: string[]; extra: string[] } {
  const offered = accept.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const allowed = setup.types.map((k) => FILE_TYPES[k]);
  const known = new Set<string>(allowed.flatMap((t) => [t.ext, t.mime]));
  if (setup.types.includes('JPEG')) known.add('.jpg'); // spec §9.2: .jpg is JPEG
  const missing = allowed.filter((t) => !offered.includes(t.ext) && !offered.includes(t.mime)).map((t) => t.ext);
  const extra = offered.filter((o) => !known.has(o));
  return { ok: !missing.length && !extra.length, missing, extra };
}
