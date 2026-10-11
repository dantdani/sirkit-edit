/**
 * [B24-C2] D24-22, OD-208: the per-scope salt of the attribution document's digests, `agent.trace-salt.v1`. OD-208 asks for a per-tenant
 * salt; this store keeps ONE random 32-byte salt per scope (tenant, project, branch) - finer than per tenant, a stated choice (OD-232) -
 * so a digest of one project can never be correlated with another project's, even inside one tenant.
 *
 *  - created ONCE by compare-and-set at revision 0 under the idempotency key `agent-trace-salt:<scope key>`: two concurrent first runs in
 *    one scope converge on one salt (the loser meets the winner's replay, or the moved head, and reads the salt back);
 *  - the salt is never logged and never written into a trace or an attribution: it leaves this module only as bytes for an HMAC;
 *  - when it cannot be resolved (the scope is outside the substrate's rule, the repository failed, the record is malformed), the answer
 *    is the closed `salt_unavailable` and the caller writes NULL digests - never an unsalted digest;
 *  - `saltedDigest(salt, domain, text)` is `sd1-` + HMAC-SHA256(salt, domain + NUL + text): the domain separates a principal from a
 *    message from an answer, so equal texts in different roles never share a digest.
 *
 * Deleting a scope's salt aggregate crypto-shreds every salted digest written under it (retention-and-deletion.md); the retention
 * policy keeps it until the owner decides (OD-202). Pure: the repository is INJECTED; this module never imports the durable runtime, the
 * database client or the outbox.
 */
import { createHmac, randomBytes } from "node:crypto";
import { canonicalDurableScope, durableAggregateIdentity, durableScopeKey, durableWorkflowId } from "../durable-workflow/stable";
import type { DurableAggregateIdentity, DurableWorkflowRepository, DurableWorkflowScope } from "../durable-workflow/types";

export const TRACE_SALT_AGGREGATE_TYPE = "agent.trace-salt.v1" as const;
export const TRACE_SALT_RECORD_SCHEMA = "sirkit.agent-trace-salt.v1" as const;
export const TRACE_SALT_BYTES = 32;
export const TRACE_SALT_STORE_BOUNDS = Object.freeze({ casAttempts: 4 });
/** A salted digest: the prefix and 64 hex characters of an HMAC-SHA256. */
export const SALTED_DIGEST_PREFIX = "sd1-" as const;
export const SALTED_DIGEST_PATTERN = /^sd1-[0-9a-f]{64}$/;
export const SALTED_DIGEST_DOMAINS = Object.freeze(["principal", "message", "answer"] as const);
export type SaltedDigestDomain = (typeof SALTED_DIGEST_DOMAINS)[number];

export interface TraceSaltRecord {
  schema: typeof TRACE_SALT_RECORD_SCHEMA;
  /** the salt, 64 hex characters (32 bytes) */
  saltHex: string;
  createdAt: string;
}
export type TraceSaltResolution = { ok: true; salt: Uint8Array; created: boolean } | { ok: false; code: "salt_unavailable" };
export interface TraceSaltStore {
  /** The scope's salt, created on the first call; `salt_unavailable` when it cannot be resolved. Never throws. */
  resolve(scope: DurableWorkflowScope, at: string): Promise<TraceSaltResolution>;
}

const SALT_HEX = /^[0-9a-f]{64}$/;
const UNAVAILABLE: TraceSaltResolution = Object.freeze({ ok: false, code: "salt_unavailable" } as const);
const scopeOf = (scope: DurableWorkflowScope): DurableWorkflowScope => ({ tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId });
function canonicalOrNull(scope: DurableWorkflowScope): DurableWorkflowScope | null {
  try { return canonicalDurableScope(scopeOf(scope)); } catch { return null; }
}
/** A revision conflict or a unique-index refusal: another creation landed first (in memory, or on PostgreSQL). */
function contended(error: unknown): boolean {
  const seen = new Set<unknown>();
  for (let current: unknown = error; current !== null && typeof current === "object" && !seen.has(current); current = (current as { cause?: unknown }).cause) {
    seen.add(current);
    const message = current instanceof Error ? current.message : "";
    if (message === "DW_OPTIMISTIC_REVISION_CONFLICT" || (current as { code?: unknown }).code === "23505" || message.includes("duplicate key value violates unique constraint")) return true;
  }
  return false;
}
function saltOf(payload: unknown): Uint8Array | null {
  if (payload === null || typeof payload !== "object") return null;
  const record = payload as Partial<TraceSaltRecord>;
  if (record.schema !== TRACE_SALT_RECORD_SCHEMA || typeof record.saltHex !== "string" || !SALT_HEX.test(record.saltHex)) return null;
  return Uint8Array.from(Buffer.from(record.saltHex, "hex"));
}

/** The aggregate key of a scope's salt (the scope as the substrate stores it; throws DW_*_INVALID on one it would refuse). */
export function traceSaltAggregateKey(scope: DurableWorkflowScope): string {
  return durableWorkflowId("agent-trace-salt", canonicalDurableScope(scopeOf(scope)));
}
function saltIdentity(scope: DurableWorkflowScope): DurableAggregateIdentity {
  return durableAggregateIdentity(scope, TRACE_SALT_AGGREGATE_TYPE, traceSaltAggregateKey(scope));
}

/** The salted digest of `text` in its `domain`: `sd1-` + HMAC-SHA256(salt, domain NUL text). */
export function saltedDigest(salt: Uint8Array, domain: SaltedDigestDomain, text: string): string {
  return `${SALTED_DIGEST_PREFIX}${createHmac("sha256", salt).update(domain, "utf8").update(String.fromCharCode(0)).update(text, "utf8").digest("hex")}`;
}

/** [B24-C2] The per-scope salt over an injected durable-workflow repository. */
export class DurableTraceSaltStore implements TraceSaltStore {
  constructor(private readonly workflow: DurableWorkflowRepository, private readonly random: (bytes: number) => Uint8Array = (bytes) => Uint8Array.from(randomBytes(bytes))) {}

  async resolve(scope: DurableWorkflowScope, at: string): Promise<TraceSaltResolution> {
    try {
      const canonical = canonicalOrNull(scope);
      if (canonical === null) return UNAVAILABLE;
      const identity = saltIdentity(canonical);
      for (let tries = 0; tries < TRACE_SALT_STORE_BOUNDS.casAttempts; tries += 1) {
        const head = await this.workflow.loadHead<TraceSaltRecord>(identity);
        if (head !== null) {
          const salt = saltOf(head.payload);
          return salt === null ? UNAVAILABLE : { ok: true, salt, created: false };
        }
        const fresh = this.random(TRACE_SALT_BYTES);
        if (!(fresh instanceof Uint8Array) || fresh.length !== TRACE_SALT_BYTES) return UNAVAILABLE;
        const record: TraceSaltRecord = { schema: TRACE_SALT_RECORD_SCHEMA, saltHex: Buffer.from(fresh).toString("hex"), createdAt: at };
        try {
          const committed = await this.workflow.commit<{ created: true }>({
            scope: canonical, scopeKey: durableScopeKey(canonical, "agent-trace-salt"), idempotencyKey: `agent-trace-salt:${identity.aggregateKey}`,
            operations: [{ aggregateType: TRACE_SALT_AGGREGATE_TYPE, aggregateKey: identity.aggregateKey, expectedRevision: 0, payload: record }],
            outbox: [], // silent: a salt is never a command a handler could re-run
            result: { created: true }, committedAt: at,
          });
          if (!committed.idempotent) return { ok: true, salt: fresh, created: true };
          // another creation's replay answered: read the salt it wrote (the next loop reads the head)
        } catch (error) {
          if (!contended(error)) return UNAVAILABLE;
          // the head moved first: the next loop reads it
        }
      }
      return UNAVAILABLE;
    } catch {
      return UNAVAILABLE;
    }
  }
}
