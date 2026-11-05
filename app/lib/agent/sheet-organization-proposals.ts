/**
 * [PR-J5, 2026-10-23] The agent's ORGANISE proposal, `sirkit.schematic.propose-sheet-organization` (runbook J.6 items 1, 4, 6, 8;
 * J.3 item 4; OD-259 item 4): a Tier 2 SEALED proposal over the run's verified schematic and its canonical head mark. The model names
 * groups of reference designators (and, optionally, names for the ports of unnamed crossing nets); the server resolves them, runs J4's
 * ONE organise planner (`planOrganizeIntoSheets`, app/lib/schematic/sheet-organization.ts) over the catalog pins read through the chat
 * route's injected catalog port, proves the organisation equivalent (the pin-to-net partition and every component identity unchanged)
 * and seals `sirkit.sheet-organization-proposal.v1` (app/lib/engineering/sheet-organization-proposal.ts). Parts the model leaves out
 * stay on the source sheet. The artifact rides its OWN event (`sheet_organization_ready`) to the page, where a human reviews the
 * sheets, members, interfaces and "check these" and applies it through the reviewed canonical command `schematic.move-to-sheet` as ONE
 * transaction (the page re-plans and refuses on a differing digest). Receiving it changes NOTHING; a refused plan is `proposal-blocked`
 * data with the planner's own sentence. Advertised only with a verified schematic, its head mark and the server's catalog fact
 * (the pins come from the catalog, never from the model); no board is needed. Root-only in 1.0.0: the source sheet is the overview.
 */
import { discoverTools } from "../engineering/tool-discovery";
import { assertSafeJsonValue, DEFAULT_INPUT_LIMITS } from "../engineering/tool-io-validation";
import type { ToolDescriptor, ToolRegistry } from "../engineering/tool-registry";
import { buildAuthorizationBinding } from "../engineering/proposal-authorization";
import { schematicStateDigest } from "../engineering/schematic-model";
import { compileSheetOrganizationProposal, sealSheetOrganizationProposal, SHEET_ORGANIZATION_LIMITS, SHEET_ORGANIZATION_TOOL_ID, type SheetOrganizationRequest } from "../engineering/sheet-organization-proposal";
import { loadCatalogParts } from "../component-resolution/facts-loader";
import type { OrganizePartSource } from "../schematic/sheet-organization";
import type { CatalogPartInspectionPort } from "./catalog-inspection-reads";
import type { AgentRunContext, GatewayInvocationOutcome } from "./contracts";
import { sanitizeTraceText } from "./redaction";

export { SHEET_ORGANIZATION_TOOL_ID };
export const SHEET_ORGANIZATION_BINDING = Object.freeze({ module: "app/lib/schematic/sheet-organization.ts", symbol: "planOrganizeIntoSheets" });
/** The descriptor's example (the manual validates it against the input schema): the fixture drone's four subsystems. */
export const SHEET_ORGANIZATION_INPUT_EXAMPLE = Object.freeze({
  groups: [
    { name: "Power", members: ["J1", "U1", "C1", "C2", "C3"] },
    { name: "Motor drivers", members: ["Q1", "Q2", "Q3", "Q4", "R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "D1", "D2", "D3", "D4", "J2", "J3", "J4", "J5"] },
    { name: "IMU", members: ["U3", "R11", "R12", "C9", "C10"] },
  ],
});
/** The catalog reads end this much before the call's own timer (a late catalog refuses the proposal: pins are never guessed). */
export const SHEET_ORGANIZATION_FACTS_MARGIN_MS = 500;

const AUTHORITY_KEYS = new Set(["actor", "actorId", "role", "capability", "capabilities", "authority", "approval", "approvals", "apply", "commit", "bind", "publish", "scope", "headMark", "revision", "expectedRevision", "expectedHeadMark", "lineageId", "schematic", "board", "sheets", "sheetId", "sourceSheetId", "ports", "pins", "nets", "operations", "operationsDigest", "partitionDigest", "grant", "grantId", "proposalId", "baseSchematicDigest"]);
const ALLOWED_KEYS = new Set(["groups", "interfaceNames"]);

export type SheetOrganizationBindingResolution = { state: "resolved" } | { state: "not_callable"; reason: string };

export function resolveSheetOrganizationBinding(descriptor: ToolDescriptor): SheetOrganizationBindingResolution {
  if (descriptor.toolId !== SHEET_ORGANIZATION_TOOL_ID) return { state: "not_callable", reason: "Only the sheet organisation proposal is invocable here." };
  if (descriptor.operationClass !== "propose" || descriptor.sideEffects !== "proposal-artifact" || descriptor.approvalTier !== "none") return { state: "not_callable", reason: "The sheet organisation is a sealed proposal (Tier 2 by derivation) with proposal-artifact side effects only." };
  if (descriptor.binding.status !== "bound-proposal" || descriptor.binding.module !== SHEET_ORGANIZATION_BINDING.module || descriptor.binding.symbol !== SHEET_ORGANIZATION_BINDING.symbol) return { state: "not_callable", reason: "The descriptor does not bind the one organise planner." };
  return { state: "resolved" };
}

/** The loop's per-run rule (beside the B09.1 head-mark gate every schematic proposal passes): the server's catalog fact (the pins). */
export function sheetOrganizationProposalAvailable(descriptor: ToolDescriptor, context: AgentRunContext, warn: (message: string) => void): boolean {
  if (resolveSheetOrganizationBinding(descriptor).state !== "resolved") { warn(`Tool ${descriptor.toolId} unavailable: no resolved sheet organisation binding.`); return false; }
  if (!context.schematic || !context.schematicDigest || !context.schematicHeadMark) { warn(`Tool ${descriptor.toolId} unavailable: no verified schematic and canonical head mark for this run.`); return false; }
  if (context.catalogInspectionAvailable !== true) { warn(`Tool ${descriptor.toolId} unavailable: no catalog is bound to this run (the organisation is proven over the catalog pins).`); return false; }
  return true;
}

export interface SheetOrganizationProposalServiceOptions {
  catalog?: CatalogPartInspectionPort;
  integrity: (context: AgentRunContext) => readonly string[];
  now?: () => number;
}
export interface SheetOrganizationProposalInput { toolId: string; version: string; args: Record<string, unknown>; context: AgentRunContext; runId: string; provider: string; timeoutMs: number; signal?: AbortSignal }

/** The closed request read from the model's arguments, or the refusal sentence. Exported for the harness's unit proofs. */
export function readSheetOrganizationRequest(args: Record<string, unknown>): { ok: true; request: SheetOrganizationRequest } | { ok: false; detail: string } {
  for (const key of Object.keys(args)) {
    if (ALLOWED_KEYS.has(key)) continue;
    return { ok: false, detail: AUTHORITY_KEYS.has(key) ? `Argument "${key.slice(0, 40)}" is an authority-shaped claim - the source sheet, the ports, the operations and the base are derived on the server; the proposal names groups of reference designators (and optional interface names) only.` : `Unexpected argument "${key.slice(0, 40)}" - the organisation proposal accepts ${[...ALLOWED_KEYS].join(", ")}.` };
  }
  const rawGroups = args.groups;
  if (!Array.isArray(rawGroups) || rawGroups.length === 0 || rawGroups.length > SHEET_ORGANIZATION_LIMITS.maxGroups) return { ok: false, detail: `groups is 1-${SHEET_ORGANIZATION_LIMITS.maxGroups} { name, members } entries (one sheet per group).` };
  const groups: Array<{ name: string; members: string[] }> = [];
  let total = 0;
  for (const raw of rawGroups as unknown[]) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, detail: "each group is an object { name, members }." };
    const record = raw as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (key === "name" || key === "members") continue;
      return { ok: false, detail: AUTHORITY_KEYS.has(key) ? `Group argument "${key.slice(0, 40)}" is an authority-shaped claim - it is derived on the server.` : `Unexpected group argument "${key.slice(0, 40)}" - a group names name and members.` };
    }
    if (typeof record.name !== "string" || record.name.trim().length === 0 || record.name.length > SHEET_ORGANIZATION_LIMITS.maxNameChars) return { ok: false, detail: `each group's name is 1-${SHEET_ORGANIZATION_LIMITS.maxNameChars} characters.` };
    if (!Array.isArray(record.members) || record.members.length === 0 || record.members.some((member) => typeof member !== "string" || member.length === 0 || member.length > SHEET_ORGANIZATION_LIMITS.maxMemberChars)) return { ok: false, detail: `each group's members is a non-empty list of reference designators (1-${SHEET_ORGANIZATION_LIMITS.maxMemberChars} characters each).` };
    total += record.members.length;
    if (total > SHEET_ORGANIZATION_LIMITS.maxMembers) return { ok: false, detail: `at most ${SHEET_ORGANIZATION_LIMITS.maxMembers} members are organised at once.` };
    groups.push({ name: record.name, members: record.members as string[] });
  }
  const request: SheetOrganizationRequest = { groups };
  if (args.interfaceNames !== undefined) {
    const raw = args.interfaceNames;
    if (!Array.isArray(raw) || raw.length > SHEET_ORGANIZATION_LIMITS.maxInterfaceNames) return { ok: false, detail: `interfaceNames is a list of at most ${SHEET_ORGANIZATION_LIMITS.maxInterfaceNames} { port, name } entries: the SIG<n> port of an unnamed crossing net (as a proposal reported it) and its new name.` };
    const names: Record<string, string> = {};
    for (const entry of raw as unknown[]) {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return { ok: false, detail: "each interfaceNames entry is an object { port, name }." };
      const record = entry as Record<string, unknown>;
      for (const key of Object.keys(record)) if (key !== "port" && key !== "name") return { ok: false, detail: `Unexpected interfaceNames argument "${key.slice(0, 40)}" - an entry names port and name.` };
      if (typeof record.port !== "string" || !/^SIG\d{1,4}$/.test(record.port)) return { ok: false, detail: `interfaceNames.port is the SIG<n> port name a proposal reported for an unnamed crossing net (got "${String(record.port).slice(0, 40)}").` };
      if (typeof record.name !== "string" || record.name.trim().length === 0 || record.name.length > 64) return { ok: false, detail: "interfaceNames.name is 1-64 characters." };
      if (record.port in names) return { ok: false, detail: `interfaceNames names ${record.port} twice.` };
      names[record.port] = record.name.trim();
    }
    request.interfaceNames = names;
  }
  return { ok: true, request };
}

export class SheetOrganizationProposalService {
  constructor(private readonly registry: ToolRegistry, private readonly options: SheetOrganizationProposalServiceOptions) {}

  async invoke(input: SheetOrganizationProposalInput): Promise<GatewayInvocationOutcome> {
    const refuse = (status: string, diagnostics: string[]): GatewayInvocationOutcome => ({ kind: "refused", ok: false, toolId: input.toolId, version: input.version, status, diagnostics });
    const descriptor = this.registry.get(input.toolId, input.version);
    if (!descriptor) return refuse("not_registered", ["Unknown tool."]);
    const resolution = resolveSheetOrganizationBinding(descriptor);
    if (resolution.state !== "resolved") return refuse("not_callable", [resolution.reason]);
    const integrity = this.options.integrity(input.context);
    if (integrity.length > 0) return refuse("context_integrity", integrity.slice(0, 5));
    const context = input.context;
    if (!context.schematic || !context.schematicDigest) return refuse("authority_unavailable", ["No verified schematic snapshot is available for this run; the organisation proposal is unavailable."]);
    if (!context.schematicHeadMark) return refuse("authority_unavailable", ["No canonical schematic head mark is available for this run; the organisation proposal is unavailable until the editor session is ready."]);
    const { catalog } = this.options;
    if (!catalog || context.catalogInspectionAvailable !== true) return refuse("authority_unavailable", ["No catalog is bound to this run; the organisation is proven over the catalog pins and is unavailable without them."]);
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
    const read = readSheetOrganizationRequest(input.args);
    if (!read.ok) return refuse("invalid_input", [read.detail]);
    if (input.signal?.aborted) return refuse("cancelled", ["The invocation was cancelled before it ran."]);

    const timeoutMs = Math.max(1, Math.min(Math.floor(input.timeoutMs), descriptor.timeoutMs));
    const now = this.options.now ?? (() => Date.now());
    const scope = { tenantId: context.tenantId, projectId: context.projectId, branchId: context.branchId };
    const state = context.schematic;
    let outcome: ReturnType<typeof sealSheetOrganizationProposal>;
    try {
      const partIds = [...new Set((state.kicadComponents ?? []).map((instance) => instance.partId))];
      const loaded = await loadCatalogParts(catalog, partIds, { scope, runId: input.runId, budgetMs: timeoutMs - SHEET_ORGANIZATION_FACTS_MARGIN_MS, ...(input.signal ? { signal: input.signal } : {}), now });
      if (loaded.failed > 0) return refuse("implementation_failed", [`The catalog pins of ${loaded.failed} part(s) could not be read within the call's deadline; nothing was proposed (an organisation is never proven without every pin).`]);
      const getPart: OrganizePartSource = (partId) => { const load = loaded.parts.get(partId); return load?.state === "found" ? { pins: load.detail.pins, mainCategory: load.detail.mainCategory } : null; };
      const compiled = compileSheetOrganizationProposal({ state, request: read.request, getPart });
      if (!compiled.ok) return { kind: "proposal-blocked", ok: false, toolId: input.toolId, version: input.version, blockers: compiled.blockers.map((blocker) => ({ code: blocker.code, detail: blocker.detail })) };
      outcome = sealSheetOrganizationProposal({
        state,
        compilation: compiled.compilation,
        scope: { ...scope, headMark: context.schematicHeadMark },
        authorization: buildAuthorizationBinding({ principalId: context.actor.actorId, ...(context.actor.membershipRevision ? { membershipRevision: context.actor.membershipRevision } : {}), scope }),
        version: descriptor.version,
        provenance: { provider: input.provider, runId: input.runId, note: "Proposed by the Sirkit agent tool loop: an organisation of the schematic into subsystem sheets, planned and proven equivalent by the organise planner over the catalog pins; nothing applied.", instruction: sanitizeTraceText(`organise ${read.request.groups.length} sheet(s): ${read.request.groups.map((group) => group.name).join(", ")}`, 160) },
        now: now(),
      });
    } catch (error) {
      return refuse("implementation_failed", [`The organisation proposal failed internally: ${sanitizeTraceText(error instanceof Error ? error.message : String(error), 200) || "unknown error"}. Nothing was changed.`]);
    }
    if (outcome.kind === "blocked") return { kind: "proposal-blocked", ok: false, toolId: input.toolId, version: input.version, blockers: outcome.blockers.map((blocker) => ({ code: blocker.code, detail: blocker.detail })) };
    if (outcome.proposal.baseSchematicDigest !== schematicStateDigest(state) || outcome.proposal.baseSchematicDigest !== context.schematicDigest) return refuse("stale_revision", ["Sealed base digest does not match the verified run snapshot; proposal discarded."]);
    return { kind: "sheet-organization-proposal", ok: true, toolId: descriptor.toolId, version: descriptor.version, proposal: outcome.proposal };
  }
}
