/**
 * [B20 B3] The replay cache of MCP reads (D-10; OD-71): a per-process, per-principal cache of SUCCESSFUL read results, keyed
 * by `tenant, project, branch, principal, idempotency key` (every part matched a closed pattern first). MCP retries a request
 * under a new JSON-RPC id after a broken stream; the same key answers the same result, relabelled `replayed`.
 *
 * An entry binds the CALL (tool id and version, the digest of the gated arguments, the pinned revision and registry digest)
 * and its CONTEXT (the membership revision, the registry digest): another call under the same key is a conflict and the entry
 * is kept; a changed context evicts the entry and the call is computed again. A concurrent call under a key already in
 * flight is refused. Bounds: a 10-minute TTL; 32 entries per principal and 1 024 in all (oldest evicted first); an entry of at
 * most 131 072 characters (else not stored); 8 388 608 characters in all; 8 in-flight keys per principal. An invalid clock
 * neither stores nor replays. Results are held as JSON text, so a hit is always a fresh copy. Nothing here throws, and the
 * counters are consistent after every call (S4). A stated limit: per process, like OD-53 — several instances each hold one.
 */
import { ID_PATTERN } from "../../auth/trusted-request-context";
import { MCP_IDEMPOTENCY_KEY_PATTERN } from "./read-arguments";

export const MCP_REPLAY_TTL_MS = 600_000;
export const MCP_REPLAY_MAX_ENTRIES_PER_PRINCIPAL = 32;
export const MCP_REPLAY_MAX_ENTRIES = 1_024;
export const MCP_REPLAY_MAX_ENTRY_CHARS = 131_072;
export const MCP_REPLAY_MAX_TOTAL_CHARS = 8_388_608;
export const MCP_REPLAY_MAX_IN_FLIGHT_PER_PRINCIPAL = 8;
export const MCP_REPLAY_BOUNDS = Object.freeze({
  MCP_REPLAY_TTL_MS,
  MCP_REPLAY_MAX_ENTRIES_PER_PRINCIPAL,
  MCP_REPLAY_MAX_ENTRIES,
  MCP_REPLAY_MAX_ENTRY_CHARS,
  MCP_REPLAY_MAX_TOTAL_CHARS,
  MCP_REPLAY_MAX_IN_FLIGHT_PER_PRINCIPAL,
});
const REPLAY_BOUND_CEILINGS: Readonly<Record<keyof typeof MCP_REPLAY_BOUNDS, number>> = Object.freeze({
  MCP_REPLAY_TTL_MS: 3_600_000,
  MCP_REPLAY_MAX_ENTRIES_PER_PRINCIPAL: 1_024,
  MCP_REPLAY_MAX_ENTRIES: 100_000,
  MCP_REPLAY_MAX_ENTRY_CHARS: 1_048_576,
  MCP_REPLAY_MAX_TOTAL_CHARS: 67_108_864,
  MCP_REPLAY_MAX_IN_FLIGHT_PER_PRINCIPAL: 1_024,
});

/** S3: exactly the six bounds, each a safe integer in [1, its ceiling]. */
export function validateMcpReplayBounds(value: unknown): string[] {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return ["the bounds are not an object"];
    const record = value as Record<string, unknown>;
    const errors: string[] = [];
    for (const key of Object.keys(record)) if (!Object.hasOwn(REPLAY_BOUND_CEILINGS, key)) errors.push(`unknown bound ${key.slice(0, 64)}`);
    for (const [name, ceiling] of Object.entries(REPLAY_BOUND_CEILINGS)) {
      const bound = record[name];
      if (typeof bound !== "number" || !Number.isSafeInteger(bound) || bound < 1 || bound > ceiling) errors.push(`${name} must be a safe integer in [1, ${ceiling}]`);
    }
    return errors;
  } catch {
    return ["the bounds could not be read"];
  }
}

export interface McpReplayIdentity {
  readonly tenantId: string;
  readonly projectId: string;
  readonly branchId: string;
  readonly principalId: string;
  readonly key: string;
}
export interface McpReplayCall {
  readonly toolId: string;
  readonly toolVersion: string;
  readonly argsDigest: string;
  readonly expectedRevision: string | null;
  readonly expectedRegistryDigest: string | null;
}
export interface McpReplayContext {
  readonly membershipRevision: string;
  readonly registryDigest: string;
}
export type McpReplayBegin =
  | { readonly kind: "hit"; readonly result: unknown }
  | { readonly kind: "conflict" }
  | { readonly kind: "in_flight" }
  | { readonly kind: "full" }
  | { readonly kind: "miss" }
  | { readonly kind: "invalid" };
export interface McpReplayStats {
  readonly entries: number;
  readonly totalChars: number;
  readonly inFlight: number;
  readonly entryChars: readonly number[];
  /** entries per principal, keyed by tenant, project and principal joined by a NUL character */
  readonly entriesPerPrincipal: Readonly<Record<string, number>>;
}

interface Entry {
  readonly principal: string;
  readonly call: string;
  readonly context: string;
  readonly text: string;
  readonly storedAtMs: number;
}

const NUL = String.fromCharCode(0);
const TOOL_ID = /^[A-Za-z0-9_.-]{1,128}$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const DIGEST = /^eng1-[0-9a-f]{16}$/;
const MEMBERSHIP_REVISION = /^mbr1-[0-9a-f]{16}$/;
const validClock = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const id = (value: unknown): value is string => typeof value === "string" && ID_PATTERN.test(value);

/** The keys of an identity, or null when a part is outside its closed pattern. */
function keysOf(identity: McpReplayIdentity): { entry: string; principal: string } | null {
  const { tenantId, projectId, branchId, principalId, key } = identity;
  if (!id(tenantId) || !id(projectId) || !id(branchId) || !id(principalId)) return null;
  if (typeof key !== "string" || key.length < 8 || key.length > 128 || !MCP_IDEMPOTENCY_KEY_PATTERN.test(key)) return null;
  return { entry: [tenantId, projectId, branchId, principalId, key].join(NUL), principal: [tenantId, projectId, principalId].join(NUL) };
}
function callOf(call: McpReplayCall): string | null {
  const { toolId, toolVersion, argsDigest, expectedRevision, expectedRegistryDigest } = call;
  if (typeof toolId !== "string" || !TOOL_ID.test(toolId) || typeof toolVersion !== "string" || !VERSION.test(toolVersion) || typeof argsDigest !== "string" || !DIGEST.test(argsDigest)) return null;
  for (const pin of [expectedRevision, expectedRegistryDigest]) if (pin !== null && (typeof pin !== "string" || !DIGEST.test(pin))) return null;
  return JSON.stringify([toolId, toolVersion, argsDigest, expectedRevision, expectedRegistryDigest]);
}
function contextOf(context: McpReplayContext): string | null {
  const { membershipRevision, registryDigest } = context;
  if (typeof membershipRevision !== "string" || !MEMBERSHIP_REVISION.test(membershipRevision) || typeof registryDigest !== "string" || !DIGEST.test(registryDigest)) return null;
  return JSON.stringify([membershipRevision, registryDigest]);
}

export class McpReadReplayCache {
  /** insertion-ordered: the first entry is the oldest */
  private readonly entries = new Map<string, Entry>();
  private readonly perPrincipal = new Map<string, number>();
  private readonly inFlight = new Map<string, string>();
  private readonly inFlightPerPrincipal = new Map<string, number>();
  private totalChars = 0;

  /**
   * Look a key up: a live matching entry is a `hit` (a fresh copy); another call under the key is a `conflict` (the entry is
   * kept); a changed context evicts the entry. Otherwise a key in flight is `in_flight`, a principal at its in-flight cap is
   * `full`, and a `miss` marks the key in flight until `release`. An invalid identity, call, context or clock is `invalid`.
   */
  begin(identity: McpReplayIdentity, call: McpReplayCall, context: McpReplayContext, nowMs: number): McpReplayBegin {
    try {
      if (!validClock(nowMs)) return { kind: "invalid" };
      const keys = keysOf(identity);
      const callKey = callOf(call);
      const contextKey = contextOf(context);
      if (keys === null || callKey === null || contextKey === null) return { kind: "invalid" };
      const entry = this.entries.get(keys.entry);
      if (entry) {
        if (nowMs - entry.storedAtMs >= MCP_REPLAY_TTL_MS || nowMs < entry.storedAtMs) this.evict(keys.entry);
        else if (entry.call !== callKey) return { kind: "conflict" };
        else if (entry.context !== contextKey) this.evict(keys.entry);
        else return { kind: "hit", result: JSON.parse(entry.text) as unknown };
      }
      if (this.inFlight.has(keys.entry)) return { kind: "in_flight" };
      const flying = this.inFlightPerPrincipal.get(keys.principal) ?? 0;
      if (flying >= MCP_REPLAY_MAX_IN_FLIGHT_PER_PRINCIPAL) return { kind: "full" };
      this.inFlight.set(keys.entry, keys.principal);
      this.inFlightPerPrincipal.set(keys.principal, flying + 1);
      return { kind: "miss" };
    } catch {
      return { kind: "invalid" };
    }
  }

  /** Store a successful result under the key: `not_stored` when anything is invalid or the entry is over its size cap. */
  store(identity: McpReplayIdentity, call: McpReplayCall, context: McpReplayContext, result: unknown, nowMs: number): "stored" | "not_stored" {
    try {
      if (!validClock(nowMs)) return "not_stored";
      const keys = keysOf(identity);
      const callKey = callOf(call);
      const contextKey = contextOf(context);
      if (keys === null || callKey === null || contextKey === null) return "not_stored";
      const text = JSON.stringify(result);
      if (typeof text !== "string" || text.length > MCP_REPLAY_MAX_ENTRY_CHARS) return "not_stored";
      if (this.entries.has(keys.entry)) this.evict(keys.entry);
      this.entries.set(keys.entry, { principal: keys.principal, call: callKey, context: contextKey, text, storedAtMs: nowMs });
      this.perPrincipal.set(keys.principal, (this.perPrincipal.get(keys.principal) ?? 0) + 1);
      this.totalChars += text.length;
      // the principal's oldest first, then the global oldest, then by size — never the entry just stored while others remain
      while ((this.perPrincipal.get(keys.principal) ?? 0) > MCP_REPLAY_MAX_ENTRIES_PER_PRINCIPAL) this.evictOldest((entry) => entry.principal === keys.principal);
      while (this.entries.size > MCP_REPLAY_MAX_ENTRIES || this.totalChars > MCP_REPLAY_MAX_TOTAL_CHARS) this.evictOldest(() => true);
      return this.entries.has(keys.entry) ? "stored" : "not_stored";
    } catch {
      return "not_stored";
    }
  }

  /** Release the in-flight marker of a key (a no-op for a key not in flight). */
  release(identity: McpReplayIdentity): void {
    try {
      const keys = keysOf(identity);
      if (keys === null) return;
      const principal = this.inFlight.get(keys.entry);
      if (principal === undefined) return;
      this.inFlight.delete(keys.entry);
      const flying = (this.inFlightPerPrincipal.get(principal) ?? 1) - 1;
      if (flying > 0) this.inFlightPerPrincipal.set(principal, flying);
      else this.inFlightPerPrincipal.delete(principal);
    } catch {
      // a hostile identity releases nothing
    }
  }

  stats(): McpReplayStats {
    return Object.freeze({
      entries: this.entries.size,
      totalChars: this.totalChars,
      inFlight: this.inFlight.size,
      entryChars: Object.freeze([...this.entries.values()].map((entry) => entry.text.length)),
      entriesPerPrincipal: Object.freeze(Object.fromEntries(this.perPrincipal)),
    });
  }

  clear(): void {
    this.entries.clear();
    this.perPrincipal.clear();
    this.inFlight.clear();
    this.inFlightPerPrincipal.clear();
    this.totalChars = 0;
  }

  private evict(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.totalChars -= entry.text.length;
    const count = (this.perPrincipal.get(entry.principal) ?? 1) - 1;
    if (count > 0) this.perPrincipal.set(entry.principal, count);
    else this.perPrincipal.delete(entry.principal);
  }

  private evictOldest(matches: (entry: Entry) => boolean): void {
    for (const [key, entry] of this.entries) {
      if (matches(entry)) {
        this.evict(key);
        return;
      }
    }
    // nothing matched: nothing to evict (never loops forever)
    throw new Error("REPLAY_NOTHING_TO_EVICT");
  }
}

/** The process's replay cache. */
export const mcpReadReplayCache = new McpReadReplayCache();
