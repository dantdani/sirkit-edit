/**
 * [PR-F fB] The agent's MISSING-FACTS read, `sirkit.parts.missing-facts`: for every instance the Schematic → PCB run cannot carry
 * to the board, the SAME missing-facts checklist the editor's missing-parts list renders (section F.4-F.5 of the owner's
 * assignment; CONTINUATION C.6: report the missing facts precisely, never report the circuit complete). ONE derivation:
 * `deriveMissingFacts` (app/lib/parts/missing-facts.ts, the UI's module) over the editor's own refusal list
 * (`listUnresolvedInstances`, app/lib/pcb-sync/unresolved-instances.ts) and the run's VERIFIED schematic snapshot - the resource the
 * gateway's integrity check digest-pins before every call. No board is needed (the editor's own Prepare PCB is board-less), so the
 * read travels its own Tier 0 service, modelled on the preflight read (pcb-sync-preflight-reads.ts).
 *
 * The catalog facts (identity: manufacturer, exact MPN, package; evidence: the published exact revision linked for the value) come
 * ONLY from the catalog port the chat route injects for `sirkit.parts.catalog-inspect` (app/api/chat/catalog-inspection-runtime.ts:
 * the SAME `loadCatalogPartDetail` the parts route answers the browser's part cache with), and only when the server's catalog fact
 * is present. Without the port every catalog fact is `unknown` with the source "catalog unavailable" - never a guess, never a
 * footprint hint promoted to a package, never a vendor text promoted to identity (ENGINEERING_FACTS_NEVER_PROVEN_BY_SOURCING is
 * the shared module's rule). A part the catalog does not hold, a failed or late catalog read, are DATA per instance, never a
 * refusal of the whole read. Bounded: at most MAX_MISSING_FACTS_INSTANCES instances listed, the rest counted; the catalog is asked
 * once per distinct part id, under the call's deadline. Nothing is placed, bound, published, searched at a distributor or bought.
 */
import type { SchematicState } from "@/lib/schematic-types";
import { normalizeRefDes, schDisplayRef } from "@/lib/schematic-types";
import { discoverTools } from "../engineering/tool-discovery";
import { assertSafeJsonValue, DEFAULT_INPUT_LIMITS, DEFAULT_OUTPUT_LIMITS, validateAgainstSchema } from "../engineering/tool-io-validation";
import type { ToolDescriptor, ToolRegistry } from "../engineering/tool-registry";
import type { CatalogPartDetail } from "../atomic/catalog-part-detail";
import type { AtomicRevisionStatus } from "../atomic/revision-status";
import { deriveMissingFacts, publishedAssignmentFor, SOURCING_NEVER_PROVES, type CatalogPartFacts, type CatalogPartLoad, type MissingFactsChecklist, type SchematicInstanceFacts } from "../parts/missing-facts";
import { listUnresolvedInstances, unresolvedInstancesRefusal, type UnresolvedInstance } from "../pcb-sync/unresolved-instances";
import type { CatalogPartInspectionPort, CatalogPartInspectionPortAnswer } from "./catalog-inspection-reads";
import type { AgentRunContext, GatewayInvocationOutcome } from "./contracts";
import { sanitizeTraceText } from "./redaction";

export const MISSING_FACTS_TOOL_ID = "sirkit.parts.missing-facts" as const;
/** The ONE derivation the descriptor binds - the UI's module (`resolveMissingFactsBinding` matches it exactly). */
export const MISSING_FACTS_BINDING = Object.freeze({ module: "app/lib/parts/missing-facts.ts", symbol: "deriveMissingFacts" });
/** The read's verification state: pure over the run's verified schematic snapshot (its digest is the result's source revision);
 *  `+catalog-read` when the catalog facts were read through the bound port at the time of the call. */
export const MISSING_FACTS_VERIFICATION = "schematic-snapshot-verified" as const;
export const MISSING_FACTS_VERIFICATION_WITH_CATALOG = "schematic-snapshot-verified+catalog-read" as const;
export const MISSING_FACTS_REPORT_SCHEMA = "sirkit.parts-missing-facts-report.v1" as const;
/** The initial Astra scope (at most 50 physical component instances): the checklists listed in full; the rest are counted. */
export const MAX_MISSING_FACTS_INSTANCES = 50;
/** The catalog reads end this much before the call's own timer, so a late catalog answers "catalog unavailable" per instance. */
export const MISSING_FACTS_CATALOG_MARGIN_MS = 500;
/** The source every catalog fact carries when no catalog port is bound to the run (the shared module prefixes it). */
export const CATALOG_UNAVAILABLE = "catalog unavailable" as const;
/** The descriptor's valid input example (the manual's example): the read takes no arguments. */
export const MISSING_FACTS_INPUT_EXAMPLE = Object.freeze({});

const AUTHORITY_KEYS = new Set(["actor", "actorId", "role", "capability", "capabilities", "authority", "approval", "approvals", "apply", "commit", "bind", "publish", "place", "scope", "headMark", "revision", "expectedRevision", "revisionId", "lineageId", "schematic", "board", "boardId", "partId", "mpn", "live", "distributor", "source", "refDes"]);
const SAFE_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;

export type MissingFactsBindingResolution = { state: "resolved" } | { state: "not_callable"; reason: string };

/** Allowlist-only: the descriptor is callable here only as the one missing-facts read over the UI's one derivation. */
export function resolveMissingFactsBinding(descriptor: ToolDescriptor): MissingFactsBindingResolution {
  if (descriptor.toolId !== MISSING_FACTS_TOOL_ID) return { state: "not_callable", reason: "Only the missing-facts read is invocable here." };
  if (descriptor.operationClass !== "read" || descriptor.approvalTier !== "none" || descriptor.sideEffects !== "none") return { state: "not_callable", reason: "The missing-facts read is a Tier 0 read with no side effects." };
  if (descriptor.binding.status !== "bound-read" || descriptor.binding.module !== MISSING_FACTS_BINDING.module || descriptor.binding.symbol !== MISSING_FACTS_BINDING.symbol) return { state: "not_callable", reason: "The descriptor does not bind the one shared missing-facts derivation." };
  return { state: "resolved" };
}

/** The loop's per-run advertisement rule: the binding resolves and the run holds a verified schematic snapshot (no board, no catalog needed). */
export function missingFactsReadAvailable(descriptor: ToolDescriptor, context: AgentRunContext, warn: (message: string) => void): boolean {
  if (resolveMissingFactsBinding(descriptor).state !== "resolved") {
    warn(`Tool ${descriptor.toolId} unavailable: no resolved missing-facts read binding.`);
    return false;
  }
  if (!context.schematic || !context.schematicDigest) {
    warn(`Tool ${descriptor.toolId} unavailable: no verified schematic snapshot for this run.`);
    return false;
  }
  return true;
}

// ─── The report ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface MissingFactsRevisionStatusView { revisionId: string; state: AtomicRevisionStatus["state"] | "unknown"; selectable: boolean | null; pinnable: boolean | null; successorRevisionId: string | null }

export interface MissingFactsReportItem {
  /** The UI's checklist, byte for byte what `deriveMissingFacts` answers the editor's list for the same instance and catalog facts. */
  checklist: MissingFactsChecklist;
  /** Where the catalog facts came from: the bound port (`loaded`), nothing (`unavailable`, with the reason), or none for a Theory symbol. */
  catalog: { state: CatalogPartLoad["state"]; reason: string | null; partId: string | null };
  /** The catalog status of the published revision the instance's value selects (data from the port; null when none or not read). */
  revisionStatus: MissingFactsRevisionStatusView | null;
}

export interface MissingFactsReport {
  schema: typeof MISSING_FACTS_REPORT_SCHEMA;
  /** The ONE derivation: the UI's module and symbol. */
  derivation: string;
  status: "missing_facts" | "all_resolved";
  /** The editor's refusal sentence for these instances (null when nothing is unresolved). */
  refusal: string | null;
  unresolved: { count: number; listed: number; truncated: number };
  catalog: { state: "bound" | "unavailable"; reason: string; partsAsked: number; partsFailed: number };
  items: MissingFactsReportItem[];
  sourcingRule: typeof SOURCING_NEVER_PROVES;
  note: string;
}

/** The port's detail, projected to the facts the shared derivation reads (the browser's part cache holds the same record). */
export function catalogPartFactsOf(detail: CatalogPartDetail): CatalogPartFacts {
  const assignments = Object.fromEntries(Object.entries(detail.atomicAssignments ?? {}).map(([key, assignment]) => [key, { revisionId: assignment.revisionId, symbolVersionId: assignment.symbolVersionId, footprintVersionId: assignment.footprintVersionId, mappingCertificateId: assignment.mappingCertificateId, footprintFullName: assignment.footprintFullName }]));
  return {
    id: detail.id,
    name: detail.name,
    mpn: detail.mpn ?? null,
    manufacturer: detail.manufacturer ?? null,
    libraryName: detail.libraryName,
    footprintHint: detail.footprintHint ?? null,
    packageNormalized: detail.packageNormalized ?? null,
    pinCount: Array.isArray(detail.pins) ? detail.pins.length : 0,
    hasSymbol: typeof detail.symbolRaw === "string" && detail.symbolRaw.length > 0,
    atomicAssignments: assignments,
    withdrawnValueKeys: [...(detail.withdrawnValueKeys ?? [])],
  };
}

/** What the schematic instance itself says, as the shared derivation reads it (the editor reads the same fields from its state). */
export function schematicInstanceFactsOf(state: SchematicState, instance: UnresolvedInstance): SchematicInstanceFacts {
  if (instance.family === "kicad") {
    const placed = (state.kicadComponents ?? []).find((component) => component.refDes === instance.refDes);
    return { value: placed?.value ?? null, partId: placed?.partId ?? null, atomicPartRevisionId: placed?.atomicPartRevisionId ?? null, symbolAssetVersionId: placed?.symbolAssetVersionId ?? null, theoryType: null };
  }
  const component = state.components.find((candidate) => normalizeRefDes(schDisplayRef(candidate)) === instance.refDes);
  return { value: component?.value ? component.value : null, partId: null, atomicPartRevisionId: null, symbolAssetVersionId: null, theoryType: component?.type ?? null };
}

/** The catalog load for one part from the port's answer: a miss, a failure and a late answer are data, never a guess. */
export function catalogLoadOf(answer: CatalogPartInspectionPortAnswer | "timeout" | "throw"): { load: CatalogPartLoad; status: Readonly<Record<string, AtomicRevisionStatus>> } {
  if (answer === "timeout") return { load: { state: "unavailable", reason: `${CATALOG_UNAVAILABLE}: the catalog read exceeded the call's deadline` }, status: {} };
  if (answer === "throw") return { load: { state: "unavailable", reason: `${CATALOG_UNAVAILABLE}: CATALOG_READ_FAILED (details redacted)` }, status: {} };
  if (answer.state === "failed") return { load: { state: "unavailable", reason: `${CATALOG_UNAVAILABLE}: CATALOG_READ_FAILED:${SAFE_CODE.test(answer.code) ? answer.code : "UNKNOWN"}` }, status: {} };
  if (answer.state === "not_found") return { load: { state: "unavailable", reason: "no catalog part has the placed part id (nothing else was looked up: no distributor is called)" }, status: {} };
  return { load: { state: "loaded", part: catalogPartFactsOf(answer.detail) }, status: answer.revisionStatus };
}

/** The port-less load every KiCad instance gets when no catalog is bound to the run. */
export const NO_CATALOG_LOAD: CatalogPartLoad = Object.freeze({ state: "unavailable", reason: `${CATALOG_UNAVAILABLE}: no catalog port is bound to this run` });

// ─── The service ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface MissingFactsReadServiceOptions {
  /** The catalog port the chat route injects for the catalog inspection (the SAME port); absent: every catalog fact is unknown, "catalog unavailable". */
  port?: CatalogPartInspectionPort;
  /** The gateway's context integrity check (injected so this module never imports the gateway). */
  integrity: (context: AgentRunContext) => readonly string[];
}
export interface MissingFactsReadInput { toolId: string; version: string; args: Record<string, unknown>; context: AgentRunContext; runId: string; timeoutMs: number; signal?: AbortSignal }

class CatalogTimeout { readonly kind = "timeout"; }

export class MissingFactsReadService {
  constructor(private readonly registry: ToolRegistry, private readonly options: MissingFactsReadServiceOptions) {}

  async invoke(input: MissingFactsReadInput): Promise<GatewayInvocationOutcome> {
    const refuse = (status: string, diagnostics: string[]): GatewayInvocationOutcome => ({ kind: "refused", ok: false, toolId: input.toolId, version: input.version, status, diagnostics });
    const descriptor = this.registry.get(input.toolId, input.version);
    if (!descriptor) return refuse("not_registered", ["Unknown tool."]);
    const resolution = resolveMissingFactsBinding(descriptor);
    if (resolution.state !== "resolved") return refuse("not_callable", [resolution.reason]);
    const integrity = this.options.integrity(input.context);
    if (integrity.length > 0) return refuse("context_integrity", integrity.slice(0, 5));
    const context = input.context;
    // The subject: the run's verified schematic snapshot (digest-pinned by the integrity check above); a board is not needed.
    if (!context.schematic || !context.schematicDigest) return refuse("authority_unavailable", ["No verified schematic snapshot is available for this run; the missing-facts read is unavailable."]);
    const discovery = discoverTools(this.registry, context.discovery);
    if (!discovery.included.some((item) => item.toolId === descriptor.toolId && item.version === descriptor.version)) {
      const reason = discovery.excluded.find((entry) => entry.toolId === descriptor.toolId)?.reason ?? "not discoverable";
      return refuse("not_discoverable", [`Tool is not discoverable in the current context (${reason}).`]);
    }
    if (!descriptor.requiredRoles.includes(context.actor.actorRole) || !context.actor.grantedCapabilities.includes(descriptor.requiredCapability)) {
      return refuse("unauthorized", [`Role ${context.actor.actorRole} / capability ${descriptor.requiredCapability} is not permitted for this tool.`]);
    }
    // The closed argument surface: no arguments; authority-shaped keys are refused by name.
    const safety = assertSafeJsonValue(input.args, DEFAULT_INPUT_LIMITS, "args");
    if (safety.length > 0) return refuse("invalid_input", safety.slice(0, 5));
    for (const key of Object.keys(input.args)) {
      return refuse("invalid_input", [AUTHORITY_KEYS.has(key) ? `Argument "${key.slice(0, 40)}" is an authority-shaped claim - the missing-facts read takes no arguments; it reads the run's verified schematic.` : `Unexpected argument "${key.slice(0, 40)}" - the missing-facts read takes no arguments.`]);
    }
    if (input.signal?.aborted) return refuse("cancelled", ["The invocation was cancelled before it ran."]);
    // The catalog: the SAME injected port as the catalog inspection, only with the server's fact; otherwise every catalog fact is unknown.
    const port = this.options.port;
    const catalogBound = port !== undefined && context.catalogInspectionAvailable === true;
    const timeoutMs = Math.max(1, Math.min(Math.floor(input.timeoutMs), descriptor.timeoutMs));
    const startedAt = Date.now();
    const remaining = (): number => timeoutMs - MISSING_FACTS_CATALOG_MARGIN_MS - (Date.now() - startedAt);
    const loads = new Map<string, { load: CatalogPartLoad; status: Readonly<Record<string, AtomicRevisionStatus>> }>();
    let partsFailed = 0;
    let partsAsked = 0;
    const loadPart = async (partId: string): Promise<{ load: CatalogPartLoad; status: Readonly<Record<string, AtomicRevisionStatus>> }> => {
      const known = loads.get(partId);
      if (known) return known;
      let outcome: { load: CatalogPartLoad; status: Readonly<Record<string, AtomicRevisionStatus>> };
      if (!catalogBound) outcome = { load: NO_CATALOG_LOAD, status: {} };
      else {
        partsAsked += 1;
        const budget = remaining();
        if (budget <= 0 || input.signal?.aborted) outcome = catalogLoadOf("timeout");
        else {
          const controller = new AbortController();
          const onAbort = (): void => controller.abort();
          input.signal?.addEventListener("abort", onAbort, { once: true });
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            const work = Promise.resolve().then(() => port.inspect({ partId, scope: { tenantId: context.tenantId, projectId: context.projectId, branchId: context.branchId }, runId: input.runId, deadlineMs: budget, signal: controller.signal }));
            work.catch(() => undefined); // a late rejection after the deadline is never unhandled
            const answer = await Promise.race<CatalogPartInspectionPortAnswer | CatalogTimeout>([work, new Promise<CatalogTimeout>((resolve) => { timer = setTimeout(() => { resolve(new CatalogTimeout()); controller.abort(); }, budget); })]);
            outcome = answer instanceof CatalogTimeout ? catalogLoadOf("timeout") : catalogLoadOf(answer);
          } catch {
            outcome = catalogLoadOf("throw"); // a port failure: a closed sentence, never its message
          } finally {
            if (timer !== undefined) clearTimeout(timer);
            input.signal?.removeEventListener("abort", onAbort);
          }
        }
        if (outcome.load.state === "unavailable") partsFailed += 1;
      }
      loads.set(partId, outcome);
      return outcome;
    };
    let output: Record<string, unknown>;
    try {
      const state = context.schematic;
      const unresolved = listUnresolvedInstances(state);
      const listed = unresolved.slice(0, MAX_MISSING_FACTS_INSTANCES);
      const items: MissingFactsReportItem[] = [];
      for (const instance of listed) {
        const schematic = schematicInstanceFactsOf(state, instance);
        const partId = schematic.partId;
        let catalog: CatalogPartLoad = { state: "none" };
        let revisionStatus: MissingFactsRevisionStatusView | null = null;
        if (instance.family === "kicad") {
          if (partId === null) catalog = { state: "unavailable", reason: "the placed instance names no catalog part id" };
          else {
            const loaded = await loadPart(partId);
            catalog = loaded.load;
            if (loaded.load.state === "loaded") {
              const selected = publishedAssignmentFor(loaded.load.part, schematic.value);
              if (selected && "assignment" in selected) {
                const status = Object.hasOwn(loaded.status, selected.assignment.revisionId) ? loaded.status[selected.assignment.revisionId] : undefined;
                revisionStatus = status
                  ? { revisionId: selected.assignment.revisionId, state: status.state, selectable: status.selectable, pinnable: status.pinnable, successorRevisionId: status.successorRevisionId ?? null }
                  : { revisionId: selected.assignment.revisionId, state: "unknown", selectable: null, pinnable: null, successorRevisionId: null };
              }
            }
          }
        }
        // THE derivation: the editor's missing-parts list calls exactly this, over the same instance row and the same catalog record.
        const checklist = deriveMissingFacts({ instance, schematic, catalog, projectOpen: true });
        items.push({ checklist, catalog: { state: catalog.state, reason: catalog.state === "unavailable" ? catalog.reason : null, partId }, revisionStatus });
      }
      const report: MissingFactsReport = {
        schema: MISSING_FACTS_REPORT_SCHEMA,
        derivation: `${MISSING_FACTS_BINDING.module}#${MISSING_FACTS_BINDING.symbol}`,
        status: unresolved.length > 0 ? "missing_facts" : "all_resolved",
        refusal: unresolved.length > 0 ? unresolvedInstancesRefusal(unresolved) : null,
        unresolved: { count: unresolved.length, listed: listed.length, truncated: Math.max(0, unresolved.length - listed.length) },
        catalog: {
          state: catalogBound ? "bound" : "unavailable",
          reason: catalogBound ? "the catalog port the chat route binds for the catalog inspection answered the placed part ids (identity and the published exact revision per value); a part it does not hold, or a failed read, is data per instance" : `${CATALOG_UNAVAILABLE}: no catalog port is bound to this run, so every identity and evidence fact is unknown (never guessed from a footprint hint, a pin count or a vendor text)`,
          partsAsked,
          partsFailed,
        },
        items,
        sourcingRule: SOURCING_NEVER_PROVES,
        note: unresolved.length > 0
          ? "Each checklist is the editor's own missing-parts row: identity (manufacturer, exact MPN, package), evidence (symbol, footprint, pin-to-pad mapping - known only from a published exact revision), and stock/pricing (sourcing observations, never proof). Nothing here is placed, bound, published, searched at a distributor or bought; the next actions name the existing human paths. A Theory symbol is not a physical part."
          : "Every physical instance carries a published exact revision and its installed symbol asset: no missing fact. Prepare PCB in the PCB editor runs the server stages this read does not.",
      };
      output = { report: report as unknown as Record<string, unknown> };
    } catch (error) {
      return refuse("implementation_failed", [`The missing-facts read failed internally: ${sanitizeTraceText(error instanceof Error ? error.message : String(error), 200) || "unknown error"}. Nothing was changed.`]);
    }
    const outputErrors = [...assertSafeJsonValue(output, DEFAULT_OUTPUT_LIMITS, "output"), ...validateAgainstSchema(output, descriptor.outputSchema, "output")];
    if (outputErrors.length > 0) return refuse("invalid_output", outputErrors.slice(0, 5));
    return { kind: "read", ok: true, toolId: descriptor.toolId, version: descriptor.version, output, sourceRevisionDigest: context.schematicDigest, verification: catalogBound ? MISSING_FACTS_VERIFICATION_WITH_CATALOG : MISSING_FACTS_VERIFICATION };
  }
}
