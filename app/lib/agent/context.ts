/**
 * B09 — the smallest truthful agent run-context assembler.
 *
 * Assembles exactly what activated tools need: identity, the LOCAL_ONLY
 * actor, the verified working-copy canonical state (+ digest), the fresh
 * discovery context, and the resource envelopes required by activated
 * bindings. The MODEL never supplies or overrides actor, role,
 * capabilities, tenant/project/branch, authority, revision, lineage,
 * approval, or idempotency authority — those come only from here.
 *
 * A missing, malformed, or unverifiable schematic/board makes the affected
 * tools unavailable (their required project state is simply absent) or
 * refuse structurally — never an answer from stale state claimed current.
 *
 * B10 builds the rich selection/editor context bridge; B09 deliberately
 * assembles no selection snapshot, no component-authority records, and no
 * netlist — tools requiring them stay unexposed.
 */

import type { SchematicState } from "@/lib/schematic-types";
import { validateSchematicStateIntegrity } from "../engineering/schematic-model";
import { schematicStateDigest } from "../engineering/schematic-model";
import { computeProjectRevision } from "../engineering/revision";
import { buildReadResourceBundle, sealResourceEnvelope, type ReadAuthorityResourceEnvelope, type ReadResourceBundle } from "../engineering/resource-envelopes";
import type { DiscoveryContext } from "../engineering/tool-discovery";
import type { CanonicalProjectState, EngineeringCapability, ProjectRole } from "../engineering/types";
import type { ToolProjectState } from "../engineering/tool-registry";
import { validatePcbBoardStructure } from "../engineering/pcb-board-structure";
import { isWellFormedProposalScope, type Tier1ProposalHeadMark } from "../engineering/schematic-proposals";
import { getPreset, PRESETS } from "../pcb/drc/presets";
import { getFabPreset } from "../pcb/fab/presets";
import type { PcbBoard } from "../pcb/types";
import { STAGE10_SCHEMA_VERSION } from "../engineering/types";
import { engineeringDigest } from "../engineering/stable";
import { refKey } from "../pcb/edit/commands";
import type { SelectionRef } from "../pcb/edit/commands";
import { getItems } from "../pcb/selection-queries";
import { proveAgentNetlist, type AgentNetlistLogical } from "./netlist-validation";
import type { ComponentAuthorityRecord, ComponentCatalogCandidate } from "../engineering/component-authority";
import type { AgentActor, AgentRunContext, PcbProposalBasis } from "./contracts";
import { validateCapturedViewContext, viewContextDigest, viewProjectStates, type CapturedViewContext } from "./view-context";
import { INTENTIONAL_AGENT_EXPOSED_TOOL_IDS } from "../engineering/agent-exposure";
import { AGENT_AUTONOMY_SCHEMA, TIER1_EXECUTE_ROLES, defaultAutonomySetting, isAutonomyMode, type AgentAutonomySetting } from "../engineering/permission-tiers";
import { TIER1_GRANTABLE_CAPABILITIES } from "../engineering/execution-grant"; // [B18-C]
import type { ToolSelectionKind } from "../engineering/tool-registry";

/** [B13] SERVER-OWNED authority records — the shape the /api/chat loader
 *  hands the assembler. It is NEVER derived from the request body. */
export interface ServerOwnedComponentAuthority {
  records: readonly ComponentAuthorityRecord[];
  candidates?: readonly ComponentCatalogCandidate[];
}

/** [B13] bounds for the authority resource (deterministic, defensive). */
export const MAX_AUTHORITY_RECORDS = 512;
export const MAX_AUTHORITY_CANDIDATES = 512;

/**
 * LOCAL_ONLY actor factory — application-owned identity for the local,
 * unauthenticated Sirkit application. DOCUMENTED LIMITATION: this build has
 * no authenticated server identity to verify a user against, so the
 * application itself asserts the local owner role. A request body or model
 * output can NEVER supply role/capability claims — this factory is the only
 * source, and it is invoked server-side per run.
 */
export function createLocalOnlyActor(): AgentActor {
  const capabilities: readonly EngineeringCapability[] = ["read_project"];
  return Object.freeze({
    actorId: "local-user",
    actorRole: "project_admin",
    grantedCapabilities: capabilities,
    source: "local-only",
  });
}

/**
 * [B16.0.1 §D] the server-derived verified principal for a run, projected
 * from the trusted request context by the /api/chat route. When present, the
 * assembler binds the agent actor to THIS principal — its id, its REAL
 * membership role, the membership revision the role was resolved at, and the
 * auth class — instead of the local-only owner. This closes R3: the verified
 * identity is load-bearing (a viewer gets no propose surface; a proposal seals
 * under the true actor), and R4: the membership revision travels with the run
 * so a later revocation/downgrade can retire an already-sealed proposal.
 *
 * It is NEVER derived from the request body or model output — the route reads
 * it only from `resolveTrustedRequestContext`.
 */
export interface VerifiedRunPrincipal {
  /** The authenticated principal id (Supabase user id / local-dev / worker). */
  principalId: string;
  /** The SERVER-DERIVED membership role — never a header/body claim. */
  actorRole: ProjectRole;
  /** The membership revision the role was resolved at. */
  membershipRevision: string;
  /** How the principal was authenticated (documents assurance, never widens). */
  authMethod: "supabase_cookie" | "local_dev" | "worker_secret";
}

/**
 * Build the run actor. With a verified principal it is bound to that identity
 * (read-surface capability only — the agent run is a read + PROPOSE ceiling, so
 * a mutation capability is never granted here; the real ROLE gates which
 * propose tools appear). Without one it is the documented local-only build
 * actor — a path impossible under `NODE_ENV=production` (see
 * app/lib/auth/mode.ts), so production always takes the verified branch.
 */
function buildRunActor(verified: VerifiedRunPrincipal | undefined): AgentActor {
  if (!verified) return createLocalOnlyActor();
  const source: AgentActor["source"] =
    verified.authMethod === "worker_secret" ? "verified-worker"
      : verified.authMethod === "supabase_cookie" ? "verified-session"
        : "local-only"; // local_dev: the honest unauthenticated local build
  return Object.freeze({
    actorId: verified.principalId,
    actorRole: verified.actorRole,
    grantedCapabilities: ["read_project"] as readonly EngineeringCapability[],
    source,
    membershipRevision: verified.membershipRevision,
    authClass: verified.authMethod,
  });
}

export interface AssembleAgentContextInput {
  tenantId: string;
  projectId: string;
  branchId: string;
  /** Client-supplied working-copy snapshots — VERIFIED here, never trusted
   *  as claims. Malformed input degrades tool availability, never widens. */
  schematic?: unknown;
  board?: unknown;
  /** [B09.1] the client's SchematicEditorSession head mark — a scope LABEL
   *  for proposal sealing only; validated for shape, never for authority. */
  schematicHeadMark?: unknown;
  /** [B10] the live PCB selection captured atomically with `board` —
   *  VERIFIED here (deduped, resolved against the exact validated board);
   *  malformed or oversized input withholds ONLY the selection resource. */
  selection?: unknown;
  /** [B10] the live netlist captured atomically with the editor context —
   *  accepted only with proven schematic-digest agreement + structural and
   *  semantic validation; otherwise ONLY the netlist resource is withheld. */
  netlist?: unknown;
  /** [B10] the schematic digest the editor context was captured from —
   *  must equal the run's verified schematic digest for the netlist to be
   *  provably atomic with this run. */
  editorSchematicDigest?: unknown;
  presetId?: string;
  /** [B15.3] the PCB proposal basis captured atomically with `board` by the
   *  editor-context bridge: canonical history head, session lineage, and the
   *  editor's ACTIVE DRC preset. Shape-validated here; malformed, unknown-
   *  preset, or boardless input withholds ONLY the PCB proposal tool. */
  pcbProposalBasis?: unknown;
  providerSupportsJsonSchema?: boolean;
  /** [B13] SERVER-OWNED component-authority records produced by the /api/chat
   *  authority loader from durable facts. Supplied ONLY server-side — the
   *  route never reads it from the request body. Structurally validated here;
   *  its presence marks `durable-server-board` authority available and seals
   *  the component-authority-records resource. Absent ⇒ the resource is
   *  withheld and the inspection tool stays unexposed. */
  componentAuthority?: ServerOwnedComponentAuthority;
  /** [B16.0.1 §D] the server-derived verified principal for this run. Supplied
   *  ONLY by the route from `resolveTrustedRequestContext`; never from the
   *  request body or model. Present ⇒ the agent actor is bound to this
   *  identity; absent ⇒ the local-only build actor (production always supplies
   *  it because the local-only path is impossible under production). */
  verifiedActor?: VerifiedRunPrincipal;
  /** [B18-A] the project's autonomy setting as READ by the route from the
   *  durable store (server-supplied only; never a body field). A setting that
   *  does not belong to this run's project, or a malformed one, is ignored
   *  with a warning and the default (`proposal_only`) applies. */
  autonomy?: AgentAutonomySetting;
  /** [B17-F] the client-captured view context (`sirkit.view-context.v1`):
   *  the open editor surfaces, each view session's id/revision/bounded state,
   *  the project operation timeline. Exact-key validated and bounded here;
   *  malformed input withholds ONLY the view resources and view tools. It is
   *  never authority — it decides which view tools exist and which revision
   *  a view command expects. */
  view?: unknown;
  /** [B18-C] SERVER fact from the composition root: an execution-grant minter is bound to this run. Never a body field. */
  executionGrantsAvailable?: boolean;
}

/** [B10] oversized selections are REJECTED (resource withheld), never
 *  silently truncated. */
export const MAX_SELECTION_REFS = 2000;

const SELECTION_ITEM_KINDS = ["via", "track", "zone", "text", "footprint", "dimension"] as const;

/** [B10.2] exported: the route boundary reuses THE structural ref parser
 *  (no duplicated shape definition) to enforce the exact selection
 *  contract before provider invocation. */
export function parseSelectionRef(value: unknown): SelectionRef | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const ref = value as Record<string, unknown>;
  if (ref.kind === "pad") {
    if (Object.keys(ref).length !== 3) return null;
    if (typeof ref.footprintId !== "string" || ref.footprintId.length === 0 || ref.footprintId.length > 200) return null;
    if (typeof ref.padNumber !== "string" || ref.padNumber.length === 0 || ref.padNumber.length > 64) return null;
    return { kind: "pad", footprintId: ref.footprintId, padNumber: ref.padNumber };
  }
  if (Object.keys(ref).length !== 2) return null;
  if (!(SELECTION_ITEM_KINDS as readonly string[]).includes(ref.kind as string)) return null;
  if (typeof ref.id !== "string" || ref.id.length === 0 || ref.id.length > 200) return null;
  return { kind: ref.kind as (typeof SELECTION_ITEM_KINDS)[number], id: ref.id };
}

/** Validate + resolve the captured selection against the EXACT validated
 *  board: exact shape, bounded size, deterministic dedupe, dead refs
 *  removed, primary kept only while live. Returns null (withhold) on any
 *  structural violation — never a truncated or partially-guessed set. */
function verifyCapturedSelection(raw: unknown, board: PcbBoard): { refs: SelectionRef[]; primary: SelectionRef | null } | { withheld: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { withheld: "selection is not an object" };
  const shape = raw as Record<string, unknown>;
  for (const key of Object.keys(shape)) if (key !== "refs" && key !== "primary") return { withheld: `unexpected selection key "${key.slice(0, 40)}"` };
  if (!Array.isArray(shape.refs)) return { withheld: "selection.refs is not an array" };
  if (shape.refs.length > MAX_SELECTION_REFS) return { withheld: `selection exceeds ${MAX_SELECTION_REFS} refs (${shape.refs.length}); it is rejected, not truncated` };
  const parsed: SelectionRef[] = [];
  for (const item of shape.refs) {
    const ref = parseSelectionRef(item);
    if (ref === null) return { withheld: "selection contains a malformed ref" };
    parsed.push(ref);
  }
  // Deterministic dedupe (insertion order, refKey identity).
  const seen = new Set<string>();
  const deduped: SelectionRef[] = [];
  for (const ref of parsed) {
    const key = refKey(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(ref);
  }
  // Dead refs are REMOVED: only refs that resolve on the exact captured
  // board survive (the same resolution helper the selection tool uses).
  const live = deduped.filter((ref) => getItems(board, [ref]).length === 1);
  let primary: SelectionRef | null = null;
  if (shape.primary !== undefined && shape.primary !== null) {
    const parsedPrimary = parseSelectionRef(shape.primary);
    if (parsedPrimary === null) return { withheld: "selection.primary is malformed" };
    const primaryKey = refKey(parsedPrimary);
    if (live.some((ref) => refKey(ref) === primaryKey)) primary = parsedPrimary;
  }
  return { refs: live, primary };
}

function isBoardShape(value: unknown): value is PcbBoard {
  if (typeof value !== "object" || value === null) return false;
  const board = value as Record<string, unknown>;
  return (board.stackup === 2 || board.stackup === 4) && Array.isArray(board.nets) && Array.isArray(board.footprints) && Array.isArray(board.tracks) && Array.isArray(board.vias) && Array.isArray(board.zones);
}

function isSchematicShape(value: unknown): value is SchematicState {
  if (typeof value !== "object" || value === null) return false;
  const state = value as Record<string, unknown>;
  return Array.isArray(state.components) && Array.isArray(state.wires);
}

export type AgentContextAssembly =
  | { ok: true; context: AgentRunContext; warnings: string[] }
  | { ok: false; reason: string };

export function assembleAgentRunContext(input: AssembleAgentContextInput): AgentContextAssembly {
  const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
  for (const [name, value] of [["tenantId", input.tenantId], ["projectId", input.projectId], ["branchId", input.branchId]] as const) {
    if (typeof value !== "string" || !idPattern.test(value)) return { ok: false, reason: `${name} is not a well-formed identifier` };
  }
  const warnings: string[] = [];
  // [B16.0.1 §D] bind the run to the server-derived verified principal when the
  // route supplies one; otherwise the documented local-only build actor.
  const actor = buildRunActor(input.verifiedActor);

  // Verify (never trust) the supplied working-copy snapshots.
  let schematic: SchematicState | null = null;
  if (input.schematic !== undefined && input.schematic !== null) {
    if (isSchematicShape(input.schematic)) {
      const issues = validateSchematicStateIntegrity(input.schematic);
      if (issues.length === 0) schematic = input.schematic;
      else warnings.push(`Schematic snapshot failed integrity validation (${issues.length} issue(s)); schematic tools are unavailable for this run.`);
    } else {
      warnings.push("Schematic snapshot is structurally invalid; schematic tools are unavailable for this run.");
    }
  }
  let board: PcbBoard | null = null;
  if (input.board !== undefined && input.board !== null) {
    if (isBoardShape(input.board)) {
      // [B09.1] shape alone is NOT authority: run the same whole-board
      // structural/reference validation the canonical mutation boundary
      // uses (global id uniqueness, net/padstack references, outline/
      // geometry/layer validity, …). An invalid board never becomes
      // `board-present` state or a "verified" resource envelope.
      let structural: string[];
      try {
        structural = validatePcbBoardStructure(input.board);
      } catch {
        // The authoritative validator refused the shape outright — equally
        // invalid; never normalized into verified authority.
        structural = ["the structural validator refused the board shape"];
      }
      if (structural.length === 0) {
        board = input.board;
      } else {
        warnings.push(`Board snapshot failed structural validation (${structural.length} issue(s), e.g. ${structural[0]!.slice(0, 120)}); board tools are unavailable for this run.`);
      }
    } else {
      warnings.push("Board snapshot is structurally invalid; board tools are unavailable for this run.");
    }
  }
  // [B09.1] head mark: shape-validated label only. Malformed → proposal
  // tool unavailable (read-only conversation continues).
  let schematicHeadMark: Tier1ProposalHeadMark | null = null;
  if (input.schematicHeadMark !== undefined && input.schematicHeadMark !== null) {
    const candidate = { tenantId: input.tenantId, projectId: input.projectId, branchId: input.branchId, headMark: input.schematicHeadMark };
    if (isWellFormedProposalScope(candidate)) {
      const mark = input.schematicHeadMark as Tier1ProposalHeadMark;
      schematicHeadMark = { lineageId: mark.lineageId, headSequence: mark.headSequence, canonicalStateDigest: mark.canonicalStateDigest };
    } else {
      warnings.push("The supplied schematic head mark is malformed; the proposal tool is unavailable for this run.");
    }
  }

  // [B09.2] a CanonicalProjectState is claimed ONLY when every required
  // constituent was supplied and structurally validated: a VALID board is
  // mandatory, and a supplied-but-invalid schematic also blocks the claim.
  // Missing/invalid state is NEVER substituted with an empty board, and a
  // canonical revision digest is NEVER manufactured.
  const schematicSuppliedButInvalid = input.schematic !== undefined && input.schematic !== null && schematic === null;
  const canonicalState: CanonicalProjectState | null = board !== null && !schematicSuppliedButInvalid
    ? {
        schemaVersion: STAGE10_SCHEMA_VERSION,
        tenantId: input.tenantId,
        projectId: input.projectId,
        branchId: input.branchId,
        pcb: board,
        ...(schematic ? { schematic } : {}),
        pinnedAssets: [],
      }
    : null;
  if (board !== null && schematicSuppliedButInvalid) {
    warnings.push("The canonical project resource was withheld: the supplied schematic failed validation, so the project state cannot be claimed complete.");
  }
  if (input.board === undefined || input.board === null) {
    warnings.push("No board snapshot was supplied; the canonical project resource and board tools are unavailable for this run.");
  }
  const canonicalRevisionDigest = canonicalState ? computeProjectRevision(canonicalState).canonicalStateDigest : null;
  const projectState: ToolProjectState[] = [];
  if (canonicalState) projectState.push("board-present");
  if (schematic) projectState.push("schematic-present");

  // [B09.3] the head mark claimed on the context follows the validated
  // schematic: without a validated schematic the mark is a label with no
  // referent and is not claimed.
  const effectiveHeadMark = schematic ? schematicHeadMark : null;

  // [B10] the live selection is claimed ONLY alongside a validated
  // canonical board (it is meaningless against nothing); any structural
  // violation withholds ONLY the selection resource.
  let selection: { refs: SelectionRef[]; primary: SelectionRef | null } | null = null;
  if (input.selection !== undefined && input.selection !== null) {
    if (!canonicalState || !board) {
      warnings.push("The captured selection was withheld: no validated canonical board exists for this run.");
    } else {
      const verified = verifyCapturedSelection(input.selection, board);
      if ("withheld" in verified) {
        warnings.push(`The selection resource was withheld: ${verified.withheld}. Selection inspection is unavailable for this run.`);
      } else {
        selection = verified;
      }
    }
  }
  const selectionDigest = selection ? engineeringDigest({ schema: "sirkit.selection-snapshot.v1", refs: selection.refs, primary: selection.primary }) : null;

  // [B10/B10.1] the live netlist is optional and NEVER fabricated: only
  // the AUTHORITY-NEUTRAL projection is accepted, with proven schematic-
  // digest agreement (atomic capture) plus semantic validation AGAINST THE
  // VERIFIED SCHEMATIC (component membership, display-ref agreement,
  // node/endpoint discipline; unknown or authority-shaped fields refuse).
  // Failure withholds ONLY the netlist resource — readiness still runs but
  // reports schematic parity as not evaluated. Board/netlist disagreement
  // is deliberately NOT validated here (a stale board is a readiness
  // diagnosis, not a malformed resource).
  let netlist: AgentNetlistLogical | null = null;
  if (input.netlist !== undefined && input.netlist !== null) {
    const runSchematicDigest = schematic ? schematicStateDigest(schematic) : null;
    if (!schematic || runSchematicDigest === null) {
      warnings.push("The netlist resource was withheld: no verified schematic exists for this run.");
    } else if (typeof input.editorSchematicDigest !== "string" || input.editorSchematicDigest !== runSchematicDigest) {
      warnings.push("The netlist resource was withheld: it was not provably captured from this run's schematic (schematic-digest agreement failed).");
    } else {
      // [B10.2] the projection must be PROVEN by server-side re-derivation
      // through the shared production netlist authority — the sealed
      // content is the SERVER-OWNED result, never browser bytes.
      const proof = proveAgentNetlist(input.netlist, schematic);
      if (!proof.ok) {
        warnings.push(`The netlist resource was withheld: ${proof.reason.slice(0, 240)}.`);
      } else {
        netlist = proof.content;
      }
    }
  }
  const netlistDigest = netlist ? engineeringDigest({ schema: "sirkit.agent-netlist-projection.v1", netlist }) : null;

  // [B13] the SERVER-OWNED component-authority records. Structurally validated
  // (bounded arrays of objects) — the loader is trusted for content, but the
  // assembler still refuses a malformed/oversized shape (withhold, never
  // widen). Its presence marks durable-server-board authority available.
  let componentAuthority: { records: readonly ComponentAuthorityRecord[]; candidates: readonly ComponentCatalogCandidate[] } | null = null;
  if (input.componentAuthority !== undefined && input.componentAuthority !== null) {
    const supplied = input.componentAuthority;
    const records = supplied.records;
    const candidates = supplied.candidates ?? [];
    if (!Array.isArray(records) || records.length > MAX_AUTHORITY_RECORDS || !Array.isArray(candidates) || candidates.length > MAX_AUTHORITY_CANDIDATES) {
      warnings.push("The component-authority resource was withheld: the server-owned records are malformed or exceed bounds.");
    } else if (records.some((record) => typeof record !== "object" || record === null || (record as ComponentAuthorityRecord).componentId === undefined)) {
      warnings.push("The component-authority resource was withheld: a server-owned record is structurally invalid.");
    } else {
      componentAuthority = { records, candidates };
    }
  }
  const componentAuthorityDigest = componentAuthority
    ? engineeringDigest({ schema: "sirkit.component-authority-records.v1", records: componentAuthority.records, candidates: componentAuthority.candidates })
    : null;

  // [B15.3] the PCB proposal BASIS — a shape-validated scope label (like the
  // schematic head mark), claimed ONLY alongside a validated canonical
  // board. It must name a KNOWN DRC preset from the canonical registry;
  // anything malformed withholds ONLY the PCB proposal tool (fail closed,
  // reads unaffected). It is never granted authority here — the live editor
  // re-verifies every field at the human-approved apply position.
  let pcbProposalBasis: PcbProposalBasis | null = null;
  if (input.pcbProposalBasis !== undefined && input.pcbProposalBasis !== null) {
    if (!canonicalState || !board) {
      warnings.push("The PCB proposal basis was withheld: no validated canonical board exists for this run.");
    } else {
      const candidate = input.pcbProposalBasis as Record<string, unknown>;
      const keys = typeof candidate === "object" ? Object.keys(candidate) : [];
      const wellFormed = typeof candidate === "object"
        && keys.length === 4
        && ["historyHeadSequence", "historyHeadLabel", "lineageId", "activeDrcPresetId"].every((key) => keys.includes(key))
        && typeof candidate.historyHeadSequence === "number"
        && Number.isSafeInteger(candidate.historyHeadSequence) && (candidate.historyHeadSequence as number) >= 0
        && (candidate.historyHeadLabel === null || (typeof candidate.historyHeadLabel === "string" && (candidate.historyHeadLabel as string).length <= 256))
        && typeof candidate.lineageId === "string" && idPattern.test(candidate.lineageId as string)
        && typeof candidate.activeDrcPresetId === "string" && idPattern.test(candidate.activeDrcPresetId as string);
      if (!wellFormed) {
        warnings.push("The PCB proposal basis is malformed; the PCB proposal tool is unavailable for this run.");
      } else if (!PRESETS.some((preset) => preset.id === candidate.activeDrcPresetId)) {
        warnings.push("The PCB proposal basis names an unknown DRC preset; the PCB proposal tool is unavailable for this run.");
      } else {
        pcbProposalBasis = {
          historyHeadSequence: candidate.historyHeadSequence as number,
          historyHeadLabel: candidate.historyHeadLabel as string | null,
          lineageId: candidate.lineageId as string,
          activeDrcPresetId: candidate.activeDrcPresetId as string,
        };
      }
    }
  }

  // [B17-F] the captured view context: validated (exact keys, bounded), never
  // authority. Its surfaces become `<editor>-surface` project states so 3D
  // tools are not advertised without a 3D surface, and its selection kinds
  // feed selection-gated discovery. Malformed ⇒ withheld with a warning.
  let view: CapturedViewContext | null = null;
  if (input.view !== undefined && input.view !== null) {
    const validated = validateCapturedViewContext(input.view);
    if (validated.ok) view = validated.view;
    else warnings.push(`The view context was withheld: ${validated.reason.slice(0, 160)}. View and history tools are unavailable for this run.`);
  }
  const viewDigest = view ? viewContextDigest(view) : null;
  for (const state of viewProjectStates(view)) projectState.push(state);
  const selectedKinds: ToolSelectionKind[] = [...new Set((selection?.refs ?? []).map((ref) => ref.kind))].sort() as ToolSelectionKind[];

  // [B18-A] the autonomy setting — server-read; a foreign or malformed record never widens.
  let autonomy = defaultAutonomySetting({ tenantId: input.tenantId, projectId: input.projectId });
  if (input.autonomy !== undefined && input.autonomy !== null) {
    const supplied = input.autonomy;
    if (supplied.schema === AGENT_AUTONOMY_SCHEMA && supplied.tenantId === input.tenantId && supplied.projectId === input.projectId && isAutonomyMode(supplied.mode) && Number.isSafeInteger(supplied.revision) && supplied.revision >= 0) {
      autonomy = structuredClone(supplied);
    } else {
      warnings.push("The project's agent autonomy setting did not belong to this run's project or was malformed; this run is proposal-only.");
    }
  }

  // [B18-C] granted executions are discoverable only when the SERVER bound a minter, the actor holds a Tier 1 execute
  // role, and a verified board with its PCB proposal basis exists — the capability rides the grant (D18-8); the actor's
  // own set stays read_project. Absent the grant context, the discovery object is byte-identical to before B18-C.
  const grantable = input.executionGrantsAvailable === true && (TIER1_EXECUTE_ROLES as readonly string[]).includes(actor.actorRole) && board !== null && pcbProposalBasis !== null;
  const discovery: DiscoveryContext = {
    tenantId: input.tenantId,
    projectId: input.projectId,
    branchId: input.branchId,
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    grantedCapabilities: actor.grantedCapabilities,
    channel: "assistant-agent",
    // [B09.2] the revision anchor is the REAL canonical digest when a
    // complete canonical resource exists, else the verified schematic
    // digest for schematic-only runs — never a digest over substituted
    // state.
    currentRevisionDigest: canonicalRevisionDigest ?? (schematic ? schematicStateDigest(schematic) : ""),
    // [B09.3] the discovery lineage anchor is the VALIDATED schematic head
    // mark's lineage — the application-owned source. Without a validated
    // head mark there is no open lineage and the anchor stays empty; it is
    // never minted from any other digest domain (the canonical project
    // revision and the schematic-state digest are DIFFERENT meanings and
    // are never conflated with the session lineage).
    lineageId: effectiveHeadMark?.lineageId ?? "",
    currentEditor: "", // agent channel: no single editor surface pins tools — the captured SURFACES gate them (B17-F)
    selectedKinds,
    projectState,
    // [B13] durable-server-board authority is advertised ONLY when the
    // server-owned component-authority resource was loaded and verified.
    availableAuthority: componentAuthority ? ["local-working-copy", "durable-server-board"] : ["local-working-copy"],
    providerCapabilities: {
      supportsJsonSchema: input.providerSupportsJsonSchema ?? true,
      toolNameMaxLength: 64,
      // [B17-F] derived from the reviewed intentional exposure set (never a
      // hard-coded count): every intentional tool fits, with headroom.
      maxToolCount: Math.max(16, INTENTIONAL_AGENT_EXPOSED_TOOL_IDS.length + 4),
    },
    // B09 ceiling: reads + sealed proposals; [B18-C] `mutate` + the reversible approval tier ONLY for a grantable run
    // (never destructive/release).
    riskCeiling: grantable ? "mutate" : "propose",
    approvalsAvailable: grantable ? ["reversible"] : [],
    enabledFlags: [],
    requestedCategories: [],
    ...(grantable ? { grantableCapabilities: [...TIER1_GRANTABLE_CAPABILITIES], grantLineageId: pcbProposalBasis!.lineageId } : {}),
  };

  return {
    ok: true,
    context: {
      tenantId: input.tenantId,
      projectId: input.projectId,
      branchId: input.branchId,
      actor,
      canonicalRevisionDigest,
      canonicalState,
      schematic,
      schematicDigest: schematic ? schematicStateDigest(schematic) : null,
      schematicHeadMark: effectiveHeadMark,
      discovery,
      presetId: input.presetId === "jlcpcb-4l" || (board?.stackup === 4 && !input.presetId) ? "jlcpcb-4l" : "jlcpcb-2l",
      selection,
      selectionDigest,
      netlist,
      netlistDigest,
      componentAuthority,
      componentAuthorityDigest,
      pcbProposalBasis,
      executionGrantsAvailable: grantable,
      view,
      viewDigest,
      autonomy,
    },
    warnings,
  };
}

// ─── Resource bundle assembly for activated read bindings ────────────────────

function envelope<T>(context: AgentRunContext, kind: ReadAuthorityResourceEnvelope["kind"], resourceId: string, sourceVersion: string, content: T): ReadAuthorityResourceEnvelope<T> {
  return sealResourceEnvelope({
    resourceId,
    kind,
    tenantId: context.tenantId,
    projectId: context.projectId,
    branchId: context.branchId,
    authoritySource: "local-working-copy",
    authorityStatus: "verified",
    sourceVersion,
    ...(context.canonicalRevisionDigest ? { sourceCanonicalRevision: context.canonicalRevisionDigest } : {}),
    producer: "agent-run-context-assembler",
    producerVersion: "1.1.0", // assembler contract version (B09.1 revision)
    freshness: "current",
    content,
  });
}

/** Build the read-resource bundle for one invocation: canonical state plus
 *  the preset-derived auxiliary resources B09 can assemble deterministically
 *  (DRC rules, DRC preset, fab preset). Selection, component authority, and
 *  netlist are B10 scope and are deliberately absent. */
export function buildAgentResourceBundle(context: AgentRunContext): ReadResourceBundle {
  // [B09.2] no canonical resource is ever fabricated: callers must guard.
  if (!context.canonicalState || !context.canonicalRevisionDigest) {
    throw new Error("CANONICAL_RESOURCE_UNAVAILABLE: no complete validated canonical project state exists for this run");
  }
  const canonicalState = envelope(context, "canonical-state", `canonical:${context.projectId}`, context.canonicalRevisionDigest, context.canonicalState);
  const drcPreset = getPreset(context.presetId as never);
  const fabPreset = getFabPreset(context.presetId as never);
  const auxiliary: ReadAuthorityResourceEnvelope[] = [
    envelope(context, "drc-rules", `drc-rules:${context.presetId}`, context.presetId, drcPreset.rules),
    envelope(context, "drc-preset", `drc-preset:${context.presetId}`, context.presetId, drcPreset),
    envelope(context, "fab-preset", `fab-preset:${context.presetId}`, context.presetId, fabPreset),
  ];
  // [B10] optional live resources — sealed ONLY when verified at assembly.
  // Selection content is the resolved refs array (the binding contract);
  // it is pinned to the server-computed canonical revision.
  if (context.selection) {
    auxiliary.push(envelope(context, "selection-snapshot", `selection:${context.projectId}`, context.canonicalRevisionDigest, context.selection.refs));
  }
  // Netlist provenance pins the schematic digest it was proven against.
  if (context.netlist && context.schematicDigest) {
    auxiliary.push(envelope(context, "netlist", `netlist:${context.projectId}`, context.schematicDigest, context.netlist));
  }
  // [B13] the server-owned component-authority resource — sealed with
  // durable-server-board provenance (NOT the local-working-copy helper),
  // pinned to the canonical revision, content shaped {records, candidates}.
  if (context.componentAuthority) {
    auxiliary.push(sealResourceEnvelope({
      resourceId: `component-authority:${context.projectId}`,
      kind: "component-authority-records",
      tenantId: context.tenantId,
      projectId: context.projectId,
      branchId: context.branchId,
      authoritySource: "durable-server-board",
      authorityStatus: "verified",
      sourceVersion: context.componentAuthorityDigest ?? context.canonicalRevisionDigest,
      sourceCanonicalRevision: context.canonicalRevisionDigest,
      producer: "component-authority-source",
      producerVersion: "1.0.0",
      freshness: "current",
      content: { records: context.componentAuthority.records, candidates: context.componentAuthority.candidates },
    }));
  }
  // [B17-F] the captured view context — sealed as the view-state snapshot
  // (what the editors show) and, when it carries one, the project timeline
  // snapshot. Both are pinned to their assembly-time digest and to the
  // canonical revision; neither is engineering state.
  if (context.view && context.viewDigest) {
    auxiliary.push(envelope(context, "view-state-snapshot", `view:${context.projectId}`, context.viewDigest, context.view));
    if (context.view.timeline) {
      auxiliary.push(envelope(context, "project-timeline-snapshot", `timeline:${context.projectId}`, context.viewDigest, context.view));
    }
  }
  return buildReadResourceBundle(canonicalState, auxiliary);
}
