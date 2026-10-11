/**
 * B16.0 — the worker / automation service principal.
 *
 * Worker identity is a SEPARATE authenticated boundary from human identity: a
 * constant-time-verified shared secret yields a machine principal that can
 * NEVER be a human (`actorKind` is always a machine kind; `authStrength` is
 * `service`). A worker secret can never mint a human actor, and a forged or
 * absent secret fails closed.
 */

import { timingSafeEqualString } from "./constant-time";
import type { EngineeringActor } from "../engineering/types";

export const WORKER_SECRET_ENV = "SIRKIT_WORKFLOW_WORKER_SECRET";
export const WORKER_SECRET_HEADER = "authorization";

/** The fixed worker principal — a machine, never a human. */
export const WORKER_PRINCIPAL_ID = "sirkit-workflow-worker";

export interface WorkerPrincipal {
  principalId: string;
  actor: EngineeringActor;
}

/** The machine actor a verified worker secret authorizes. `actorKind` is
 *  `automated_engine` (a machine kind) — never `human`. */
export function workerActor(): EngineeringActor {
  return {
    actorId: WORKER_PRINCIPAL_ID,
    actorKind: "automated_engine",
    sessionId: "worker:service",
    role: "automation",
  };
}

/** Extract a bearer token from an Authorization header. */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get(WORKER_SECRET_HEADER);
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1]!.trim() : null;
}

/**
 * Verify the worker shared secret with a constant-time comparison. Returns
 * the worker principal on success, or null (fail closed) when the secret is
 * absent, unconfigured, or mismatched. NEVER produces a human actor.
 */
export function verifyWorkerSecret(request: Request, environment: Record<string, string | undefined> = process.env): WorkerPrincipal | null {
  const configured = environment[WORKER_SECRET_ENV]?.trim();
  if (!configured || configured.length === 0) return null; // no worker auth configured → fail closed
  const presented = bearerToken(request);
  if (!presented) return null;
  if (!matchesCurrentOrPreviousWorkerSecret(presented, configured, environment)) return null; // [B24-A2] D24-4, OD-195: the current secret, or the previous one while it is set (verification only)
  return { principalId: WORKER_PRINCIPAL_ID, actor: workerActor() };
}

/**
 * [B24-A2] D24-4, OD-195 - rotation: while `SIRKIT_WORKFLOW_WORKER_SECRET_PREVIOUS` is set, a bearer holding the previous secret
 * verifies too, so the operator can switch the current value first and every worker after it, then unset the previous one. It only
 * verifies: alone (the current value unset or blank) it configures nothing, and `verifyWorkerSecret` answers null before reaching it.
 */
export const WORKER_SECRET_PREVIOUS_ENV = "SIRKIT_WORKFLOW_WORKER_SECRET_PREVIOUS";

/** The bearer against the current secret and against the previous one (both trimmed), each compared in constant time, both compares
 *  made before the one answer: no return between them. An unset or blank previous value matches nothing. */
function matchesCurrentOrPreviousWorkerSecret(presented: string, current: string, environment: Record<string, string | undefined>): boolean {
  const previous = environment[WORKER_SECRET_PREVIOUS_ENV]?.trim() ?? "";
  const matchesCurrent = timingSafeEqualString(presented, current);
  const matchesPrevious = timingSafeEqualString(presented, previous);
  return matchesCurrent || (previous.length > 0 && matchesPrevious);
}
