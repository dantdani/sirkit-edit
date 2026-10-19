/**
 * [PR-M, 2026-10-18] Section M2 (design M2.1): the ONE service behind the page route (`/api/parts/acquisitions`) and the agent's two tools
 * (`sirkit.parts.acquisition-start` / `-status`): start or attach, read, control, the human handoff, and the applied-receipt record.
 *
 * Start is gated on a VERIFIED schematic snapshot (shape + `validateSchematicStateIntegrity`, its digest computed here) and the server
 * catalog - never a board, never a browser pin list: the instances are inspected through the catalog port (`inspectSchematicInstances`),
 * must be KiCad catalog instances of ONE catalog part, and must be unresolved. The target is derived from that catalog part (its KiCad
 * symbol `library:name`, its footprint hint, its MPN) plus the closed requirement. Nothing here mutates a design.
 */
import { validateSchematicStateIntegrity, schematicStateDigest } from "../../engineering/schematic-model";
import { validateSchematicCanonicalMark, type SchematicCanonicalMark } from "../../engineering/schematic-projection";
import type { EngineeringActor, ProjectRole } from "../../engineering/types";
import type { DurableWorkflowScope } from "../../durable-workflow/types";
import type { SchematicState } from "@/lib/schematic-types";
import { buildPcbSyncPreflightReport } from "../../pcb-sync/preflight-read";
import { inspectSchematicInstances, type SchematicInstanceFacts } from "../instance-facts";
import { loadCatalogParts } from "../facts-loader";
import type { CatalogPartInspectionPort } from "../../agent/catalog-inspection-reads";
import { normalizeCadAcquisitionRequest, type CadAcquisitionRequest, type CadAcquisitionTaskView } from "../../acquisition/cad-acquisition-contract";
import { createAcquisitionHandoff, AcquisitionHandoffError } from "../acquisition/handoff";
import { CadObjectStoreError } from "../../acquisition/cad-object-store";
import { AcquisitionCandidateError, type AcquisitionTarget } from "../acquisition/candidate";
import { componentResolutionTaskView, isTerminalResolutionState } from "./contracts";
import { ComponentResolutionTaskStore } from "./store";
import { handoffDepsOf, type ComponentResolutionRuntime } from "./runtime";

export type ResolutionServiceAnswer = { status: number; body: Record<string, unknown> };
export interface ResolutionPrincipal { principalId: string; role: ProjectRole; membershipRevision: string | null; actorKind: "human" | "ai" }

const START_ROLES: ReadonlySet<ProjectRole> = new Set<ProjectRole>(["pcb_editor", "reviewer", "project_admin"]);
const ACTION_ID = /^[A-Za-z0-9:._-]{1,128}$/;
const FOOTPRINT_HINT = /^([A-Za-z0-9][A-Za-z0-9_.+-]{0,127}):([A-Za-z0-9][A-Za-z0-9_.,+()=-]{0,191})$/;

const refuse = (status: number, code: string, error: string, extra: Record<string, unknown> = {}): ResolutionServiceAnswer => ({ status, body: { ok: false, code, error, ...extra } });

function isSchematicShape(value: unknown): value is SchematicState {
  return typeof value === "object" && value !== null && Array.isArray((value as Record<string, unknown>).components) && Array.isArray((value as Record<string, unknown>).wires);
}

/** The verified sheet: its shape and integrity, its digest computed here; a malformed head mark is refused (never coerced). */
export function verifiedSchematic(schematic: unknown, headMark: unknown): { ok: true; state: SchematicState; digest: string; headMark: SchematicCanonicalMark | null } | { ok: false; detail: string } {
  if (!isSchematicShape(schematic)) return { ok: false, detail: "a verified schematic snapshot is required (no board is needed or read)" };
  const issues = validateSchematicStateIntegrity(schematic);
  if (issues.length > 0) return { ok: false, detail: `the schematic snapshot failed integrity validation (${issues.length} issue(s))` };
  const mark = headMark === undefined || headMark === null ? null : validateSchematicCanonicalMark(headMark);
  if (headMark !== undefined && headMark !== null && !mark) return { ok: false, detail: "the schematic head mark is malformed" };
  return { ok: true, state: schematic, digest: schematicStateDigest(schematic), headMark: mark };
}

/** The target, derived from the server's catalog part of the instances and the closed requirement. */
export function acquisitionTargetOf(instances: readonly SchematicInstanceFacts[], request: CadAcquisitionRequest): { ok: true; target: AcquisitionTarget } | { ok: false; detail: string } {
  const first = instances[0];
  if (!first) return { ok: false, detail: "no instance was named" };
  for (const instance of instances) {
    if (instance.family !== "kicad" || !instance.partId) return { ok: false, detail: `${instance.refDes} is not a catalog instance (a Theory symbol is resolved by placing a catalog part)` };
    if (instance.catalog.state !== "loaded" || !instance.catalog.part) return { ok: false, detail: `${instance.refDes}: its catalog part could not be read from the server catalog (${instance.catalog.reason ?? instance.catalog.state})` };
    if (instance.partId !== first.partId) return { ok: false, detail: "the instances are drawn from different catalog parts: start one acquisition per catalog part" };
    if (instance.resolution.state === "resolved") return { ok: false, detail: `${instance.refDes} already has a published exact revision` };
  }
  const part = first.catalog.part!;
  const hint = part.footprintHint ? FOOTPRINT_HINT.exec(part.footprintHint) : null;
  const exactMpn = request.requirement.exactMpn ?? part.mpn ?? null;
  return {
    ok: true,
    target: {
      componentIds: instances.map((instance) => instance.componentId), refDes: instances.map((instance) => instance.refDes), value: first.value, catalogPartId: part.id, catalogMpn: part.mpn,
      symbol: { library: part.library, name: part.name }, footprint: hint && request.assetKinds.includes("footprint") ? { library: hint[1]!, name: hint[2]! } : null,
      exactMpn, packageCode: request.requirement.packageCode ?? null, mounting: request.requirement.mounting ?? null,
    },
  };
}

export interface ResolutionServiceDeps { runtime: ComponentResolutionRuntime; catalog: CatalogPartInspectionPort | null; store?: ComponentResolutionTaskStore }

export class ComponentResolutionService {
  private readonly store: ComponentResolutionTaskStore;
  constructor(private readonly deps: ResolutionServiceDeps) {
    this.store = deps.store ?? new ComponentResolutionTaskStore({ repository: deps.runtime.repository, clock: deps.runtime.clock });
  }

  async start(scope: DurableWorkflowScope, principal: ResolutionPrincipal, input: { request: unknown; schematic: unknown; headMark?: unknown; origin: "page" | "chat" }): Promise<ResolutionServiceAnswer> {
    if (!START_ROLES.has(principal.role)) return refuse(403, "COMPONENT_RESOLUTION_FORBIDDEN", "Only an editor, reviewer or administrator can start an acquisition.");
    const normalized = normalizeCadAcquisitionRequest(input.request);
    if (!normalized.ok) return refuse(400, "COMPONENT_RESOLUTION_INVALID_REQUEST", normalized.detail, { field: normalized.field });
    const sheet = verifiedSchematic(input.schematic, input.headMark);
    if (!sheet.ok) return refuse(400, "COMPONENT_RESOLUTION_SCHEMATIC_UNVERIFIED", sheet.detail);
    if (!this.deps.catalog) return refuse(503, "COMPONENT_RESOLUTION_CATALOG_UNAVAILABLE", "The server catalog cannot be read here, so no instance can be inspected; nothing was started.");
    const partIds = [...new Set((sheet.state.kicadComponents ?? []).filter((instance) => normalized.request.componentIds.includes(instance.id)).map((instance) => instance.partId))];
    const loaded = await loadCatalogParts(this.deps.catalog, partIds, { scope, runId: `cr-start:${principal.principalId}`, budgetMs: 8_000 });
    const inspection = inspectSchematicInstances({ state: sheet.state, targets: normalized.request.componentIds, parts: loaded.parts });
    const byId = inspection.instances.filter((instance) => normalized.request.componentIds.includes(instance.componentId));
    if (inspection.notFound.length > 0 || byId.length !== normalized.request.componentIds.length) return refuse(400, "COMPONENT_RESOLUTION_INVALID_REQUEST", "every componentId must name a stable instance id on the verified sheet (a reference designator is not a durable target)");
    const target = acquisitionTargetOf(byId, normalized.request);
    if (!target.ok) return refuse(409, "COMPONENT_RESOLUTION_NOT_ACQUIRABLE", target.detail);
    const started = await this.store.start({ scope, principal, origin: input.origin, request: normalized.request, base: { schematicDigest: sheet.digest, headMark: sheet.headMark }, target: target.target, instances: byId });
    if (!started.ok) return refuse(400, started.code, started.issue);
    return { status: 202, body: { ok: true, attached: started.attached, task: componentResolutionTaskView(started.task), durability: this.deps.runtime.durability } };
  }

  async read(scope: DurableWorkflowScope, taskId: unknown): Promise<ResolutionServiceAnswer> {
    const read = await this.store.get(scope, taskId);
    if (!read) return refuse(404, "COMPONENT_RESOLUTION_TASK_NOT_FOUND", "No such acquisition task in this project.");
    return { status: 200, body: { ok: true, task: componentResolutionTaskView(read.task), durability: this.deps.runtime.durability } };
  }

  async list(scope: DurableWorkflowScope): Promise<ResolutionServiceAnswer> {
    const tasks = await this.store.list(scope);
    return { status: 200, body: { ok: true, tasks: tasks.slice(0, 20).map(componentResolutionTaskView), durability: this.deps.runtime.durability } };
  }

  /** cancel / resume / recheck (whoever may start may stop). */
  async control(scope: DurableWorkflowScope, principal: ResolutionPrincipal, input: { taskId: unknown; action: unknown; clientActionId: unknown }): Promise<ResolutionServiceAnswer> {
    if (!START_ROLES.has(principal.role)) return refuse(403, "COMPONENT_RESOLUTION_FORBIDDEN", "Only an editor, reviewer or administrator can control an acquisition.");
    if (input.action !== "cancel" && input.action !== "resume" && input.action !== "recheck") return refuse(400, "COMPONENT_RESOLUTION_INVALID_REQUEST", "action is cancel, resume or recheck");
    if (typeof input.clientActionId !== "string" || !ACTION_ID.test(input.clientActionId)) return refuse(400, "COMPONENT_RESOLUTION_INVALID_REQUEST", "clientActionId names the action (1-128 of [A-Za-z0-9:._-])");
    if (typeof input.taskId !== "string") return refuse(404, "COMPONENT_RESOLUTION_TASK_NOT_FOUND", "No such acquisition task in this project.");
    const outcome = await this.store.control({ scope, taskId: input.taskId, principalId: principal.principalId, action: input.action, clientActionId: input.clientActionId });
    if (!outcome.ok) return outcome.code === "COMPONENT_RESOLUTION_TASK_NOT_FOUND" ? refuse(404, outcome.code, "No such acquisition task in this project.") : refuse(409, outcome.code, outcome.issue ?? "The task cannot take that action now.");
    return { status: 200, body: { ok: true, task: componentResolutionTaskView(outcome.task) } };
  }

  /** "Send for component review": a HUMAN member action; the agent is refused here (it prepares, a person sends). */
  async handoff(scope: DurableWorkflowScope, actor: EngineeringActor, membershipRevision: string | null, input: { taskId: unknown; clientActionId: unknown }): Promise<ResolutionServiceAnswer> {
    if (typeof input.clientActionId !== "string" || !ACTION_ID.test(input.clientActionId)) return refuse(400, "COMPONENT_RESOLUTION_INVALID_REQUEST", "clientActionId names the action");
    const read = await this.store.get(scope, input.taskId);
    if (!read) return refuse(404, "COMPONENT_RESOLUTION_TASK_NOT_FOUND", "No such acquisition task in this project.");
    const task = read.task; if (isTerminalResolutionState(task.state)) return refuse(409, "COMPONENT_RESOLUTION_STATE_CONFLICT", "The task cannot take a handoff now: it was stopped or has ended; nothing was sent for review."); // [PR-L/M integration, 2026-10-18] M2-SEC-3: checked BEFORE the handoff writes anything in the governance scope (a cancelled task, a stale tab, a direct POST); record-handoff keeps its own check
    if (!task.candidateId || task.candidate?.verdict !== "validated") return refuse(409, "COMPONENT_RESOLUTION_STATE_CONFLICT", "Only a validated candidate is sent for review.");
    try {
      const { handoff } = await createAcquisitionHandoff(handoffDepsOf(this.deps.runtime), { sourceScope: scope, taskId: task.taskId, candidateId: task.candidateId, actor, membershipRevision });
      const recorded = await this.store.control({ scope, taskId: task.taskId, principalId: actor.actorId, action: "record-handoff", clientActionId: input.clientActionId, handoff: { handoffId: handoff.handoffId, at: handoff.createdAt, by: actor.actorId } });
      if (!recorded.ok) return refuse(409, recorded.code, recorded.issue ?? "The handoff could not be recorded on the task.");
      return { status: 200, body: { ok: true, task: componentResolutionTaskView(recorded.task), handoffId: handoff.handoffId } };
    } catch (error) {
      if (error instanceof AcquisitionHandoffError) {
        const status = error.code === "ACQUISITION_HANDOFF_HUMAN_REQUIRED" || error.code === "ACQUISITION_HANDOFF_FORBIDDEN" || error.code === "ACQUISITION_HANDOFF_CROSS_TENANT" ? 403 : error.code === "ACQUISITION_HANDOFF_GOVERNANCE_UNCONFIGURED" ? 503 : 409;
        return refuse(status, error.code, error.message);
      }
      if (error instanceof AcquisitionCandidateError || error instanceof CadObjectStoreError) return refuse(409, error.code, error.message);
      throw error;
    }
  }

  /** The applied receipt of the offered replacement and the updated preflight, computed HERE over the committed sheet the page sends. */
  async recordApplied(scope: DurableWorkflowScope, principal: ResolutionPrincipal, input: { taskId: unknown; clientActionId: unknown; receiptId: unknown; schematicDigestAfter: unknown; schematic: unknown }): Promise<ResolutionServiceAnswer> {
    if (!START_ROLES.has(principal.role)) return refuse(403, "COMPONENT_RESOLUTION_FORBIDDEN", "Only an editor, reviewer or administrator can record the applied replacement.");
    if (typeof input.clientActionId !== "string" || !ACTION_ID.test(input.clientActionId) || typeof input.receiptId !== "string" || !/^[A-Za-z0-9:._-]{1,200}$/.test(input.receiptId) || typeof input.schematicDigestAfter !== "string") return refuse(400, "COMPONENT_RESOLUTION_INVALID_REQUEST", "clientActionId, receiptId and schematicDigestAfter are required");
    const sheet = verifiedSchematic(input.schematic, null);
    if (!sheet.ok) return refuse(400, "COMPONENT_RESOLUTION_SCHEMATIC_UNVERIFIED", sheet.detail);
    if (sheet.digest !== input.schematicDigestAfter) return refuse(409, "COMPONENT_RESOLUTION_STALE_BASE", "the sheet sent is not the revision the receipt names");
    const read = await this.store.get(scope, input.taskId);
    if (!read) return refuse(404, "COMPONENT_RESOLUTION_TASK_NOT_FOUND", "No such acquisition task in this project.");
    const proposal = read.task.proposal;
    const bound = proposal ? (sheet.state.kicadComponents ?? []).filter((instance) => proposal.componentIds.includes(instance.id) && instance.atomicPartRevisionId === proposal.atomicPartRevisionId) : [];
    if (!proposal || bound.length !== proposal.componentIds.length) return refuse(409, "COMPONENT_RESOLUTION_STATE_CONFLICT", "the sheet does not carry the offered revision on every target instance");
    const report = buildPcbSyncPreflightReport(sheet.state);
    const preflight: NonNullable<CadAcquisitionTaskView["preflight"]> = { unresolvedCount: report.unresolved.count, unresolvedRefDes: report.unresolved.rows.map((row) => row.refDes).slice(0, 20), at: new Date(this.deps.runtime.clock()).toISOString(), verifiedDigest: sheet.digest };
    const outcome = await this.store.control({ scope, taskId: read.task.taskId, principalId: principal.principalId, action: "record-applied", clientActionId: input.clientActionId, applied: { receiptId: input.receiptId, schematicDigestAfter: sheet.digest, at: preflight.at }, preflight });
    if (!outcome.ok) return refuse(409, outcome.code, outcome.issue ?? "The receipt could not be recorded.");
    return { status: 200, body: { ok: true, task: componentResolutionTaskView(outcome.task) } };
  }
}
