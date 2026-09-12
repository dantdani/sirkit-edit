/**
 * [B18-B] The browser's transport to the execution-grant routes — the ONLY
 * way the granted-execution ritual reaches the server: same-origin, no-store,
 * the project selector headers of the LIVE scope, bounded response reads and
 * a hard deadline per exchange. It carries no authority: every exchange is
 * answered by the server's own checks, and every response is parsed
 * fail-closed (a malformed grant is a refusal, never a grant).
 */
import { parsePublicExecutionGrant, type CancelRetirementReason, type ExecutionGrantConsumption, type ExecutionGrantSettlement, type PublicExecutionGrant } from "../engineering/execution-grant";
import { readBoundedStream } from "../http/bounded-stream";
import { projectSelectorHeaders, type ProjectSelectorScope } from "./project-selector";

export const EXECUTION_GRANT_ENDPOINT = "/api/agent/execution-grant";
export const EXECUTION_GRANT_SETTLE_ENDPOINT = "/api/agent/execution-grant/settle";
export const EXECUTION_GRANT_TRANSPORT_DEADLINE_MS = 10_000;
const MAX_RESPONSE_BYTES = 65_536;

export type TransportOutcome<T> =
  | { ok: true; status: number; body: T }
  | { ok: false; status: number | null; code: string; message: string; reason: string | null; grant: PublicExecutionGrant | null };

export interface TenderBody {
  grantId: string;
  grantDigest: string;
  attemptId: string;
  tender: { operationsDigest: string; commitment: string; confirmation: { actionId: string; previewDigest: string } | null; live: { pcbRevisionId?: string | null; headSequence?: number | null; lineageId?: string | null; selectionDigest?: string | null } | null };
}
export interface CancelBody { grantId: string; grantDigest: string; reason: CancelRetirementReason } // [B18-E E2] the shared cancel vocabulary
export interface SettleBody {
  grantId: string;
  grantDigest: string;
  attemptId: string;
  commitment: string;
  settlement: Omit<ExecutionGrantSettlement, "attestation" | "late" | "at">;
}

export interface ExecutionGrantTransport {
  get(scope: ProjectSelectorScope, grantId: string, signal?: AbortSignal): Promise<TransportOutcome<{ grant: PublicExecutionGrant }>>;
  tender(scope: ProjectSelectorScope, body: TenderBody, signal?: AbortSignal): Promise<TransportOutcome<{ grant: PublicExecutionGrant; consumption: ExecutionGrantConsumption; idempotent: boolean }>>;
  cancel(scope: ProjectSelectorScope, body: CancelBody, signal?: AbortSignal): Promise<TransportOutcome<{ grant: PublicExecutionGrant }>>;
  settle(scope: ProjectSelectorScope, body: SettleBody, signal?: AbortSignal): Promise<TransportOutcome<{ grant: PublicExecutionGrant; idempotent: boolean; late: boolean }>>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Turn a parsed route response into the transport outcome (fail-closed on every surprise). */
export function interpretGrantResponse<T>(status: number, payload: unknown, project: (body: Record<string, unknown>) => T | null): TransportOutcome<T> {
  if (!isRecord(payload)) return { ok: false, status, code: "malformed", message: "The execution-grant endpoint answered with a malformed body.", reason: null, grant: null };
  if (payload.ok === true && status >= 200 && status < 300) {
    const projected = project(payload);
    if (projected === null) return { ok: false, status, code: "malformed", message: "The execution-grant endpoint answered with a malformed success body.", reason: null, grant: null };
    return { ok: true, status, body: projected };
  }
  return {
    ok: false, status,
    code: typeof payload.code === "string" ? payload.code.slice(0, 64) : `http-${status}`,
    message: typeof payload.error === "string" ? payload.error.slice(0, 300) : "The execution-grant endpoint refused the request.",
    reason: typeof payload.reason === "string" ? payload.reason.slice(0, 64) : null,
    grant: parsePublicExecutionGrant(payload.grant),
  };
}

function consumptionOf(value: unknown): ExecutionGrantConsumption | null {
  if (!isRecord(value) || !isRecord(value.live)) return null;
  if (typeof value.attemptId !== "string" || typeof value.consumedAt !== "string" || typeof value.commitDeadline !== "string" || typeof value.commitment !== "string") return null;
  if (typeof value.live.principalId !== "string" || typeof value.live.role !== "string" || typeof value.live.membershipRevision !== "string") return null;
  return { attemptId: value.attemptId, consumedAt: value.consumedAt, commitDeadline: value.commitDeadline, commitment: value.commitment, live: { principalId: value.live.principalId, role: value.live.role as ExecutionGrantConsumption["live"]["role"], membershipRevision: value.live.membershipRevision } };
}

async function exchange<T>(url: string, init: { method: "GET" | "POST"; scope: ProjectSelectorScope; body?: unknown; signal?: AbortSignal }, project: (body: Record<string, unknown>) => T | null): Promise<TransportOutcome<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EXECUTION_GRANT_TRANSPORT_DEADLINE_MS);
  if (init.signal?.aborted) controller.abort();
  else init.signal?.addEventListener("abort", () => controller.abort(), { once: true });
  try {
    const response = await fetch(url, {
      method: init.method,
      credentials: "same-origin",
      cache: "no-store",
      headers: { ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}), ...projectSelectorHeaders(init.scope) },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      signal: controller.signal,
    });
    const read = await readBoundedStream(response.body, MAX_RESPONSE_BYTES, { signal: controller.signal, deadlineMs: EXECUTION_GRANT_TRANSPORT_DEADLINE_MS });
    if (!read.ok) return { ok: false, status: response.status, code: `read-${read.reason}`, message: "The execution-grant response could not be read.", reason: null, grant: null };
    let payload: unknown = null;
    try { payload = JSON.parse(new TextDecoder().decode(read.bytes)); } catch { payload = null; }
    return interpretGrantResponse(response.status, payload, project);
  } catch {
    return { ok: false, status: null, code: controller.signal.aborted ? "timeout" : "unreachable", message: "The execution-grant endpoint could not be reached.", reason: null, grant: null };
  } finally {
    clearTimeout(timer);
  }
}

const withGrant = (body: Record<string, unknown>): { grant: PublicExecutionGrant } | null => {
  const grant = parsePublicExecutionGrant(body.grant);
  return grant ? { grant } : null;
};

/** The PRODUCTION transport. */
export function createExecutionGrantTransport(): ExecutionGrantTransport {
  return {
    get: (scope, grantId, signal) => exchange(`${EXECUTION_GRANT_ENDPOINT}?grantId=${encodeURIComponent(grantId)}`, { method: "GET", scope, signal }, withGrant),
    tender: (scope, body, signal) => exchange(EXECUTION_GRANT_ENDPOINT, { method: "POST", scope, body: { kind: "tender", ...body }, signal }, (payload) => {
      const grant = parsePublicExecutionGrant(payload.grant);
      const consumption = consumptionOf(payload.consumption);
      return grant && consumption ? { grant, consumption, idempotent: payload.idempotent === true } : null;
    }),
    cancel: (scope, body, signal) => exchange(EXECUTION_GRANT_ENDPOINT, { method: "POST", scope, body: { kind: "cancel", ...body }, signal }, withGrant),
    settle: (scope, body, signal) => exchange(EXECUTION_GRANT_SETTLE_ENDPOINT, { method: "POST", scope, body, signal }, (payload) => {
      const grant = parsePublicExecutionGrant(payload.grant);
      return grant ? { grant, idempotent: payload.idempotent === true, late: payload.late === true } : null;
    }),
  };
}
