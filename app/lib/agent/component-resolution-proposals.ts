/**
 * [PR-M, 2026-10-17] The agent's UNRESOLVED-COMPONENT RESOLUTION proposal, `sirkit.schematic.propose-component-resolution` (sections
 * M.0 last paragraph, M.2.4): a Tier 2 sealed BATCH over stable instance ids - one item per instance, each naming the candidate
 * catalog part and the exact revision the candidate search reported for it (an ASSERTION the server must reproduce, never a
 * choice) - assembled on the server by app/lib/component-resolution/resolution-assembler.ts over facts read through the chat
 * route's injected ports only: the catalog parts of the whole sheet and of the candidates (the catalog inspection port), the
 * published revision evidence and its catalog status (the revision evidence port). It is separate from the narrower B14 exact
 * replacement (`sirkit.schematic.propose-component-replacement`, unchanged), which keeps serving already-qualified parts.
 *
 * It never applies anything: the sealed batch rides its own event (`component_resolution_ready`) to the page, where a human
 * reviews the identities, the proved mapping and the material warnings and applies it through the reviewed canonical command
 * (`schematic.resolve-components`, app/lib/component-resolution/approved-resolution-mutations.ts). When an instance's connected-pin
 * facts cannot be established from trusted evidence, the batch is `proposal-blocked` with the exact missing evidence and the
 * existing work items (the missing-facts read, the unverified draft request) - never a guessed mapping. Advertised only with a
 * verified schematic, its canonical head mark, and the server's catalog and revision evidence facts; no board is needed.
 */
import { discoverTools } from "../engineering/tool-discovery";
import { assertSafeJsonValue, DEFAULT_INPUT_LIMITS } from "../engineering/tool-io-validation";
import type { ToolDescriptor, ToolRegistry } from "../engineering/tool-registry";
import { buildAuthorizationBinding } from "../engineering/proposal-authorization";
import { schematicStateDigest } from "../engineering/schematic-model";
import { assembleResolutionProposal, resolutionPartIdsFor, type ResolutionRequestItem } from "../component-resolution/resolution-assembler";
import { candidateLinkFor } from "../component-resolution/candidate-search";
import type { RevisionEvidencePort } from "../component-resolution/evidence";
import { loadCatalogParts, loadRevisionEvidence } from "../component-resolution/facts-loader";
import { MAX_RESOLUTION_ITEMS } from "../component-resolution/resolution-proposal";
import type { CatalogPartInspectionPort } from "./catalog-inspection-reads";
import { parseResolutionRequirement } from "./candidate-search-reads";
import type { AgentRunContext, GatewayInvocationOutcome } from "./contracts";
import { sanitizeTraceText } from "./redaction";

export const COMPONENT_RESOLUTION_TOOL_ID = "sirkit.schematic.propose-component-resolution" as const;
export const COMPONENT_RESOLUTION_BINDING = Object.freeze({ module: "app/lib/component-resolution/resolution-assembler.ts", symbol: "assembleResolutionProposal" });
export const COMPONENT_RESOLUTION_INPUT_EXAMPLE = Object.freeze({
  items: [
    { componentId: "kc-3a9f01", candidatePartId: "3f2a9c1e-0b7d-4e5a-9c21-7d8e6f5a4b3c", atomicPartRevisionId: "rev_1n4148w_sod123_1" },
    { componentId: "kc-3a9f02", candidatePartId: "3f2a9c1e-0b7d-4e5a-9c21-7d8e6f5a4b3c", atomicPartRevisionId: "rev_1n4148w_sod123_1" },
  ],
  functionalClass: "diode",
});

const AUTHORITY_KEYS = new Set(["actor", "actorId", "role", "capability", "capabilities", "authority", "approval", "approvals", "apply", "commit", "bind", "publish", "scope", "headMark", "revision", "expectedRevision", "lineageId", "schematic", "board", "pins", "currentPins", "targetPins", "mapping", "pinMapping", "explicitPinMapping", "acknowledgeDroppedPins", "symbolAssetVersionId", "footprintAssetVersionId", "mappingCertificateId", "grant", "grantId", "operations"]);
const ALLOWED_KEYS = new Set(["items", "functionalClass", "mounting", "packageCode", "ratings"]);
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/+\-]{0,199}$/;
const REVISION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/+\-]{0,511}$/;
export const COMPONENT_RESOLUTION_FACTS_MARGIN_MS = 500;

export type ComponentResolutionBindingResolution = { state: "resolved" } | { state: "not_callable"; reason: string };

export function resolveComponentResolutionBinding(descriptor: ToolDescriptor): ComponentResolutionBindingResolution {
  if (descriptor.toolId !== COMPONENT_RESOLUTION_TOOL_ID) return { state: "not_callable", reason: "Only the component resolution proposal is invocable here." };
  if (descriptor.operationClass !== "propose" || descriptor.sideEffects !== "proposal-artifact" || descriptor.approvalTier !== "none") return { state: "not_callable", reason: "The component resolution is a sealed proposal (Tier 2 by derivation) with proposal-artifact side effects only." };
  if (descriptor.binding.status !== "bound-proposal" || descriptor.binding.module !== COMPONENT_RESOLUTION_BINDING.module || descriptor.binding.symbol !== COMPONENT_RESOLUTION_BINDING.symbol) return { state: "not_callable", reason: "The descriptor does not bind the one resolution assembler." };
  return { state: "resolved" };
}

/** The loop's per-run rule (beside the B09.1 head-mark gate every schematic proposal passes): the catalog and evidence facts. */
export function componentResolutionProposalAvailable(descriptor: ToolDescriptor, context: AgentRunContext, warn: (message: string) => void): boolean {
  if (resolveComponentResolutionBinding(descriptor).state !== "resolved") { warn(`Tool ${descriptor.toolId} unavailable: no resolved component resolution binding.`); return false; }
  if (!context.schematic || !context.schematicDigest || !context.schematicHeadMark) { warn(`Tool ${descriptor.toolId} unavailable: no verified schematic and canonical head mark for this run.`); return false; }
  if (context.catalogInspectionAvailable !== true || context.componentResolutionAvailable !== true) { warn(`Tool ${descriptor.toolId} unavailable: no catalog and published revision evidence are bound to this run.`); return false; }
  return true;
}

export interface ComponentResolutionProposalServiceOptions {
  catalog?: CatalogPartInspectionPort;
  evidence?: RevisionEvidencePort;
  integrity: (context: AgentRunContext) => readonly string[];
  now?: () => number;
}
export interface ComponentResolutionProposalInput { toolId: string; version: string; args: Record<string, unknown>; context: AgentRunContext; runId: string; provider: string; timeoutMs: number; signal?: AbortSignal }

export class ComponentResolutionProposalService {
  constructor(private readonly registry: ToolRegistry, private readonly options: ComponentResolutionProposalServiceOptions) {}

  async invoke(input: ComponentResolutionProposalInput): Promise<GatewayInvocationOutcome> {
    const refuse = (status: string, diagnostics: string[]): GatewayInvocationOutcome => ({ kind: "refused", ok: false, toolId: input.toolId, version: input.version, status, diagnostics });
    const descriptor = this.registry.get(input.toolId, input.version);
    if (!descriptor) return refuse("not_registered", ["Unknown tool."]);
    const resolution = resolveComponentResolutionBinding(descriptor);
    if (resolution.state !== "resolved") return refuse("not_callable", [resolution.reason]);
    const integrity = this.options.integrity(input.context);
    if (integrity.length > 0) return refuse("context_integrity", integrity.slice(0, 5));
    const context = input.context;
    if (!context.schematic || !context.schematicDigest) return refuse("authority_unavailable", ["No verified schematic snapshot is available for this run; the resolution proposal is unavailable."]);
    if (!context.schematicHeadMark) return refuse("authority_unavailable", ["No canonical schematic head mark is available for this run; the resolution proposal is unavailable until the editor session is ready."]);
    const { catalog, evidence } = this.options;
    if (!catalog || !evidence || context.catalogInspectionAvailable !== true || context.componentResolutionAvailable !== true) return refuse("authority_unavailable", ["No catalog and published revision evidence are bound to this run; the resolution proposal is unavailable."]);
    const discovery = discoverTools(this.registry, context.discovery);
    if (!discovery.included.some((item) => item.toolId === descriptor.toolId && item.version === descriptor.version)) {
      const reason = discovery.excluded.find((entry) => entry.toolId === descriptor.toolId)?.reason ?? "not discoverable";
      return refuse("not_discoverable", [`Tool is not discoverable in the current context (${reason}).`]);
    }
    if (!descriptor.requiredRoles.includes(context.actor.actorRole) || !context.actor.grantedCapabilities.includes(descriptor.requiredCapability)) {
      return refuse("unauthorized", [`Role ${context.actor.actorRole} / capability ${descriptor.requiredCapability} is not permitted for this tool.`]);
    }
    const safety = assertSafeJsonValue(input.args, DEFAULT_INPUT_LIMITS, "args");
    if (safety.length > 0) return refuse("invalid_input", safety.slice(0, 5));
    for (const key of Object.keys(input.args)) {
      if (ALLOWED_KEYS.has(key)) continue;
      return refuse("invalid_input", [AUTHORITY_KEYS.has(key) ? `Argument "${key.slice(0, 40)}" is an authority-shaped claim - pins, mappings, assets and grants are derived on the server; the proposal names instances and candidates only.` : `Unexpected argument "${key.slice(0, 40)}" - the resolution proposal accepts ${[...ALLOWED_KEYS].join(", ")}.`]);
    }
    const rawItems = input.args.items;
    if (!Array.isArray(rawItems) || rawItems.length === 0 || rawItems.length > MAX_RESOLUTION_ITEMS) return refuse("invalid_input", [`items is 1-${MAX_RESOLUTION_ITEMS} {componentId, candidatePartId, atomicPartRevisionId} entries (one coherent batch).`]);
    const kicad = context.schematic.kicadComponents ?? [];
    const items: ResolutionRequestItem[] = [];
    for (const raw of rawItems as unknown[]) {
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return refuse("invalid_input", ["each item is an object {componentId, candidatePartId, atomicPartRevisionId}."]);
      const record = raw as Record<string, unknown>;
      for (const key of Object.keys(record)) {
        if (key === "componentId" || key === "candidatePartId" || key === "atomicPartRevisionId") continue;
        return refuse("invalid_input", [AUTHORITY_KEYS.has(key) ? `Item argument "${key.slice(0, 40)}" is an authority-shaped claim - it is derived on the server.` : `Unexpected item argument "${key.slice(0, 40)}" - an item names componentId, candidatePartId and atomicPartRevisionId.`]);
      }
      const { componentId, candidatePartId, atomicPartRevisionId } = record;
      if (typeof componentId !== "string" || !ID_PATTERN.test(componentId)) return refuse("invalid_input", ["componentId is the stable instance id (not the reference designator)."]);
      if (!kicad.some((instance) => instance.id === componentId) && !context.schematic.components.some((component) => component.id === componentId)) {
        const byRef = kicad.find((instance) => instance.refDes === componentId);
        return refuse("invalid_input", [byRef ? `"${componentId.slice(0, 32)}" is a reference designator, not a durable target; use its stable componentId ${byRef.id.slice(0, 64)} (the instance inspection lists it).` : `No instance with the stable id ${componentId.slice(0, 64)} exists in the current schematic.`]);
      }
      if (typeof candidatePartId !== "string" || !ID_PATTERN.test(candidatePartId)) return refuse("invalid_input", ["candidatePartId is the catalog part id of the candidate the candidate search reported."]);
      if (typeof atomicPartRevisionId !== "string" || !REVISION_PATTERN.test(atomicPartRevisionId)) return refuse("invalid_input", ["atomicPartRevisionId is the exact revision the candidate search reported (an assertion the server reproduces, never a choice)."]);
      items.push({ componentId, candidatePartId, atomicPartRevisionId });
    }
    const parsed = parseResolutionRequirement(input.args);
    if (!parsed.ok) return refuse("invalid_input", [parsed.detail]);
    if (input.signal?.aborted) return refuse("cancelled", ["The invocation was cancelled before it ran."]);

    const timeoutMs = Math.max(1, Math.min(Math.floor(input.timeoutMs), descriptor.timeoutMs));
    const now = this.options.now ?? (() => Date.now());
    const started = now();
    const scope = { tenantId: context.tenantId, projectId: context.projectId, branchId: context.branchId };
    const state = context.schematic;
    let outcome: ReturnType<typeof assembleResolutionProposal>;
    try {
      const partIds = resolutionPartIdsFor(state, items);
      const loaded = await loadCatalogParts(catalog, partIds, { scope, runId: input.runId, budgetMs: Math.floor((timeoutMs - COMPONENT_RESOLUTION_FACTS_MARGIN_MS) * 0.6), ...(input.signal ? { signal: input.signal } : {}), now });
      const revisionIds: string[] = [];
      for (const item of items) {
        const load = loaded.parts.get(item.candidatePartId);
        const instance = kicad.find((candidate) => candidate.id === item.componentId);
        if (load?.state === "found" && instance) {
          const link = candidateLinkFor(load.detail, instance.value);
          if (link.kind === "link") revisionIds.push(link.link.revisionId);
        }
      }
      const facts = await loadRevisionEvidence(evidence, revisionIds, { scope, runId: input.runId, budgetMs: timeoutMs - COMPONENT_RESOLUTION_FACTS_MARGIN_MS - (now() - started), ...(input.signal ? { signal: input.signal } : {}), now });
      if (!facts) return refuse("implementation_failed", ["The published revision evidence could not be read within the call's deadline; nothing was proposed (a candidate is never eligible without its evidence)."]);
      outcome = assembleResolutionProposal({
        state,
        scope: { ...scope, headMark: context.schematicHeadMark },
        authorization: buildAuthorizationBinding({ principalId: context.actor.actorId, ...(context.actor.membershipRevision ? { membershipRevision: context.actor.membershipRevision } : {}), scope }),
        items,
        requirement: parsed.requirement,
        facts: { parts: loaded.parts, evidence: facts.evidence, status: facts.status },
        provenance: { provider: input.provider, note: "Proposed by the Sirkit agent tool loop: an unresolved-component resolution assembled from server catalog and published revision evidence; nothing applied.", instruction: sanitizeTraceText(`resolve ${items.length} instance(s)`, 120) },
        now: now(),
      });
    } catch (error) {
      return refuse("implementation_failed", [`The resolution proposal failed internally: ${sanitizeTraceText(error instanceof Error ? error.message : String(error), 200) || "unknown error"}. Nothing was changed.`]);
    }
    if (outcome.kind === "blocked") {
      return { kind: "proposal-blocked", ok: false, toolId: input.toolId, version: input.version, blockers: outcome.blockers.map((blocker) => ({ code: blocker.code, detail: [blocker.detail, ...(blocker.missingEvidence ? [`Missing evidence: ${blocker.missingEvidence.join("; ")}.`] : []), ...(blocker.workItems ? [`Next: ${blocker.workItems.join("; ")}.`] : [])].join(" ") })) };
    }
    if (outcome.proposal.baseSchematicDigest !== schematicStateDigest(state) || outcome.proposal.baseSchematicDigest !== context.schematicDigest) return refuse("stale_revision", ["Sealed base digest does not match the verified run snapshot; proposal discarded."]);
    return { kind: "resolution-proposal", ok: true, toolId: descriptor.toolId, version: descriptor.version, proposal: outcome.proposal };
  }
}
