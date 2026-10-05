import { createEmptyBoard, type PcbBoard } from "@/app/lib/pcb/types"; // [B23-B3] + PcbBoard: the loaded board travels to the summary (D23-17)
import { makeBoardRecord } from "@/app/lib/pcb-sync/board";
import { PcbSyncSnapshotRevisionConflict } from "@/app/lib/pcb-sync/durable";
import type { DurableBoardLineageStore } from "@/app/lib/pcb-sync/board-lineage";
import type { PcbSyncBoardRevisionDeriveRequest } from "@/app/lib/pcb-sync/types";
import type { PcbSyncRepository } from "@/app/lib/pcb-sync/repository";
import type { PcbSyncFeatureState } from "@/app/lib/pcb-sync/rollout";
import type { PcbSynchronizationService } from "@/app/lib/pcb-sync/service";
import { authoritativeSnapshotDigest, canonicalAuthoritativeSnapshot, pcbSyncDigest } from "@/app/lib/pcb-sync/stable";
import {
  PCB_SYNC_BOARD_LOAD_RESULT_VERSION,
  PCB_SYNC_DEMO_PUBLICATION_REQUEST_VERSION,
  PCB_SYNC_SNAPSHOT_VERSION,
  type PcbSyncApplyRequest,
  type PcbSyncAuthoritativeSnapshot,
  type PcbSyncBoardLoadResult,
  type PcbSyncDemoSnapshotPublicationRequest,
  type PcbSyncIssue,
  type PcbSyncPreflightRequest,
  type PcbSyncSchematicComponent,
  type PcbSyncSchematicNet,
  type PcbSyncSnapshotPublisher,
} from "@/app/lib/pcb-sync/types";
import { object, pcbSyncScope, scopedPcbSyncJson } from "./_scope"; import type { ManufacturingObservationView } from "@/app/lib/manufacturing-providers/provider-observation"; // [B23-B3] appended in place (types only)

const MAX_COMPONENTS = 4_096, MAX_NETS = 32_768, MAX_PINS = 131_072, MAX_LIST = 4_096;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/@+_-]{0,255}$/;

function errorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : "PS_INTERNAL_ERROR";
  const code = /^PS_[A-Z0-9_]+/.exec(message)?.[0] ?? "PS_INTERNAL_ERROR";
  // A non-PS_* message is an unclassified defect, not a policy outcome — keep
  // the response opaque but never lose the cause server-side.
  if (code === "PS_INTERNAL_ERROR") console.error("[pcb-sync] unhandled error:", error);
  // [B16-C.3] a revision conflict names the newer revision another session published (current vs expected) — never a bare code.
  const conflict = error instanceof PcbSyncSnapshotRevisionConflict ? { conflict: error.details } : {};
  const status = code.includes("AUTHORIZATION") || code.includes("SCOPE") || code.includes("HUMAN_REQUIRED") ? 403 : code.includes("NOT_FOUND") ? 404 : code.includes("CONFIRMATION_REQUIRED") || code.includes("CARRY_INVALID") || code.includes("PARENT_INVALID") || code.includes("IDEMPOTENCY_REQUIRED") ? 400 : code.includes("STALE") || code.includes("REVISION") || code.includes("DIGEST") || code.includes("LIFECYCLE") || code.includes("EXPIRED") || code.includes("IDEMPOTENCY") || code.includes("SUPERSEDED") || code.includes("DERIVATION_BLOCKED") || code.includes("PLAN_MISMATCH") ? 409 : code.includes("LIMIT") || code.includes("PAYLOAD") ? 413 : code.includes("CANCELLED") ? 408 : 422;
  return Response.json({ ok: false, code, error: code, ...conflict }, { status, headers: { "Cache-Control": "no-store" } });
}

function fail(code: string): never { throw new Error(code); }
function exact(value: Record<string, unknown>, keys: readonly string[]): void { const allowed = new Set(keys); if (Object.keys(value).some((key) => !allowed.has(key))) fail("PS_API_UNKNOWN_FIELD"); }
function text(value: unknown, code: string, max = 256): string { if (typeof value !== "string" || !value.trim() || value.length > max) fail(code); return value.trim(); }
function id(value: unknown, code: string): string { const result = text(value, code); if (!ID.test(result)) fail(code); return result; }
function list(value: unknown, max: number, code: string): unknown[] { if (!Array.isArray(value)) fail(code); if (value.length > max) fail("PS_SNAPSHOT_LIMIT_EXCEEDED"); return value; }
function strings(value: unknown, max: number, code: string): string[] { return list(value, max, code).map((item) => text(item, code)); }
function choice<T extends string>(value: unknown, values: readonly T[], code: string): T { if (typeof value !== "string" || !values.includes(value as T)) fail(code); return value as T; }
function timestamp(value: unknown, code: string): string { const result = text(value, code); if (!Number.isFinite(Date.parse(result))) fail(code); return new Date(result).toISOString(); }

function parseComponent(value: unknown): PcbSyncSchematicComponent {
  if (!object(value)) fail("PS_COMPONENT_INVALID");
  exact(value, ["componentInstanceId", "componentRevision", "referenceDesignator", "value", "hierarchyPath", "symbolAssetVersionId", "applicability", "pins"]);
  const pins = list(value.pins, MAX_LIST, "PS_PIN_INVALID").map((pin): PcbSyncSchematicComponent["pins"][number] => {
    if (!object(pin)) fail("PS_PIN_INVALID");
    exact(pin, ["pinInstanceId", "number", "name", "disposition"]);
    return { pinInstanceId: id(pin.pinInstanceId, "PS_PIN_ID_INVALID"), number: text(pin.number, "PS_PIN_NUMBER_INVALID", 128), ...(pin.name === undefined ? {} : { name: text(pin.name, "PS_PIN_NAME_INVALID") }), disposition: choice(pin.disposition, ["connected", "unconnected", "no_connect", "schematic_only"] as const, "PS_PIN_DISPOSITION_INVALID") };
  });
  return { componentInstanceId: id(value.componentInstanceId, "PS_COMPONENT_ID_INVALID"), componentRevision: id(value.componentRevision, "PS_COMPONENT_REVISION_INVALID"), referenceDesignator: id(value.referenceDesignator, "PS_REFERENCE_INVALID"), ...(value.value === undefined ? {} : { value: text(value.value, "PS_COMPONENT_VALUE_INVALID", 1_024) }), hierarchyPath: strings(value.hierarchyPath, 128, "PS_HIERARCHY_PATH_INVALID"), symbolAssetVersionId: id(value.symbolAssetVersionId, "PS_SYMBOL_ASSET_INVALID"), applicability: choice(value.applicability, ["applicable", "not_applicable", "nonphysical", "unknown"] as const, "PS_COMPONENT_APPLICABILITY_INVALID"), pins };
}

function parseNet(value: unknown): PcbSyncSchematicNet {
  if (!object(value)) fail("PS_NET_INVALID");
  exact(value, ["stableNetId", "connectivityRevision", "canonicalScope", "displayName", "aliases", "classification", "members", "explicitNoConnectPinIds", "constraintRefs"]);
  const members = list(value.members, MAX_PINS, "PS_NET_MEMBER_INVALID").map((member): PcbSyncSchematicNet["members"][number] => {
    if (!object(member)) fail("PS_NET_MEMBER_INVALID"); exact(member, ["componentInstanceId", "pinInstanceId", "pinNumber"]);
    return { componentInstanceId: id(member.componentInstanceId, "PS_COMPONENT_ID_INVALID"), pinInstanceId: id(member.pinInstanceId, "PS_PIN_ID_INVALID"), pinNumber: text(member.pinNumber, "PS_PIN_NUMBER_INVALID", 128) };
  });
  return { stableNetId: id(value.stableNetId, "PS_NET_ID_INVALID"), connectivityRevision: id(value.connectivityRevision, "PS_NET_REVISION_INVALID"), canonicalScope: strings(value.canonicalScope, 128, "PS_NET_SCOPE_INVALID"), displayName: text(value.displayName, "PS_NET_NAME_INVALID", 1_024), aliases: strings(value.aliases, MAX_LIST, "PS_NET_ALIAS_INVALID"), classification: choice(value.classification, ["signal", "power", "ground", "differential", "other"] as const, "PS_NET_CLASSIFICATION_INVALID"), members, explicitNoConnectPinIds: strings(value.explicitNoConnectPinIds, MAX_PINS, "PS_NO_CONNECT_INVALID"), constraintRefs: strings(value.constraintRefs, MAX_LIST, "PS_CONSTRAINT_REF_INVALID") };
}

function parseIssue(value: unknown): PcbSyncIssue {
  if (!object(value)) fail("PS_PREREQUISITE_ISSUE_INVALID");
  exact(value, ["code", "severity", "blocking", "scope", "stableIds", "displayRefs", "message", "remediationCategory", "evidenceRefs", "causedBy", "retryability", "helpKey"]);
  if (typeof value.blocking !== "boolean") fail("PS_PREREQUISITE_ISSUE_INVALID");
  return { code: id(value.code, "PS_ISSUE_CODE_INVALID"), severity: choice(value.severity, ["info", "warning", "error", "blocking"] as const, "PS_ISSUE_SEVERITY_INVALID"), blocking: value.blocking, scope: choice(value.scope, ["request", "authorization", "snapshot", "component", "mapping", "asset", "net", "board", "plan", "storage", "router", "legacy", "system"] as const, "PS_ISSUE_SCOPE_INVALID"), stableIds: strings(value.stableIds, MAX_LIST, "PS_ISSUE_REFERENCE_INVALID"), displayRefs: strings(value.displayRefs, MAX_LIST, "PS_ISSUE_REFERENCE_INVALID"), message: text(value.message, "PS_ISSUE_MESSAGE_INVALID", 2_048), remediationCategory: id(value.remediationCategory, "PS_ISSUE_REMEDIATION_INVALID"), evidenceRefs: strings(value.evidenceRefs, MAX_LIST, "PS_ISSUE_REFERENCE_INVALID"), causedBy: strings(value.causedBy, MAX_LIST, "PS_ISSUE_REFERENCE_INVALID"), retryability: choice(value.retryability, ["never", "after_user_action", "after_refresh", "transient"] as const, "PS_ISSUE_RETRYABILITY_INVALID"), helpKey: id(value.helpKey, "PS_ISSUE_HELP_KEY_INVALID") };
}

function parsePublication(value: unknown): PcbSyncDemoSnapshotPublicationRequest {
  if (!object(value)) fail("PS_API_REQUEST_REQUIRED");
  exact(value, ["requestSchemaVersion", "requestId", "designId", "boardId", "boardName", "projectRevision", "designRevision", "schematicRevision", "componentSetRevision", "netGraphRevision", "assemblyVariantId", "assemblyVariantRevision", "librarySnapshotRevision", "constraintsRevision", "expectedSnapshotRevision", "idempotencyKey", "components", "nets", "prerequisiteIssues", "sourceDigest", "requestedAt"]);
  if (value.requestSchemaVersion !== PCB_SYNC_DEMO_PUBLICATION_REQUEST_VERSION) fail("PS_PUBLICATION_SCHEMA_UNSUPPORTED");
  if (!Number.isSafeInteger(value.expectedSnapshotRevision) || (value.expectedSnapshotRevision as number) < 0) fail("PS_SNAPSHOT_REVISION_INVALID");
  const components = list(value.components, MAX_COMPONENTS, "PS_COMPONENTS_INVALID").map(parseComponent), nets = list(value.nets, MAX_NETS, "PS_NETS_INVALID").map(parseNet), prerequisiteIssues = list(value.prerequisiteIssues, MAX_LIST, "PS_PREREQUISITE_ISSUES_INVALID").map(parseIssue);
  if (components.reduce((sum, component) => sum + component.pins.length, 0) > MAX_PINS || nets.reduce((sum, net) => sum + net.members.length + net.explicitNoConnectPinIds.length, 0) > MAX_PINS) fail("PS_SNAPSHOT_LIMIT_EXCEEDED");
  return { requestSchemaVersion: PCB_SYNC_DEMO_PUBLICATION_REQUEST_VERSION, requestId: id(value.requestId, "PS_REQUEST_ID_INVALID"), designId: id(value.designId, "PS_DESIGN_ID_INVALID"), boardId: id(value.boardId, "PS_BOARD_ID_INVALID"), boardName: text(value.boardName, "PS_BOARD_NAME_INVALID", 512), projectRevision: id(value.projectRevision, "PS_PROJECT_REVISION_INVALID"), designRevision: id(value.designRevision, "PS_DESIGN_REVISION_INVALID"), schematicRevision: id(value.schematicRevision, "PS_SCHEMATIC_REVISION_INVALID"), componentSetRevision: id(value.componentSetRevision, "PS_COMPONENT_SET_REVISION_INVALID"), netGraphRevision: id(value.netGraphRevision, "PS_NET_GRAPH_REVISION_INVALID"), assemblyVariantId: id(value.assemblyVariantId, "PS_VARIANT_ID_INVALID"), assemblyVariantRevision: id(value.assemblyVariantRevision, "PS_VARIANT_REVISION_INVALID"), librarySnapshotRevision: id(value.librarySnapshotRevision, "PS_LIBRARY_REVISION_INVALID"), ...(value.constraintsRevision === undefined ? {} : { constraintsRevision: id(value.constraintsRevision, "PS_CONSTRAINTS_REVISION_INVALID") }), expectedSnapshotRevision: value.expectedSnapshotRevision as number, idempotencyKey: id(value.idempotencyKey, "PS_IDEMPOTENCY_KEY_INVALID"), components, nets, prerequisiteIssues, ...(value.sourceDigest === undefined ? {} : { sourceDigest: id(value.sourceDigest, "PS_SOURCE_DIGEST_INVALID") }), requestedAt: timestamp(value.requestedAt, "PS_REQUEST_TIMESTAMP_INVALID") };
}

function validateGraph(components: PcbSyncSchematicComponent[], nets: PcbSyncSchematicNet[]): void {
  const componentIds = new Set<string>(), references = new Set<string>(), pins = new Map<string, { componentId: string; number: string; disposition: PcbSyncSchematicComponent["pins"][number]["disposition"] }>();
  for (const component of components) {
    if (componentIds.has(component.componentInstanceId) || references.has(component.referenceDesignator)) fail("PS_COMPONENT_IDENTITY_DUPLICATE");
    componentIds.add(component.componentInstanceId); references.add(component.referenceDesignator);
    for (const pin of component.pins) { if (pins.has(pin.pinInstanceId)) fail("PS_PIN_IDENTITY_DUPLICATE"); pins.set(pin.pinInstanceId, { componentId: component.componentInstanceId, number: pin.number, disposition: pin.disposition }); }
  }
  const netIds = new Set<string>(), connected = new Set<string>(), noConnect = new Set<string>();
  for (const net of nets) {
    if (netIds.has(net.stableNetId)) fail("PS_NET_IDENTITY_DUPLICATE"); netIds.add(net.stableNetId);
    for (const member of net.members) { const pin = pins.get(member.pinInstanceId); if (!pin || pin.componentId !== member.componentInstanceId || pin.number !== member.pinNumber || pin.disposition !== "connected") fail("PS_NET_MEMBER_REFERENCE_INVALID"); if (connected.has(member.pinInstanceId)) fail("PS_NET_MEMBER_DUPLICATE"); connected.add(member.pinInstanceId); }
    for (const pinId of net.explicitNoConnectPinIds) { const pin = pins.get(pinId); if (!pin || pin.disposition !== "no_connect") fail("PS_NO_CONNECT_REFERENCE_INVALID"); if (noConnect.has(pinId)) fail("PS_NO_CONNECT_DUPLICATE"); noConnect.add(pinId); }
  }
  for (const [pinId, pin] of pins) if (pin.disposition === "connected" && !connected.has(pinId)) fail("PS_CONNECTED_PIN_NET_MISSING");
}

function buildSnapshot(request: PcbSyncDemoSnapshotPublicationRequest, scope: { tenantId: string; projectId: string; branchId: string }): PcbSyncAuthoritativeSnapshot {
  validateGraph(request.components, request.nets);
  const seed = canonicalAuthoritativeSnapshot({ schemaVersion: PCB_SYNC_SNAPSHOT_VERSION, ...scope, designId: request.designId, projectRevision: request.projectRevision, designRevision: request.designRevision, schematicRevision: request.schematicRevision, schematicDigest: "pending", componentSetRevision: request.componentSetRevision, netGraphRevision: request.netGraphRevision, netGraphDigest: "pending", assemblyVariantId: request.assemblyVariantId, assemblyVariantRevision: request.assemblyVariantRevision, librarySnapshotRevision: request.librarySnapshotRevision, ...(request.constraintsRevision ? { constraintsRevision: request.constraintsRevision } : {}), components: request.components, nets: request.nets, prerequisiteIssues: request.prerequisiteIssues, newBoardTemplate: createEmptyBoard() });
  const sourceDigest = pcbSyncDigest({ components: seed.components, nets: seed.nets, prerequisiteIssues: seed.prerequisiteIssues });
  if (request.sourceDigest && request.sourceDigest !== sourceDigest) fail("PS_SOURCE_DIGEST_MISMATCH");
  const base = { ...seed, schematicDigest: pcbSyncDigest(seed.components), netGraphDigest: pcbSyncDigest(seed.nets) };
  return { ...base, snapshotDigest: authoritativeSnapshotDigest(base) };
}

export interface PcbSyncApiContracts { snapshotPublisher?: PcbSyncSnapshotPublisher; repository?: PcbSyncRepository; clock?: () => string }

export function createPcbSyncPostHandler(service: PcbSynchronizationService, featureState: () => PcbSyncFeatureState, contracts: PcbSyncApiContracts = {}) {
  return async function post(request: Request): Promise<Response> {
    const parsed = await scopedPcbSyncJson(request);
    if (!parsed.ok) return parsed.response;
    const { body, scope } = parsed, operation = typeof body.operation === "string" ? body.operation : "preflight", state = featureState();
    if (state === "off") return Response.json({ ok: false, code: "PS_STAGE3_DISABLED", error: "Stage 3 PCB synchronization is disabled." }, { status: 503, headers: { "Cache-Control": "no-store" } });
    try {
      if (operation === "publish_demo_snapshot") {
        if (!contracts.snapshotPublisher) fail("PS_SNAPSHOT_PUBLICATION_UNAVAILABLE");
        if (!["pcb_editor", "project_admin", "automation"].includes(scope.actor.role)) fail("PS_SNAPSHOT_PUBLICATION_AUTHORIZATION_DENIED");
        exact(body, ["operation", "request"]);
        const input = parsePublication(body.request), snapshot = buildSnapshot(input, scope), publishedAt = contracts.clock?.() ?? new Date().toISOString();
        if (!Number.isFinite(Date.parse(publishedAt))) fail("PS_TRUSTED_CLOCK_INVALID");
        const result = await contracts.snapshotPublisher.publish(snapshot, { expectedRevision: input.expectedSnapshotRevision, idempotencyKey: input.idempotencyKey, requestId: input.requestId, boardId: input.boardId, actorId: scope.actor.actorId, publishedAt: new Date(publishedAt).toISOString() });
        // Explicit unauthenticated demo ingestion pending production identity gap R02-B1-011.
        return Response.json({ ok: true, operation, boardChanged: false, demoSecurity: { authentication: "deferred", gap: "R02-B1-011" }, result }, { status: result.created ? 201 : 200, headers: { "Cache-Control": "no-store", "X-Sirkit-Pcb-Sync-State": state } });
      }
      if (operation === "preflight") {
        if (!object(body.request)) return Response.json({ ok: false, code: "PS_API_REQUEST_REQUIRED", error: "request object is required." }, { status: 400, headers: { "Cache-Control": "no-store" } });
        const input = body.request as unknown as PcbSyncPreflightRequest;
        const result = await service.preflight({ ...input, tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId, actorContext: scope.actor }, request.signal);
        return Response.json({ ok: true, operation: "preflight", boardChanged: false, result }, { headers: { "Cache-Control": "no-store", "X-Sirkit-Pcb-Sync-State": state } });
      }
      if (operation === "apply") {
        if (state !== "opt_in" && state !== "authoritative_safe_profile") return Response.json({ ok: false, code: "PS_APPLY_ROLLOUT_BLOCKED", error: "Apply is unavailable during observation rollout." }, { status: 403, headers: { "Cache-Control": "no-store" } });
        if (request.headers.get("x-sirkit-pcb-sync-opt-in")?.toLowerCase() !== "true") return Response.json({ ok: false, code: "PS_APPLY_OPT_IN_REQUIRED", error: "Explicit Stage 3 apply opt-in is required." }, { status: 403, headers: { "Cache-Control": "no-store" } });
        if (!object(body.request)) return Response.json({ ok: false, code: "PS_API_REQUEST_REQUIRED", error: "request object is required." }, { status: 400, headers: { "Cache-Control": "no-store" } });
        const input = body.request as unknown as PcbSyncApplyRequest;
        const result = await service.apply({ ...input, tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId, actorContext: scope.actor }, request.signal);
        return Response.json({ ok: result.status === "applied" || result.status === "idempotent_replay", operation: "apply", boardChanged: result.boardChanged, result }, { status: result.status === "applied" || result.status === "idempotent_replay" ? 200 : 409, headers: { "Cache-Control": "no-store", "X-Sirkit-Pcb-Sync-State": state } });
      }
      // ── [B16-C.1] routed-board revision lifecycle: preview the rework plan, then derive it deliberately ──
      if (operation === "preview_board_revision" || operation === "derive_board_revision") {
        if (!object(body.request)) return Response.json({ ok: false, code: "PS_API_REQUEST_REQUIRED", error: "request object is required." }, { status: 400, headers: { "Cache-Control": "no-store" } });
        if (!["pcb_editor", "project_admin"].includes(scope.actor.role)) fail("PS_BOARD_DERIVATION_AUTHORIZATION_DENIED");
        const input = { ...(body.request as Record<string, unknown>), tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId, actorContext: scope.actor } as unknown as PcbSyncBoardRevisionDeriveRequest;
        if (operation === "preview_board_revision") {
          const result = await service.previewBoardRevision(input, request.signal);
          return Response.json({ ok: true, operation, boardChanged: false, result }, { headers: { "Cache-Control": "no-store", "X-Sirkit-Pcb-Sync-State": state } });
        }
        // Deriving writes a new durable board: the same rollout gate and explicit opt-in as apply.
        if (state !== "opt_in" && state !== "authoritative_safe_profile") return Response.json({ ok: false, code: "PS_APPLY_ROLLOUT_BLOCKED", error: "Derivation is unavailable during observation rollout." }, { status: 403, headers: { "Cache-Control": "no-store" } });
        if (request.headers.get("x-sirkit-pcb-sync-opt-in")?.toLowerCase() !== "true") return Response.json({ ok: false, code: "PS_APPLY_OPT_IN_REQUIRED", error: "Explicit Stage 3 apply opt-in is required." }, { status: 403, headers: { "Cache-Control": "no-store" } });
        const result = await service.deriveBoardRevision(input, request.signal);
        return Response.json({ ok: true, operation, boardChanged: true, result }, { status: result.status === "derived" ? 201 : 200, headers: { "Cache-Control": "no-store", "X-Sirkit-Pcb-Sync-State": state } });
      }
      return Response.json({ ok: false, code: "PS_API_OPERATION_UNSUPPORTED", error: "Unsupported PCB synchronization operation." }, { status: 400, headers: { "Cache-Control": "no-store" } });
    } catch (error) { return errorResponse(error); }
  };
}

/**
 * [B16.0.22] Request-free authoritative board load. The canonical route
 * wrapper authorizes and projects the query (deterministic first-value-wins);
 * this core validates the projected fields and reads the durable record. The
 * unknown-field refusal is preserved exactly; the historical DUPLICATED-key
 * refusal lives only in the legacy Request adapter below (the canonical query
 * projection cannot carry duplicates).
 */
/**
 * [B16.1C §C] the reload-time manufacturing truth a browser needs to
 * reconstruct workflow state: the durable qualification authority head and
 * the latest ledgered release, each flagged `current` against the board the
 * request just loaded. Read-only, bounded, secret-free.
 *
 * [B16-A F12] every durable subject also carries an integrity verdict: a
 * record whose stored digest no longer matches its payload is reported as
 * `corrupt` with its bounded code — never silently as "absent".
 * [B16-A F14] the summary names the trusted viewer's role/kind and whether
 * that viewer may authorize a release (mirrors the release route's refusal;
 * informational — the release route stays the enforcement point).
 */
export type PcbSyncManufacturingIntegrityState = "ok" | "absent" | "corrupt";
/** The server-derived actor a board read is computed for (from the trusted context — never a header). */
export interface PcbSyncManufacturingViewer { role: string; actorKind: string }
export interface PcbSyncManufacturingSummary {
  /** [B16.1C] the durable schematic snapshot head for the project's primary design/variant — the `expectedSnapshotRevision` a fresh browser must publish against. */
  snapshot: null | { revision: number; snapshotDigest: string; schematicRevision: string; schematicDigest: string };
  authority: null | { revision: number; recordDigest: string; boardRevision: string; boardDigest: string; schematicRevision: string; schematicDigest: string; componentAuthorityDigest: string; fabricationProfileId: string; qualifiedAt: string; actor: string; current: boolean };
  latestRelease: null | { releaseId: string; archiveSha256: string; manifestContentDigest: string; filename: string; authorityRecordDigest: string; authorityRevision: number; boardRevision: string; actor: string; releasedAt: string; current: boolean };
  /** [B16-A F12] per-subject verification state; `codes` lists the bounded error codes observed (never a message or stack). A `corrupt` subject is reported as null above with `current` false. */
  integrity: { authority: PcbSyncManufacturingIntegrityState; snapshot: PcbSyncManufacturingIntegrityState; latestRelease: PcbSyncManufacturingIntegrityState; codes: string[] };
  /** [B16-A F14] the trusted viewer and whether it may authorize a release (human project administrator only). */
  viewer: { role: string; actorKind: string; canRelease: boolean }; /** [B23-B3] the provider observations (external, never Sirkit proof), present only when the route composes their reader */ observations?: PcbSyncManufacturingObservations;
}
export type PcbSyncManufacturingSummaryReader = (scope: { tenantId: string; projectId: string; branchId: string; boardId: string }, current: { revision: string; digest: string; board: PcbBoard; superseded?: boolean } | null, viewer?: PcbSyncManufacturingViewer) => Promise<PcbSyncManufacturingSummary>; // [B23-B3] + board (its authoritative digest is recomputed, D23-17) and its lineage state

export function createPcbSyncBoardGetCore(repository: PcbSyncRepository, featureState: () => PcbSyncFeatureState, manufacturing?: PcbSyncManufacturingSummaryReader, lineage?: DurableBoardLineageStore) {
  // [B16-A F14] `viewer` is the route's trusted actor projection (role + kind); it only ever reaches the summary reader.
  return async function loadBoard(scope: { tenantId: string; projectId: string; branchId: string }, query: Readonly<Record<string, string>>, viewer?: PcbSyncManufacturingViewer): Promise<Response> {
    const state = featureState();
    try {
      const allowed = new Set(["boardId", "knownRevision", "knownDigest", "include"]);
      if (Object.keys(query).some((key) => !allowed.has(key))) fail("PS_API_UNKNOWN_FIELD");
      const boardId = id(query.boardId, "PS_BOARD_ID_INVALID"), knownRevision = query.knownRevision ?? null, knownDigest = query.knownDigest ?? null;
      if (knownRevision !== null) id(knownRevision, "PS_BOARD_REVISION_INVALID"); if (knownDigest !== null) id(knownDigest, "PS_BOARD_DIGEST_INVALID");
      const include = query.include ?? null;
      if (include !== null && include !== "manufacturing") fail("PS_API_UNKNOWN_FIELD");
      const includeManufacturing = include === "manufacturing";
      if (includeManufacturing && !manufacturing) fail("PS_API_UNKNOWN_FIELD");
      const boardScope = { tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId, boardId }, record = await repository.getBoard(boardScope);
      // [B16-C.1] which revision of this board's lineage is current — a superseded board tells the browser where to go.
      const lineageSummary = lineage ? await lineage.resolveCurrent(boardScope, boardId) : undefined;
      const common = { resultSchemaVersion: PCB_SYNC_BOARD_LOAD_RESULT_VERSION, scope: boardScope, ...(lineageSummary ? { lineage: lineageSummary } : {}) };
      if (!record) {
        const result: PcbSyncBoardLoadResult = { ...common, status: "not_found" };
        const summary = includeManufacturing ? await manufacturing!(boardScope, null, viewer) : undefined;
        return Response.json({ ok: true, operation: "load_board", boardChanged: false, result, ...(summary ? { manufacturing: summary } : {}) }, { status: 404, headers: { "Cache-Control": "no-store", "X-Sirkit-Pcb-Sync-State": state } });
      }
      const rebuilt = makeBoardRecord({ ...boardScope, board: record.board, updatedAt: record.updatedAt });
      if (rebuilt.revision !== record.revision || rebuilt.digest !== record.digest) fail("PS_BOARD_RECORD_DIGEST_MISMATCH");
      const conditional = (knownRevision !== null || knownDigest !== null) && (knownRevision === null || knownRevision === record.revision) && (knownDigest === null || knownDigest === record.digest);
      const result: PcbSyncBoardLoadResult = conditional ? { ...common, status: "not_modified" } : { ...common, status: "found", record };
      const summary = includeManufacturing ? await manufacturing!(boardScope, { revision: record.revision, digest: record.digest, board: record.board, superseded: lineageSummary?.state === "superseded" }, viewer) : undefined; // [B23-B3] the loaded board and its lineage state reach the summary
      return Response.json({ ok: true, operation: "load_board", boardChanged: false, result, ...(summary ? { manufacturing: summary } : {}) }, { headers: { "Cache-Control": "no-store", "X-Sirkit-Pcb-Sync-State": state } });
    } catch (error) { return errorResponse(error); }
  };
}

/** Legacy Request adapter over the core (standing tests): authorizes through
 *  `pcbSyncScope` and preserves the historical duplicated-query-key refusal. */
export function createPcbSyncBoardGetHandler(repository: PcbSyncRepository, featureState: () => PcbSyncFeatureState) {
  const core = createPcbSyncBoardGetCore(repository, featureState);
  return async function get(request: Request): Promise<Response> {
    const authorized = await pcbSyncScope(request); if (!authorized.ok) return authorized.response;
    try {
      const url = new URL(request.url), allowed = new Set(["boardId", "knownRevision", "knownDigest"]);
      if ([...url.searchParams.keys()].some((key) => !allowed.has(key)) || [...allowed].some((key) => url.searchParams.getAll(key).length > 1)) fail("PS_API_UNKNOWN_FIELD");
      const query: Record<string, string> = {};
      for (const key of allowed) { const value = url.searchParams.get(key); if (value !== null) query[key] = value; }
      return await core(authorized.scope, query);
    } catch (error) { return errorResponse(error); }
  };
}

/** [B23-B3] The provider observations beside the board read (runbook B23-B steps 6-8; OD-168, OD-169): each an external observation,
 *  never Sirkit proof, judged stale or current at this read; `state` and `codes` follow the summary's one read policy. */
export interface PcbSyncManufacturingObservations { state: PcbSyncManufacturingIntegrityState; codes: string[]; items: ManufacturingObservationView[]; omitted: number }
