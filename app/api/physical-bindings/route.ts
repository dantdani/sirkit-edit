import { bindAtomicSelection } from "@/app/lib/physical-binding/atomic-binding";
import { createPhysicalBindingCandidate } from "@/app/lib/physical-binding/domain";
import { legacyFootprintAssignmentView, migrateLegacyPhysicalBinding } from "@/app/lib/physical-binding/legacy";
import { PhysicalBindingService } from "@/app/lib/physical-binding/repository";
import { PostgresPhysicalBindingRepository } from "@/app/lib/physical-binding/server-repository";
import type { ComponentPhysicalBinding, PhysicalBindingScope, PhysicalBindingTransitionRequest } from "@/app/lib/physical-binding/types";
import { validatePhysicalBinding } from "@/app/lib/physical-binding/validation";
import type { NewPhysicalBindingCandidate } from "@/app/lib/physical-binding/domain";
import { authenticatedJsonRoute, authenticatedRoute } from "@/app/lib/auth/route-handlers";
import { PHYSICAL_BINDING_API_DEADLINE_MS, PHYSICAL_BINDING_API_MAX_BYTES, bindingScopeFromContext, object } from "./_scope";

export const runtime = "nodejs";

const repository = new PostgresPhysicalBindingRepository();
const service = new PhysicalBindingService(repository);

function errorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : "PB_API_UNKNOWN_ERROR";
  const code = message.split(":")[0] || "PB_API_UNKNOWN_ERROR";
  const status = code.includes("NOT_FOUND") ? 404 : code.includes("CONFLICT") || code.includes("ACTIVE_SELECTION") ? 409 : code.includes("UNAUTHORIZED") || code.includes("HUMAN_REQUIRED") ? 403 : 422;
  return Response.json({ ok: false, code, error: code }, { status, headers: { "Cache-Control": "no-store" } });
}

function sameScope(candidate: PhysicalBindingScope, scope: { tenantId: string; projectId: string; branchId: string }): boolean {
  return candidate.tenantId === scope.tenantId && candidate.projectId === scope.projectId && candidate.branchId === scope.branchId;
}

function redacted(binding: ComponentPhysicalBinding, includeRaw: boolean): ComponentPhysicalBinding {
  if (includeRaw || !binding.legacySource) return binding;
  return { ...binding, legacySource: { ...binding.legacySource, rawFields: { redacted: true } } };
}

// [B16.0.22] canonical wrapper — authorization inside the wrapper (all-members
// read, no CSRF per the exact policy row); `setId` and `includeLegacyRaw`
// travel ONLY through the bounded first-value-wins query projection, and the
// legacy-raw reveal stays gated on the TRUSTED role.
export const GET = authenticatedRoute({ query: true }, async ({ context, meta }) => {
  const scope = bindingScopeFromContext(context), query = meta.query ?? {};
  const setId = query.setId?.trim();
  if (!setId) return Response.json({ ok: false, code: "PB_API_SET_ID_REQUIRED", error: "setId query parameter is required." }, { status: 400 });
  try {
    const state = await repository.load(setId);
    if (!state) return Response.json({ ok: false, code: "PB_BINDING_SET_NOT_FOUND", error: "Binding set not found." }, { status: 404 });
    if (!sameScope(state.set.scope, scope)) return Response.json({ ok: false, code: "PB_API_SCOPE_FORBIDDEN", error: "Binding set is outside the authorized project scope." }, { status: 403 });
    const includeRaw = query.includeLegacyRaw === "true" && ["project_admin", "migration_admin"].includes(scope.actor.role);
    const selected = state.bindings.find((item) => item.revisionId === state.set.effectiveSelectedRevisionId);
    return Response.json({ ok: true, authoritative: true, set: state.set, bindings: state.bindings.map((item) => redacted(item, includeRaw)), assessments: state.assessments, auditEvents: state.auditEvents, migrationRecords: state.migrationRecords.map((record) => ({ ...record, rawFields: undefined })), legacyCompatibilityView: selected ? legacyFootprintAssignmentView(selected) : null }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
});

// [B16.0.22] canonical wrapper — authorization + exact-origin CSRF + the
// bounded 2 MB / 30 s JSON read inside the wrapper; operation dispatch,
// per-operation role gates, and scope byte-matching are unchanged and keyed
// off the TRUSTED scope only.
export const POST = authenticatedJsonRoute(
  { maxBytes: PHYSICAL_BINDING_API_MAX_BYTES, deadlineMs: PHYSICAL_BINDING_API_DEADLINE_MS },
  async ({ context, body }) => {
  const scope = bindingScopeFromContext(context);
  const operation = typeof body.operation === "string" ? body.operation : "";
  try {
    if (operation === "create_candidate") {
      if (!["pcb_editor", "automation", "reviewer", "project_admin"].includes(scope.actor.role) || !object(body.candidate) || typeof body.idempotencyKey !== "string") return Response.json({ ok: false, code: "PB_API_CREATE_FORBIDDEN", error: "Authorized candidate input and idempotency key are required." }, { status: 403 });
      const candidateInput = body.candidate as unknown as NewPhysicalBindingCandidate;
      if (!candidateInput.scope || !sameScope(candidateInput.scope, scope)) return Response.json({ ok: false, code: "PB_API_SCOPE_FORBIDDEN", error: "Candidate scope does not match request scope." }, { status: 403 });
      const now = new Date().toISOString();
      const binding = createPhysicalBindingCandidate({ ...candidateInput, origin: { ...candidateInput.origin, actor: scope.actor, createdAt: now }, createdAt: now, createdBy: scope.actor });
      const state = await service.createCandidate(binding, body.idempotencyKey);
      return Response.json({ ok: true, state }, { status: 201, headers: { "Cache-Control": "no-store" } });
    }
    if (operation === "transition") {
      if (typeof body.setId !== "string" || !object(body.transition)) return Response.json({ ok: false, code: "PB_API_TRANSITION_INVALID", error: "setId and transition are required." }, { status: 400 });
      const current = await repository.load(body.setId);
      if (!current) return Response.json({ ok: false, code: "PB_BINDING_SET_NOT_FOUND", error: "Binding set not found." }, { status: 404 });
      if (!sameScope(current.set.scope, scope)) return Response.json({ ok: false, code: "PB_API_SCOPE_FORBIDDEN", error: "Binding set is outside the authorized project scope." }, { status: 403 });
      const requestBody = body.transition as unknown as PhysicalBindingTransitionRequest;
      const transition: PhysicalBindingTransitionRequest = { ...requestBody, actor: scope.actor, at: new Date().toISOString() };
      const state = await service.transition(body.setId, transition);
      return Response.json({ ok: true, state }, { headers: { "Cache-Control": "no-store" } });
    }
    if (operation === "migrate_legacy") {
      if (!["project_admin", "migration_admin"].includes(scope.actor.role) || !object(body.scope) || !object(body.rawComponent) || typeof body.sourceSchemaVersion !== "string") return Response.json({ ok: false, code: "PB_API_MIGRATION_FORBIDDEN", error: "Migration requires admin role, scope, source schema and raw component." }, { status: 403 });
      const bindingTarget = body.scope as unknown as PhysicalBindingScope;
      if (!sameScope(bindingTarget, scope)) return Response.json({ ok: false, code: "PB_API_SCOPE_FORBIDDEN", error: "Migration scope does not match request scope." }, { status: 403 });
      const result = migrateLegacyPhysicalBinding({ sourceSchemaVersion: body.sourceSchemaVersion, scope: bindingTarget, rawComponent: body.rawComponent, actor: { ...scope.actor, actorKind: "system_migration" }, migratedAt: new Date().toISOString() }, { dryRun: body.dryRun === true });
      if (body.dryRun === true) return Response.json({ ok: true, dryRun: true, migration: { ...result, candidate: redacted(result.candidate, false) } }, { headers: { "Cache-Control": "no-store" } });
      const state = await service.migrate(result);
      return Response.json({ ok: true, dryRun: false, state }, { status: 201, headers: { "Cache-Control": "no-store" } });
    }
    if (operation === "bind_atomic_selection") {
      if (typeof body.componentInstanceId !== "string" || typeof body.boardInstanceId !== "string" || typeof body.atomicPartRevisionId !== "string") {
        return Response.json({ ok: false, code: "PB_API_BIND_INPUT_INVALID", error: "componentInstanceId, boardInstanceId, and atomicPartRevisionId are required." }, { status: 400 });
      }
      const result = await bindAtomicSelection(service, repository, {
        scope,
        actor: scope.actor,
        boardInstanceId: body.boardInstanceId,
        componentInstanceId: body.componentInstanceId,
        atomicPartRevisionId: body.atomicPartRevisionId,
        hierarchyPath: Array.isArray(body.hierarchyPath) ? (body.hierarchyPath as string[]) : undefined,
        assemblyVariantIds: Array.isArray(body.assemblyVariantIds) ? (body.assemblyVariantIds as string[]) : undefined,
      });
      return Response.json({ ok: true, ...result }, { status: result.alreadyBound ? 200 : 201, headers: { "Cache-Control": "no-store" } });
    }
    if (operation === "assess") {
      if (typeof body.setId !== "string") return Response.json({ ok: false, code: "PB_API_SET_ID_REQUIRED", error: "setId is required." }, { status: 400 });
      const current = await repository.load(body.setId);
      if (!current) return Response.json({ ok: false, code: "PB_BINDING_SET_NOT_FOUND", error: "Binding set not found." }, { status: 404 });
      if (!sameScope(current.set.scope, scope)) return Response.json({ ok: false, code: "PB_API_SCOPE_FORBIDDEN", error: "Binding set is outside the authorized project scope." }, { status: 403 });
      const assessment = await service.assess(body.setId, { bindingRevisionId: typeof body.bindingRevisionId === "string" ? body.bindingRevisionId : undefined, assessedAt: new Date().toISOString() });
      return Response.json({ ok: true, assessment }, { headers: { "Cache-Control": "no-store" } });
    }
    if (operation === "validate") {
      if (!object(body.binding)) return Response.json({ ok: false, code: "PB_API_BINDING_REQUIRED", error: "binding is required." }, { status: 400 });
      const issues = validatePhysicalBinding(body.binding as unknown as ComponentPhysicalBinding);
      return Response.json({ ok: issues.length === 0, issues }, { status: issues.length ? 422 : 200, headers: { "Cache-Control": "no-store" } });
    }
    return Response.json({ ok: false, code: "PB_API_OPERATION_UNSUPPORTED", error: "Unsupported physical-binding operation." }, { status: 400 });
  } catch (error) { return errorResponse(error); }
  });
