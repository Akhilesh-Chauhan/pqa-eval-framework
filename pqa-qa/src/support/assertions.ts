export interface HttpObservation {
  status: number;
  body: unknown;
}

const REFUSAL_STATUSES = new Set([401, 403, 404]);

function preview(body: unknown): string {
  const text = typeof body === 'string' ? body : JSON.stringify(body ?? null);
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}

/**
 * Access must have been refused. A 2xx is a failure even when the payload is
 * empty: an empty list is indistinguishable from "this tenant has no data",
 * which is exactly how a broken gate hides behind a plausible screen.
 * A 5xx is also a failure — it is an error, not evidence of a working gate.
 */
export function assertRefused(obs: HttpObservation, context: string): void {
  if (REFUSAL_STATUSES.has(obs.status)) return;

  if (obs.status >= 200 && obs.status < 300) {
    throw new Error(
      `${context}: expected refusal (401/403/404) but got ${obs.status}. ` +
        `Access was granted where it should have been denied. Body: ${preview(obs.body)}`,
    );
  }
  throw new Error(
    `${context}: expected refusal (401/403/404) but got ${obs.status}, which is ` +
      `an error rather than a gate. A 5xx does not demonstrate that access is denied. ` +
      `Body: ${preview(obs.body)}`,
  );
}

/**
 * The response must not contain any marker belonging to another tenant.
 * Used where a request legitimately succeeds but must be scoped.
 */
export function assertNoForeignContent(
  obs: HttpObservation,
  foreignMarkers: string[],
  context: string,
): void {
  const text = typeof obs.body === 'string' ? obs.body : JSON.stringify(obs.body ?? null);
  const hits = foreignMarkers.filter((m) => m && text.includes(m));
  if (hits.length > 0) {
    throw new Error(
      `${context}: response contained content belonging to another tenant: ` +
        `${hits.join(', ')}. Body: ${preview(obs.body)}`,
    );
  }
}
