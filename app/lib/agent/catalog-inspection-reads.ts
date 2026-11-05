/**
 * [PR-D d2] The agent's CATALOG PART INSPECTION read, `sirkit.parts.catalog-inspect`: ONE part of Sirkit's own parts catalog by its
 * part id - the same read the parts detail route answers the browser's part cache with (app/lib/atomic/catalog-part-detail.ts
 * `loadCatalogPartDetail`, extracted from app/api/parts/[id]/route.ts), plus the published revision status read
 * (`loadAtomicRevisionStatus`, app/lib/atomic/server-catalog.ts) for its linked exact revisions. A Tier 0 read modelled on the named
 * computation reads (computation-reads.ts): nothing here reads the database - the server port is INJECTED into the gateway by the
 * chat route through its one approved runtime boundary (app/api/chat/catalog-inspection-runtime.ts), behind the server's own catalog
 * fact (`catalogInspectionAvailable`), which the context assembler turns into the `catalog` authority.
 *
 * Per invocation: the exact allowlisted binding, the context integrity check (the fact and the authority agree), the server's fact AND
 * port, a fresh discovery check, the role and capability recheck, the closed argument surface (exactly `partId`, the id alphabet;
 * authority-shaped keys refused by name), the port under a deadline composed with the run's cancellation, then a CLOSED bounded
 * projection of the answer (no raw symbol text, no properties blob, no links), schema-checked. A part that is not in the catalog is
 * DATA (`found: false`), never an error; a port failure is a refusal with a closed code. No distributor is called; nothing is placed,
 * bound, published or bought.
 */
import { discoverTools } from "../engineering/tool-discovery";
import { assertSafeJsonValue, DEFAULT_INPUT_LIMITS, DEFAULT_OUTPUT_LIMITS, validateAgainstSchema } from "../engineering/tool-io-validation";
import type { ToolDescriptor, ToolRegistry } from "../engineering/tool-registry";
import type { CatalogPartDetail } from "../atomic/catalog-part-detail";
import type { AtomicRevisionStatus } from "../atomic/revision-status";
import type { AgentRunContext, GatewayInvocationOutcome } from "./contracts";

export const CATALOG_INSPECT_TOOL_ID = "sirkit.parts.catalog-inspect" as const;
/** The authority source the descriptor requires: advertised ONLY when the chat route bound the catalog inspection port to the run. */
export const CATALOG_INSPECTION_AUTHORITY = "catalog" as const;
/** The ONE proven implementation the descriptor binds (`resolveCatalogInspectionBinding` matches it exactly). */
export const CATALOG_INSPECTION_BINDING = Object.freeze({ module: "app/lib/atomic/catalog-part-detail.ts", symbol: "loadCatalogPartDetail" });
/** The read's verification state: a server catalog read at the time of the call, never pinned to a project revision. */
export const CATALOG_INSPECTION_VERIFICATION = "catalog-read" as const;
/** The part id alphabet (a database UUID, or the fixture catalog's stable names): the loader's own shape check runs after it. */
export const CATALOG_PART_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export const MAX_INSPECTED_PINS = 128;
export const MAX_INSPECTED_TEXT_CHARS = 300;
export const MAX_INSPECTED_KEYS = 64;
/** The descriptor's valid input example (the manual's example). */
export const CATALOG_INSPECT_INPUT_EXAMPLE = Object.freeze({ partId: "3f2a9c1e-0b7d-4e5a-9c21-7d8e6f5a4b3c" });

// ─── The port the chat route injects ────────────────────────────────────────────────────────────────────────────────────────

export interface CatalogPartInspectionPortRequest {
  readonly partId: string;
  readonly scope: { readonly tenantId: string; readonly projectId: string; readonly branchId: string };
  readonly runId: string;
  readonly deadlineMs: number;
  readonly signal: AbortSignal;
}
export type CatalogPartInspectionPortAnswer =
  | { readonly state: "found"; readonly detail: CatalogPartDetail; /** by revision id, for the detail's linked revisions (absent: status unknown) */ readonly revisionStatus: Readonly<Record<string, AtomicRevisionStatus>> }
  | { readonly state: "not_found" }
  | { readonly state: "failed"; readonly code: string };
/** The server port: the shared loader behind the catalog fact (app/api/chat/catalog-inspection-runtime.ts); faked in tests. */
export interface CatalogPartInspectionPort {
  inspect(request: CatalogPartInspectionPortRequest): Promise<CatalogPartInspectionPortAnswer>;
}

// ─── The closed projection ──────────────────────────────────────────────────────────────────────────────────────────────────

const text = (value: unknown, max = MAX_INSPECTED_TEXT_CHARS): string | null => {
  if (typeof value !== "string") return null;
  const points = Array.from(value);
  return points.length <= max ? value : `${points.slice(0, max - 1).join("")}…`;
};

export interface CatalogPartInspectionRevision {
  valueKey: string;
  revisionId: string;
  footprintFullName: string;
  /** Derived from selectability by the loader (published and never withdrawn); never a stored flag. */
  approved: boolean;
  status: { state: AtomicRevisionStatus["state"] | "unknown"; selectable: boolean | null; pinnable: boolean | null; successorRevisionId: string | null };
}

/** The bounded, closed projection of a found part (the model never receives the raw symbol text, the properties blob or a link). */
export function projectCatalogPartInspection(partId: string, detail: CatalogPartDetail, revisionStatus: Readonly<Record<string, AtomicRevisionStatus>>): Record<string, unknown> {
  const pins = Array.isArray(detail.pins) ? detail.pins : [];
  const assignments = Object.entries(detail.atomicAssignments ?? {}).sort(([a], [b]) => a.localeCompare(b)).slice(0, MAX_INSPECTED_KEYS);
  const exactRevisions: CatalogPartInspectionRevision[] = assignments.map(([valueKey, assignment]) => {
    const status = Object.hasOwn(revisionStatus, assignment.revisionId) ? revisionStatus[assignment.revisionId] : undefined;
    return {
      valueKey: text(valueKey, 64) ?? "",
      revisionId: assignment.revisionId,
      footprintFullName: text(assignment.footprintFullName, 128) ?? "",
      approved: assignment.approved === true,
      status: status
        ? { state: status.state, selectable: status.selectable, pinnable: status.pinnable, successorRevisionId: status.successorRevisionId ?? null }
        : { state: "unknown", selectable: null, pinnable: null, successorRevisionId: null },
    };
  });
  return {
    partId,
    found: true,
    part: {
      id: detail.id,
      name: text(detail.name) ?? "",
      description: text(detail.description),
      mpn: text(detail.mpn, 128),
      manufacturer: text(detail.manufacturer, 128),
      library: text(detail.libraryName, 128) ?? "",
      mainCategory: text(detail.mainCategory, 64) ?? "",
      footprintHint: text(detail.footprintHint, 128),
      packageNormalized: text(detail.packageNormalized, 64),
      lifecycleStatus: detail.lifecycleStatus ?? "unknown",
      rohsStatus: detail.rohsStatus ?? "unknown",
      isGeneric: detail.isGeneric === true,
      internalPartNumber: text(detail.internalPartNumber, 128),
    },
    pins: {
      count: pins.length,
      items: pins.slice(0, MAX_INSPECTED_PINS).map((pin) => ({ number: text(pin.number, 32) ?? "", name: text(pin.name, 64) ?? "", type: text(pin.type, 32) ?? "" })),
      truncated: Math.max(0, pins.length - MAX_INSPECTED_PINS),
    },
    authority: {
      exactRevisions,
      withdrawnValueKeys: [...(detail.withdrawnValueKeys ?? [])].sort().slice(0, MAX_INSPECTED_KEYS).map((key) => text(key, 64) ?? ""),
      note: "A catalog link is the part's published exact revision for a value, as the Build Library shows it; placing or binding it stays the user's and a reviewer's act. A withdrawn value key has no selectable revision.",
    },
    source: "sirkit-catalog",
  };
}

export function projectCatalogPartMiss(partId: string): Record<string, unknown> {
  return { partId, found: false, note: "No catalog part has this id (or the id is not a catalog part id). Nothing else was looked up: this read never calls a distributor." };
}

// ─── Binding resolution ─────────────────────────────────────────────────────────────────────────────────────────────────────

export type CatalogInspectionBindingResolution = { state: "resolved" } | { state: "not_callable"; reason: string };

/** Allowlist-only: the descriptor is callable here only as the one catalog inspection read over the one shared loader. */
export function resolveCatalogInspectionBinding(descriptor: ToolDescriptor): CatalogInspectionBindingResolution {
  if (descriptor.toolId !== CATALOG_INSPECT_TOOL_ID) return { state: "not_callable", reason: "Only the catalog part inspection is invocable here." };
  if (descriptor.operationClass !== "read" || descriptor.approvalTier !== "none" || (descriptor.sideEffects !== "none" && descriptor.sideEffects !== "derived-cache")) return { state: "not_callable", reason: "The catalog inspection is a Tier 0 read with no side effects beyond a derived cache." };
  if (descriptor.binding.status !== "bound-read" || descriptor.binding.module !== CATALOG_INSPECTION_BINDING.module || descriptor.binding.symbol !== CATALOG_INSPECTION_BINDING.symbol) return { state: "not_callable", reason: "The descriptor does not bind the one shared catalog part detail loader." };
  if (descriptor.requiredAuthority.length !== 1 || descriptor.requiredAuthority[0] !== CATALOG_INSPECTION_AUTHORITY) return { state: "not_callable", reason: "The catalog inspection requires exactly the catalog authority." };
  return { state: "resolved" };
}

/** The loop's per-run advertisement rule: the binding resolves and the server bound the catalog port to this run (the catalog fact). */
export function catalogInspectionReadAvailable(descriptor: ToolDescriptor, context: AgentRunContext, warn: (message: string) => void): boolean {
  if (resolveCatalogInspectionBinding(descriptor).state !== "resolved") {
    warn(`Tool ${descriptor.toolId} unavailable: no resolved catalog inspection binding.`);
    return false;
  }
  if (context.catalogInspectionAvailable !== true) {
    warn(`Tool ${descriptor.toolId} unavailable: no catalog is bound to this run.`);
    return false;
  }
  return true;
}

// ─── The service ────────────────────────────────────────────────────────────────────────────────────────────────────────────

const AUTHORITY_KEYS = new Set(["actor", "actorId", "role", "capability", "capabilities", "authority", "approval", "approvals", "apply", "commit", "bind", "publish", "place", "scope", "headMark", "revision", "expectedRevision", "revisionId", "lineageId", "mpn", "live", "distributor", "source"]);
const SAFE_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;

export interface CatalogInspectionReadServiceOptions {
  /** The server port, injected by the composition root; absent: the catalog inspection refuses authority_unavailable. */
  port?: CatalogPartInspectionPort;
  /** The gateway's context integrity check (injected so this module never imports the gateway). */
  integrity: (context: AgentRunContext) => readonly string[];
}
export interface CatalogInspectionReadInput { toolId: string; version: string; args: Record<string, unknown>; context: AgentRunContext; runId: string; timeoutMs: number; signal?: AbortSignal }

class CatalogInspectionTimeout { readonly kind = "timeout"; }
class CatalogInspectionCancelled { readonly kind = "cancelled"; }

export class CatalogInspectionReadService {
  constructor(private readonly registry: ToolRegistry, private readonly options: CatalogInspectionReadServiceOptions) {}

  async invoke(input: CatalogInspectionReadInput): Promise<GatewayInvocationOutcome> {
    const refuse = (status: string, diagnostics: string[]): GatewayInvocationOutcome => ({ kind: "refused", ok: false, toolId: input.toolId, version: input.version, status, diagnostics });
    const descriptor = this.registry.get(input.toolId, input.version);
    if (!descriptor) return refuse("not_registered", ["Unknown tool."]);
    const resolution = resolveCatalogInspectionBinding(descriptor);
    if (resolution.state !== "resolved") return refuse("not_callable", [resolution.reason]);
    const integrity = this.options.integrity(input.context);
    if (integrity.length > 0) return refuse("context_integrity", integrity.slice(0, 5));
    const context = input.context;
    const port = this.options.port;
    if (!port || context.catalogInspectionAvailable !== true) return refuse("authority_unavailable", ["No catalog is bound to this run; the catalog inspection is unavailable."]);
    const discovery = discoverTools(this.registry, context.discovery);
    if (!discovery.included.some((item) => item.toolId === descriptor.toolId && item.version === descriptor.version)) {
      const reason = discovery.excluded.find((entry) => entry.toolId === descriptor.toolId)?.reason ?? "not discoverable";
      return refuse("not_discoverable", [`Tool is not discoverable in the current context (${reason}).`]);
    }
    if (!descriptor.requiredRoles.includes(context.actor.actorRole) || !context.actor.grantedCapabilities.includes(descriptor.requiredCapability)) {
      return refuse("unauthorized", [`Role ${context.actor.actorRole} / capability ${descriptor.requiredCapability} is not permitted for this tool.`]);
    }
    // The closed argument surface: exactly `partId`; authority-shaped keys are refused by name.
    const safety = assertSafeJsonValue(input.args, DEFAULT_INPUT_LIMITS, "args");
    if (safety.length > 0) return refuse("invalid_input", safety.slice(0, 5));
    for (const key of Object.keys(input.args)) {
      if (key === "partId") continue;
      return refuse("invalid_input", [AUTHORITY_KEYS.has(key) ? `Argument "${key.slice(0, 40)}" is an authority-shaped claim - the catalog inspection accepts only partId.` : `Unexpected argument "${key.slice(0, 40)}" - the catalog inspection accepts only partId.`]);
    }
    const partId = typeof input.args.partId === "string" ? input.args.partId.trim() : "";
    if (!CATALOG_PART_ID_PATTERN.test(partId)) return refuse("invalid_input", ["partId must be a catalog part id: 1 to 128 characters of letters, digits, dot, underscore, colon or hyphen."]);
    if (input.signal?.aborted) return refuse("cancelled", ["The invocation was cancelled before it ran."]);
    const timeoutMs = Math.max(1, Math.min(Math.floor(input.timeoutMs), descriptor.timeoutMs));
    const controller = new AbortController();
    const onAbort = (): void => controller.abort();
    input.signal?.addEventListener("abort", onAbort, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let answer: CatalogPartInspectionPortAnswer | CatalogInspectionTimeout | CatalogInspectionCancelled;
    try {
      const work = Promise.resolve().then(() => port.inspect({ partId, scope: { tenantId: context.tenantId, projectId: context.projectId, branchId: context.branchId }, runId: input.runId, deadlineMs: Math.max(1, timeoutMs - Math.min(500, Math.floor(timeoutMs / 4))), signal: controller.signal }));
      work.catch(() => undefined); // a late rejection after the deadline is never unhandled
      answer = await Promise.race<CatalogPartInspectionPortAnswer | CatalogInspectionTimeout | CatalogInspectionCancelled>([
        work,
        new Promise<CatalogInspectionTimeout>((resolve) => { timer = setTimeout(() => { resolve(new CatalogInspectionTimeout()); controller.abort(); }, timeoutMs); }), // the deadline settles the race, then stops the port's work (the abort listener below resolves second)
        new Promise<CatalogInspectionCancelled>((resolve) => { controller.signal.addEventListener("abort", () => resolve(new CatalogInspectionCancelled()), { once: true }); }),
      ]);
    } catch {
      return refuse("implementation_failed", ["CATALOG_READ_FAILED (details redacted); nothing was changed."]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      input.signal?.removeEventListener("abort", onAbort);
    }
    if (answer instanceof CatalogInspectionTimeout) return refuse("timeout", [`The catalog read exceeded ${timeoutMs} ms.`]);
    if (answer instanceof CatalogInspectionCancelled) return refuse("cancelled", ["The catalog read was cancelled."]);
    if (answer.state === "failed") return refuse("implementation_failed", [`CATALOG_READ_FAILED:${SAFE_CODE.test(answer.code) ? answer.code : "UNKNOWN"}`]);
    const output = { result: answer.state === "found" ? projectCatalogPartInspection(partId, answer.detail, answer.revisionStatus) : projectCatalogPartMiss(partId) };
    const outputErrors = [...assertSafeJsonValue(output, DEFAULT_OUTPUT_LIMITS, "output"), ...validateAgainstSchema(output, descriptor.outputSchema, "output")];
    if (outputErrors.length > 0) return refuse("invalid_output", outputErrors.slice(0, 5));
    return { kind: "read", ok: true, toolId: descriptor.toolId, version: descriptor.version, output, sourceRevisionDigest: context.canonicalRevisionDigest ?? context.schematicDigest ?? context.discovery.currentRevisionDigest, verification: CATALOG_INSPECTION_VERIFICATION };
  }
}
