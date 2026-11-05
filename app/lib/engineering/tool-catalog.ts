/**
 * B04 — the initial Sirkit tool catalog, classified TRUTHFULLY:
 *
 *  - `callable` appears ONLY where a real, reusable, named implementation is
 *    proven in this repository (module + symbol in the binding). Route-local
 *    structured outputs and schema-only declarations are NOT shared tools.
 *  - Migrated PCB mutations are runtime-executable for the trusted editor
 *    session (B03) but remain `agentExposed: false`.
 *  - Canonical undo/redo is internal-only and never discoverable.
 *  - Manufacturing release stays API-only under the MFG01 gate.
 *  - Surfaces without a proven reusable tool adapter are registered as
 *    non-callable so the gap is visible instead of silently absent
 *    (pcb.dimension itself is implemented and active since B08 — see its
 *    descriptor).
 *  - B09 exposes to the assistant-agent channel ONLY the read tools whose
 *    allowlisted B05/B05.1 bindings the chat run-context assembler can
 *    actually satisfy, plus the sealed tier-1 schematic PROPOSAL tool
 *    (proposal-artifact side effects only — applying stays a human-only
 *    destructive command). Everything else remains agentExposed: false with
 *    its exact blocker recorded in the B09 activation audit.
 */

import { ToolRegistry, type JsonSchema, type ToolDescriptor } from "./tool-registry";
import { VIEW_TOOL_ENUMS } from "../agent/view-context";

const OWNER = "ai-control-plane";

const obj = (properties: Record<string, unknown> = {}, required: string[] = []): JsonSchema => ({
  type: "object",
  additionalProperties: false,
  properties,
  ...(required.length > 0 ? { required } : {}),
});

const OUT_REPORT: JsonSchema = obj({ report: { type: "object" } }, ["report"]);
const OUT_RESULT: JsonSchema = obj({ result: { type: "object" } }, ["result"]);
/** [B17-F] a report plus the sealed resource refs it was answered from (inspection provenance, never authority). */
const OUT_PINNED_REPORT: JsonSchema = obj({ report: { type: "object" }, pinned: { type: "object" } }, ["report", "pinned"]);


/** Shared invariants for canonical-executor mutations (B03 slice). */
const canonicalMutation = {
  requiresExpectedRevision: true,
  idempotency: "required-key" as const,
  requiresLineage: true,
  sideEffects: "engineering-state" as const,
  discovery: "discoverable" as const,
  callability: "callable" as const,
  agentExposed: false,
  budgetClass: "interactive" as const,
  audit: "change-set" as const,
  validationStrategy: "legacy edit validator, then canonical operation validation (locks, existence, integer nm)",
  verificationStrategy: "canonical change-set digests + derived-artifact invalidation",
  lifecycle: "active" as const,
  requiredAuthority: ["local-working-copy"] as const,
  requiredProjectState: ["board-present"] as const,
  owner: OWNER,
};

const readDefaults = {
  sideEffects: "none" as const,
  approvalTier: "none" as const,
  requiresExpectedRevision: false,
  idempotency: "natural" as const,
  requiresLineage: false,
  agentExposed: false,
  budgetClass: "interactive" as const,
  audit: "none-read-only" as const,
  lifecycle: "active" as const,
  requiredSelectionKinds: [] as const,
  owner: OWNER,
};

// ── [B17-F] view-session tools: bus commands the BROWSER executes; never engineering state ──
const ALL_ROLES = ["viewer", "commenter", "pcb_editor", "reviewer", "project_admin"] as const;
/** A semantic view target (targets.ts): a stable identity or the versioned selection — never a screen coordinate. */
const TARGET: JsonSchema = obj({
  kind: { type: "string", enum: ["component", "object", "net", "point", "selection", "primary"], description: "component: by reference designator or id (ref); object: one board object (objectKind + objectId, or pad: footprintId + padNumber); net: by netId or name; point: world units (x, y); selection / primary: the user's CURRENT selection — refused when stale or empty" },
  ref: { type: "string" },
  objectKind: { type: "string", enum: ["footprint", "track", "via", "zone", "text", "dimension", "pad"] },
  objectId: { type: "string" },
  footprintId: { type: "string" },
  padNumber: { type: "string" },
  netId: { type: "number" },
  name: { type: "string" },
  x: { type: "number" },
  y: { type: "number" },
}, ["kind"]);
const OUT_VIEW_COMMAND: JsonSchema = obj({ dispatched: { type: "boolean" }, editor: { type: "string" }, commandId: { type: "string" }, expectedViewRevision: { type: "number" } }, ["dispatched", "editor", "commandId", "expectedViewRevision"]);
const viewSession = {
  ...readDefaults,
  category: "view" as const,
  operationClass: "view-session" as const,
  sideEffects: "session-state" as const,
  requiredCapability: "read_project" as const,
  requiredRoles: ALL_ROLES,
  requiredAuthority: ["none"] as const,
  discovery: "discoverable" as const,
  callability: "callable" as const,
  agentExposed: true,
  audit: "event-log" as const,
  timeoutMs: 5_000,
  validationStrategy: "server: registry command list + captured surface + role + the bus command's own exact payload validation; browser: the bus's stale-revision rule, role gate and session scoping",
  verificationStrategy: "the browser bus settles the command and reports the resulting view revision to the user; the model receives only that the request was dispatched",
  versionNotes: "B17-F: a bus-command tool over the B17-B view-session bus.",
};

export const SIRKIT_TOOL_CATALOG: readonly ToolDescriptor[] = Object.freeze([
  // ── Project / revision inspection ─────────────────────────────────────────
  {
    ...readDefaults,
    toolId: "sirkit.project.canonical-revision-inspect", version: "1.0.0",
    agentExposed: true, // B09 — statically exposed; per-run availability requires the canonical-state resource
    owningCommandId: "project.hydrate",
    title: "Inspect canonical project revision",
    description: "Compute the canonical ProjectRevision (state digest + per-domain revisions) for a canonical project state.",
    category: "project", operationClass: "read",
    inputSchema: obj({}), outputSchema: obj({ revision: { type: "object" } }, ["revision"]),
    requiredCapability: "read_project", requiredRoles: ["viewer", "commenter", "pcb_editor", "reviewer", "project_admin"],
    requiredProjectState: [], requiredAuthority: ["local-working-copy", "durable-server-board"],
    binding: { status: "bound-read", module: "app/lib/engineering/revision.ts", symbol: "computeProjectRevision" },
    discovery: "discoverable", callability: "callable",
    timeoutMs: 2_000,
    validationStrategy: "typed canonical state input", verificationStrategy: "deterministic digest recomputation",
    sourceEvidence: ["app/lib/engineering/revision.ts", "artifacts/ai-control-plane-b02/README.md"],
    versionNotes: "B04 initial registration; B09: agent-exposed (activated read binding; requires the verified canonical-state run resource — withheld per run when it is absent; pre-B10 browser chat supplies no board, so this read is withheld there). B20-B3: durable-server-board declared (served over MCP from the durable board)",
  },
  {
    ...readDefaults,
    toolId: "sirkit.pcb.revision-inspect", version: "1.0.0",
    agentExposed: true, // B09 — statically exposed; per-run availability requires the canonical-state resource
    owningCommandId: "pcb.sync-durable",
    title: "Inspect semantic board revision",
    description: "Compute the pcb2 semantic content revision of a PCB board (UI and history state excluded by construction).",
    category: "pcb", operationClass: "read",
    inputSchema: obj(), outputSchema: obj({ revision: { type: "string" } }, ["revision"]),
    requiredCapability: "read_project", requiredRoles: ["viewer", "commenter", "pcb_editor", "reviewer", "project_admin"],
    requiredProjectState: ["board-present"], requiredAuthority: ["local-working-copy", "durable-server-board"],
    binding: { status: "bound-read", module: "app/lib/pcb/revision.ts", symbol: "pcbRevisionId" },
    discovery: "discoverable", callability: "callable",
    timeoutMs: 2_000,
    validationStrategy: "typed board input", verificationStrategy: "deterministic content-addressed identity",
    sourceEvidence: ["app/lib/pcb/revision.ts"],
    versionNotes: "B04 initial registration; B09: agent-exposed (activated read binding; requires the verified canonical-state run resource — withheld per run when it is absent; pre-B10 browser chat supplies no board, so this read is withheld there).",
  },
  // ── Schematic inspection ──────────────────────────────────────────────────
  {
    ...readDefaults,
    toolId: "sirkit.schematic.inspect", version: "1.2.0",
    agentExposed: true, // B09 — statically exposed; per-run availability requires the canonical-state resource
    owningCommandId: "schematic.review-advisory",
    title: "Inspect schematic state",
    description: "Read the current schematic: component list (display refs, types, values, positions), wire/net-label counts, and the schematic digest. Example input: {} for the whole project (every sheet's parts in one list, as before); {\"sheetId\":\"root\"} for the overview with the sheet tree (each sheet's id, name, parent, path, component count and ports with their bound state); {\"sheetId\":\"sheet-imu\"} for ONE sheet's components, local labels, ports and child blocks (bounded); {\"sheetId\":\"sheet-imu\",\"neighbours\":true} also fetches the other sheets' ports the connectivity authority joins to its ports. An unknown sheetId answers the tree and a diagnostic, never a guess.",
    category: "schematic", operationClass: "read",
    inputSchema: obj({ sheetId: { type: "string", description: "Optional: one sheet's id (the tree lists them; \"root\" is the overview). Omitted: the whole project." }, neighbours: { type: "boolean", description: "Optional, with sheetId: fetch the other sheets' ports joined to this sheet's ports (an explicit neighbour read)." } }), outputSchema: OUT_REPORT, // [PR-J5, 2026-10-23] 1.2.0: sheetId / neighbours (runbook J.6.7, OD-259)
    requiredCapability: "read_project", requiredRoles: ["viewer", "commenter", "pcb_editor", "reviewer", "project_admin"],
    requiredProjectState: ["schematic-present"], requiredAuthority: ["local-working-copy"],
    binding: { status: "bound-read", module: "app/lib/engineering/schematic-read.ts", symbol: "inspectSchematicState", notes: "B09/B09.3: the ONLY invocation path is the registered B05/B05.1 read binding consuming the verified canonical-state resource (whose envelope carries the authoritative schematic snapshot, B07.3); without a complete validated canonical project resource the tool is withheld — no snapshot bypass exists." },
    discovery: "discoverable", callability: "callable",
    timeoutMs: 2_000,
    validationStrategy: "structural schematic-shape validation (fails closed on malformed snapshots)",
    verificationStrategy: "deterministic sorted projection + schematic digest",
    sourceEvidence: ["app/lib/engineering/schematic-read.ts", "app/lib/engineering/schematic-model.ts"],
    versionNotes: "1.2.0 (PR-J5, 2026-10-23; runbook J.6.7, OD-259): sheet-aware on request - sheetId answers ONE sheet's components, labels, ports and child blocks beside the sheet tree (sheetId root: the overview and the tree); neighbours fetches the joined ports through the project connectivity authority; a read without options is byte-identical to 1.1.0 for every document, multi-sheet included. 1.1.0 (B09): bound to the reusable pure accessor and agent-exposed; output carries the schematic digest. B09.3: canonical-state binding is the only path (the B09.2 boardless gateway bypass was removed).",
  },
  {
    ...readDefaults,
    toolId: "sirkit.schematic.propose-tier1-edit", version: "1.1.0",
    agentExposed: true, // B09 — sealed proposal artifact only; apply stays human-only
    owningCommandId: "schematic.edit-tier1-propose",
    title: "Propose schematic tier-1 edit",
    description: "Compile 1-20 set-value / rename / delete operations against the CURRENT schematic into a sealed, digest-pinned proposal. Receiving the proposal changes nothing; the user must explicitly apply it in the review UI.",
    category: "schematic", operationClass: "propose",
    sideEffects: "proposal-artifact",
    inputSchema: obj({
      ops: {
        type: "array",
        // 1-20 ops enforced at runtime (parseOps): strict provider modes
        // reject minItems/maxItems keywords on the wire.
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            op: { type: "string", enum: ["set-value", "rename", "delete"] },
            target: { type: "string", description: "The component display reference (Build refDes or Theory id) as shown in the schematic." },
            value: { type: "string", description: "New value for set-value." },
            refDes: { type: "string", description: "New reference designator for rename." },
          },
          required: ["op", "target"],
        },
      },
    }, ["ops"]),
    outputSchema: obj({ result: { type: "object" } }, ["result"]),
    requiredCapability: "read_project", requiredRoles: ["pcb_editor", "reviewer", "project_admin"],
    requiredProjectState: ["schematic-present"], requiredAuthority: ["local-working-copy"],
    requiresExpectedRevision: true,
    // [B09.3] the sealed artifact is lineage-sealed (the head mark's
    // lineageId participates in the identity digest), so discovery
    // truthfully requires an open lineage anchor.
    requiresLineage: true,
    binding: { status: "bound-proposal", module: "app/lib/engineering/schematic-plans.ts", symbol: "compileTier1Proposal", notes: "B09: compiles all-or-nothing and seals via sealTier1Proposal; the sealed artifact only enters the existing Apply-exact-proposal review boundary." },
    discovery: "discoverable", callability: "callable",
    timeoutMs: 5_000,
    validationStrategy: "strict op schema; deterministic all-or-nothing tier-1 compiler (unknown target, theory rename, or missing pin data blocks the WHOLE proposal)",
    verificationStrategy: "sealed base/operations/identity digests re-verified at explicit apply time (verifySealedTier1Proposal)",
    sourceEvidence: ["app/lib/engineering/schematic-plans.ts", "app/lib/engineering/schematic-proposals.ts", "app/lib/agent/gateway.ts"],
    versionNotes: "1.1.0 (B09.1/B09.2): the sealed artifact is the V2 SCOPE/HEAD contract (sirkit.schematic-tier1-proposal.v2) — tenant/project/branch + canonical head mark participate in the identity digest; sealing requires a validated canonical mark and the effective actor to hold the required capability.",
  },
  {
    ...readDefaults,
    toolId: "sirkit.schematic.propose-component-replacement", version: "1.0.0",
    agentExposed: true, // B14 — sealed replacement proposal ONLY; apply stays human-only and is never provider-callable
    owningCommandId: "schematic.replace-component-propose",
    title: "Propose exact component replacement",
    description: "Propose replacing ONE KiCad component instance with its server-verified exact target (from durable component authority). The input identifies intent only — the target identity, pins, and mapping are derived server-side. Receiving the sealed proposal changes NOTHING; a human must review and explicitly apply it.",
    category: "schematic", operationClass: "propose",
    sideEffects: "proposal-artifact",
    inputSchema: obj({
      componentId: { type: "string", description: "The stable KiCad component instance id (NOT the display refDes) of the component to replace." },
      expectedMpn: { type: "string", description: "Optional expected exact MPN. An assertion only — it must equal the server-owned verified target and never chooses it." },
    }, ["componentId"]),
    outputSchema: obj({ result: { type: "object" } }, ["result"]),
    requiredCapability: "read_project", requiredRoles: ["pcb_editor", "reviewer", "project_admin"],
    requiredProjectState: ["schematic-present"], requiredAuthority: ["durable-server-board", "local-working-copy"],
    requiresExpectedRevision: true,
    requiresLineage: true,
    binding: { status: "bound-proposal", module: "app/lib/engineering/replacement-proposal-assembler.ts", symbol: "assembleReplacementProposal", notes: "B14: server-owned authority + published pin facts + the ONE planSchematicReplacement algorithm; exact-pin-identity mapping corroborated by the approved mapping certificate; zero dropped connected pins; the sealed artifact only enters the B14 replacement review boundary. The proposal-time runtime grant is retired before the artifact leaves the server." },
    discovery: "discoverable", callability: "callable",
    timeoutMs: 10_000,
    validationStrategy: "strict {componentId, expectedMpn?} input (never asset identities, pins, authority, approvals, or dropped-pin acknowledgements); verified-exact server authority + published current/target pin facts required; structured blockers otherwise",
    verificationStrategy: "sealed operation/impact/identity digests re-verified at explicit apply time (verifySealedReplacementProposal) with fresh server authority, recompiled-plan byte-match, and a fresh runtime grant",
    sourceEvidence: ["app/lib/engineering/replacement-proposal-assembler.ts", "app/lib/engineering/replacement-proposals.ts", "app/lib/agent/gateway.ts"],
    versionNotes: "1.0.0 (B14): first agent-assisted exact-replacement proposal; per-run availability requires the canonical head mark AND the server-owned component-authority-records resource.",
  },
  {
    ...readDefaults,
    toolId: "sirkit.pcb.propose-bounded-edit", version: "1.0.0",
    agentExposed: true, // B15.3 — sealed bounded PCB proposal ONLY; apply stays human-only inside PcbEditor and is never provider-callable
    owningCommandId: "pcb.bounded-edit-propose",
    title: "Propose bounded PCB edits",
    description: "Compile 1-16 bounded PCB operations (move/rotate footprint, add/update track or via, routing preference, net-class rule, dimension, routing keepout) against the CURRENT board into a sealed, digest-pinned proposal. Deletions and destructive operations are excluded. The input carries intent and operations ONLY — the board, rules, scope, and every digest are server-derived. Receiving the sealed proposal changes NOTHING; a human must review and explicitly approve it in the PCB editor, and manufacturing readiness stays unavailable.",
    category: "pcb", operationClass: "propose",
    sideEffects: "proposal-artifact",
    // Wire-level shape guidance ONLY. The runtime authority is the canonical
    // `parseBoundedEditRequest` (closed per-kind key sets, exact bounds,
    // 32,768-byte payload ceiling); runtime bounds live server-side because
    // strict provider modes reject minItems/maxItems/maxLength keywords.
    inputSchema: obj({
      intent: { type: "string", description: "One-line engineering intent for the whole bounded proposal (max 240 chars)." },
      operations: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            kind: { type: "string", enum: ["move_footprint", "rotate_footprint", "add_track", "update_track", "add_via", "update_via", "set_routing_preference", "set_net_class_rule", "add_dimension", "update_dimension", "remove_dimension", "add_keepout", "update_keepout"] },
            footprintId: { type: "string" }, trackId: { type: "string" }, viaId: { type: "string" },
            dimensionId: { type: "string" }, keepoutId: { type: "string" }, padstackId: { type: "string" },
            viaPadstackId: { type: "string" }, name: { type: "string" }, layer: { type: "string" },
            layers: { type: "array", items: { type: "string" } },
            netId: { type: "number" }, netIds: { type: "array", items: { type: "number" } },
            widthNm: { type: "number" }, sizeNm: { type: "number" }, drillNm: { type: "number" },
            rotationDeg: { type: "number" }, offsetNm: { type: "number" }, textHeightNm: { type: "number" },
            strokeWidthNm: { type: "number" }, trackWidthNm: { type: "number" }, clearanceNm: { type: "number" },
            viaSizeNm: { type: "number" }, viaDrillNm: { type: "number" }, customTrackWidthNm: { type: "number" },
            precision: { type: "number" },
            dimensionKind: { type: "string", enum: ["aligned", "horizontal", "vertical"] },
            unit: { type: "string", enum: ["mm", "in"] },
            routeMode: { type: "string", enum: ["highlight_stop", "walk_around", "shove"] },
            posture: { type: "string", enum: ["orthogonal", "octilinear_a", "octilinear_b", "arbitrary"] },
            to: { type: "object", additionalProperties: false, properties: { x: { type: "number" }, y: { type: "number" } }, required: ["x", "y"] },
            at: { type: "object", additionalProperties: false, properties: { x: { type: "number" }, y: { type: "number" } }, required: ["x", "y"] },
            start: { type: "object", additionalProperties: false, properties: { x: { type: "number" }, y: { type: "number" } }, required: ["x", "y"] },
            end: { type: "object", additionalProperties: false, properties: { x: { type: "number" }, y: { type: "number" } }, required: ["x", "y"] },
            a: { type: "object", additionalProperties: false, properties: { x: { type: "number" }, y: { type: "number" } }, required: ["x", "y"] },
            b: { type: "object", additionalProperties: false, properties: { x: { type: "number" }, y: { type: "number" } }, required: ["x", "y"] },
            polygon: { type: "array", items: { type: "object", additionalProperties: false, properties: { x: { type: "number" }, y: { type: "number" } }, required: ["x", "y"] } },
            forbidTracks: { type: "boolean" }, forbidVias: { type: "boolean" },
          },
          required: ["kind"],
        },
      },
    }, ["intent", "operations"]),
    outputSchema: obj({ result: { type: "object" } }, ["result"]),
    requiredCapability: "read_project", requiredRoles: ["pcb_editor", "reviewer", "project_admin"],
    // approvalTier stays "none" (readDefaults), exactly like both schematic
    // propose tools: SEALING requires no approval — it mints a display-only
    // artifact. The topology-or-geometry tier lives on the sealed ARTIFACT
    // and on the pcb.bounded-edit-apply action, enforced by the human-gated
    // apply boundary.
    requiredProjectState: ["board-present"], requiredAuthority: ["local-working-copy"],
    requiresExpectedRevision: true,
    // The discovery lineage anchor is the SCHEMATIC session lineage (B09.3
    // digest-domain separation) — the PCB proposal's lineage binding is the
    // PCB canonical session lineage, enforced by its own `pcbProposalBasis`
    // prerequisite (loop + gateway fail closed without it), sealed into
    // `base.lineageId`, and re-verified at the human-approved apply. So this
    // stays false: a schematic lineage is truthfully NOT required.
    requiresLineage: false,
    binding: { status: "bound-proposal", module: "app/lib/pcb/proposal/pcb-propose-tool-handler.ts", symbol: "handlePcbProposeTool", notes: "B15.3: strict {intent, operations} only; board/scope/resource/history-basis/validation-policy are derived from the verified run context; compiles through the ONE B15 bounded compiler and seals via createSealedPcbEditProposal (never the raw sealer); the sealed artifact only enters the human-gated PCB review boundary inside PcbEditor." },
    discovery: "discoverable", callability: "callable",
    timeoutMs: 10_000,
    validationStrategy: "canonical parseBoundedEditRequest (closed per-kind schemas, <=16 ops, exact 32,768-byte ceiling, excluded destructive intents) + full bounded compile: structure, geometry (exact BigInt outline), locks, rules floors, DRC no-regression, connectivity no-regression, canonical expressibility",
    verificationStrategy: "sealed operations/candidate/impact/policy digests re-verified structurally on receipt (verifySealedPcbEditProposalIntegrity) and re-verified against LIVE state with full recompile + byte-match at the human-approved apply position",
    sourceEvidence: ["app/lib/pcb/proposal/pcb-propose-tool-handler.ts", "app/lib/pcb/proposal/pcb-edit-proposal-service.ts", "app/lib/pcb/proposal/bounded-edit-compiler.ts", "app/lib/agent/gateway.ts"],
    versionNotes: "1.0.0 (B15.3): first exposure. The B15-B15.2.3 core (bounded operations, compiler, sealed proposal, closed impact certificate, sealed validation policy) predates exposure; no wire compatibility is owed to any pre-exposure shape.",
  },
  // ── PCB inspection (PCBToolService — proven reusable implementation) ──────
  {
    ...readDefaults,
    toolId: "sirkit.pcb.board-inspect", version: "1.1.0",
    agentExposed: true, // B09 — statically exposed; per-run availability requires the canonical-state resource
    owningCommandId: "pcb.board-repair",
    title: "Inspect board snapshot",
    description: "Build the versioned exact AI PCB snapshot (millimeters) for the current board: the outline, every footprint (position, bounds, stable id, and whether it is a mounting hole — a footprint whose pads are all non-plated holes), pads, nets and validations.",
    category: "pcb", operationClass: "read",
    // [B09.1] length bounds live in server-side input validation (B05
    // DEFAULT_INPUT_LIMITS), never in wire schemas (strict provider modes
    // reject maxLength/maxItems keywords).
    inputSchema: obj({ projectId: { type: "string" } }), outputSchema: obj({ snapshot: { type: "object" } }, ["snapshot"]),
    requiredCapability: "read_project", requiredRoles: ["viewer", "commenter", "pcb_editor", "reviewer", "project_admin"],
    requiredProjectState: ["board-present"], requiredAuthority: ["local-working-copy", "durable-server-board"],
    binding: { status: "bound-read", module: "app/lib/pcb/ai/snapshot.ts", symbol: "buildAIPcbSnapshot", notes: "B05 audit: bound to the pure snapshot builder directly; PCBToolService wraps it with session state the read layer does not need." },
    discovery: "discoverable", callability: "callable",
    timeoutMs: 10_000,
    validationStrategy: "snapshot options schema", verificationStrategy: "snapshot pinned to the source revision; wall-clock generatedInMs normalized to 0",
    sourceEvidence: ["app/lib/pcb/ai/snapshot.ts", "app/lib/engineering/tool-bindings-readonly.ts"],
    versionNotes: "B04 initial registration; B09: agent-exposed (activated read binding; requires the verified canonical-state run resource — withheld per run when it is absent; pre-B10 browser chat supplies no board, so this read is withheld there); B18-E E10: every footprint carries `mountingHole` (OD-21: it has pads and they are ALL non-plated holes) — a classification of pads the snapshot already lists, so no new geometry and no new authority. B20-B3: durable-server-board declared (served over MCP from the durable board)",
  },
  {
    // [B18-E E11] The BOUNDED mechanical read. The full snapshot above is the whole board and, measured on the browser
    // journey's synchronized board, exceeds the loop's 60,000-character result budget — the model receives
    // `output_too_large_for_model` and cannot plan a dimension at all. This read answers only what a dimension needs.
    ...readDefaults,
    toolId: "sirkit.pcb.mechanical-inspect", version: "1.0.0",
    agentExposed: true,
    owningCommandId: "pcb.board-repair",
    title: "Inspect board extents and mounting holes",
    description: "Read the board's MECHANICAL facts only, in millimetres: the outline (kind, origin, width, height, and up to 64 vertices with the true vertex count) and every mounting hole (a footprint whose pads are all non-plated holes) with its stable id, reference, position and bounds. Use this to place dimensions; it carries no nets, tracks, pads, zones or validations, so it stays within the model's result budget on boards whose full snapshot does not.",
    category: "pcb", operationClass: "read",
    inputSchema: obj({}), outputSchema: obj({ mechanical: { type: "object" } }, ["mechanical"]),
    requiredCapability: "read_project", requiredRoles: ["viewer", "commenter", "pcb_editor", "reviewer", "project_admin"],
    requiredProjectState: ["board-present"], requiredAuthority: ["local-working-copy", "durable-server-board"],
    binding: { status: "bound-read", module: "app/lib/pcb/ai/mechanical.ts", symbol: "buildMechanicalSnapshot", notes: "Pure builder over the verified canonical board; no session state, no timing, no authority." },
    discovery: "discoverable", callability: "callable",
    timeoutMs: 10_000,
    validationStrategy: "empty input schema", verificationStrategy: "derived from the canonical board revision; sizes bounded by the outline vertex cap and the mounting-hole count",
    sourceEvidence: ["app/lib/pcb/ai/mechanical.ts", "app/lib/engineering/tool-bindings-readonly.ts"],
    versionNotes: "1.0.0 (B18-E E11): first exposure, reviewed in `agent-exposure.ts`. It states nothing the full snapshot did not already state; it exists because the full snapshot does not fit in a tool result on a real board. B20-B3: durable-server-board declared (served over MCP from the durable board)",
  },
  {
    // [B18-E E13] The BOUNDED via read. Vias exist only on a ROUTED board, where the full snapshot exceeds the model's
    // result budget — and even where it fits it strips the padstack binding, the fact that decides whether a size/drill
    // change is possible at all. This read carries that fact and the library a bound via can be retargeted onto.
    ...readDefaults,
    toolId: "sirkit.pcb.via-inspect", version: "1.0.0",
    agentExposed: true,
    owningCommandId: "pcb.board-repair",
    title: "Inspect the vias on a net",
    description: "Read a board's VIA facts only, in millimetres: every net that carries vias (name and count, so a net name can be resolved or truthfully found absent), the named net's vias (stable id, position, diameter, drill, layer span, locked, and the padstack each is bound to), and every via padstack the board has. A via bound to a padstack takes its size and drill FROM that padstack: changing them is refused, and the only proposable route is retargeting onto a padstack in this list — creating one is a human step in the editor. The net name is matched exactly; nothing is guessed. Carries no tracks, pads, zones, footprints or validations.",
    category: "pcb", operationClass: "read",
    // [B09.1] length bounds live in server-side input validation (B05 DEFAULT_INPUT_LIMITS), never in wire schemas.
    inputSchema: obj({ netName: { type: "string" } }), outputSchema: obj({ vias: { type: "object" } }, ["vias"]),
    requiredCapability: "read_project", requiredRoles: ["viewer", "commenter", "pcb_editor", "reviewer", "project_admin"],
    requiredProjectState: ["board-present"], requiredAuthority: ["local-working-copy", "durable-server-board"],
    binding: { status: "bound-read", module: "app/lib/pcb/ai/vias.ts", symbol: "buildViaSnapshot", notes: "Pure builder over the verified canonical board; no session state, no timing, no authority." },
    discovery: "discoverable", callability: "callable",
    timeoutMs: 10_000,
    validationStrategy: "optional netName string", verificationStrategy: "derived from the canonical board revision; sizes bounded by the net, via and padstack caps, each reported beside its true count",
    sourceEvidence: ["app/lib/pcb/ai/vias.ts", "app/lib/engineering/tool-bindings-readonly.ts"],
    versionNotes: "1.0.0 (B18-E E13): first exposure, reviewed in `agent-exposure.ts`. The vias and net names are already in the full snapshot; the padstack binding and the padstack library are NEW to the agent's view — read-only facts about the user's own board, and the only way a via proposal can be planned instead of discovered by refusal. B20-B3: durable-server-board declared (served over MCP from the durable board)",
  },
  {
    ...readDefaults,
    toolId: "sirkit.validation.drc-run", version: "1.0.0",
    agentExposed: true, // B09 — statically exposed; per-run availability requires the canonical-state resource
    owningCommandId: "validation.erc-drc",
    title: "Run design-rule check",
    description: "Run the native DRC engine against the current board without changing it.",
    category: "validation", operationClass: "read",
    inputSchema: obj(), outputSchema: obj({ report: { type: "object" }, pinned: { type: "object" } }, ["report", "pinned"]),
    sideEffects: "derived-cache",
    requiredCapability: "read_project", requiredRoles: ["viewer", "commenter", "pcb_editor", "reviewer", "project_admin"],
    requiredProjectState: ["board-present"], requiredAuthority: ["local-working-copy", "durable-server-board"],
    binding: { status: "bound-read", module: "app/lib/pcb/drc/run-drc.ts", symbol: "runDrc" },
    discovery: "discoverable", callability: "callable",
    timeoutMs: 30_000, budgetClass: "batch",
    validationStrategy: "board + rule-set inputs", verificationStrategy: "report interpreted against the source board revision",
    sourceEvidence: ["app/lib/pcb/drc/run-drc.ts", "app/components/pcb/DrcPanel.tsx"],
    versionNotes: "B04 initial registration; B09: agent-exposed (activated read binding; requires the verified canonical-state run resource — withheld per run when it is absent; pre-B10 browser chat supplies no board, so this read is withheld there). B20-B3: durable-server-board declared (served over MCP from the durable board)",
  },
  {
    ...readDefaults,
    toolId: "sirkit.validation.connectivity-verify", version: "1.0.0",
    agentExposed: true, // B09 — statically exposed; per-run availability requires the canonical-state resource
    owningCommandId: "validation.erc-drc",
    title: "Verify connectivity",
    description: "Reconstruct exact pad/track/via/zone connectivity and report incomplete nets, airwires, and shorts.",
    category: "validation", operationClass: "read",
    inputSchema: obj(), outputSchema: OUT_REPORT,
    requiredCapability: "read_project", requiredRoles: ["viewer", "commenter", "pcb_editor", "reviewer", "project_admin"],
    requiredProjectState: ["board-present"], requiredAuthority: ["local-working-copy", "durable-server-board"],
    binding: { status: "bound-read", module: "app/lib/pcb/connectivity-board.ts", symbol: "computeConnectivity", notes: "B05 audit: computeConnectivity is the pure board-level connectivity engine; electrical-truth composes additional netlist context this read does not require." },
    discovery: "discoverable", callability: "callable",
    timeoutMs: 10_000,
    validationStrategy: "typed board input", verificationStrategy: "not fabrication readiness by itself (explicit); nets sorted deterministically",
    sourceEvidence: ["app/lib/pcb/connectivity-board.ts", "app/lib/engineering/tool-bindings-readonly.ts"],
    versionNotes: "B04 initial registration; B09: agent-exposed (activated read binding; requires the verified canonical-state run resource — withheld per run when it is absent; pre-B10 browser chat supplies no board, so this read is withheld there). B20-B3: durable-server-board declared (served over MCP from the durable board)",
  },
  // ── Selection inspection ──────────────────────────────────────────────────
  {
    ...readDefaults,
    toolId: "sirkit.selection.inspect", version: "1.1.0",
    agentExposed: true, // B10 — statically exposed; per-run availability requires the sealed selection-snapshot resource
    owningCommandId: "view.canvas-navigation",
    title: "Inspect the current selection",
    description: "Resolve the CURRENT sealed PCB selection (captured atomically with the board) into typed items (footprints, tracks, vias, zones, texts, pads, dimensions). An empty current selection returns a truthful empty result.",
    category: "selection", operationClass: "read",
    // [B10] EMPTY input: the tool inspects the sealed current selection —
    // it never accepts model-invented selection references. Size bounds are
    // enforced server-side at resource sealing (never wire keywords).
    inputSchema: obj(),
    outputSchema: obj({ items: { type: "array", items: { type: "object" } }, droppedRefs: { type: "array", items: { type: "string" } }, pinned: { type: "object" } }, ["items", "droppedRefs", "pinned"]),
    requiredCapability: "read_project", requiredRoles: ["viewer", "commenter", "pcb_editor", "reviewer", "project_admin"],
    requiredProjectState: ["board-present"], requiredAuthority: ["local-working-copy"],
    binding: { status: "bound-read", module: "app/lib/pcb/selection-queries.ts", symbol: "getItems", notes: "B10: consumes the sealed selection-snapshot resource (exact live selectionStore refs, deduped and resolved against the exact captured board, pinned to the server-computed canonical revision)." },
    discovery: "discoverable", callability: "callable",
    timeoutMs: 2_000,
    validationStrategy: "empty strict input; selection refs validated/resolved at resource sealing (oversized selections rejected, never truncated)", verificationStrategy: "pure resolution against the pinned canonical board; dead refs dropped deterministically",
    sourceEvidence: ["app/lib/pcb/selection-queries.ts", "app/lib/agent/context.ts"],
    versionNotes: "1.1.0 (B10): agent-exposed over the sealed selection-snapshot resource; maxItems removed from the wire schema (outside the proven strict provider subset); input is empty — the current selection is the subject.",
  },
  // ── Parts / component authority ───────────────────────────────────────────
  {
    ...readDefaults,
    toolId: "sirkit.parts.search", version: "1.0.0",
    owningCommandId: "parts.catalog-read",
    title: "Search parts catalog",
    description: "Search the parts catalog with authority annotations (verified/published physical-authority).", // [B19-E E6] was "orderable"
    category: "parts", operationClass: "read",
    inputSchema: obj({ query: { type: "string" }, limit: { type: "number" } }, ["query"]), outputSchema: OUT_RESULT,
    requiredCapability: "read_project", requiredRoles: ["viewer", "commenter", "pcb_editor", "reviewer", "project_admin"],
    requiredProjectState: ["catalog-available"], requiredAuthority: ["catalog"],
    binding: { status: "bound-read", module: "app/lib/parts-search.ts", symbol: "searchPartsForAI", notes: "NOT activated in B05: recall uses a provider-hosted embedding call and live database access — activation requires a proven provider-free read path." },
    discovery: "discoverable", callability: "callable",
    timeoutMs: 15_000, budgetClass: "batch",
    validationStrategy: "query schema", verificationStrategy: "authority annotations surfaced verbatim",
    sourceEvidence: ["app/lib/parts-search.ts"],
    versionNotes: "B04 initial registration.",
  },
  // ── [B19-E E6] External acquisition — bounded Tier 0 reads over the server's injected port (OD-36, OD-40) ──
  {
    ...readDefaults,
    toolId: "sirkit.parts.external-search", version: "1.0.0",
    agentExposed: true, // B19-E E6 — per-run availability requires the server's external acquisition fact and canonical state
    owningCommandId: "parts.external-observation-read",
    title: "Search distributors by exact MPN",
    description: "Look up 1-5 EXACT manufacturer part numbers at the registered distributors (cache first; a live lookup only when the server allows it for the source, at most 5 live MPNs per run). The answer is a sourcing observation, never engineering authority: per source its status, and per MPN where the answer was served from, when it was observed and when it expires, and whether its MPN is exactly the one asked. Vendor values appear only for a source whose terms permit showing them to the assistant, under untrustedVendorText. It never places, binds, publishes or buys a part.",
    category: "parts", operationClass: "read",
    sideEffects: "derived-cache", // a live answer may be kept in the connector's own in-process memo for the source's registered freshness
    // [B09.1] 1-5 and the exact-MPN rule are enforced server-side (acquisition-reads.ts), never wire keywords
    inputSchema: obj({ mpns: { type: "array", items: { type: "string" }, description: "1-5 exact manufacturer part numbers, printable ASCII, as published (every suffix character counts)." } }, ["mpns"]),
    outputSchema: OUT_RESULT,
    requiredCapability: "read_project", requiredRoles: ALL_ROLES,
    requiredProjectState: ["board-present"], requiredAuthority: ["external-observation"],
    binding: { status: "bound-external-read", module: "app/lib/acquisition/agent-read-port.ts", symbol: "searchExactMpnsForAgent", notes: "B19-E E6: invoked only through ExternalReadInvocationService (app/lib/agent/acquisition-reads.ts) over the port the chat route injects through app/api/chat/external-acquisition-runtime.ts; labels only while the registry's agentDisclosure is unknown (OD-36)." },
    discovery: "discoverable", callability: "callable",
    timeoutMs: 12_000,
    validationStrategy: "exact keys {mpns}; safe JSON and schema; 1-5 printable-ASCII exact MPNs (canonicalExactMpn), de-duplicated; the server's availability fact, canonical state, role and capability rechecked per call",
    verificationStrategy: "closed projection of the port's answer (registry sources, closed statuses and outcomes, ISO times, requested MPNs only); vendor values only for a permitting source, bounded; at most 8,000 characters",
    sourceEvidence: ["app/lib/agent/acquisition-reads.ts", "app/lib/acquisition/agent-read-port.ts", "app/lib/distributors/index.ts", "app/api/chat/external-acquisition-runtime.ts", "app/lib/acquisition/source-registry.ts"],
    versionNotes: "1.0.0 (B19-E E6): first exposure, reviewed in agent-exposure.ts; exact MPNs only and at most 5 live MPNs per run at the agent's 25% quota share (OD-40).",
  },
  {
    ...readDefaults,
    toolId: "sirkit.parts.evidence-read", version: "1.0.0",
    agentExposed: true, // B19-E E6 — per-run availability requires the server's external acquisition fact and canonical state
    owningCommandId: "parts.external-observation-read",
    title: "Read the evidence for an exact MPN",
    description: "Read, from the offer cache only (never a vendor), the evidence an import review would see for ONE exact MPN: the cached sourcing observations with their freshness (stale ones flagged), the names of conflicting properties, the engineering evidence still missing, and each published atomic revision's catalog status (published, deprecated or superseded with its successor, revoked). proven is always false: a bundle proves nothing, and publication and binding are human steps.",
    category: "parts", operationClass: "read",
    inputSchema: obj({ mpn: { type: "string", description: "One exact manufacturer part number, printable ASCII, as published." } }, ["mpn"]),
    outputSchema: OUT_RESULT,
    requiredCapability: "read_project", requiredRoles: ALL_ROLES,
    requiredProjectState: ["board-present"], requiredAuthority: ["external-observation"],
    binding: { status: "bound-external-read", module: "app/lib/acquisition/agent-read-port.ts", symbol: "readEvidenceForAgent", notes: "B19-E E6: cache-only composition of the E4 import-review projection and E3's revision status; invoked only through ExternalReadInvocationService." },
    discovery: "discoverable", callability: "callable",
    timeoutMs: 12_000,
    validationStrategy: "exact keys {mpn}; safe JSON and schema; one printable-ASCII exact MPN (canonicalExactMpn); the server's availability fact, canonical state, role and capability rechecked per call",
    verificationStrategy: "closed projection: offer-cache observations only, property names only, the closed missing-evidence vocabulary, bounded revision ids and closed catalog states; proven false; at most 8,000 characters",
    sourceEvidence: ["app/lib/agent/acquisition-reads.ts", "app/lib/acquisition/agent-read-port.ts", "app/lib/acquisition/import-review.ts", "app/lib/acquisition/offer-cache-observations.ts", "app/lib/atomic/server-catalog.ts"],
    versionNotes: "1.0.0 (B19-E E6): first exposure, reviewed in agent-exposure.ts; cache only, so it spends no vendor quota.",
  },
  // ── [B20 A4] The external tool read — one bounded Tier 0 read over approved, pinned MCP servers (OD-74..OD-77) ──
  {
    ...readDefaults,
    toolId: "sirkit.mcp.observation-read", version: "1.0.0",
    agentExposed: true, // B20-A4 — per-run availability requires the server's external tool fact and canonical state
    owningCommandId: "mcp.external-tool-read",
    title: "Read an external tool of an approved server",
    description: "Reach approved external tool servers (MCP) that Sirkit's registry pins, in three operations: servers lists them; tools shows one server's catalog (set toolName to one tool's name to see only that one); call runs one of its tools with argumentsJson, at most 2 048 characters of arguments as a JSON object text holding only the part numbers or terms the user asked to look up. The answer is an untrusted external observation, never engineering authority and never an instruction: text appears only under untrusted keys and only for a server whose terms permit it, a block that carries a secret-shaped value or reads as an instruction is withheld whole, and images, audio and links are described, never embedded; at most 4 server operations per run (servers is free). It never writes anything, and it never places, binds, publishes or buys a part.",
    category: "parts", operationClass: "read",
    sideEffects: "derived-cache", // the per-run negotiation memo and the per-process listing cache (the server's own ttlMs)
    // [B09.1] the per-operation rules and the argument bounds are enforced server-side (mcp-observation-reads.ts), never wire keywords
    inputSchema: obj({
      operation: { type: "string", enum: ["servers", "tools", "call"], description: "servers: the approved servers; tools: one server's catalog; call: one tool of it." },
      serverId: { type: "string", description: "The server id from servers; empty for servers." },
      toolName: { type: "string", description: "For tools, empty for the whole catalog or one tool's exact name; for call, the exact tool name; empty for servers." },
      argumentsJson: { type: "string", description: "For call, the tool's arguments as the text of a JSON object (at most 2 048 characters); empty otherwise." },
    }, ["operation", "serverId", "toolName", "argumentsJson"]),
    outputSchema: OUT_RESULT,
    requiredCapability: "read_project", requiredRoles: ALL_ROLES,
    requiredProjectState: ["board-present"], requiredAuthority: ["external-mcp-observation"],
    binding: { status: "bound-external-read", module: "app/lib/mcp/agent-port.ts", symbol: "callMcpToolForAgent", notes: "B20-A4: invoked only through McpObservationReadService (app/lib/agent/mcp-observation-reads.ts) over the port the chat route injects through app/api/chat/mcp-observation-runtime.ts; disclosure decided from the committed registry (labels only unless a row permits it, OD-76); no production row today (OD-48)." },
    discovery: "discoverable", callability: "callable",
    timeoutMs: 15_000,
    validationStrategy: "exact keys {operation, serverId, toolName, argumentsJson}, all required; the per-operation empty-string rules; arguments at most 2 048 characters, plain bounded JSON, no secret shape; the port screens run identity and held credentials before anything is sent; the fact, canonical state, role and capability rechecked per call",
    verificationStrategy: "closed projection of the port's answer (a roster, a pinned catalog with schema-node text removed, or the sirkit.mcp-observation.v1 record's labels); untrusted text only under untrusted keys for a permitted row; at most 8 000 characters; re-validated",
    sourceEvidence: ["app/lib/agent/mcp-observation-reads.ts", "app/lib/mcp/agent-port.ts", "app/lib/mcp/observation.ts", "app/api/chat/mcp-observation-runtime.ts", "app/lib/mcp/server-registry.ts", "app/lib/mcp/tool-call.ts"],
    versionNotes: "1.0.0 (B20-A4): first exposure, reviewed in agent-exposure.ts; at most 4 server operations per run under the agent's 25% share of every window (OD-74, OD-40).",
  },
  {
    ...readDefaults,
    toolId: "sirkit.component-authority.inspect", version: "1.0.0",
    agentExposed: true, // B13 — statically exposed; per-run availability requires the server-owned component-authority-records resource (durable-server-board authority), so the tool is withheld whenever the durable source is unavailable; over MCP the durable canonical state is always present, so an absent authority resource refuses `missing_resource` (B20-B3)
    owningCommandId: "pcb.physical-binding",
    title: "Inspect physical-binding authority",
    description: "Read durable physical-binding aggregates and their immutable revisions for component instances.",
    category: "parts", operationClass: "read",
    // [B09.1] size bounds live in server-side input validation (B05
    // DEFAULT_INPUT_LIMITS: 2000 array items / 10k chars), never in wire
    // schemas (strict provider modes reject maxItems/maxLength).
    inputSchema: obj({ componentIds: { type: "array", items: { type: "string" } } }),
    outputSchema: obj({ components: { type: "array", items: { type: "object" } }, pinned: { type: "object" } }, ["components", "pinned"]),
    requiredCapability: "read_project", requiredRoles: ["viewer", "pcb_editor", "reviewer", "project_admin"],
    requiredProjectState: [], requiredAuthority: ["durable-server-board", "local-working-copy"],
    binding: { status: "bound-read", module: "app/lib/engineering/component-authority.ts", symbol: "inspectComponentAuthority", notes: "B05 audit: PhysicalBindingService performs durable I/O; the activated read is a pure inspector over explicitly supplied binding records (facet states from app/lib/physical-binding/types.ts)." },
    discovery: "discoverable", callability: "callable",
    timeoutMs: 10_000,
    validationStrategy: "component-id inputs; records supplied explicitly, never fetched", verificationStrategy: "closed authority vocabulary; candidates never become authority; unknown facts stay unknown",
    sourceEvidence: ["app/lib/engineering/component-authority.ts", "app/lib/physical-binding/types.ts"],
    versionNotes: "B05: activated pure read inspector.",
  },
  // ── Manufacturing readiness (inspection only) ─────────────────────────────
  {
    ...readDefaults,
    toolId: "sirkit.manufacturing.readiness-inspect", version: "1.0.0",
    agentExposed: true, // B09 — statically exposed; per-run availability requires the canonical-state resource
    owningCommandId: "manufacturing.export-engineering",
    title: "Inspect fabrication readiness",
    description: "Recompute the PCB fabrication readiness report; never authorizes a release.",
    category: "manufacturing", operationClass: "read",
    inputSchema: obj(), outputSchema: obj({ report: { type: "object" }, pinned: { type: "object" } }, ["report", "pinned"]),
    requiredCapability: "read_project", requiredRoles: ["viewer", "pcb_editor", "reviewer", "project_admin"],
    requiredProjectState: ["board-present"], requiredAuthority: ["local-working-copy", "durable-server-board"],
    binding: { status: "bound-read", module: "app/lib/pcb/readiness/evaluate.ts", symbol: "evaluatePcbFabricationReadiness" },
    discovery: "discoverable", callability: "callable",
    timeoutMs: 30_000, budgetClass: "batch",
    validationStrategy: "readiness inputs schema", verificationStrategy: "live recompute; historical manifests never authorize",
    sourceEvidence: ["app/lib/pcb/readiness/evaluate.ts"],
    versionNotes: "B04 initial registration; B09: agent-exposed (activated read binding; requires the verified canonical-state run resource — withheld per run when it is absent; pre-B10 browser chat supplies no board, so this read is withheld there).",
  },
  // ── Proposals (real engines; propose-class, never auto-apply) ─────────────
  {
    ...readDefaults,
    toolId: "sirkit.placement.propose", version: "1.2.0", // [PR-F fE, 2026-10-17] 1.1.0 -> 1.2.0: the optional structured intent block (schema change, same producer)
    agentExposed: true, // B17-F — the shared revision-bound layout candidate; the HUMAN applies it in the placement panel
    owningCommandId: "placement.auto",
    title: "Propose a placement candidate",
    description: "Run the engineering placement engine over the CURRENT board and produce a revision-bound placement candidate (sirkit.layout-candidate.v1) that appears in the user's placement panel for review. Receiving the candidate changes nothing; the user applies or discards it explicitly. Optionally restrict to selected footprint ids. An optional intent block (sirkit.placement-intent.v1: millimetres in the board frame, exact component and net identities) seeds the engine; where legalization, a lock, a keepout or a clearance changed what it asked, the candidate lists each conflict; a board over 50 physical instances is classified unsupported-scope in the candidate's data.",
    category: "placement", operationClass: "propose",
    inputSchema: obj({ instanceIds: { type: "array", items: { type: "string" }, description: "Restrict the search to these footprint ids; absent = the whole board" }, candidateCount: { type: "number", description: "2–8 (enforced by the service)" }, maxIterations: { type: "number", description: "1–2000 (enforced by the service)" }, intent: placementIntentInputSchema() /* [PR-F fE] declared at the END (hoisted) */ }), outputSchema: OUT_RESULT,
    sideEffects: "proposal-artifact",
    requiredCapability: "read_project", requiredRoles: ["pcb_editor", "project_admin"],
    requiredProjectState: ["board-present"], requiredAuthority: ["local-working-copy"],
    binding: { status: "bound-proposal", module: "app/lib/pcb/candidates/layout-candidate.ts", symbol: "runPlacementCandidate" },
    discovery: "discoverable", callability: "callable",
    timeoutMs: 120_000, budgetClass: "long-running",
    validationStrategy: "one options builder (placementRunOptions); candidate hard-constraint validation; digest-sealed, pinned to the board revision; [PR-F fE] the intent is compiled all-or-nothing against exact component and net identities of the board revision (compilePlacementIntent: an unknown identity refuses the whole proposal as proposal-blocked data), seeds one extra engine candidate, and is re-measured against the selected candidate (evaluatePlacementIntent: conflicts listed, never dropped); over 50 physical instances the intent is recorded unapplied (unsupported-scope)", verificationStrategy: "applyLayoutCandidate re-verifies revision, hashes and protected copper at apply — the user-facing workflow only",
    sourceEvidence: ["app/lib/pcb/candidates/layout-candidate.ts", "app/lib/pcb/placement/engine.ts", "app/lib/pcb/placement/intent.ts", "app/components/pcb/PlacementSetup.tsx"],
    versionNotes: "1.2.0 (PR-F fE, 2026-10-17): the optional structured placement intent (sirkit.placement-intent.v1; directive section 8) passed through the same engine, legalization and validators with a conflict list, and the 50-instance scope gate; 1.1.0 (B17-F): exposed as the shared candidate producer; apply remains the editor's decision.",
  },
  {
    ...readDefaults,
    toolId: "sirkit.routing.propose", version: "1.1.0",
    agentExposed: true, // B17-F — the shared revision-bound routing candidate; the HUMAN applies it in the routing panel
    owningCommandId: "routing.autoroute",
    title: "Propose a routing candidate",
    description: "Run the bounded local autorouter over the CURRENT board (optionally only the given nets) and produce a revision-bound routing candidate (sirkit.layout-candidate.v1) that the user previews as a ghost and applies or discards explicitly. Never commits copper.",
    category: "routing", operationClass: "propose",
    inputSchema: obj({ netIds: { type: "array", items: { type: "number" }, description: "Route only these nets (a reroute); absent = every incomplete net" } }), outputSchema: OUT_RESULT,
    sideEffects: "proposal-artifact",
    requiredCapability: "read_project", requiredRoles: ["pcb_editor", "project_admin"],
    requiredProjectState: ["board-present"], requiredAuthority: ["local-working-copy"],
    binding: { status: "bound-proposal", module: "app/lib/pcb/candidates/routing-server.ts", symbol: "runRoutingCandidate" },
    discovery: "discoverable", callability: "callable",
    timeoutMs: 180_000, budgetClass: "long-running",
    validationStrategy: "the same completeAutoroute service as the autoroute route (DSN preflight, SES parse, boundary + monotonic acceptance); copper restricted to the requested nets; digest-sealed, revision-pinned", verificationStrategy: "applyLayoutCandidate re-verifies revision, scope and provenance at apply — the user-facing workflow only",
    sourceEvidence: ["app/lib/pcb/candidates/routing-server.ts", "app/lib/pcb/autoroute/freerouting-pass-executor.ts", "app/components/pcb/AutorouteSetup.tsx"],
    versionNotes: "1.1.0 (B17-F): exposed as the shared candidate producer over the shared pass executor.",
  },
  {
    ...readDefaults,
    toolId: "sirkit.pcb.repair-plan", version: "1.0.0",
    owningCommandId: "pcb.board-repair",
    title: "Plan DRC repairs",
    description: "Group DRC violations by root cause and create bounded candidate fixes without applying them.",
    category: "validation", operationClass: "propose",
    inputSchema: obj({ mode: { type: "string", enum: ["review_every_change", "safe_fixes_automatically", "fully_automatic_within_constraints"] } }), outputSchema: OUT_RESULT,
    sideEffects: "proposal-artifact",
    requiredCapability: "run_automation", requiredRoles: ["pcb_editor", "project_admin"],
    requiredProjectState: ["board-present"], requiredAuthority: ["local-working-copy"],
    binding: { status: "bound-proposal", module: "app/lib/pcb/repair/planner.ts", symbol: "planDrcRepairs" },
    discovery: "discoverable", callability: "callable",
    timeoutMs: 60_000, budgetClass: "batch",
    validationStrategy: "safe-fix classification", verificationStrategy: "apply requires explicit approval outside this tool",
    sourceEvidence: ["app/lib/pcb/repair/planner.ts", "app/lib/pcb/ai/pcb-tool-service.ts"],
    versionNotes: "Proposal only; apply stays in the PcbHistory transaction flow.",
  },
  // ── Migrated PCB mutations (B03 slice — trusted editor session ONLY) ──────
  {
    ...canonicalMutation,
    toolId: "sirkit.pcb.move-footprint", version: "1.1.1",
    owningCommandId: "pcb.move-footprint",
    title: "Move footprint",
    description: "EXECUTION tool: move footprints to absolute board positions (integer nanometres; +x right, +y down). Calling it never changes the board by itself — the server issues a one-shot grant bound to the current board revision, and the user's editor either shows the exact move for the user to confirm or, when the project opted in and the user's whole message is exactly this request, commits it as one transaction with one undo entry. Name footprints by their stable ids — from a selection.inspect result or from board-inspect (never reference designators); 1–16 moves; locked footprints refuse.",
    category: "pcb", operationClass: "mutate",
    inputSchema: obj({
      moves: {
        type: "array",
        description: "1–16 footprint moves, each to an absolute position.",
        items: obj({
          footprintId: { type: "string", description: "The stable footprint id from selection.inspect or board-inspect (not the reference designator)." },
          x: { type: "integer", description: "Absolute X of the footprint origin in integer nanometres (+x right)." },
          y: { type: "integer", description: "Absolute Y of the footprint origin in integer nanometres (+y down, so moving up means a smaller y)." },
        }, ["footprintId", "x", "y"]),
      },
    }, ["moves"]),
    outputSchema: OUT_RESULT,
    requiredCapability: "edit_placement", requiredRoles: ["pcb_editor", "project_admin"],
    // [B18-C I3] targets are NAMED by stable id (never resolved from a selection), so no selection gates discovery.
    approvalTier: "reversible", requiredSelectionKinds: [],
    agentExposed: true, executionMode: "granted",
    binding: { status: "bound-mutation-editor-session", module: "app/lib/engineering/editor-adapter.ts", symbol: "CanonicalEditorSession.commit", canonicalCommandId: "pcb.move-footprint", notes: "Commits ONLY inside the trusted interactive editor session. The agent reaches it solely through a server-minted one-shot execution grant (B18-B/C): the gateway seals and mints; the user's editor tenders the grant and commits through this session; nothing server-side invokes it." },
    timeoutMs: 5_000,
    sourceEvidence: ["app/lib/engineering/editor-adapter.ts", "artifacts/ai-control-plane-b03/mutation-migration-matrix.csv", "app/lib/agent/execution-dispatch.ts", "app/lib/engineering/granted-executions.ts"],
    versionNotes: "1.1.1 (B18-E E3): the id sources also name sirkit.selection.inspect — board-inspect can exceed the model's result budget on a routed board (measured: 70,173 characters against 60,000), so naming it alone can leave the model with no ids at all; arguments, schema shape and reach unchanged. 1.1.0 (B18-C I3): agent-exposed as the first reviewed granted execution (executionMode granted); integer-nanometre schema with model-facing descriptions; no selection gate (named targets). 1.0.0: trusted-UI only.",
  },
  {
    ...canonicalMutation,
    toolId: "sirkit.pcb.rotate-side-footprint", version: "1.2.1",
    owningCommandId: "pcb.rotate-side-footprint",
    title: "Rotate or flip footprint",
    description: "EXECUTION tool: set footprints' ABSOLUTE rotation (whole degrees 0–359, counter-clockwise as seen on screen) and/or board side. To rotate BY an angle, add it to the current rotation from board-inspect (clockwise subtracts). Calling it never changes the board by itself — the server issues a one-shot grant bound to the current board revision, and the user's editor either shows the exact change for the user to confirm or, when the project opted in and the user's whole message is exactly this request, commits it as one transaction with one undo entry. Name footprints by their stable ids — from a selection.inspect result or from board-inspect; 1–16 targets; locked footprints refuse.",
    category: "pcb", operationClass: "mutate",
    inputSchema: obj({
      targets: {
        type: "array",
        description: "1–16 footprints, each with its new absolute rotation, its new side, or both.",
        items: obj({
          footprintId: { type: "string", description: "The stable footprint id from selection.inspect or board-inspect (not the reference designator)." },
          rotationDeg: { type: "integer", description: "The new ABSOLUTE rotation in whole degrees 0–359, counter-clockwise as seen on screen. null with a side change turns the part over the way the editor's Flip does (the rotation becomes 360 minus the current rotation); null without one keeps the current rotation." },
          side: { enum: ["top", "bottom"], description: "The board side to place the footprint on. null keeps the current side." },
        }, ["footprintId"]),
      },
    }, ["targets"]),
    outputSchema: OUT_RESULT,
    requiredCapability: "edit_placement", requiredRoles: ["pcb_editor", "project_admin"],
    // [B18-C I5] targets are NAMED by stable id (never resolved from a selection), so no selection gates discovery.
    approvalTier: "reversible", requiredSelectionKinds: [],
    agentExposed: true, executionMode: "granted",
    binding: { status: "bound-mutation-editor-session", module: "app/lib/engineering/editor-adapter.ts", symbol: "CanonicalEditorSession.commit", canonicalCommandId: "pcb.rotate-side-footprint", notes: "Commits ONLY inside the trusted interactive editor session; the agent reaches it solely through a server-minted one-shot execution grant (B18-B/C)." },
    timeoutMs: 5_000,
    sourceEvidence: ["app/lib/engineering/editor-adapter.ts", "artifacts/ai-control-plane-b03/mutation-migration-matrix.csv", "app/lib/agent/execution-dispatch.ts", "app/lib/engineering/granted-executions.ts"],
    versionNotes: "1.2.1 (B18-E E3): the id sources also name sirkit.selection.inspect (board-inspect can exceed the model's result budget on a routed board); arguments, schema shape and reach unchanged. 1.2.0 (B18-C review 2): a side change with a null rotation follows the editor's own Flip (rotation 360 − r), so a flip at 90° or 270° no longer lands turned 180° from what the editor's Flip produces. 1.1.0 (B18-C I5): agent-exposed as a reviewed granted execution; absolute integer rotation and a nullable side; no selection gate (named targets). 1.0.0: trusted-UI only.",
  },
  {
    ...canonicalMutation,
    toolId: "sirkit.pcb.edit-track", version: "1.0.0",
    owningCommandId: "pcb.edit-track",
    title: "Edit track width/layer",
    description: "Update track width or copper layer through the canonical executor.",
    category: "pcb", operationClass: "mutate",
    inputSchema: obj({ trackIds: { type: "array", items: { type: "string" } }, widthNm: { type: "number" }, layer: { type: "string" } }, ["trackIds"]),
    outputSchema: OUT_RESULT,
    requiredCapability: "edit_copper", requiredRoles: ["pcb_editor", "project_admin"],
    approvalTier: "topology-or-geometry", requiredSelectionKinds: ["track"],
    binding: { status: "bound-mutation-editor-session", module: "app/lib/engineering/editor-adapter.ts", symbol: "applyEditsCanonical", canonicalCommandId: "pcb.edit-track" },
    timeoutMs: 5_000,
    sourceEvidence: ["app/lib/engineering/editor-adapter.ts", "artifacts/ai-control-plane-b03/mutation-migration-matrix.csv"],
    versionNotes: "Runtime-executable for trusted UI; agent-exposed: false by invariant.",
  },
  {
    ...canonicalMutation,
    toolId: "sirkit.pcb.delete-item", version: "1.0.0",
    owningCommandId: "pcb.delete-item",
    title: "Delete track/via/zone",
    description: "Delete tracks, vias, or zones through the canonical executor (destructive tier; interactive-session approval).",
    category: "pcb", operationClass: "destructive",
    inputSchema: obj({ refs: { type: "array", items: obj({ kind: { type: "string", enum: ["track", "via", "zone"] }, id: { type: "string" } }, ["kind", "id"]) } }, ["refs"]),
    outputSchema: OUT_RESULT,
    requiredCapability: "edit_copper", requiredRoles: ["pcb_editor", "project_admin"],
    approvalTier: "destructive", requiredSelectionKinds: ["track", "via", "zone"],
    binding: { status: "bound-mutation-editor-session", module: "app/lib/engineering/editor-adapter.ts", symbol: "applyEditsCanonical", canonicalCommandId: "pcb.delete-item", notes: "Destructive approval comes from the trusted interactive channel or an independent approve_proposal — never from this registry." },
    timeoutMs: 5_000,
    sourceEvidence: ["app/lib/engineering/editor-adapter.ts", "artifacts/ai-control-plane-b03-1/security-boundary.md"],
    versionNotes: "Runtime-executable for trusted UI; agent-exposed: false by invariant.",
  },
  {
    ...canonicalMutation,
    toolId: "sirkit.pcb.arrange", version: "1.1.1",
    owningCommandId: "pcb.arrange",
    title: "Align/distribute/snap footprints",
    description: "EXECUTION tool: align footprints on an edge or centre line, distribute them evenly along an axis, or snap them to a grid, with the editor's own arrangement commands. Calling it never changes the board by itself — the server issues a one-shot grant bound to the current board revision, and the user's editor either shows the exact change for the user to confirm or, when the project opted in and the user's whole message is exactly this request, commits it as one transaction with one undo entry. Always previewed for the user's confirmation. Name footprints by their stable ids — from a selection.inspect result or from board-inspect; locked footprints refuse.",
    category: "pcb", operationClass: "mutate",
    inputSchema: obj({
      mode: { type: "string", enum: ["align", "distribute", "snap-to-grid"], description: "align: line the footprints up on one edge or centre line (2 or more); distribute: space them evenly along an axis (3 or more); snap-to-grid: move each onto the grid." },
      footprintIds: { type: "array", items: { type: "string" }, description: "The stable footprint ids from selection.inspect or board-inspect (1–16)." },
      edge: { enum: ["left", "right", "top", "bottom", "centerH", "centerV"], description: "align only: the edge or centre line to align to; null otherwise." },
      axis: { enum: ["h", "v"], description: "distribute only: h = horizontally, v = vertically; null otherwise." },
      gridNm: { type: "integer", description: "snap-to-grid only: the grid pitch in whole nanometres; null otherwise." },
    }, ["mode", "footprintIds"]),
    outputSchema: OUT_RESULT,
    requiredCapability: "edit_placement", requiredRoles: ["pcb_editor", "project_admin"],
    // [B18-C I5] targets are NAMED by stable id (never resolved from a selection), so no selection gates discovery.
    approvalTier: "reversible", requiredSelectionKinds: [],
    agentExposed: true, executionMode: "granted",
    binding: { status: "bound-mutation-editor-session", module: "app/lib/engineering/editor-adapter.ts", symbol: "applyEditsCanonical", canonicalCommandId: "pcb.arrange", notes: "Trusted UI: applyEditsCanonical. The agent reaches it solely through a server-minted one-shot execution grant (B18-B/C), whose ritual commits the pinned positions through CanonicalEditorSession.commit." },
    timeoutMs: 5_000,
    sourceEvidence: ["app/lib/engineering/editor-adapter.ts", "artifacts/ai-control-plane-b03/mutation-migration-matrix.csv", "app/lib/agent/execution-dispatch.ts", "app/lib/engineering/granted-executions.ts"],
    versionNotes: "1.1.1 (B18-E E3): the id sources also name sirkit.selection.inspect (board-inspect can exceed the model's result budget on a routed board); arguments, schema shape and reach unchanged. 1.1.0 (B18-C I5): agent-exposed as a reviewed granted execution (confirmation-only: no explicit grammar); the mode's parameter is explicit (edge / axis / gridNm); no selection gate (named targets). 1.0.0: trusted-UI only.",
  },
  // ── [B18-C I6] Silkscreen TEXT — a reviewed granted execution (confirmation-only) ──
  {
    ...canonicalMutation,
    toolId: "sirkit.pcb.silkscreen-text", version: "1.0.1",
    owningCommandId: "pcb.silkscreen-text",
    title: "Add, edit or remove silkscreen text",
    description: "EXECUTION tool: add silkscreen TEXT (a label, revision mark or note) at a board position, change an existing silk text's text, size, stroke or layer, or remove one. Only silkscreen TEXT items (never lines, rectangles, circles or copper text). Calling it never changes the board by itself — the server issues a one-shot grant bound to the current board revision, and the user's editor shows the exact change for the user to confirm; nothing is committed until they do. Name an existing silk text by its stable id (selection-inspect lists the silk text the user selected; an executed result lists the ids it added); 1–16 edits; text is 1–64 printable characters without leading or trailing spaces; bottom-side text is mirrored automatically.",
    category: "pcb", operationClass: "mutate",
    inputSchema: obj({
      edits: {
        type: "array",
        description: "1–16 silkscreen TEXT edits, applied together as one change.",
        items: obj({
          op: { type: "string", enum: ["add", "update", "remove"], description: "add a new silk text; update an existing silk text; remove one." },
          silkId: { type: "string", description: "update / remove only: the stable id of an existing silk TEXT item (from selection-inspect or an earlier executed result); null for add." },
          text: { type: "string", description: "add (required) / update: 1–64 printable ASCII characters; null keeps the text on update." },
          layer: { enum: ["silkTop", "silkBottom"], description: "add (required) / update: the silkscreen layer; null keeps the layer on update." },
          atNm: { ...obj({ x: { type: "integer", description: "X of the text centre in integer nanometres (+x right)." }, y: { type: "integer", description: "Y of the text centre in integer nanometres (+y down)." } }, ["x", "y"]), description: "add only: where the text is centred; null for update / remove." },
          heightNm: { type: "integer", description: "add / update: cap height in whole nanometres, at least 100000 (0.1 mm); null means 1 mm on add, unchanged on update." },
          strokeWidthNm: { type: "integer", description: "add / update: stroke width in whole nanometres; null means 0.15 mm on add, unchanged on update." },
        }, ["op"]),
      },
    }, ["edits"]),
    outputSchema: OUT_RESULT,
    requiredCapability: "edit_placement", requiredRoles: ["pcb_editor", "project_admin"],
    approvalTier: "reversible", requiredSelectionKinds: [],
    agentExposed: true, executionMode: "granted",
    binding: { status: "bound-mutation-editor-session", module: "app/lib/engineering/editor-adapter.ts", symbol: "CanonicalEditorSession.commit", canonicalCommandId: "pcb.silkscreen-text", notes: "Trusted UI: the silk tool through the PCB commit gateway. The agent reaches it solely through a server-minted one-shot execution grant (B18-B/C); the ritual commits the grant's exact silk operations through CanonicalEditorSession.commit." },
    timeoutMs: 5_000,
    sourceEvidence: ["app/lib/pcb/silk/commands.ts", "app/components/pcb/hooks/useSilkTool.ts", "app/lib/engineering/editor-adapter.ts", "app/lib/agent/execution-dispatch.ts", "app/lib/engineering/granted-executions.ts"],
    versionNotes: "1.0.1 (B18-C review 2): the id sources are selection-inspect and executed results (the AI board snapshot lists no silk items); text without leading or trailing spaces. 1.0.0 (B18-C I6): the first descriptor for pcb.silkscreen-text — silk TEXT only (board text is not silk and stays out of scope); deterministic add ids; confirmation-only (no explicit grammar).",
  },
  // ── Canonical undo/redo — INTERNAL, never discoverable ────────────────────
  {
    ...canonicalMutation,
    toolId: "sirkit.pcb.undo-redo-canonical", version: "1.0.0",
    owningCommandId: "pcb.undo-redo-canonical",
    title: "Canonical undo/redo (internal)",
    description: "Verified replay of a referenced durable transaction. Internal to the editor session's wrapped history; never a general tool.",
    category: "pcb", operationClass: "mutate",
    inputSchema: obj({ referencedTransactionId: { type: "string" }, direction: { type: "string", enum: ["undo", "redo"] } }, ["referencedTransactionId", "direction"]),
    outputSchema: OUT_RESULT,
    requiredCapability: "edit_placement", requiredRoles: ["pcb_editor", "project_admin"],
    approvalTier: "none", requiredSelectionKinds: [],
    binding: { status: "bound-mutation-editor-session", module: "app/lib/engineering/executor.ts", symbol: "CanonicalExecutor.executeUndoRedo", canonicalCommandId: "pcb.undo-redo-canonical", notes: "Reachable ONLY through the adapter-wrapped history and — the recorded B03.2 amendment (B18-C I8) — the grant-only sirkit.pcb.undo-redo-granted, which replays the exact last AI change through CanonicalEditorSession.replayUnderGrant; generic execution is rejected (B03.1). No other tool binding exists or may be added." },
    discovery: "internal-only",
    timeoutMs: 5_000,
    sourceEvidence: ["app/lib/engineering/executor.ts", "artifacts/ai-control-plane-b03-2/lineage-and-channel-boundary.md"],
    versionNotes: "Internal-only; excluded from every discovery channel.",
  },
  // ── [B18-C I8] Undo / redo of the assistant's own latest change — a reviewed granted execution (grant-only) ──
  {
    ...canonicalMutation,
    toolId: "sirkit.pcb.undo-redo-granted", version: "1.0.1",
    owningCommandId: "pcb.undo-redo-canonical",
    title: "Undo or redo your latest change",
    description: "EXECUTION tool: undo the latest change YOU (the assistant) made to the board through an execution tool, or redo the change your latest undo reverted. It takes only the direction — the server finds the exact change, and only while it is still the latest change on the board (any later edit, by the user or by you, refuses). Calling it never changes the board by itself: the server issues a one-shot grant, and the user's editor either shows the exact change for the user to confirm or, when the project opted in and the user's whole message is exactly \"undo\" or \"redo\" (optionally \"that\" or \"the last change\"), commits it. An undo or redo you perform is itself a NEW history entry: after your undo the user's own Undo re-applies the change; after your redo it removes the change again.",
    category: "pcb", operationClass: "mutate",
    inputSchema: obj({ direction: { type: "string", enum: ["undo", "redo"], description: "undo your latest change, or redo the change your latest undo reverted." } }, ["direction"]),
    outputSchema: OUT_RESULT,
    requiredCapability: "edit_placement", requiredRoles: ["pcb_editor", "project_admin"],
    // [B18-C I8] approvalTier "none" on a mutate tool is the exact-last-operation replay family: permission Tier 1 by derivation.
    approvalTier: "none", requiredSelectionKinds: [],
    agentExposed: true, executionMode: "granted", grantOnly: true,
    validationStrategy: "the server resolves the reference from the principal's own settled grants at the verified head; the canonical executor verifies the durable record, the lineage position and a pure dry run before any mutation",
    verificationStrategy: "the replay's durable record links the referenced transaction and direction, and its recorded semantic result equals the referenced change's other side",
    binding: { status: "bound-mutation-editor-session", module: "app/lib/engineering/editor-adapter.ts", symbol: "CanonicalEditorSession.replayUnderGrant", canonicalCommandId: "pcb.undo-redo-canonical", notes: "Grant-only: absent from interactive-ui, api and automation discovery. The browser replays the durable record through CanonicalExecutor.executeUndoRedo (canonical first; one new history entry); the internal sirkit.pcb.undo-redo-canonical stays internal-only." },
    timeoutMs: 5_000,
    sourceEvidence: ["app/lib/engineering/editor-adapter.ts", "app/lib/engineering/executor.ts", "app/lib/execution-grant/mint.ts", "app/lib/engineering/granted-executions.ts", "artifacts/ai-control-plane-b18/safe-mutation-contract.md"],
    versionNotes: "1.0.0 (B18-C I8): undo / redo of the assistant's own latest change as a reviewed granted execution (OD-14); grant-only; explicit only for a whole-message undo or redo. 1.0.1 (B18-C review 3): the description states what the user's Undo does after each direction.",
  },
  // ── Manufacturing release — API-only, MFG01-owned, never a tool ───────────
  {
    ...readDefaults,
    toolId: "sirkit.manufacturing.release", version: "1.0.0",
    owningCommandId: "manufacturing.release",
    title: "Manufacturing release (API-only)",
    description: "Deterministic bare-board release. Owned by the MFG01 release gate behind POST /api/pcb/release; categorically outside general tool execution.",
    category: "manufacturing", operationClass: "release",
    inputSchema: obj({ }), outputSchema: OUT_RESULT,
    sideEffects: "release-artifact",
    requiredCapability: "export_project", requiredRoles: ["project_admin"],
    approvalTier: "release",
    requiredProjectState: ["authoritative-board"], requiredAuthority: ["durable-server-board"],
    requiresExpectedRevision: true, idempotency: "required-key", requiresLineage: false,
    binding: { status: "unbound", notes: "Release authority is the MFG01 gate (app/api/pcb/release); it must never receive a general tool binding and the canonical executor categorically refuses release-tier commands." },
    discovery: "internal-only", callability: "not-callable",
    timeoutMs: 60_000, budgetClass: "batch", audit: "change-set",
    validationStrategy: "MFG01 gate (revision/digest, placement, DRC, connectivity, compile, readback)", verificationStrategy: "MFG01 gate",
    sourceEvidence: ["app/api/pcb/release/route.ts", "app/lib/pcb/fab/release-gate.ts"],
    versionNotes: "Registered so the boundary is explicit: release is not, and must not become, agent-executable.",
  },
  // ── [B17-F] View / session tools — registry-backed bus commands the browser executes ──
  {
    ...readDefaults,
    toolId: "sirkit.view.read-state", version: "1.0.0",
    agentExposed: true, // B17-F — read-only view state from the captured view context
    owningCommandId: "view.canvas-navigation",
    title: "Read the editors' view state",
    description: "What the user's editors currently SHOW (open surfaces, each editor's view state and its view revision, the 3D scene state). Read-only; never engineering state. Use the returned viewRevision when issuing view commands.",
    category: "view", operationClass: "read",
    inputSchema: obj({ editor: { type: "string", enum: VIEW_TOOL_ENUMS.editors, description: "Restrict to one editor" } }), outputSchema: OUT_PINNED_REPORT,
    requiredCapability: "read_project", requiredRoles: ALL_ROLES,
    requiredProjectState: ["board-present"], requiredAuthority: ["none"],
    binding: { status: "bound-read", module: "app/lib/agent/view-context.ts", symbol: "inspectViewState" },
    discovery: "discoverable", callability: "callable",
    timeoutMs: 2_000,
    validationStrategy: "the captured sirkit.view-context.v1 snapshot is exact-key validated and bounded at run assembly", verificationStrategy: "pinned to the sealed view-state-snapshot resource digest",
    sourceEvidence: ["app/lib/agent/view-context.ts", "app/lib/agent/view-session-bridge.ts"],
    versionNotes: "B17-F.",
  },
  {
    ...readDefaults,
    toolId: "sirkit.project.history-inspect", version: "1.0.0",
    agentExposed: true, // B17-F — the project operation timeline (read-only)
    owningCommandId: "project.operation-timeline",
    title: "Inspect the project operation timeline",
    description: "The ordered record of schematic and PCB operations in this session (commits, undo/redo, hydration, restores) with their store, label and actor, and whether a project-level undo is currently eligible. Read-only; undo itself stays a human action.",
    category: "project", operationClass: "read",
    inputSchema: obj({ limit: { type: "number", description: "most recent entries to return, 1–50" } }), outputSchema: OUT_PINNED_REPORT,
    requiredCapability: "read_project", requiredRoles: ALL_ROLES,
    requiredProjectState: ["board-present"], requiredAuthority: ["none"],
    binding: { status: "bound-read", module: "app/lib/agent/view-context.ts", symbol: "inspectProjectTimeline" },
    discovery: "discoverable", callability: "callable",
    timeoutMs: 2_000,
    validationStrategy: "bounded timeline snapshot validated at run assembly", verificationStrategy: "pinned to the sealed project-timeline-snapshot resource digest",
    sourceEvidence: ["app/lib/project/operation-timeline.ts", "app/lib/agent/view-context.ts"],
    versionNotes: "B17-F.",
  },
  {
    ...viewSession,
    toolId: "sirkit.view.pcb3d", version: "1.0.0",
    owningCommandId: "view.pcb-3d-control",
    title: "Control the 3D view",
    description: "Open/close the 3D view, camera presets (top/bottom/iso), fit, reset, focus a component / the selection / a net, show or hide scene layers (top and bottom silkscreen independently, mask, copper, zones, vias, footprints, refdes, substrate), set the visual finish. The command runs on the user's 3D view session; a target without geometry is refused (model/geometry unavailable), never faked.",
    inputSchema: obj({
      action: { type: "string", enum: ["open", "close", "camera-preset", "fit-board", "reset-camera", "focus-component", "focus-selection", "focus-net", "set-layer-visible", "toggle-layer", "set-finish", "read-state"] },
      preset: { type: "string", enum: VIEW_TOOL_ENUMS.pcb3dPresets },
      ref: { type: "string", description: "component reference designator or id (focus-component)" },
      netId: { type: "number" }, name: { type: "string", description: "net name (focus-net)" },
      layer: { type: "string", enum: VIEW_TOOL_ENUMS.pcb3dLayers }, visible: { type: "boolean" },
      finish: { type: "string" },
    }, ["action"]), outputSchema: OUT_VIEW_COMMAND,
    requiredProjectState: ["board-present", "pcb3d-surface"],
    binding: { status: "bound-view-session", module: "app/lib/view-session/pcb3d.ts", symbol: "pcb3dCommands" },
    viewCommands: ["pcb3d.open", "pcb3d.close", "pcb3d.camera-preset", "pcb3d.fit-board", "pcb3d.reset-camera", "pcb3d.focus-component", "pcb3d.focus-selection", "pcb3d.focus-net", "pcb3d.set-layer-visible", "pcb3d.toggle-layer", "pcb3d.set-finish", "pcb3d.read-state"],
    sourceEvidence: ["app/lib/view-session/pcb3d.ts", "app/components/pcb/hooks/usePcb3dViewSession.ts", "app/lib/agent/view-context.ts"],
  },
  {
    ...viewSession,
    toolId: "sirkit.view.canvas-navigation", version: "1.2.0",
    owningCommandId: "view.canvas-navigation",
    title: "Navigate a canvas or open an editor tab",
    description: "Fit the board/page, zoom by a bounded factor or to a scale, pan to or focus a semantic target (component by refdes/id, object, net, world point, or the user's current selection) on the PCB or schematic canvas; open a workspace editor tab; open a schematic SHEET by id, unique display name or path (action open-sheet with sheet; a name two sheets share is refused with the candidates). Relative commands refuse a stale view revision; selection-relative targets refuse a stale or empty selection.",
    inputSchema: obj({
      editor: { type: "string", enum: ["pcb", "schematic", "workspace"] },
      action: { type: "string", enum: ["fit", "fit-selection", "zoom", "zoom-to", "pan-to", "focus", "open-editor", "open-sheet"] },
      target: TARGET,
      factor: { type: "number", description: "zoom: relative factor 0.25–4 (the bus refuses others)" },
      scale: { type: "number", description: "zoom-to: pcb px/mm or schematic zoom" },
      tab: { type: "string", enum: VIEW_TOOL_ENUMS.workspaceTabs, description: "open-editor" }, sheet: { type: "string", description: "open-sheet (schematic only): the sheet's id, its unique display name or its path (sirkit.schematic.inspect lists them)" }, // [PR-J5, 2026-10-23] + sheet, in place on this line (no catalog line moves)
    }, ["editor", "action"]), outputSchema: OUT_VIEW_COMMAND,
    requiredProjectState: [],
    binding: { status: "bound-view-session", module: "app/lib/view-session/pcb.ts", symbol: "pcbCommands" },
    viewCommands: ["pcb.fit-board", "pcb.fit-selection", "pcb.zoom", "pcb.zoom-to", "pcb.pan-to", "pcb.focus", "schematic.fit-page", "schematic.zoom", "schematic.zoom-to", "schematic.pan-to", "schematic.focus", "workspace.open-editor", "schematic.open-sheet"], // [PR-J5, 2026-10-23] + schematic.open-sheet (runbook J.6.5 / J.6.6: navigation stays a view command)
    sourceEvidence: ["app/lib/view-session/pcb.ts", "app/lib/view-session/schematic.ts", "app/lib/view-session/workspace.ts", "app/lib/agent/view-context.ts"],
    versionNotes: "1.2.0 (PR-J5, 2026-10-23; runbook J.6.5, OD-259): + open-sheet - the schematic.open-sheet bus command opens a sheet by id, unique name or path through the editor's Sheets navigator; an ambiguous name is refused with the candidates. 1.1.0 (B17-F): bound to the view-session bus (was an unbound schema declaration).",
  },
  {
    ...viewSession,
    toolId: "sirkit.selection.control", version: "1.0.0",
    owningCommandId: "view.selection",
    category: "selection",
    title: "Change or highlight the selection",
    description: "Replace, add to, remove from or clear the PCB selection (by refs or a semantic target), select every copper item on a net, highlight a net; select or highlight on the schematic. Selection is view state (never engineering state); relative changes refuse a stale view revision.",
    inputSchema: obj({
      editor: { type: "string", enum: ["pcb", "schematic"] },
      action: { type: "string", enum: ["select", "add", "remove", "clear", "select-net", "highlight-net", "clear-highlight"] },
      target: TARGET,
      refs: { type: "array", items: obj({ kind: { type: "string", enum: ["footprint", "track", "via", "zone", "text", "dimension", "pad"] }, id: { type: "string" }, footprintId: { type: "string" }, padNumber: { type: "string" } }, ["kind"]) },
      netId: { type: "number" }, name: { type: "string" },
    }, ["editor", "action"]), outputSchema: OUT_VIEW_COMMAND,
    requiredProjectState: [],
    binding: { status: "bound-view-session", module: "app/lib/view-session/pcb.ts", symbol: "pcbCommands" },
    viewCommands: ["pcb.select", "pcb.select-add", "pcb.select-remove", "pcb.clear-selection", "pcb.select-net", "pcb.highlight-net", "pcb.clear-highlight", "schematic.select", "schematic.clear-selection", "schematic.highlight-net", "schematic.clear-highlight"],
    sourceEvidence: ["app/lib/view-session/pcb.ts", "app/lib/view-session/schematic.ts", "app/lib/view-session/targets.ts"],
  },
  {
    ...viewSession,
    toolId: "sirkit.view.layers", version: "1.0.0",
    owningCommandId: "view.layer-visibility",
    title: "Layer visibility, active layer and grid",
    description: "Show/hide a PCB layer, toggle it, make a copper layer active, isolate one layer, show every copper layer, show/hide or toggle the grid. View state only; toggles refuse a stale view revision; inner layers refuse on a 2-layer board.",
    inputSchema: obj({
      action: { type: "string", enum: ["set-visible", "toggle", "set-active", "isolate", "show-copper", "set-grid", "toggle-grid"] },
      layer: { type: "string", enum: VIEW_TOOL_ENUMS.pcbLayers }, visible: { type: "boolean" },
    }, ["action"]), outputSchema: OUT_VIEW_COMMAND,
    requiredProjectState: ["board-present", "pcb-surface"],
    binding: { status: "bound-view-session", module: "app/lib/view-session/pcb.ts", symbol: "pcbCommands" },
    viewCommands: ["pcb.set-layer-visible", "pcb.toggle-layer", "pcb.set-active-layer", "pcb.isolate-layer", "pcb.show-copper", "pcb.set-grid", "pcb.toggle-grid"],
    sourceEvidence: ["app/lib/view-session/pcb.ts", "app/components/pcb/LayerPanel.tsx"],
  },
  {
    ...viewSession,
    toolId: "sirkit.view.reveal-finding", version: "1.0.0",
    owningCommandId: "view.reveal-finding",
    title: "Reveal a DRC or routing finding",
    description: "Frame and flash a DRC violation (drc:<violation id>) or an unresolved routing connection (routing:<index>) on the PCB canvas. The schematic editor produces no ERC findings today and refuses honestly.",
    inputSchema: obj({ editor: { type: "string", enum: ["pcb", "schematic"] }, findingId: { type: "string" } }, ["editor", "findingId"]), outputSchema: OUT_VIEW_COMMAND,
    requiredProjectState: ["board-present", "pcb-surface"],
    binding: { status: "bound-view-session", module: "app/lib/view-session/pcb.ts", symbol: "pcbCommands" },
    viewCommands: ["pcb.reveal-finding", "schematic.reveal-finding"],
    sourceEvidence: ["app/lib/view-session/pcb.ts", "app/components/pcb/DrcPanel.tsx"],
  },
  {
    ...viewSession,
    toolId: "sirkit.view.measure", version: "1.0.0",
    owningCommandId: "view.measure",
    title: "Measure between stable objects or points",
    description: "Measure the distance between two stable targets (components by refdes, objects, the primary selected item, or world points) on the PCB without creating a dimension; the readout appears in the user's toolbar. A real dimension is only ever created by the user's dimension tool.",
    inputSchema: obj({ action: { type: "string", enum: ["measure", "clear"] }, a: TARGET, b: TARGET }, ["action"]), outputSchema: OUT_VIEW_COMMAND,
    requiredProjectState: ["board-present", "pcb-surface"],
    binding: { status: "bound-view-session", module: "app/lib/view-session/pcb.ts", symbol: "pcbCommands" },
    viewCommands: ["pcb.measure", "pcb.clear-measurement"],
    sourceEvidence: ["app/lib/view-session/pcb.ts", "app/components/pcb/PcbToolbar.tsx"],
  },
  // ── Schema-only / partial / UI-only / missing — registered, NOT callable ──
  {
    ...readDefaults,
    toolId: "sirkit.pcb.create-via", version: "1.1.0",
    owningCommandId: "pcb.create-via",
    title: "Create via (canonical interactive path; no tool adapter)",
    description: "B08: via creation/editing is a CANONICAL operation family (add_via/update_via/remove_via with exact kernel inverses) executed through the interactive route tool and inspector via the ONE PCB commit gateway. No dedicated reusable agent/tool adapter exists — interactive canonical execution only.",
    category: "pcb", operationClass: "mutate",
    inputSchema: obj({ x: { type: "number" }, y: { type: "number" }, netId: { type: "number" } }, ["x", "y", "netId"]), outputSchema: OUT_RESULT,
    sideEffects: "engineering-state",
    requiredCapability: "edit_copper", requiredRoles: ["pcb_editor", "project_admin"],
    approvalTier: "topology-or-geometry",
    requiredProjectState: ["board-present"], requiredAuthority: ["local-working-copy"],
    requiresExpectedRevision: true, idempotency: "required-key", requiresLineage: true,
    binding: { status: "unbound", notes: "[B09.1] B08 implemented the canonical operations + interactive path (commitPcbCandidate/applyEditsCanonical → CanonicalExecutor; one transaction, exact inverses, change-set audit). 'Canonical human/editor implementation exists' ≠ 'agent tool binding exists': no reusable tool adapter is registered, so callability stays closed." },
    discovery: "discoverable", callability: "not-callable",
    timeoutMs: 5_000, audit: "change-set",
    validationStrategy: "canonical operation validation (interactive path): locks, existence, integer nm, whole-board structure",
    verificationStrategy: "canonical change-set digests + verified-replay undo (interactive path)",
    sourceEvidence: ["app/lib/pcb/route-tool.commands.ts", "app/lib/engineering/operations.ts", "app/lib/engineering/pcb-commit-gateway.ts", "artifacts/ai-control-plane-b08/README.md"],
    versionNotes: "1.1.0 (B09.1): reconciled with B08 truth — canonical interactive implementation exists; still no tool adapter, never agent-exposed.",
  },
  {
    ...readDefaults,
    toolId: "sirkit.pcb.zone-edit", version: "1.1.0",
    owningCommandId: "pcb.zone",
    title: "Zone edit (canonical interactive path; no tool adapter)",
    description: "B08: zone/plane creation and editing execute CANONICALLY — the zone tool, plane dialog, and inspector build candidate boards that the ONE PCB commit gateway delta-compiles into exact operations (one transaction, exact inverses). No dedicated reusable agent/tool adapter exists — interactive canonical execution only.",
    category: "pcb", operationClass: "mutate",
    inputSchema: obj({ zoneId: { type: "string" } }), outputSchema: OUT_RESULT,
    sideEffects: "engineering-state",
    requiredCapability: "edit_zones", requiredRoles: ["pcb_editor", "project_admin"],
    approvalTier: "topology-or-geometry",
    requiredProjectState: ["board-present"], requiredAuthority: ["local-working-copy"],
    requiresExpectedRevision: true, idempotency: "required-key", requiresLineage: true,
    binding: { status: "unbound", notes: "[B09.1] B08 migrated every zone surface onto commitPcbCandidate (\"pcb.zone\") → board-delta compiler → CanonicalExecutor. 'Canonical human/editor implementation exists' ≠ 'agent tool binding exists': no reusable tool adapter is registered, so callability stays closed." },
    discovery: "discoverable", callability: "not-callable",
    timeoutMs: 5_000, audit: "change-set",
    validationStrategy: "canonical operation validation + whole-board structural validation (interactive path)",
    verificationStrategy: "canonical change-set digests + verified-replay undo (interactive path)",
    sourceEvidence: ["app/lib/pcb/zones/command.ts", "app/lib/engineering/pcb-commit-gateway.ts", "app/lib/engineering/pcb-delta.ts", "artifacts/ai-control-plane-b08/README.md"],
    versionNotes: "1.1.0 (B09.1): reconciled with B08 truth — canonical interactive implementation exists; still no tool adapter, never agent-exposed.",
  },
  {
    ...readDefaults,
    toolId: "sirkit.schematic.add-component", version: "1.0.0",
    owningCommandId: "schematic.add-component",
    title: "Add schematic component (human-only canonical command)",
    description: "B07: placement is a canonical human command through the trusted interactive schematic session. Deliberately NOT bound as a tool — no agent, provider, chat, or MCP surface may invoke it.",
    category: "schematic", operationClass: "mutate",
    inputSchema: obj({ partId: { type: "string" } }, ["partId"]), outputSchema: OUT_RESULT,
    sideEffects: "engineering-state",
    requiredCapability: "edit_components", requiredRoles: ["project_admin"],
    approvalTier: "topology-or-geometry",
    requiredProjectState: ["schematic-present"], requiredAuthority: ["local-working-copy"],
    requiresExpectedRevision: false, idempotency: "not-applicable", requiresLineage: false,
    binding: { status: "unbound", notes: "B07: the canonical implementation exists (the add-component operation via SchematicEditorSession), but tool activation is withheld — human interactive execution only." },
    discovery: "internal-only", callability: "not-callable",
    timeoutMs: 5_000, audit: "event-log",
    validationStrategy: "n/a (unbound)", verificationStrategy: "n/a (unbound)",
    sourceEvidence: ["artifacts/ai-control-plane-b01/ui-command-toolability-matrix.csv", "artifacts/ai-control-plane-b07/schematic-graph-command-contract.md"],
    versionNotes: "B07: canonical human command; deliberately never a tool.",
  },
  // ── [B18-C I7] Dimension annotations — a reviewed granted execution (confirmation-only) ──
  {
    ...canonicalMutation,
    toolId: "sirkit.pcb.dimension", version: "1.2.0",
    owningCommandId: "pcb.dimension",
    title: "Add, edit or remove dimension annotations",
    description: "EXECUTION tool: add a dimension annotation measuring between two board points (horizontal, vertical or aligned), change an existing dimension's kind, offset or style (layer, unit, precision, text height, stroke), or remove one. Dimensions are documentation only (silkscreen or fabrication layers, never copper); the displayed value is derived from the points. Calling it never changes the board by itself — the server issues a one-shot grant bound to the current board revision, and the user's editor shows the exact change for the user to confirm; nothing is committed until they do. Name an existing dimension by its stable id (selection-inspect lists the dimensions the user selected; an executed result lists the ids it added); 1–16 edits; an update never moves the measured points (remove it and add a new one).",
    category: "pcb", operationClass: "mutate",
    inputSchema: obj({
      edits: {
        type: "array",
        description: "1–16 dimension edits, applied together as one change.",
        items: obj({
          op: { type: "string", enum: ["add", "update", "remove"], description: "add a new dimension; update an existing one in place; remove one." },
          dimensionId: { type: "string", description: "update / remove only: the stable id of an existing dimension; null for add." },
          kind: { enum: ["horizontal", "vertical", "aligned"], description: "add (required) / update: horizontal measures the X distance between a and b, vertical the Y distance, aligned the straight-line distance; null keeps the kind on update." },
          a: { ...obj({ x: { type: "integer", description: "X in integer nanometres (+x right)." }, y: { type: "integer", description: "Y in integer nanometres (+y down)." } }, ["x", "y"]), description: "add only: the first measured point; null for update / remove." },
          b: { ...obj({ x: { type: "integer", description: "X in integer nanometres (+x right)." }, y: { type: "integer", description: "Y in integer nanometres (+y down)." } }, ["x", "y"]), description: "add only: the second measured point; null for update / remove." },
          offsetNm: { type: "integer", description: "add (required, non-zero) / update: signed distance of the dimension line from the measured points in whole nanometres — horizontal: + is down (+y); vertical: + is right (+x); aligned: + is the right-hand side walking from a to b on screen; null keeps it on update." },
          layer: { enum: ["silkTop", "silkBottom", "fabTop", "fabBottom"], description: "add / update: a documentation layer; null means silkTop on add, unchanged on update." },
          unit: { enum: ["mm", "in"], description: "add / update: the unit of the displayed value; null means mm on add, unchanged on update." },
          precision: { type: "integer", description: "add / update: displayed decimal places, 0–4; null means 2 on add, unchanged on update." },
          textHeightNm: { type: "integer", description: "add / update: label height in whole nanometres, at least 100000 (0.1 mm); null means 1 mm on add, unchanged on update." },
          strokeWidthNm: { type: "integer", description: "add / update: line and label stroke in whole nanometres; null means 0.15 mm on add, unchanged on update." },
        }, ["op"]),
      },
    }, ["edits"]),
    outputSchema: OUT_RESULT,
    requiredCapability: "edit_placement", requiredRoles: ["pcb_editor", "project_admin"],
    // [B18-C I7] re-tiered reversible per the runbook's PCB Tier 1 list (OD-13): documentation-only, exact-inverse edits.
    approvalTier: "reversible", requiredSelectionKinds: [],
    agentExposed: true, executionMode: "granted",
    validationStrategy: "canonical dimension validation (INVALID_DIMENSION) + whole-board structural validation; the seal refuses an invalid dimension before any grant exists",
    verificationStrategy: "canonical change-set digests + verified-replay undo",
    binding: { status: "bound-mutation-editor-session", module: "app/lib/engineering/editor-adapter.ts", symbol: "CanonicalEditorSession.commit", canonicalCommandId: "pcb.dimension", notes: "Trusted UI: the dimension tool and the dimension inspector through the PCB commit gateway, both over the shared pure app/lib/pcb/dimensions/commands.ts. The agent reaches it solely through a server-minted one-shot execution grant (B18-B/C); the ritual commits the grant's exact dimension operations through CanonicalEditorSession.commit." },
    timeoutMs: 5_000,
    sourceEvidence: ["app/lib/pcb/dimensions/commands.ts", "app/lib/pcb/dimensions/geometry.ts", "app/components/pcb/hooks/useDimensionTool.ts", "app/components/pcb/inspectors/DimensionInspector.tsx", "app/lib/engineering/operations.ts", "app/lib/agent/execution-dispatch.ts", "app/lib/engineering/granted-executions.ts"],
    versionNotes: "1.2.0 (B18-C I7): bound and agent-exposed as a reviewed granted execution (confirmation-only: no explicit grammar); re-tiered reversible per the runbook's PCB Tier 1 list (OD-13); deterministic add ids; an update never moves the measured points. 1.1.0 (B09.1): reconciled with B08 truth — implemented and active, no tool adapter.",
  }, ...COMPUTATION_TOOL_DESCRIPTORS, boardPageInspectDescriptor(), generateProposalDescriptor(), pcbSyncPreflightDescriptor(), catalogInspectDescriptor(), componentReviewRequestDescriptor(), missingFactsDescriptor(), draftRequestDescriptor(), moduleContractsDescriptor(), stackupProposalDescriptor(), instanceInspectDescriptor(), candidateSearchDescriptor(), componentResolutionDescriptor(), cadAcquisitionStartDescriptor(), cadAcquisitionStatusDescriptor(), /* [PR-M, 2026-10-18] M2: the schematic-scoped CAD acquisition start and status, declared at the END too */ generationTaskInspectDescriptor(), generationTaskControlDescriptor(), sheetOrganizationProposalDescriptor(), /* [PR-J5, 2026-10-23] the organise proposal (runbook J.6, OD-259 item 4), declared at the END too */ /* [PR-L, 2026-10-18] the durable generation task's inspection and control request (runbook L.5), declared at the END too */ /* [PR-M, 2026-10-17] the schematic-instance inspection, the candidate search and the component resolution proposal, declared at the END too */ /* [PR-F fE, 2026-10-17] the stackup / via-policy proposal, declared at the END too */ /* [PR-F fD, 2026-10-17] the module contract proposal, declared at the END too */ /* [PR-F fB, 2026-10-17] the missing-facts read and the part draft request, declared at the END too */ // [B22-B] the five named computations (OD-139), from computation-tool-descriptors.ts; [B24-D2, 2026-10-09] the bounded paged board read (OD-213), its declaration at the END of this file; [PR-D, 2026-10-16] the Build-mode generation proposal (OD-243), its declaration at the END too; [PR-D d2, 2026-10-16] the Schematic to PCB preflight read, the catalog part inspection and the (unavailable) component review request, declared at the END too
] satisfies readonly ToolDescriptor[]);

let cached: ToolRegistry | null = null;

/** The canonical Sirkit tool registry over the B04 catalog (validated once). */
export function sirkitToolRegistry(): ToolRegistry {
  cached ??= new ToolRegistry(SIRKIT_TOOL_CATALOG);
  return cached;
}

// [B22-B] the five named computation descriptors, on their own line at the END (imports are hoisted): no line of this catalog moves
import { COMPUTATION_TOOL_DESCRIPTORS } from "./computation-tool-descriptors";

/**
 * [B24-D2, 2026-10-09] D24-29, OD-213: the BOUNDED, PAGED board read, declared at the END (a function declaration is hoisted, and
 * readDefaults, obj and OWNER above are initialized before the catalog calls it), so no line of this catalog moves. board-inspect's
 * whole snapshot does not fit in one tool result on a routed board; this read pages one layer, one net or one region of the same
 * snapshot (app/lib/pcb/ai/board-pages.ts), modelled on sirkit.pcb.via-inspect: the same owning command, roles, project state and
 * authority, so it is discovered wherever via-inspect is.
 */
function boardPageInspectDescriptor(): ToolDescriptor {
  return {
    ...readDefaults,
    toolId: "sirkit.pcb.board-page-inspect", version: "1.0.0",
    agentExposed: true,
    owningCommandId: "pcb.board-repair",
    title: "Inspect one page of the board",
    description: "Read the board ONE selection at a time, in pages, in millimetres. Name exactly one selector: an enabled copper layer (`layer`, e.g. copperTop), one net by the board's own name (`netName`, matched exactly; case and surrounding space forgiven), or a flat region (`xMinMm`, `yMinMm`, `xMaxMm`, `yMaxMm`); for a later page pass the previous page's `nextCursor` as `cursor`. Each page gives the board revision, the true count per kind for the whole selection and whole items exactly as board-inspect states them (nets, footprints, pads, tracks, vias, zones, keepouts); `nextCursor` is null on the last page. Use it where board-inspect is too large for one result (a routed board). A wrong selector or a stale cursor gets a closed refusal code; nothing is guessed or changed.",
    category: "pcb", operationClass: "read",
    // [B09.1] length bounds live in server-side input validation (B05 DEFAULT_INPUT_LIMITS), never in wire schemas.
    inputSchema: obj({ layer: { type: "string" }, netName: { type: "string" }, xMinMm: { type: "number" }, yMinMm: { type: "number" }, xMaxMm: { type: "number" }, yMaxMm: { type: "number" }, cursor: { type: "string" } }),
    outputSchema: obj({ page: { type: "object" } }, ["page"]),
    requiredCapability: "read_project", requiredRoles: ["viewer", "commenter", "pcb_editor", "reviewer", "project_admin"],
    requiredProjectState: ["board-present"], requiredAuthority: ["local-working-copy", "durable-server-board"],
    binding: { status: "bound-read", module: "app/lib/pcb/ai/board-pages.ts", symbol: "buildBoardPage", notes: "Pure builder over the verified canonical board through buildAIPcbSnapshot (board-inspect's own projections); no session state, no timing, no authority." },
    discovery: "discoverable", callability: "callable",
    timeoutMs: 10_000,
    validationStrategy: "server-side: exactly one selector (layer, netName, or all four region bounds in mm, minimum not above maximum) and an optional cursor, under the B05 input limits; no bounds in the wire schema",
    verificationStrategy: "derived from the canonical board revision through buildAIPcbSnapshot; membership by layer (footprints with a pad on it, pads with copper on it, tracks on it, vias whose span includes it, zones on it, keepouts listing it), by net (the net, footprints with a pad on it, its pads, tracks, vias and zones) or by region (footprint body bounds, pad and via positions, track segments, zone and keepout polygon bounding boxes meeting the rectangle); kinds in a fixed order, ids by code point; each page's result within BOARD_PAGE_MAX_RESULT_CHARS, and following nextCursor visits every selected item once; an item larger than a whole page is refused by kind and id (item_over_budget), never truncated; a cursor from another revision or selector is refused (stale_cursor)",
    sourceEvidence: ["app/lib/pcb/ai/board-pages.ts", "app/lib/pcb/ai/snapshot.ts", "app/lib/engineering/tool-bindings-readonly.ts"],
    versionNotes: "1.0.0 (B24-D2): first exposure, reviewed in `agent-exposure.ts` (OD-213); withheld from MCP by a reviewed choice in `mcp-exposure-review.ts` although it is servable from the durable board. It states nothing board-inspect does not already state; it exists because board-inspect's whole snapshot does not fit in one tool result on a routed board.",
  };
}

/**
 * [PR-D, 2026-10-16] OD-243: the agent's Build-mode GENERATION proposal, declared at the END (a function declaration is hoisted; the
 * defaults above are initialized before the catalog calls it), so no line of this catalog moves. It is the semantic equivalent of
 * the Build composer's Generate. [PR-L, 2026-10-18] Runbook L.5: since 2.0.0 both start the SAME durable generation task
 * (GenerationTaskService.start; the composer through POST /api/generation-tasks, the agent through the chat route's injected port,
 * app/api/chat/schematic-generation-runtime.ts); the tool answers the task's reference and the page follows it with the same status
 * card and the same review intake (app/lib/agent/generation-proposals.ts). Discovery requires Build mode (`schematic-build-mode`: the
 * validated sheet holds no Theory component), a validated schematic and its canonical head mark (the base the task pins), and the
 * durable task port bound to the run (`schematic-generation`: the server's port fact, never a body claim); the chat turn's deadline
 * ends the turn, never the task, and the loop's single-flight allows one start (or attach) per run.
 */
function generateProposalDescriptor(): ToolDescriptor {
  return {
    ...readDefaults,
    toolId: "sirkit.schematic.generate-proposal", version: "2.0.0", // [PR-L, 2026-10-18] runbook L.5: a DURABLE task start (2.0.0); the in-turn generation of 1.0.0 is removed
    agentExposed: true, // [PR-D] sealed artifact ONLY (since 2.0.0 a task reference); approval stays human-only in the schematic review dialog
    owningCommandId: "schematic.generate",
    title: "Start or follow a Build-mode schematic design",
    description: "Start a Build-mode schematic design (real catalog parts) from a one-paragraph circuit request as the project's DURABLE design task - the SAME task the Build composer's Generate starts - or attach to the design already running for this project. Example input: {\"prompt\":\"A 555 timer LED blinker powered from a 9 V battery through a 5 V linear regulator.\"}. It answers at once with the task's reference and state; the design runs in a generation worker in saved steps, NOT inside this chat turn, so the turn ending or Stop answer never stops it (Stop design does). The page shows its progress and offers its result in the schematic review dialog, where a human approves or discards it; NOTHING is changed by this call. One start per turn; a second design request while one runs attaches to the running one. Read its state later with sirkit.generation.task-inspect.",
    category: "schematic", operationClass: "propose",
    sideEffects: "proposal-artifact",
    inputSchema: obj({ prompt: { type: "string", description: "The circuit request in plain words (1 to 4000 characters): what the circuit does, its supply, its inputs and outputs, and named parts where they matter." } }, ["prompt"]),
    outputSchema: OUT_RESULT,
    requiredCapability: "read_project", requiredRoles: ["pcb_editor", "reviewer", "project_admin"],
    requiredProjectState: ["schematic-present", "schematic-build-mode"], requiredAuthority: ["schematic-generation"],
    requiresExpectedRevision: true,
    // the task pins the editor's sheet as its base and the loop's B09.1 gate holds every schematic proposal to a canonical head mark, so discovery requires an open lineage
    requiresLineage: true,
    binding: { status: "bound-proposal", module: "app/lib/generation-task/service.ts", symbol: "GenerationTaskService", notes: "PR-L (runbook L.5, 2026-10-18): the ONE durable generation-task service the routes call - start / attach with the start route's closed body, its idempotency (a client request id derived from the run and the provider call), one active task per project and branch (the index CAS), the editor roles, the provider-servable rule and the per-task allowance; origin chat, the asking run recorded. The agent reaches it only through the chat route's injected port (app/api/chat/schematic-generation-runtime.ts); SchematicGenerationProposalService (app/lib/agent/generation-proposals.ts) checks the binding, integrity, discovery, role and the closed argument surface, then answers the task reference (sirkit.generation-task-ref.v1). The design runs in the generation worker (app/lib/generation-task/worker); nothing is applied here." },
    discovery: "discoverable", callability: "callable",
    // [PR-L, 2026-10-18] a durable start answers in milliseconds: an interactive tool now (it was the 185 s in-turn generation ceiling)
    timeoutMs: 15_000, budgetClass: "interactive",
    validationStrategy: "closed argument surface (exactly prompt, 1-4000 characters; authority-shaped keys such as scope, base, provider or clientRequestId refused by name) under the B05 input limits; the server's generation fact and port, a validated schematic and a provider call id are required; the start route's own validation (GenerationTaskService.start: the closed body, the editor role, the provider rule, the index CAS) decides acceptance; a refused start is reported as data, nothing accepted",
    verificationStrategy: "the reference names a task read back from the durable store in the trusted scope; the page re-reads the task through its own authorized GET /api/generation-tasks/[id] before following it, and its result is verified at intake (the task's result digest, the base digest under the task's recipe, the exact-base pin) and laid out through the same autoLayoutBuildValidated the Build composer uses",
    sourceEvidence: ["app/lib/generation-task/service.ts", "app/lib/agent/generation-proposals.ts", "app/lib/agent/generation-task-tools.ts", "app/api/chat/schematic-generation-runtime.ts", "app/api/generation-tasks/route.ts", "app/lib/agent/gateway.ts"],
    versionNotes: "2.0.0 (PR-L, runbook L.5, 2026-10-18): starts or attaches the durable generation task the Build composer uses and answers its reference (generation_task_ready); the 1.0.0 in-turn generation (runBuildMultiGeneration inside the run, sealed as sirkit.schematic-generation-proposal.v1) is removed from the agent tool. 1.0.0 (PR-D, OD-243): first exposure, reviewed in agent-exposure.ts; withheld from MCP by a reviewed choice in mcp-exposure-review.ts.",
  };
}

/**
 * [PR-D d2, 2026-10-16] The agent's Schematic → PCB PREFLIGHT read, declared at the END (a function declaration is hoisted), so no line
 * of this catalog moves. It is the semantic equivalent of what the editor's Prepare PCB (`PcbEditor.handleSync`; the journey strip's
 * `prepare_pcb`) decides BEFORE its first server call: the SAME `listUnresolvedInstances` / `unresolvedInstancesRefusal` / row texts,
 * and the same bind filter, through the ONE pure report function (app/lib/pcb-sync/preflight-read.ts) over the run's verified
 * schematic snapshot - board-less, as the editor's own run is (Prepare PCB exists to make the first board), so it travels its own Tier 0
 * service (app/lib/agent/pcb-sync-preflight-reads.ts) and not the B05 canonical-state binding. The server stages (bindings,
 * publication, the durable preflight and its blockers) travel as `not_run` data: not checked is not a pass.
 */
function pcbSyncPreflightDescriptor(): ToolDescriptor {
  return {
    ...readDefaults,
    toolId: "sirkit.pcb-sync.preflight", version: "1.0.0",
    agentExposed: true, // [PR-D d2] a Tier 0 read over the run's verified schematic snapshot; nothing is bound, published or applied
    owningCommandId: "pcb.sync-durable",
    title: "Check what blocks Prepare PCB before any server call",
    description: "Run the checks the editor's Prepare PCB (Schematic to PCB) runs BEFORE it calls the server, over the run's verified schematic: every instance that cannot reach the board (no published exact revision, a published revision without its installed symbol asset, or a Theory symbol with no physical package), each with the missing fact and the review path the editor shows, the refusal sentence the editor would show, and a census of the instances the server preparation would bind. Example input: {}. The server stages (bindings, publication, the durable preflight and its blockers) are reported as not run: not checked is not a pass, and no board is prepared, bound or applied by this read; the user runs Prepare PCB in the PCB editor.",
    category: "validation", operationClass: "read",
    inputSchema: obj({}), outputSchema: OUT_REPORT,
    requiredCapability: "read_project", requiredRoles: ALL_ROLES,
    requiredProjectState: ["schematic-present"], requiredAuthority: ["local-working-copy"],
    binding: { status: "bound-read", module: "app/lib/pcb-sync/preflight-read.ts", symbol: "buildPcbSyncPreflightReport", notes: "PR-D d2: the SAME listUnresolvedInstances / unresolvedInstancesRefusal / UNRESOLVED_MISSING_LABEL / UNRESOLVED_REVIEW_PATH the editor's handleSync calls (app/components/pcb/PcbEditor.tsx) and the same Boolean(atomicPartRevisionId) bind filter, in one pure report; invoked only through PcbSyncPreflightReadService (app/lib/agent/pcb-sync-preflight-reads.ts) over the run's verified schematic snapshot (digest-pinned by the gateway's integrity check), board-less like the editor's own run. No second checker; no server stage runs." },
    discovery: "discoverable", callability: "callable",
    timeoutMs: 2_000,
    validationStrategy: "closed argument surface (no arguments; an authority-shaped key is refused by name) under the B05 input limits; the verified schematic snapshot and its digest are required; discovery, role and capability rechecked per call; the output is schema-checked and bounded (at most 200 unresolved rows listed, the rest counted)",
    verificationStrategy: "pure over the run's verified schematic snapshot (the integrity check recomputes its digest before every call; the result names that digest as its source); the server stages are stated as not run, never inferred",
    sourceEvidence: ["app/lib/pcb-sync/preflight-read.ts", "app/lib/pcb-sync/unresolved-instances.ts", "app/components/pcb/PcbEditor.tsx", "app/lib/agent/pcb-sync-preflight-reads.ts", "app/lib/agent/gateway.ts"],
    versionNotes: "1.0.0 (PR-D d2): first exposure, reviewed in agent-exposure.ts; withheld from MCP by a reviewed choice in mcp-exposure-review.ts (its only input is the editor's browser-only SchematicState, as OD-69's reads).",
  };
}

/**
 * [PR-D d2, 2026-10-16] The agent's CATALOG PART INSPECTION read, declared at the END too. ONE part of Sirkit's own parts catalog by
 * its id, through the SAME `loadCatalogPartDetail` the parts detail route answers the browser's part cache with (extracted from
 * app/api/parts/[id]/route.ts into app/lib/atomic/catalog-part-detail.ts: one reader) plus the published revision status read; the
 * agent reaches them only through the chat route's injected catalog port (app/api/chat/catalog-inspection-runtime.ts), advertised
 * as the `catalog` authority ONLY with the server's fact. Bounded, closed output; never a distributor call.
 */
function catalogInspectDescriptor(): ToolDescriptor {
  return {
    ...readDefaults,
    toolId: "sirkit.parts.catalog-inspect", version: "1.0.0",
    agentExposed: true, // [PR-D d2] a Tier 0 read of ONE catalog part through the chat route's injected catalog port; no distributor call; nothing placed, bound or published
    owningCommandId: "parts.catalog-read",
    title: "Inspect one catalog part by id",
    description: "Read ONE part of Sirkit's own parts catalog by its part id (a placed KiCad instance's partId): name, manufacturer part number, manufacturer, library and category, the footprint hint and normalized package, the lifecycle and RoHS status, the symbol's pins (number, name, type; at most 128 listed, the rest counted), and its published exact atomic revisions per value key with each revision's catalog status (published, deprecated, superseded or revoked; selectable; pinnable) and the value keys whose link points at a withdrawn or missing revision. Example input: {\"partId\":\"3f2a9c1e-0b7d-4e5a-9c21-7d8e6f5a4b3c\"}. The answer is catalog data read on the server, never a distributor lookup and never engineering authority: a part that is not in the catalog is reported as not found, and nothing is placed, bound or published.",
    category: "parts", operationClass: "read",
    inputSchema: obj({ partId: { type: "string", description: "The catalog part id (1 to 128 characters: letters, digits, dot, underscore, colon or hyphen), as a placed KiCad instance's partId." } }, ["partId"]),
    outputSchema: OUT_RESULT,
    requiredCapability: "read_project", requiredRoles: ALL_ROLES,
    requiredProjectState: [], requiredAuthority: ["catalog"],
    binding: { status: "bound-read", module: "app/lib/atomic/catalog-part-detail.ts", symbol: "loadCatalogPartDetail", notes: "PR-D d2: the ONE catalog part read the parts detail route (app/api/parts/[id]/route.ts) answers the browser's part cache with, plus the published revision status read (loadAtomicRevisionStatus, app/lib/atomic/server-catalog.ts); the agent reaches them only through the chat route's injected port (app/api/chat/catalog-inspection-runtime.ts), and CatalogInspectionReadService (app/lib/agent/catalog-inspection-reads.ts) checks the binding, integrity, the server's fact, discovery and role, then answers a closed bounded projection. No live distributor call." },
    discovery: "discoverable", callability: "callable",
    timeoutMs: 8_000,
    validationStrategy: "closed argument surface (exactly partId, 1-128 characters of the id alphabet; authority-shaped keys refused by name) under the B05 input limits; the server's catalog fact and port are required; discovery, role and capability rechecked per call; the port's answer is projected through a closed allowlist (no raw symbol text, no properties blob, no links) and schema-checked",
    verificationStrategy: "a server catalog read at the time of the call (never pinned to a project revision): the loader's id shape check runs before any database read, a miss is data (found false), a failure is a refusal with a closed code",
    sourceEvidence: ["app/lib/atomic/catalog-part-detail.ts", "app/lib/atomic/server-catalog.ts", "app/api/parts/[id]/route.ts", "app/lib/agent/catalog-inspection-reads.ts", "app/api/chat/catalog-inspection-runtime.ts"],
    versionNotes: "1.0.0 (PR-D d2): first exposure, reviewed in agent-exposure.ts; withheld from MCP by a reviewed choice in mcp-exposure-review.ts (the MCP server binds no catalog port; servable from durable state in principle, as OD-235's read).",
  };
}

/**
 * [PR-D d2, 2026-10-16] The component REVIEW REQUEST, declared at the END too, registered NOT callable so the coverage matrix shows the
 * operation with its disposition (unavailable) and its honest reason instead of a missing row. The editor's two review paths - the
 * Component review panel's Request review (physical-bindings request_atomic_review, app/lib/physical-binding/review-handoff.ts) and the
 * Build Library's Request evidence review (the atomic publication review, app/lib/atomic/publication-review.ts) - both refuse any
 * non-human actor on the server (assertHuman; the publication review admits no AI actor at any step), so no server-owned service
 * exists that an agent may call, and inventing one would be a second, agent-callable review path. Restoring it needs an owner decision.
 */
function componentReviewRequestDescriptor(): ToolDescriptor {
  return {
    ...readDefaults,
    toolId: "sirkit.component.review-request", version: "1.0.0",
    owningCommandId: "pcb.component-review",
    title: "Component review request (human-only path; unavailable)",
    description: "The editor's Request review (Component review panel; the reviewer handoff of Prepare PCB's bind step) files a durable review request for one component's exact atomic candidate, which a reviewer approves or rejects (physical-bindings request_atomic_review). UNAVAILABLE to the assistant, because the server's requestComponentReview admits a human requester only and the parts evidence review (Build Library, Request evidence review) is the human-only atomic publication review. No server-owned review-request service accepts an agent actor, so no binding exists and this descriptor is not callable; the assistant may only name the handoff for the user.",
    category: "pcb", operationClass: "mutate",
    inputSchema: obj({ componentInstanceId: { type: "string" }, reason: { type: "string" } }, ["componentInstanceId"]), outputSchema: OUT_RESULT,
    sideEffects: "engineering-state",
    requiredCapability: "edit_components", requiredRoles: ["pcb_editor", "reviewer", "project_admin"],
    approvalTier: "reversible",
    requiredProjectState: ["schematic-present"], requiredAuthority: ["durable-server-board"],
    requiresExpectedRevision: false, idempotency: "required-key", requiresLineage: false,
    binding: { status: "unbound", notes: "[PR-D d2] disposition unavailable, by honest reason: the existing review paths (app/lib/physical-binding/review-handoff.ts requestComponentReview; app/lib/atomic/publication-review.ts submitAtomicPublicationRequest) refuse any non-human actor, so a tool here would have no service to call, and a new agent-callable review service would be a second review path. Restoring it needs an owner decision on an agent-filed review request (the requester of record, what the reviewer sees) - recorded for the lead." },
    discovery: "discoverable", callability: "not-callable",
    timeoutMs: 5_000, audit: "event-log",
    validationStrategy: "human path only (not invocable here): the route's closed request shape, the server-projected evidence digest, REVIEW_REQUESTER_ROLES, retirement on revocation or role change",
    verificationStrategy: "human path only (not invocable here): the durable review-request aggregate's revisions; approval publishes the binding under the reviewer's identity",
    sourceEvidence: ["app/lib/physical-binding/review-handoff.ts", "app/api/physical-bindings/route.ts", "app/components/pcb/hooks/useComponentReview.ts", "app/lib/atomic/publication-review.ts", "app/components/editor/BuildLibraryPanel.tsx"],
    versionNotes: "1.0.0 (PR-D d2): registered not-callable so the coverage matrix shows the component review request with its disposition (unavailable) and reason instead of a missing row; never agent-exposed.",
  };
}

/**
 * [PR-F fB, 2026-10-17] The agent's MISSING-FACTS read, declared at the END too (a function declaration is hoisted), so no line of this
 * catalog moves. For every instance the editor's own Schematic to PCB refusal list names (`listUnresolvedInstances`), the SAME
 * checklist the editor's missing-parts list renders: `deriveMissingFacts` (app/lib/parts/missing-facts.ts, the UI's module - ONE
 * derivation) over the run's verified schematic snapshot (no board, as the preflight read) and, ONLY when the chat route's catalog
 * port is bound, the catalog part each instance was placed from (identity and the published exact revision per value) through the
 * SAME port the catalog inspection reads. Without the port every catalog fact is unknown with the source "catalog unavailable": a
 * footprint hint, a pin count or a vendor text never becomes identity or evidence (ENGINEERING_FACTS_NEVER_PROVEN_BY_SOURCING).
 */
function missingFactsDescriptor(): ToolDescriptor {
  return {
    ...readDefaults,
    toolId: "sirkit.parts.missing-facts", version: "1.0.0",
    agentExposed: true, // [PR-F] a Tier 0 read over the run's verified schematic snapshot and the bound catalog port; nothing placed, bound, published or bought
    owningCommandId: "pcb.sync-durable",
    title: "List the missing facts of every unresolved part",
    description: "For every instance the Schematic to PCB run cannot carry to the board (the editor's own refusal list), derive the SAME missing-facts checklist the editor's missing-parts list shows: identity (manufacturer, exact MPN, package), evidence (symbol, footprint, pin-to-pad mapping - known only from a published exact revision) and stock/pricing (sourcing observations, never proof), each known, unknown or conflicting with its source, plus the next actions in order. Example input: {}. Catalog facts come through the server's catalog port only when it is bound to the run; without it every identity and evidence fact is unknown with the source \"catalog unavailable\" - never guessed from a footprint hint, a pin count or a vendor text. At most 50 instances listed, the rest counted. Nothing is placed, bound or published.",
    category: "validation", operationClass: "read",
    inputSchema: obj({}), outputSchema: OUT_REPORT,
    requiredCapability: "read_project", requiredRoles: ALL_ROLES,
    requiredProjectState: ["schematic-present"], requiredAuthority: ["local-working-copy"],
    binding: { status: "bound-read", module: "app/lib/parts/missing-facts.ts", symbol: "deriveMissingFacts", notes: "PR-F: the ONE missing-facts derivation the editor's missing-parts list renders (app/lib/parts/missing-facts.ts), over the editor's own refusal list (listUnresolvedInstances) and the run's verified schematic snapshot; invoked only through MissingFactsReadService (app/lib/agent/missing-facts-reads.ts), which asks the chat route's injected catalog port (app/api/chat/catalog-inspection-runtime.ts, the same port as the catalog inspection) for each placed part only when the server's catalog fact is present, and otherwise reports every catalog fact unknown as catalog unavailable. No second derivation; no distributor call; bounded to 50 instances." },
    discovery: "discoverable", callability: "callable",
    timeoutMs: 8_000,
    validationStrategy: "closed argument surface (no arguments; an authority-shaped key is refused by name) under the B05 input limits; the verified schematic snapshot and its digest are required; discovery, role and capability rechecked per call; the catalog is asked once per distinct placed part id under the call's deadline, a miss, a failure or a late answer being data per instance; the output is schema-checked and bounded (at most 50 checklists, the rest counted)",
    verificationStrategy: "pure over the run's verified schematic snapshot (the integrity check recomputes its digest before every call; the result names that digest as its source); the catalog facts are a server catalog read at the time of the call and the result says so (schematic-snapshot-verified+catalog-read); every fact carries the source that decided it, and an absent catalog is stated, never inferred",
    sourceEvidence: ["app/lib/parts/missing-facts.ts", "app/lib/agent/missing-facts-reads.ts", "app/lib/pcb-sync/unresolved-instances.ts", "app/api/chat/catalog-inspection-runtime.ts", "app/lib/agent/gateway.ts"],
    versionNotes: "1.0.0 (PR-F fB): first exposure, reviewed in agent-exposure.ts; withheld from MCP by a reviewed choice in mcp-exposure-review.ts (its input is the editor's browser-only SchematicState, as OD-244's preflight read).",
  };
}

/**
 * [PR-F fB, 2026-10-17] The agent's part DRAFT REQUEST proposal, declared at the END too. A sealed REQUEST for an explicitly UNVERIFIED
 * draft of one unresolved part, in the vocabulary of the EXISTING human-only atomic publication request (AtomicPublicationSpec,
 * app/lib/atomic/publication-review-contract.ts; the route's submit_request admits a person only, ATOMIC_PUBLICATION_HUMAN_REQUIRED),
 * from the documented facts the request carries, each with its source label or listed as missing; the C.4 blockers of PCB
 * assignment travel as data; no mapping certificate, approval or publication is ever claimed (CONTINUATION C.4-C.6). The agent
 * cannot file it (OD-244 stands): a human member pastes it into the Build Library's Request evidence review.
 */
function draftRequestDescriptor(): ToolDescriptor {
  const fact = (what: string): JsonSchema => obj({ value: { type: "string", description: what }, source: { type: "string", description: "The label of the document that states it (manufacturer datasheet revision and section)." } }, ["value", "source"]);
  return {
    ...readDefaults,
    toolId: "sirkit.parts.draft-request", version: "1.0.0",
    agentExposed: true, // [PR-F] sealed UNVERIFIED draft request ONLY; filing, review, approval and publication stay human-only in the publication review
    owningCommandId: "parts.draft-request", // [PR-F lead, 2026-10-17] its own propose record: B19-E E4 keeps every tool away from the human-only publication-review record
    title: "Propose an unverified draft request for one missing part",
    description: "Seal a REQUEST for an explicitly UNVERIFIED draft of ONE unresolved part from the documented facts it carries (exact MPN, manufacturer, package, pin table, pitch, body dimensions, pin-1 orientation, exposed pad), each given WITH its source label or listed as missing. Example input: {\"refDes\":\"U1\",\"exactMpn\":{\"value\":\"NE555DR\",\"source\":\"TI SLFS022I, page 1\"},\"pinTable\":[{\"number\":\"1\",\"function\":\"ground\",\"source\":\"TI SLFS022I, table 5-1\"}]}. A human files it as a publication request; it lists the missing facts, states that an unknown package variant, pad numbering, pin-1 orientation, pitch, courtyard or exposed-pad mapping BLOCKS PCB assignment, and claims no mapping certificate, approval or publication. It refuses without a pin table, exact MPN and manufacturer, with a fact lacking its source, or with conflicting facts.",
    category: "parts", operationClass: "propose",
    sideEffects: "proposal-artifact",
    inputSchema: obj({
      refDes: { type: "string", description: "The unresolved instance's reference designator, as the missing-facts read lists it." },
      exactMpn: fact("The exact manufacturer part number as published (every suffix character counts)."),
      manufacturer: obj({ name: { type: "string" }, domains: { type: "array", items: { type: "string" }, description: "Official manufacturer domains, lower case (optional)." }, source: { type: "string" } }, ["name", "source"]),
      package: obj({ code: { type: "string", description: "The manufacturer's package code." }, mounting: { type: "string", enum: ["smd", "through_hole"] }, source: { type: "string" } }, ["code", "mounting", "source"]),
      pinTable: { type: "array", description: "Every pin from the datasheet's pin table: number, name, function, the pads it maps to (default: the pin number) and the source.", items: obj({ number: { type: "string" }, name: { type: "string" }, function: { type: "string" }, pads: { type: "array", items: { type: "string" } }, source: { type: "string" } }, ["number", "function", "source"]) },
      pitchMm: obj({ value: { type: "number", description: "Pitch in millimetres." }, source: { type: "string" } }, ["value", "source"]),
      bodyMm: obj({ x: { type: "number" }, y: { type: "number" }, source: { type: "string" } }, ["x", "y", "source"]),
      pin1Orientation: fact("Where pin 1 sits and how the package marks it."),
      exposedPad: obj({ pads: { type: "array", items: { type: "string" }, description: "The exposed pad's pad numbers; an empty list documents that there is none." }, source: { type: "string" } }, ["pads", "source"]),
      datasheet: obj({ locator: { type: "string", description: "The datasheet revision and section cited (a link is never carried)." }, source: { type: "string" } }, ["locator", "source"]),
      missing: { type: "array", items: { type: "string" }, description: "Facts the documents do not state, in plain words." },
      profile: { type: "string", enum: ["schematic_only", "pcb_assignable"], description: "The approval profile requested; pcb_assignable needs every package fact documented." },
    }, ["refDes"]),
    outputSchema: OUT_RESULT,
    requiredCapability: "read_project", requiredRoles: ["pcb_editor", "reviewer", "project_admin"],
    requiredProjectState: ["schematic-present"], requiredAuthority: ["local-working-copy"],
    // the loop's B09.1 gate holds for every schematic proposal (a canonical head mark), so discovery requires the revision and the open lineage too; the sealed scope carries the mark
    requiresExpectedRevision: true, requiresLineage: true,
    binding: { status: "bound-proposal", module: "app/lib/agent/draft-request-proposals.ts", symbol: "compilePartDraftRequest", notes: "PR-F: the pure compile + seal of the request in the publication path's own vocabulary (AtomicPublicationSpec: exactMpn, profile, terminals, package, datasheet, manufacturer; symbol and footprint references left to the person) against the editor's own refusal list and, through the chat route's injected catalog port when bound, the placed catalog part (identity, package and pin count cross-checked; a different part is never substituted). The server's normalizeAtomicPublicationSpec and assembleAtomicDraft run when the HUMAN submits (app/lib/atomic/publication-review.ts: submitAtomicPublicationRequest admits a person only); PartDraftRequestProposalService (app/lib/agent/draft-request-proposals.ts) seals the artifact (sirkit.part-draft-request.v1, verification unverified) or reports the blockers as proposal-blocked data. Nothing is filed, approved or published here." },
    discovery: "discoverable", callability: "callable",
    timeoutMs: 8_000,
    validationStrategy: "closed argument surface (the request's keys only; authority-shaped keys and KiCad asset references refused by name) under the B05 input limits; the verified schematic snapshot and its digest are required; discovery, role and capability rechecked per call; the compile is all-or-nothing: the instance must be one the editor's refusal list names, the exact MPN and manufacturer and a pin table are required, every given fact carries a source label, pin numbers and pad mappings must not conflict, the placed catalog part's identity, package and pin count must not conflict when the catalog port is bound, and pcb_assignable needs every C.4 fact",
    verificationStrategy: "the sealed body's identity digest and the request digest are recomputed by verifySealedPartDraftRequestIntegrity; the artifact's verification is the constant unverified and it names the human path (submit_request, humans only), the facts it documents with their sources, the facts missing and the PCB-assignment blockers; the server's own normalizer, the import review, the reviewer's approval, the administrator's publication and the deterministic mapping checks decide later",
    sourceEvidence: ["app/lib/agent/draft-request-proposals.ts", "app/lib/atomic/publication-review-contract.ts", "app/api/components/atomic/publication/handler.ts", "app/lib/atomic/publication-review.ts", "app/lib/pcb-sync/unresolved-instances.ts", "app/lib/agent/gateway.ts"],
    versionNotes: "1.0.0 (PR-F fB): first exposure, reviewed in agent-exposure.ts; withheld from MCP by a reviewed choice in mcp-exposure-review.ts (it seals against the editor's browser-only SchematicState, as OD-82's proposals).",
  };
}

/**
 * [PR-F fD, 2026-10-17] The agent's MODULE CONTRACT proposal, declared at the END too (a function declaration is hoisted), so no line
 * of this catalog moves. The owner's Astra directive (sections 6-7; CONTINUATION E): the model submits a typed, versioned module
 * contract set (`sirkit.module-contract.v1`) for the run's PINNED schematic - modules with their responsibilities, the components
 * they own by exact sheet identity, ports on the sheet's named nets with limits, logic levels, impedance and permitted loading,
 * the requirement topics (bandwidth, gain, noise, timing, accuracy, power, reference, ground, startup, protection) stated with
 * evidence or listed unknown, footprint / pin authority gaps, placement and routing obligations, tests, and the cross-module
 * constraints over shared nets - and the ONE validator (app/lib/engineering/module-contract.ts) checks it against that sheet
 * through the existing identity, netlist and unresolved-instance authorities. A validated set is SEALED as an engineering note
 * the page shows in the run log (no apply path exists; the human accepts by continuing); a refused set is proposal-blocked data.
 */
function moduleContractsDescriptor(): ToolDescriptor {
  const quantity: JsonSchema = obj({ name: { type: "string" }, value: { type: "number" }, unit: { type: "string", description: "The unit of the value (V, A, ohm, Hz, dB, s, pF, degC, bit); never empty." }, bound: { type: "string", enum: ["min", "max", "typical", "nominal"] } }, ["name", "value", "unit"]);
  const quantities = (): JsonSchema => ({ type: "array", items: quantity });
  const evidence: JsonSchema = {
    type: "array",
    items: obj({ sourceIdentity: { type: "string", description: "The document that states the recommendation: an exact-part datasheet, a manufacturer layout or application note, a reference design or a primary paper." }, documentRevision: { type: "string" }, section: { type: "string" }, applicability: { type: "string", description: "The component, pin, net, module or operating condition it applies to." }, assumptions: { type: "string" }, uncertainty: { type: "string" }, kind: { type: "string", enum: ["hard-requirement", "approved-policy", "optimization-goal"] } }, ["sourceIdentity", "documentRevision", "section", "applicability", "assumptions", "uncertainty", "kind"]),
  };
  const topics = { type: "string", enum: ["bandwidth", "gain", "noise", "timing", "accuracy", "power", "reference", "ground", "startup", "protection"] };
  const port: JsonSchema = obj({
    id: { type: "string" }, net: { type: "string", description: "A named net of the pinned schematic: a net label name, or GND." }, direction: { type: "string", enum: ["input", "output", "bidirectional", "power-in", "power-out", "reference", "ground"] },
    logicLevel: { type: "string" }, voltage: quantities(), current: quantities(), impedance: quantities(), permittedLoading: quantities(),
    unknown: { type: "array", items: { type: "string", enum: ["voltage", "current", "logicLevel", "impedance", "permittedLoading"] }, description: "The facts of this port that stay unknown; a fact neither stated nor listed here is refused." }, evidence,
  }, ["id", "net", "direction"]);
  const requirement: JsonSchema = obj({ topic: topics, statement: { type: "string" }, quantities: quantities(), evidence }, ["topic", "statement", "evidence"]);
  const test: JsonSchema = obj({ id: { type: "string" }, procedure: { type: "string" }, acceptance: { type: "string" }, quantities: quantities(), evidence }, ["id", "procedure", "acceptance"]);
  const moduleSchema: JsonSchema = obj({
    id: { type: "string" }, name: { type: "string" }, responsibility: { type: "string" },
    components: { type: "array", items: obj({ refDes: { type: "string", description: "The reference designator on the pinned schematic; the exact part and revision ids are read from the sheet." }, partId: { type: "string" }, revisionId: { type: "string" } }, ["refDes"]) },
    ports: { type: "array", items: port }, requirements: { type: "array", items: requirement },
    unknown: { type: "array", items: topics }, notApplicable: { type: "array", items: topics },
    partAuthorityGaps: { type: "array", items: { type: "string" }, description: "Owned reference designators that lack a published exact revision or a physical package (the sheet decides; every such instance is acknowledged here)." },
    placementRouting: { type: "array", items: { type: "string" } }, tests: { type: "array", items: test },
  }, ["id", "name", "responsibility", "components", "ports", "requirements"]);
  const constraint: JsonSchema = obj({
    id: { type: "string" }, kind: { type: "string", enum: ["interface", "shared-power", "shared-ground", "shared-clock", "shared-reference", "shared-connector", "net-ownership"] }, net: { type: "string" },
    modules: { type: "array", items: { type: "string" } }, owner: { type: "string", description: "The module that owns the shared net (required for every kind but interface)." }, statement: { type: "string" }, quantities: quantities(),
    loading: obj({ driver: { type: "string" }, quantities: quantities(), unknown: { type: "string", description: "The reason the loading is unknown (given alone, without driver or quantities)." } }), evidence,
  }, ["id", "kind", "net", "modules", "statement", "evidence"]);
  return {
    ...readDefaults,
    toolId: "sirkit.module.propose-contracts", version: "1.0.0",
    agentExposed: true, // [PR-F fD] a sealed engineering note ONLY: no apply path, nothing changes the sheet or a board; the human accepts it by continuing
    owningCommandId: "cd.architecture.workbench",
    title: "Propose module contracts for the pinned schematic",
    description: "Submit a module contract set (sirkit.module-contract.v1) for the current schematic, sealed as an engineering note for human review. A module names its responsibility, the components it owns by reference designator (part and revision ids come from the sheet), its ports on the sheet's named nets (a net label or GND) with voltage and current limits, logic level, impedance and permitted loading, its requirements per topic with evidence, the topics left unknown or not applicable, its part-authority gaps, layout obligations and tests; the constraints state every net two modules share (an interface states its loading or declares it unknown; a shared power, ground, clock, reference or connector net names its owner). Every number carries a unit; every recommendation names its source. Refused as data: an unknown or doubly owned component, an unknown net, a value without a unit, evidence without a source, an unstated interface, over 50 physical instances. Nothing is applied or verified.",



    category: "schematic", operationClass: "propose",
    sideEffects: "proposal-artifact",
    inputSchema: obj({ system: obj({ name: { type: "string" }, statement: { type: "string" }, operatingConditions: quantities() }, ["name", "statement"]), modules: { type: "array", items: moduleSchema }, constraints: { type: "array", items: constraint } }, ["system", "modules", "constraints"]),
    outputSchema: OUT_RESULT,
    requiredCapability: "read_project", requiredRoles: ["pcb_editor", "reviewer", "project_admin"],
    requiredProjectState: ["schematic-present"], requiredAuthority: ["local-working-copy"],
    // the loop's B09.1 gate holds for every schematic proposal (a canonical head mark): the set is pinned to the sheet's exact base digest and head mark
    requiresExpectedRevision: true, requiresLineage: true,
    binding: { status: "bound-proposal", module: "app/lib/engineering/module-contract.ts", symbol: "validateModuleContractSet", notes: "PR-F fD: the ONE validator of a module contract set against the pinned schematic - identities through the sheet's own instances (KiCad part and published exact revision ids; Theory ids and types), nets through the netlist authority's names (app/lib/pcb/netlist-bridge.ts buildNetlist: labels win, ground is GND) united with the sheet's declared labels, footprint / pin authority through the editor's own refusal list (app/lib/pcb-sync/unresolved-instances.ts listUnresolvedInstances), units and evidence shape, single ownership, and the cross-module interface statements (an output meeting an input across modules must state its loading or declare it unknown; a shared reference names its owner). ModuleContractProposalService (app/lib/agent/module-contract-proposals.ts) seals the validated set (sirkit.module-contract-proposal.v1, verification contract-structure-checked, electricalCheck not_run) or reports the blockers as proposal-blocked data. No electrical check runs; nothing is applied." },
    discovery: "discoverable", callability: "callable",
    timeoutMs: 8_000,
    validationStrategy: "closed argument surface (exactly system, modules, constraints; authority-shaped keys refused by name) under the B05 input limits; the verified schematic snapshot, its digest and its canonical head mark are required; discovery, role and capability rechecked per call; the validation is all-or-nothing with every blocker listed: every owned component an exact identity of the sheet owned exactly once (a stated part or revision id must agree), every port and constraint net a named net of the sheet, every quantity with a unit, every stated port fact and requirement with evidence naming a source, every port fact and requirement topic stated or listed unknown (or not applicable), every owned unresolved instance acknowledged as a part-authority gap and none claimed falsely, every shared net stated by a constraint over every module carrying it (a driver-to-receiver net by an interface with its loading; a shared reference with its owner), one owner per net, at most 50 physical instances on the sheet",
    verificationStrategy: "the sealed body's identity digest and the contract digest are recomputed by verifySealedModuleContractProposalIntegrity; the artifact's verification is the constant contract-structure-checked and its electricalCheck is not_run (no ERC, simulation or electrical check ran; the existing deterministic checks recheck the composed circuit later); the sealed set carries the exact identities read from the pinned sheet, the derived part-authority rows (the editor's refusal list), the coverage (physical instances, owned, unassigned, known and referenced nets, shared nets with their constraints) and the human review task",
    sourceEvidence: ["app/lib/engineering/module-contract.ts", "app/lib/agent/module-contract-proposals.ts", "app/lib/pcb/netlist-bridge.ts", "app/lib/pcb-sync/unresolved-instances.ts", "app/lib/agent/gateway.ts", "app/lib/agent/loop.ts"],
    versionNotes: "1.0.0 (PR-F fD): first exposure, reviewed in agent-exposure.ts; withheld from MCP by a reviewed choice in mcp-exposure-review.ts (it validates against the editor's browser-only SchematicState and seals its head mark, as OD-82's proposals; MCP exposure stays read-only). The page shows the sealed note in the run log; a richer review surface is later work.",
  };
}

/**
 * [PR-F fE, 2026-10-17] The placement INTENT block of `sirkit.placement.propose` (`sirkit.placement-intent.v1`; directive section 8),
 * built by a hoisted FUNCTION declared at the END (a const here would still be in its temporal dead zone when the catalog array above
 * evaluates), so no line of this catalog moves. Every length is in millimetres in the board-world frame; every component is
 * { ref, instanceId } and every net { name, id }, both halves bound to the SAME object of the board revision by the service
 * (app/lib/pcb/placement/intent.ts compilePlacementIntent); the frame statement the manual prints is that module's.
 */
function placementIntentInputSchema(): JsonSchema {
  const component = obj({ ref: { type: "string", description: "The reference designator exactly as the board shows it (R1, U3, J2)." }, instanceId: { type: "string", description: "The footprint instance id of the SAME component (board-inspect lists it); both must match or the whole intent is refused." } }, ["ref", "instanceId"]);
  const net = obj({ name: { type: "string", description: "The net name exactly as the board names it." }, id: { type: "integer", description: "The board net id of the SAME net; both must match or the whole intent is refused." } }, ["name", "id"]);
  const pointMm = obj({ x: { type: "number", description: "millimetres, board-world frame: +x right" }, y: { type: "number", description: "millimetres, board-world frame: +y down" } }, ["x", "y"]);
  const polygonMm = { type: "array", items: pointMm, description: "3 to 32 corners in millimetres (mm) in the board-world frame (+x right, +y down; the world origin, not the outline corner)." };
  const regionSide = { type: "string", enum: ["top", "bottom", "both"] };
  return obj({
    schema: { type: "string", enum: ["sirkit.placement-intent.v1"] },
    units: { type: "string", enum: ["mm"], description: "Every length and coordinate below is in millimetres (mm); nothing else is accepted." },
    frame: { type: "string", enum: ["board-world"], description: "The board's world frame as the PCB model stores it: +x right, +y down, origin at the world (0, 0), a component's position is its footprint origin; rotation in whole degrees, counter-clockwise as seen on screen, 0 | 90 | 180 | 270; side bottom mirrors across x." },
    regions: { type: "array", description: "Named placement regions (rooms) a group may be assigned to.", items: obj({ id: { type: "string" }, name: { type: "string" }, polygonMm, side: regionSide }, ["id", "polygonMm"]) },
    groups: { type: "array", description: "Functional groups of exact components; a regionId keeps the group inside that region (members without an explicit coordinate start at the region's centre).", items: obj({ id: { type: "string" }, name: { type: "string" }, members: { type: "array", items: component }, regionId: { type: "string" } }, ["id", "members"]) },
    placements: { type: "array", description: "Explicit coordinates (and optionally rotation / side) for exact components; the engine's legalization may move them and every move is reported as a conflict.", items: obj({ component, xMm: { type: "number", description: "millimetres, +x right" }, yMm: { type: "number", description: "millimetres, +y down" }, rotationDeg: { type: "integer", enum: [0, 90, 180, 270], description: "whole degrees, counter-clockwise as seen on screen" }, side: { type: "string", enum: ["top", "bottom"] } }, ["component", "xMm", "yMm"]) },
    proximity: { type: "array", description: "Pin-specific proximity: keep a component (or one of its pads) within a distance of another component (or pad); measured on the candidate and reported.", items: obj({ component, pad: { type: "string", description: "The pad number on component (optional; the footprint origin otherwise)." }, near: component, nearPad: { type: "string" }, maxDistanceMm: { type: "number", description: "millimetres, above 0" }, reason: { type: "string" } }, ["component", "near", "maxDistanceMm"]) },
    separations: { type: "array", description: "Keep two components' placement envelopes at least this far apart (millimetres); measured on the candidate and reported.", items: obj({ component, from: component, minDistanceMm: { type: "number", description: "millimetres, above 0" }, reason: { type: "string" } }, ["component", "from", "minDistanceMm"]) },
    corridors: { type: "array", description: "Routing corridors kept free of component envelopes (a polygon in millimetres, optionally for named nets); any component entering one is reported.", items: obj({ id: { type: "string" }, name: { type: "string" }, polygonMm, side: regionSide, nets: { type: "array", items: net } }, ["id", "polygonMm"]) },
    criticalNets: { type: "array", description: "Net priorities (1 most critical) carried as data for the reviewer and the routing step; the placement engine does not enforce them.", items: obj({ net, priority: { type: "integer", enum: [1, 2, 3] }, reason: { type: "string" } }, ["net", "priority"]) },
  }, ["schema", "units", "frame"]);
}

/**
 * [PR-F fE, 2026-10-17] The agent's STACKUP / VIA-POLICY proposal, declared at the END too (a function declaration is hoisted), so no
 * line of this catalog moves. A sealed RECOMMENDATION (sirkit.stackup-candidate.v1; directive section 9) of a layer count and layer
 * roles, reference planes, power distribution and a through-via profile chosen ONLY among the tree's stackup profiles
 * (app/lib/pcb/stackup.ts STACKUP_PROFILES), its two- and four-layer manufacturing presets (app/lib/pcb/drc/presets with their fab
 * bundles) and its via padstacks; release qualification is stated per preset (QUALIFIED_RULE_PROFILE_IDS: jlcpcb-2l only). Blind,
 * buried, micro, via-in-pad or stacked vias, materials, dielectrics, copper weights, thicknesses, impedance and other layer counts
 * are refused as proposal-blocked data with the one reason "unsupported until the complete chain is proven". Nothing is applied: the
 * human changes the stackup through the PCB editor's Stackup selector (pcb.board-geometry), and a different layer count or profile is
 * marked as invalidating dependent approvals with the rules cited inside the candidate.
 */
function stackupProposalDescriptor(): ToolDescriptor {
  const net = obj({ name: { type: "string", description: "The net name exactly as the board names it." }, id: { type: "integer", description: "The board net id of the SAME net." } }, ["name", "id"]);
  return {
    ...readDefaults,
    toolId: "sirkit.stackup.propose", version: "1.0.0",
    agentExposed: true, // [PR-F fE] sealed recommendation ONLY; the stackup is changed by the human in the PCB editor's Stackup selector
    owningCommandId: "pcb.board-geometry",
    title: "Propose a stackup and via policy",
    description: "Recommend a layer count and layer roles, reference planes and a through-via profile for the CURRENT board, chosen only among the qualified stackup profiles (simple-2, signal-plane-4, all-signal-4, dense-4), the two- and four-layer manufacturing profiles (jlcpcb-2l, jlcpcb-4l, pcbway-standard, oshpark-4l) and the via padstacks this board defines, sealed into a revision-bound candidate. Example input: {\"profileId\":\"signal-plane-4\",\"manufacturingProfileId\":\"jlcpcb-4l\",\"planes\":[{\"layer\":\"in1\",\"net\":{\"name\":\"GND\",\"id\":1}}]}. The candidate states physical and routable signal layer counts apart, whether the manufacturing profile is release-qualified, which via profiles meet the manufacturer's minimum, and that a different layer count or profile invalidates dependent approvals. Blind, buried, micro, via-in-pad or stacked vias, materials, impedance and other layer counts are refused as data: unsupported until the complete chain is proven. Receiving it changes nothing.",
    category: "pcb", operationClass: "propose",
    sideEffects: "proposal-artifact",
    inputSchema: obj({
      profileId: { type: "string", enum: ["simple-2", "signal-plane-4", "all-signal-4", "dense-4"], description: "The stackup profile (layer count and layer roles) as app/lib/pcb/stackup.ts defines it." },
      manufacturingProfileId: { type: "string", enum: ["jlcpcb-2l", "jlcpcb-4l", "pcbway-standard", "oshpark-4l"], description: "The manufacturing (DRC / fab) preset; its copper layer count must match the profile's. Absent: the run's active preset." },
      planes: { type: "array", description: "Reference planes: an inner layer that is a plane in the chosen profile and the exact board net it carries.", items: obj({ layer: { type: "string", enum: ["in1", "in2"] }, net }, ["layer", "net"]) },
      viaPadstackIds: { type: "array", items: { type: "string" }, description: "Via profiles by padstack id among this board's padstacks and the class defaults (via-default, via-power, via-highcurrent); absent: all of them, each checked against the preset's minimum." },
      viaTechnology: { type: "string", enum: ["through"], description: "Only through vias are qualified; any other technology is refused as data." },
      rationale: { type: "string", description: "Why this stackup (up to 600 characters); carried as data for the reviewer." },
    }, ["profileId"]),
    outputSchema: OUT_RESULT,
    requiredCapability: "read_project", requiredRoles: ["pcb_editor", "project_admin"],
    requiredProjectState: ["board-present"], requiredAuthority: ["local-working-copy"],
    binding: { status: "bound-proposal", module: "app/lib/pcb/candidates/stackup-candidate.ts", symbol: "compileStackupCandidate", notes: "PR-F fE: the ONE pure compile over the verified canonical board - the tree's STACKUP_PROFILES (physical vs routable signal layers), the DRC presets with their fab copper bundles (release qualification from QUALIFIED_RULE_PROFILE_IDS), the board's via padstacks and the seeded class defaults checked against the preset's minima, the revision / approval invalidation rules cited; StackupProposalService (app/lib/agent/stackup-proposals.ts) checks the binding, integrity, the board, discovery, role and the closed request, then seals (sirkit.stackup-candidate.v1) or reports the blockers as proposal-blocked data. Nothing is applied here: the human path is PcbEditor's Stackup selector (pcb.board-geometry)." },
    discovery: "discoverable", callability: "callable",
    timeoutMs: 8_000,
    validationStrategy: "closed argument surface (profileId required; manufacturingProfileId, planes, viaPadstackIds, viaTechnology, rationale; authority-shaped keys refused by name; the unsupported-capability keys reach the compiler so their refusal carries the exact reason) under the B05 input limits; a verified canonical board is required; discovery, role and capability rechecked per call; the compile is all-or-nothing against the tree's own profiles, presets, layer roles, board nets and padstacks",
    verificationStrategy: "the sealed body's content digest is recomputed by stackupCandidateIntact; the candidate is pinned to the board revision and expires; nothing is applied by the tool - the editor's own Stackup selector commits the change as one canonical transaction, after which DRC, the export preflight and the manufacturing qualification re-run from scratch (the cited invalidation rules)",
    sourceEvidence: ["app/lib/pcb/candidates/stackup-candidate.ts", "app/lib/agent/stackup-proposals.ts", "app/lib/pcb/stackup.ts", "app/lib/pcb/drc/presets/index.ts", "app/lib/pcb/fab/rule-profile.ts", "app/lib/pcb/padstack/defaults.ts", "app/lib/agent/gateway.ts"],
    versionNotes: "1.0.0 (PR-F fE, 2026-10-17): first exposure, reviewed in agent-exposure.ts; withheld from MCP by a reviewed choice in mcp-exposure-review.ts (a proposal, as OD-82; MCP exposure stays read-only).",
  };
}
/**
 * [PR-M, 2026-10-17] Section M.2.1: the agent's SCHEMATIC-INSTANCE INSPECTION, declared at the END too (a function declaration is
 * hoisted), so no line of this catalog moves. A Tier 0 read over the run's VALIDATED schematic snapshot and the server catalog
 * facts of the placed parts (the catalog inspection's own port), board-less like the editor's Prepare PCB: the one derivation is
 * app/lib/component-resolution/instance-facts.ts `inspectSchematicInstances`; the pins come from the catalog symbol, never a
 * browser pin list, and without the catalog port every pin is reported unavailable.
 */
function instanceInspectDescriptor(): ToolDescriptor {
  return {
    ...readDefaults,
    toolId: "sirkit.schematic.instance-inspect", version: "1.0.0",
    agentExposed: true, // [PR-M] a Tier 0 read over the run's verified schematic and the bound catalog port; no board; nothing placed, bound or applied
    owningCommandId: "schematic.review-advisory",
    title: "Inspect schematic instances without a PCB",
    description: "Inspect schematic component instances WITHOUT a PCB: for each, the stable instance id (the only durable target - a reference designator is a label), reference, value, the catalog part and exact atomic revision with its catalog status, whether Prepare PCB would refuse it and why, the published revision its own part links for its value, the symbol's pins (number, name, electrical type, function) from the server catalog symbol, each pin's net and members, and anode / cathode nets of a polar part, with the captured schematic digest and head mark. Example input: {\"componentIds\":[\"D1\",\"D2\"]}; omit componentIds for every unresolved instance. Without the catalog port every pin is unavailable (never guessed). Nothing is placed, bound or applied.",
    category: "schematic", operationClass: "read",
    inputSchema: obj({ componentIds: { type: "array", items: { type: "string" }, description: "Optional: up to 50 stable instance ids or reference designators to inspect; omitted, every instance Prepare PCB would refuse." } }),
    outputSchema: OUT_REPORT,
    requiredCapability: "read_project", requiredRoles: ALL_ROLES,
    requiredProjectState: ["schematic-present"], requiredAuthority: ["local-working-copy"],
    binding: { status: "bound-read", module: "app/lib/component-resolution/instance-facts.ts", symbol: "inspectSchematicInstances", notes: "PR-M: the ONE schematic-instance derivation (the editor's own refusal rule listUnresolvedInstances, the production netlist union-find buildNetlist over the server catalog's pins, the published link rule valueKeyLink); invoked only through InstanceInspectionReadService (app/lib/agent/instance-inspection-reads.ts) over the run's verified schematic snapshot and the chat route's injected catalog port (app/api/chat/catalog-inspection-runtime.ts, the same port as the catalog inspection). Board-less by design: it reads what blocks the first board. No second derivation." },
    discovery: "discoverable", callability: "callable",
    timeoutMs: 8_000,
    validationStrategy: "closed argument surface (only componentIds: 1-50 stable ids or references; authority-shaped keys such as pins, nets or partId refused by name) under the B05 input limits; the verified schematic snapshot and its digest are required; discovery, role and capability rechecked per call; the catalog is asked once per distinct placed part under the call's deadline (a miss, a failure or a late answer is data per part); the output is schema-checked and bounded",
    verificationStrategy: "pure over the run's verified schematic snapshot (the integrity check recomputes its digest before every call; the result names it as its source and carries the head mark); pins and their functions only from the server catalog symbol (schematic-snapshot-verified+catalog-read), otherwise reported unavailable",
    sourceEvidence: ["app/lib/component-resolution/instance-facts.ts", "app/lib/component-resolution/pin-functions.ts", "app/lib/agent/instance-inspection-reads.ts", "app/lib/pcb/netlist-bridge.ts", "app/lib/pcb-sync/unresolved-instances.ts", "app/api/chat/catalog-inspection-runtime.ts"],
    versionNotes: "1.0.0 (PR-M, 2026-10-17): first exposure, reviewed in agent-exposure.ts; withheld from MCP by a reviewed choice in mcp-exposure-review.ts (its input is the editor's browser-only SchematicState, as OD-244's preflight read).",
  };
}

/**
 * [PR-M, 2026-10-17] Section M.2.2: the agent's CANDIDATE SEARCH BY REQUIREMENTS, declared at the END too. Its recall is the Build
 * loop's own hybrid catalog search (app/lib/parts-search.ts searchPartsForAI, embedding-backed, over the catalog's real category
 * vocabulary) through the chat route's injected search port; every hit is re-read through the catalog port and the published
 * revision evidence port and classified by the one compatibility evaluation. Requires the catalog authority (the server's facts).
 */
function candidateSearchDescriptor(): ToolDescriptor {
  const rating: JsonSchema = obj({ property: { type: "string", description: "The published claim property, lower case (e.g. reverse_voltage, forward_current)." }, dimension: { type: "string", enum: ["dimensionless", "voltage", "current", "resistance", "capacitance", "inductance", "power", "frequency", "time", "temperature", "length", "mass"] }, min: { type: "number", description: "Minimum in SI base units." }, max: { type: "number", description: "Maximum in SI base units." } }, ["property", "dimension"]);
  return {
    ...readDefaults,
    toolId: "sirkit.parts.candidate-search", version: "1.0.0",
    agentExposed: true, // [PR-M] a Tier 0 read of the local catalog by requirements through the chat route's injected ports; no distributor; nothing placed, bound or published
    owningCommandId: "parts.catalog-read",
    title: "Search the local catalog for replacement candidates",
    description: "Search Sirkit's local catalog by functional role, specifications and package text for exact published revisions that could resolve ONE instance (componentId), and sort every result into eligible (published, selectable, symbol + footprint + approved mapping, every connected pin mapped by function), draft, missing-asset, withdrawn, incompatible or unresolved, each with its reasons, warnings and the proved pin mapping. The instance's own part is considered first (binding its published revision changes no part). Example input: {\"componentId\":\"D1\",\"query\":\"small-signal fast switching diode 100 V 150 mA\",\"functionalClass\":\"diode\",\"limit\":8}. At most 3 searches per turn. A hit is a candidate, never authority; no distributor is called; compatible is not electrical equivalence.",
    category: "parts", operationClass: "read",
    sideEffects: "derived-cache", // the search's own embedding memo and reranker refusal memo
    inputSchema: obj({
      componentId: { type: "string", description: "The stable instance id (or reference) of the instance to resolve; omitted, assets are classified but suitability is not evaluated." },
      query: { type: "string", description: "The functional role and specifications to search for (1-300 printable characters)." },
      category: { type: "string", description: "Optional catalog category name or request (normalized onto the catalog vocabulary; an unrecognised one filters nothing)." },
      functionalClass: { type: "string", enum: ["diode", "schottky-diode", "zener-diode", "tvs-diode", "led", "resistor", "capacitor", "inductor", "transistor", "integrated-circuit", "connector"], description: "Optional class the replacement must have; omitted, the instance's own class." },
      mounting: { type: "string", enum: ["smd", "through_hole"], description: "Optional required mounting." },
      packageCode: { type: "string", description: "Optional package code the footprint must be (e.g. SOD-123)." },
      ratings: { type: "array", items: rating, description: "Optional stated rating requirements; each must be proven by a published claim." },
      limit: { type: "integer", description: "1-10 search hits to classify (default 10)." },
    }, ["query"]),
    outputSchema: OUT_RESULT,
    requiredCapability: "read_project", requiredRoles: ALL_ROLES,
    requiredProjectState: [], requiredAuthority: ["catalog"],
    binding: { status: "bound-read", module: "app/lib/component-resolution/candidate-search.ts", symbol: "searchResolutionCandidates", notes: "PR-M: recall through the chat route's injected search port over the Build loop's own searchPartsForAI (app/lib/parts-search.ts; embedding-backed, the catalog's category vocabulary, the reranker refusal memo); every hit re-read through the catalog inspection port (loadCatalogPartDetail) and the revision evidence port (loadSelectablePortableSnapshot + loadAtomicRevisionStatus), then classified by evaluateCompatibility (app/lib/component-resolution/compatibility.ts). Invoked only through CandidateSearchReadService (app/lib/agent/candidate-search-reads.ts); at most 3 searches per run." },
    discovery: "discoverable", callability: "callable",
    timeoutMs: 15_000, budgetClass: "batch",
    validationStrategy: "closed argument surface (componentId, query, category, functionalClass, mounting, packageCode, ratings, limit; authority-shaped keys such as atomicPartRevisionId, pins or mapping refused by name) under the B05 input limits; the server's catalog, search and evidence facts and ports are required; discovery, role and capability rechecked per call; at most 3 searches per run, charged before the search port is asked; every port call bounded by the call's deadline",
    verificationStrategy: "every result is re-read from the server catalog and the published revision evidence at the time of the call; eligibility needs a published, selectable revision whose catalog link names exactly its symbol, footprint and approved complete mapping, a catalog symbol drawing the published pins, the same functional class and every connected pin mapped by function to a pad; a stated rating needs a published claim; the output is schema-checked",
    sourceEvidence: ["app/lib/component-resolution/candidate-search.ts", "app/lib/component-resolution/compatibility.ts", "app/lib/agent/candidate-search-reads.ts", "app/lib/parts-search.ts", "app/api/chat/component-resolution-runtime.ts", "app/lib/atomic/server-catalog.ts"],
    versionNotes: "1.0.0 (PR-M, 2026-10-17): first exposure, reviewed in agent-exposure.ts; the second binding admitted by the catalog authority rule (tool-registry.ts catalogAuthorityIssues); withheld from MCP by a reviewed choice in mcp-exposure-review.ts (the MCP server binds no catalog or search port, as OD-235's catalog read).",
  };
}

/**
 * [PR-M, 2026-10-17] Sections M.0 (last paragraph) and M.2.4: the agent's UNRESOLVED-COMPONENT RESOLUTION proposal, declared at the
 * END too. A sealed batch the human reviews and applies through schematic.resolve-components; separate from, and never replacing,
 * the narrower B14 exact replacement above (which keeps its durable-binding requirement for already-qualified parts).
 */
function componentResolutionDescriptor(): ToolDescriptor {
  return {
    ...readDefaults,
    toolId: "sirkit.schematic.propose-component-resolution", version: "1.0.0",
    agentExposed: true, // [PR-M] sealed batch proposal ONLY; applying it is the human's reviewed schematic.resolve-components and never provider-callable
    owningCommandId: "schematic.resolve-components-propose",
    title: "Propose eligible parts for unresolved components",
    description: "Seal ONE coherent batch that resolves unresolved KiCad instances (no published exact revision) to exact eligible revisions from the candidate search: one item per stable instance id with the candidate part and the exact revision the search reported (an assertion the server must reproduce). The server re-reads the catalog and published evidence, proves each pin mapping by function over the approved certificate (a permutation only when proved), keeps references, values, placements and every net, and seals the identities, mapping and material warnings. Example input: {\"items\":[{\"componentId\":\"kc-3a9f01\",\"candidatePartId\":\"part-1n4148w\",\"atomicPartRevisionId\":\"rev-1n4148w-1\"}]}. Receiving it changes NOTHING; a human reviews and applies it. Missing pin evidence returns the missing-facts / draft-request work item instead.",
    category: "schematic", operationClass: "propose",
    sideEffects: "proposal-artifact",
    inputSchema: obj({
      items: { type: "array", description: "1-20 instances to resolve together, each naming the candidate the candidate search reported for it.", items: obj({ componentId: { type: "string", description: "The stable instance id (not the reference designator)." }, candidatePartId: { type: "string", description: "The candidate's catalog part id." }, atomicPartRevisionId: { type: "string", description: "The exact revision the candidate search reported for this instance (an assertion, never a choice)." } }, ["componentId", "candidatePartId", "atomicPartRevisionId"]) },
      functionalClass: { type: "string", enum: ["diode", "schottky-diode", "zener-diode", "tvs-diode", "led", "resistor", "capacitor", "inductor", "transistor", "integrated-circuit", "connector"], description: "Optional class every replacement must have." },
      mounting: { type: "string", enum: ["smd", "through_hole"], description: "Optional required mounting." },
      packageCode: { type: "string", description: "Optional package code every footprint must be (e.g. SOD-123)." },
      ratings: { type: "array", items: obj({ property: { type: "string" }, dimension: { type: "string", enum: ["dimensionless", "voltage", "current", "resistance", "capacitance", "inductance", "power", "frequency", "time", "temperature", "length", "mass"] }, min: { type: "number" }, max: { type: "number" } }, ["property", "dimension"]), description: "Optional stated rating requirements (SI base units), each proven by a published claim." },
    }, ["items"]),
    outputSchema: OUT_RESULT,
    requiredCapability: "read_project", requiredRoles: ["pcb_editor", "reviewer", "project_admin"],
    requiredProjectState: ["schematic-present", "catalog-available"], requiredAuthority: ["local-working-copy"], // catalog-available: the server's catalog fact (context.ts claims the state exactly with it), so without the catalog facts this proposal is withheld at discovery, as the catalog reads are
    // the loop's B09.1 gate holds for every schematic proposal (a canonical head mark), so discovery requires the revision and the open lineage too
    requiresExpectedRevision: true, requiresLineage: true,
    binding: { status: "bound-proposal", module: "app/lib/component-resolution/resolution-assembler.ts", symbol: "assembleResolutionProposal", notes: "PR-M: the ONE resolution assembler over server facts read through the chat route's injected ports (the catalog inspection port for the sheet's and the candidates' parts; the revision evidence port for the published snapshot projection and status): the instance inspection, evaluateCompatibility, the catalog-sourced resolution authority (one fresh runtime grant per item, retired before the artifact leaves), the ONE planSchematicReplacement with the proved mapping, zero dropped connections, no doubly-moved wire end or label, and the sheet's net partition proved unchanged; ComponentResolutionProposalService (app/lib/agent/component-resolution-proposals.ts) seals sirkit.component-resolution-proposal.v1 or returns the blockers as proposal-blocked data. Nothing applied here." },
    discovery: "discoverable", callability: "callable",
    timeoutMs: 15_000, budgetClass: "batch",
    validationStrategy: "closed argument surface (items with componentId, candidatePartId, atomicPartRevisionId; functionalClass, mounting, packageCode, ratings; authority-shaped keys such as pins, mapping, asset ids or grants refused by name; a reference designator refused with its stable id named); a verified schematic, its head mark and the server's catalog and evidence facts are required; discovery, role and capability rechecked per call; all-or-nothing over the batch",
    verificationStrategy: "the sealed batch's operations, impact and identity digests are re-verified at apply (verifySealedResolutionProposal) against the live session head; the apply re-reads fresh server facts through its one-shot channel, recompiles the whole batch and byte-matches the reviewed operations and impact, then proves the postconditions (identities, kept references / values / placements, moved wire ends and labels, unaffected instances, the connectivity digest) inside the canonical transaction",
    sourceEvidence: ["app/lib/component-resolution/resolution-assembler.ts", "app/lib/component-resolution/resolution-proposal.ts", "app/lib/component-resolution/compatibility.ts", "app/lib/component-resolution/approved-resolution-mutations.ts", "app/lib/agent/component-resolution-proposals.ts", "app/lib/agent/gateway.ts"],
    versionNotes: "1.0.0 (PR-M, 2026-10-17): first exposure, reviewed in agent-exposure.ts; withheld from MCP by a reviewed choice in mcp-exposure-review.ts (it seals against the editor's browser-only SchematicState and head mark, as OD-82's proposals).",
  };
}

/**
 * [PR-L, 2026-10-18] Runbook L.5 (task-worker-contract.md section 8): the durable generation task's INSPECTION, declared at the END too
 * (a function declaration is hoisted), so no line of this catalog moves. A Tier 0 read of the task's PUBLIC snapshot from the durable
 * task store through the chat route's injected port (the same service the GET routes answer from): state, phase, liveness, blocks,
 * counts, blocker, valid actions and, once a result exists, a bounded summary of it - never the prompt, the conversation, a tool output,
 * hidden reasoning or the netlist.
 */
function generationTaskInspectDescriptor(): ToolDescriptor {
  return {
    ...readDefaults,
    toolId: "sirkit.generation.task-inspect", version: "1.0.0",
    agentExposed: true, // [PR-L] a Tier 0 read of the durable task's public snapshot; nothing started, stopped or applied
    owningCommandId: "schematic.generate",
    title: "Inspect the project's design task",
    description: "Read the PUBLIC state of the project's durable schematic design task - the one the Build composer's Generate or the generation start began: state, phase, liveness (whether a generation worker is actually running it), its blocks and their status, model-call and catalog-search counts, the remaining allowance, any blocker with its resolution, the actions valid now and, once a reviewable result exists, its completeness, omitted blocks, part and connection counts and electrical check numbers. Example input: {} (the project's running or most recent design), or {\"taskId\":\"generation-task:<32 hex>\"}. Never the prompt, the conversation, tool outputs, reasoning or the netlist; nothing is started, stopped or changed.",
    category: "schematic", operationClass: "read",
    inputSchema: obj({ taskId: { type: "string", description: "Optional: a design task id of this project (generation-task:<32 hex>); omitted, the project's running design, else its most recent one." } }),
    outputSchema: OUT_REPORT,
    requiredCapability: "read_project", requiredRoles: ALL_ROLES,
    requiredProjectState: ["schematic-present"], requiredAuthority: ["schematic-generation"],
    binding: { status: "bound-read", module: "app/lib/generation-task/service.ts", symbol: "GenerationTaskService", notes: "PR-L (runbook L.5): GenerationTaskService.list / .inspect over the durable task store - the same answers GET /api/generation-tasks and GET /api/generation-tasks/[id] serve - through the chat route's injected port; GenerationTaskInspectService (app/lib/agent/generation-proposals.ts) projects an allowlist of the public snapshot and a bounded result summary. Scoped by the trusted run context: a foreign or guessed id is the uniform not_found." },
    discovery: "discoverable", callability: "callable",
    timeoutMs: 10_000,
    validationStrategy: "closed argument surface (only taskId; authority-shaped keys refused by name) under the B05 input limits; the server's generation fact and port are required; discovery, role and capability rechecked per call; the task is resolved in the trusted scope only (an unknown, malformed or foreign id is the same not_found); the output is schema-checked and bounded (GENERATION_TASK_INSPECT_MAX_CHARS)",
    verificationStrategy: "read from the durable task store at the time of the call (generation-task-store-read): the snapshot's liveness comes from the store's leases (running only while a worker holds a live lease), never from a request being open; the result summary is computed from the task's validated result document",
    sourceEvidence: ["app/lib/generation-task/service.ts", "app/lib/generation-task/snapshot.ts", "app/lib/agent/generation-proposals.ts", "app/api/chat/schematic-generation-runtime.ts", "app/api/generation-tasks/[id]/route.ts"],
    versionNotes: "1.0.0 (PR-L, runbook L.5, 2026-10-18): first exposure, reviewed in agent-exposure.ts; withheld from MCP by a reviewed choice in mcp-exposure-review.ts (the MCP server binds no generation-task port).",
  };
}

/**
 * [PR-L, 2026-10-18] Runbook L.5 (OD-252 item 6): the durable generation task's CONTROL REQUEST, declared at the END too. A sealed request
 * (cancel, pause, resume, retry one block) the page shows as a confirm chip; only the human's click sends it to the task's control route,
 * under the human's own authorization and CSRF, where the store judges the transition. Direct agent control would need a reviewed
 * exposure change (OWNER-6).
 */
function generationTaskControlDescriptor(): ToolDescriptor {
  return {
    ...readDefaults,
    toolId: "sirkit.generation.task-control", version: "1.0.0",
    agentExposed: true, // [PR-L] a sealed confirm chip ONLY; the control itself is the human's click on the page (POST /api/generation-tasks/[id]/control)
    owningCommandId: "schematic.generate",
    title: "Ask to stop, pause, resume or retry the design task",
    description: "Prepare a control request for the project's durable design task - cancel (Stop design: nothing more runs and a late result is refused), pause (saved work is kept), resume, or retry-block (one blocked block) - shown to the user as a chip they confirm or dismiss. Example input: {\"action\":\"cancel\"}; retry-block needs blockId. The action must be valid for the task's current state (the snapshot's actions); otherwise nothing is requested and the valid actions are reported. NOTHING happens to the design until the user confirms the chip; Stop answer (ending this chat reply) never stops a design.",
    category: "schematic", operationClass: "propose",
    sideEffects: "proposal-artifact",
    inputSchema: obj({
      action: { type: "string", enum: ["cancel", "pause", "resume", "retry-block"], description: "cancel (Stop design), pause, resume, or retry-block." },
      taskId: { type: "string", description: "Optional: the design task id (generation-task:<32 hex>); omitted, the project's running design." },
      blockId: { type: "string", enum: ["main", "b1", "b2", "b3", "b4", "b5", "b6", "b7", "b8"], description: "For retry-block only: the blocked block to retry (the snapshot's retryBlocks)." },
    }, ["action"]),
    outputSchema: OUT_RESULT,
    requiredCapability: "read_project", requiredRoles: ["pcb_editor", "reviewer", "project_admin"],
    requiredProjectState: ["schematic-present"], requiredAuthority: ["schematic-generation"],
    // the loop's B09.1 gate holds every schematic proposal to a canonical head mark, so discovery requires the revision and the open lineage too
    requiresExpectedRevision: true, requiresLineage: true,
    binding: { status: "bound-proposal", module: "app/lib/generation-task/service.ts", symbol: "GenerationTaskService", notes: "PR-L (runbook L.5, OD-252 item 6): GenerationTaskService.list / .inspect resolve the task in the trusted scope and its server-computed valid actions; GenerationTaskControlProposalService (app/lib/agent/generation-proposals.ts) seals sirkit.generation-task-control-request.v1 or reports the refusal as proposal-blocked data. The control itself is GenerationTaskService.control behind POST /api/generation-tasks/[id]/control, reached only by the human's click on the chip. Nothing is changed here." },
    discovery: "discoverable", callability: "callable",
    timeoutMs: 10_000,
    validationStrategy: "closed argument surface (action required from the closed list; taskId; blockId only for retry-block, from the block id list; authority-shaped keys refused by name) under the B05 input limits; the server's generation fact and port, a validated schematic and its head mark are required; discovery, role and capability rechecked per call; the action must be one the task's current snapshot lists (and the block one of its retryable blocks)",
    verificationStrategy: "the sealed request's identity digest is recomputed by the page's receiver (verifySealedGenerationTaskControlRequest), which also checks the page's project and the expiry; the human's confirmation sends the action to the control route, which re-authorizes the human (role, live membership, exact-origin CSRF) and lets the store judge the transition against the task's state at that moment",
    sourceEvidence: ["app/lib/agent/generation-proposals.ts", "app/lib/agent/generation-task-tools.ts", "app/lib/generation-task/service.ts", "app/lib/generation-task/snapshot.ts", "app/api/generation-tasks/[id]/control/route.ts", "app/lib/project/generation-proposal-events.ts"],
    versionNotes: "1.0.0 (PR-L, runbook L.5, 2026-10-18): first exposure, reviewed in agent-exposure.ts; a confirm chip by OD-252 item 6 (direct control would be OWNER-6); withheld from MCP by a reviewed choice in mcp-exposure-review.ts (a proposal: MCP exposure stays read-only, OD-82).",
  };
}

/**
 * [PR-M, 2026-10-18] Section M2 (design M2.1): the agent's SCHEMATIC-SCOPED CAD acquisition, declared at the END too (a function
 * declaration is hoisted), so no line of this catalog moves. Both work BEFORE any PCB exists - a verified schematic snapshot and the
 * server's `cadAcquisitionAvailable` fact, never `canonical-state` - over the ONE durable component-resolution task service the page
 * route answers from (app/lib/component-resolution/task/service.ts); the board-gated external search and evidence read keep their contract.
 */
function cadAcquisitionStartDescriptor(): ToolDescriptor {
  return {
    ...readDefaults,
    toolId: "sirkit.parts.acquisition-start", version: "1.0.0",
    agentExposed: true, // [PR-M] starts (or attaches to) a durable acquisition task; mutates no design; publishes, approves, binds and buys nothing
    owningCommandId: "parts.cad-acquisition",
    title: "Obtain a part's CAD assets for the library",
    description: "Start (or attach to) the durable acquisition task for catalog instances of ONE catalog part that have no eligible local revision: a worker retrieves the part's real KiCad symbol and footprint (and a pin table where an admitted source has one) from an ADMITTED CAD source only (the pinned official KiCad library; never an arbitrary URL), stores and hashes the bytes, parses and validates pins, pads, mapping, package and pin 1, and prepares a review package. Works without a PCB. Example input: {\"componentIds\":[\"kc-3a9f01\",\"kc-3a9f02\"],\"requirement\":{\"mounting\":\"through_hole\",\"packageCode\":\"DO-35\"},\"assetKinds\":[\"symbol\",\"footprint\",\"datasheet\"]}. NOTHING in the design changes; a PERSON sends the package for review, a reviewer approves and a different administrator publishes; only then is the replacement offered for the user's review. A published revision of the same part is reused without any download.",
    category: "parts", operationClass: "propose",
    sideEffects: "proposal-artifact", // a durable task record (as the generation start): no design state, no publication
    inputSchema: obj({
      componentIds: { type: "array", items: { type: "string" }, description: "1-8 stable instance ids (not reference designators) of catalog instances of the same catalog part." },
      requirement: obj({ exactMpn: { type: "string" }, manufacturer: { type: "string" }, packageCode: { type: "string", description: "e.g. DO-35" }, mounting: { type: "string", enum: ["smd", "through_hole"] } }),
      assetKinds: { type: "array", items: { type: "string", enum: ["symbol", "footprint", "datasheet", "model"] }, description: "Default symbol, footprint, datasheet (3D models are not retrieved in this release)." },
    }, ["componentIds"]),
    outputSchema: OUT_REPORT,
    requiredCapability: "read_project", requiredRoles: ["pcb_editor", "reviewer", "project_admin"],
    requiredProjectState: ["schematic-present"], requiredAuthority: ["local-working-copy"],
    binding: { status: "bound-proposal", module: "app/lib/component-resolution/task/service.ts", symbol: "ComponentResolutionService", notes: "PR-M M2: ComponentResolutionService.start over the durable task store (component-resolution.task.v1, topic component-resolution-slice, consumed by the existing generation worker); the instances inspected through the chat route's catalog port over the run's verified schematic; the target derived from the server catalog part; reached only through CadAcquisitionToolService (app/lib/agent/cad-acquisition-reads.ts) and the chat route's one boundary (app/api/chat/cad-acquisition-runtime.ts). The CAD sources are the worker's (cad-source-registry.ts admission), never this call's." },
    discovery: "discoverable", callability: "callable",
    timeoutMs: 15_000,
    validationStrategy: "closed argument surface (componentIds, requirement {exactMpn, manufacturer, packageCode, mounting}, assetKinds; authority-shaped keys such as sourceId, url, bytes, pins or revisionId refused by name) under the B05 input limits; a verified schematic snapshot and the server's acquisition fact are required (no board); discovery, role and capability rechecked per call; the instances must be unresolved KiCad catalog instances of one catalog part",
    verificationStrategy: "the task is durable and fenced (every slice commit re-checks its fence; a cancel fences a late result); its start is idempotent on (scope, principal, instance ids, requirement digest, schematic base); every stored object is re-hashed on read; the publication re-verifies every byte; the offered replacement is M1's sealed batch applied only by the human",
    sourceEvidence: ["app/lib/component-resolution/task/service.ts", "app/lib/component-resolution/task/store.ts", "app/lib/component-resolution/task/slices.ts", "app/lib/component-resolution/acquisition/pipeline.ts", "app/lib/agent/cad-acquisition-reads.ts", "app/api/chat/cad-acquisition-runtime.ts"],
    versionNotes: "1.0.0 (PR-M M2, 2026-10-18): first exposure, reviewed in agent-exposure.ts; withheld from MCP by a reviewed choice in mcp-exposure-review.ts (it reads the editor's browser-only SchematicState).",
  };
}

function cadAcquisitionStatusDescriptor(): ToolDescriptor {
  return {
    ...readDefaults,
    toolId: "sirkit.parts.acquisition-status", version: "1.0.0",
    agentExposed: true, // [PR-M] a Tier 0 read of the durable acquisition task's public view
    owningCommandId: "parts.cad-acquisition",
    title: "Read the CAD acquisition task's progress",
    description: "Read the PUBLIC state of the project's durable CAD acquisition task(s): each stage (local search, source selection, retrieve, validate, handoff, awaiting publication, proposal, applied, preflight) with its evidence, the source attempts, the candidate's validation verdict, identity (exact or GENERIC KiCad candidate), object hashes, unresolved facts, conflicts and licence, the handoff, the publication status, the replacement offered, the receipt and the updated preflight, the blocker with its remedy and the recent progress lines. Example input: {\"taskId\":\"cr-task:0123456789abcdef0123456789abcdef\"}, or {} for the project's recent tasks. Nothing is changed.",
    category: "parts", operationClass: "read",
    inputSchema: obj({ taskId: { type: "string", description: "Optional: an acquisition task id of this project (cr-task:<32 hex>); omitted, the project's recent tasks." } }),
    outputSchema: OUT_REPORT,
    requiredCapability: "read_project", requiredRoles: ALL_ROLES,
    requiredProjectState: ["schematic-present"], requiredAuthority: ["local-working-copy"],
    binding: { status: "bound-read", module: "app/lib/component-resolution/task/service.ts", symbol: "ComponentResolutionService", notes: "PR-M M2: ComponentResolutionService.read / .list over the durable task store in the trusted scope (a foreign or guessed id is the uniform not_found), reached only through CadAcquisitionToolService and the chat route's one boundary; the same view GET /api/parts/acquisitions answers." },
    discovery: "discoverable", callability: "callable",
    timeoutMs: 8_000,
    validationStrategy: "closed argument surface (only taskId); a verified schematic snapshot and the server's acquisition fact are required (no board); discovery, role and capability rechecked per call; the output is a bounded projection of the public view",
    verificationStrategy: "a pure read of the durable task head in the trusted scope; never the stored bytes; the view's stages each carry their own evidence (M.4)",
    sourceEvidence: ["app/lib/component-resolution/task/service.ts", "app/lib/component-resolution/task/contracts.ts", "app/lib/agent/cad-acquisition-reads.ts", "app/api/chat/cad-acquisition-runtime.ts"],
    versionNotes: "1.0.0 (PR-M M2, 2026-10-18): first exposure, reviewed in agent-exposure.ts; withheld from MCP by a reviewed choice in mcp-exposure-review.ts.",
  };
}

/**
 * [PR-J5, 2026-10-23] Runbook section J increment 5 (J.6 items 1, 4, 6 and 8; J.3 item 4; OD-259 item 4): the agent's ORGANISE
 * proposal, declared at the END too (a function declaration is hoisted), so no line of this catalog moves. A Tier 2 SEALED proposal
 * the human reviews on the page and applies through schematic.move-to-sheet as ONE transaction; the server plans it with J4's one
 * organise planner over the catalog pins and proves it equivalent before sealing. Never applied by the agent; root-only in 1.0.0.
 */
function sheetOrganizationProposalDescriptor(): ToolDescriptor {
  return {
    ...readDefaults,
    toolId: "sirkit.schematic.propose-sheet-organization", version: "1.0.0",
    agentExposed: true, // [PR-J5] sealed organisation proposal ONLY; applying it is the human's reviewed schematic.move-to-sheet and never provider-callable
    owningCommandId: "schematic.sheet-organize-propose",
    title: "Propose organising the schematic into subsystem sheets",
    description: "Seal ONE proposal that organises the overview's catalog parts into named subsystem sheets: groups of reference designators, one new child sheet each (parts not named stay on the overview). The server resolves every member by name (unknown or duplicate members are refused by name), plans the organisation as a chain of equivalence-proven moves, carries every net the groups cut through an explicit port (named after the net; SIG<n> for an unnamed net, or the name given in interfaceNames), proves the pin-to-net partition and every component identity unchanged, and seals the sheets, members, interfaces, unassigned parts, parts to check and the operations digest. Example input: {\"groups\":[{\"name\":\"Power\",\"members\":[\"J1\",\"U1\",\"C1\"]},{\"name\":\"IMU\",\"members\":[\"U3\",\"R11\",\"R12\"]}]}. Receiving it changes NOTHING; the user reviews and approves it (one undoable transaction). An ambiguous or non-equivalent split is refused with the planner's reason.",
    category: "schematic", operationClass: "propose",
    sideEffects: "proposal-artifact",
    inputSchema: obj({
      groups: { type: "array", description: "1-8 groups, one new sheet each: a name (1-80 characters, no \"/\") and the reference designators it holds (each named once; parts not named stay on the overview).", items: obj({ name: { type: "string", description: "The new sheet's name." }, members: { type: "array", items: { type: "string" }, description: "Reference designators (R7, U2) of catalog parts on the overview." } }, ["name", "members"]) },
      interfaceNames: { type: "array", description: "Optional names for the ports of UNNAMED crossing nets, as a previous proposal reported them (SIG1, SIG2 ...): [{\"port\":\"SIG1\",\"name\":\"MOTOR_SENSE\"}]. A name no net, label or port of the project uses yet.", items: obj({ port: { type: "string", description: "The SIG<n> port a proposal reported." }, name: { type: "string", description: "Its new name (1-64 letters, digits, _ + - .)." } }, ["port", "name"]) },
    }, ["groups"]),
    outputSchema: OUT_RESULT,
    requiredCapability: "read_project", requiredRoles: ["pcb_editor", "reviewer", "project_admin"],
    requiredProjectState: ["schematic-present", "catalog-available"], requiredAuthority: ["local-working-copy"], // catalog-available: the pins the planner proves over come from the server catalog (context.ts claims the state exactly with the fact), so without the catalog this proposal is withheld at discovery
    // the loop's B09.1 gate holds for every schematic proposal (a canonical head mark), so discovery requires the revision and the open lineage too
    requiresExpectedRevision: true, requiresLineage: true,
    binding: { status: "bound-proposal", module: "app/lib/schematic/sheet-organization.ts", symbol: "planOrganizeIntoSheets", notes: "PR-J5: the ONE organise planner (J4's planOrganizeIntoSheets: sequential planMoveToSheet steps to new child sheets, re-applied once as one batch, the partition digest and every component identity proven unchanged) over the catalog pins read through the chat route's injected catalog port; compileSheetOrganizationProposal / sealSheetOrganizationProposal (app/lib/engineering/sheet-organization-proposal.ts) resolve the members and seal sirkit.sheet-organization-proposal.v1; SheetOrganizationProposalService (app/lib/agent/sheet-organization-proposals.ts) is the gateway's service. The page's Approve re-plans the sealed groups through the same planner and applies through schematic.move-to-sheet only when the operations and partition digests equal the sealed ones. Nothing applied here." },
    discovery: "discoverable", callability: "callable",
    timeoutMs: 10_000,
    validationStrategy: "closed argument surface (groups of { name, members }; interfaceNames of { port, name }; authority-shaped keys such as sheetId, ports, operations, scope or headMark refused by name); a verified schematic, its head mark and the server's catalog fact are required; discovery, role and capability rechecked per call; unknown, duplicate, Theory and off-sheet members refused by name; all-or-nothing over the groups (any refused step refuses the whole proposal)",
    verificationStrategy: "the sealed artifact's identity digest, operations digest and partition digest are re-verified at the page (verifySealedSheetOrganizationProposal: scope, lineage, head, expiry, base digest); Approve re-plans on the canonical base inside the serialized queue (replanSheetOrganization) and applies only when the re-planned operations digest and partition digest equal the sealed ones",
    sourceEvidence: ["app/lib/schematic/sheet-organization.ts", "app/lib/schematic/sheet-operations.ts", "app/lib/engineering/sheet-organization-proposal.ts", "app/lib/agent/sheet-organization-proposals.ts", "app/lib/agent/gateway.ts", "app/lib/agent/loop.ts"],
    versionNotes: "1.0.0 (PR-J5, 2026-10-23): first exposure, reviewed in agent-exposure.ts; withheld from MCP by a reviewed choice in mcp-exposure-review.ts (it seals against the editor's browser-only SchematicState and head mark, as OD-82's proposals, and needs the chat route's catalog port).",
  };
}
