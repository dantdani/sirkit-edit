/**
 * [B18-B] The PURE seal of an agent's Tier 1 execution intent — everything the
 * agent layer may compute about a mutation tool call WITHOUT authority:
 *
 *  - the descriptor must be a canonical mutation binding whose command is an
 *    execution family of permission Tier 1 (D18-6/7);
 *  - the run actor's ROLE must be permitted by the descriptor; the descriptor's
 *    capability must be grantable (D18-8 — the run actor never holds it: the
 *    grant carries it);
 *  - the operations are compiled with the SAME builder the editor session and
 *    the explicit-request grammar use, against the VERIFIED canonical board;
 *  - every operation kind must be inside the family's kernel binding.
 *
 * The output is DATA (a sealed plan): no decision, no explicitness, no ids —
 * those are minted only inside the server closure (`app/lib/execution-grant`).
 * This module imports no authority and nothing under `app/lib/execution-grant`.
 */
import { KERNEL_OPERATION_BINDINGS } from "../engineering/executor";
import { EXECUTION_FAMILIES, MAX_GRANT_OPERATIONS, TIER1_GRANTABLE_CAPABILITIES, executionBoardDigest, isExecutionFamily, type ExecutionFamily, type ExecutionGrantBase, type ExecutionGrantPreview, type ExecutionGrantTargets, type GrantableCapability } from "../engineering/execution-grant";
import { ARRANGE_EDGES, buildExecutionOperations, type ArrangeEdge, type ExecutionPlan } from "../engineering/execution-operations";
import { permissionTierOfDescriptor } from "../engineering/permission-tiers";
import type { ToolDescriptor } from "../engineering/tool-registry";
import type { EngineeringOperation } from "../engineering/types";
import type { EditCommand } from "../pcb/edit/commands";
import type { PcbBoard } from "../pcb/types";
import { pcbRevisionId } from "../pcb/revision";
import { resolvePcbValidationPolicy } from "../pcb/proposal/sealed-pcb-edit-proposal";
import type { AgentExecutionPlan, AgentRunContext } from "./contracts";

export interface SealedExecutionPlan {
  family: ExecutionFamily;
  toolId: string;
  toolVersion: string;
  capability: GrantableCapability;
  plan: ExecutionPlan;
  commands: EditCommand[];
  operations: EngineeringOperation[];
  operationsDigest: string;
  operationCount: number;
  targets: ExecutionGrantTargets;
  preview: ExecutionGrantPreview;
  previewDigest: string;
  expectedPcbRevisionAfter: string;
}

export type SealOutcome =
  | { ok: true; plan: SealedExecutionPlan }
  | { ok: false; status: "not_callable" | "unauthorized" | "authority_unavailable" | "invalid_input" | "tier_exceeded" | "kind_not_allowed"; diagnostics: string[] };

const AUTHORITY_ARG_KEYS = new Set(["approval", "approvals", "approve", "grant", "grantId", "executionGrant", "nonce", "attemptId", "capability", "capabilities", "authority", "actor", "role", "explicit", "explicitUserRequest", "confirmed", "confirmation", "tier", "decision"]);

function refuse(status: Exclude<SealOutcome, { ok: true }>["status"], ...diagnostics: string[]): SealOutcome {
  return { ok: false, status, diagnostics };
}

/** Parse the family's tool arguments into a plan (strict keys; authority-shaped keys refused by name). [B18-C I5] Per family;
 *  `null` is accepted as absent for optional properties (the strict wire schema makes every optional property required and
 *  nullable); a rotate/flip plan is made ABSOLUTE against the verified board (an omitted rotation or side keeps its value). */
export function parseExecutionArguments(family: ExecutionFamily, args: Record<string, unknown>, board?: PcbBoard | null): { ok: true; plan: ExecutionPlan } | { ok: false; diagnostics: string[] } {
  const authority = Object.keys(args).filter((key) => AUTHORITY_ARG_KEYS.has(key));
  if (authority.length > 0) return { ok: false, diagnostics: [`Argument "${authority[0]!.slice(0, 40)}" is an authority-shaped claim; a tool argument can never assert approval, a grant or explicitness.`] };
  if (family === "pcb.rotate-side-footprint") return parseRotateSideArguments(args, board ?? null);
  if (family === "pcb.arrange") return parseArrangeArguments(args);
  if (family !== "pcb.move-footprint") return { ok: false, diagnostics: [`Family ${family} has no executable argument contract yet.`] };
  const unknown = Object.keys(args).filter((key) => key !== "moves");
  if (unknown.length > 0) return { ok: false, diagnostics: [`Unexpected argument "${unknown[0]!.slice(0, 40)}" — move-footprint accepts only moves.`] };
  const moves = args.moves;
  if (!Array.isArray(moves) || moves.length === 0 || moves.length > MAX_GRANT_OPERATIONS) return { ok: false, diagnostics: [`moves must list 1–${MAX_GRANT_OPERATIONS} footprint targets.`] };
  const parsed: Array<{ footprintId: string; x: number; y: number }> = [];
  for (const move of moves) {
    if (typeof move !== "object" || move === null || Array.isArray(move)) return { ok: false, diagnostics: ["Each move must be an object { footprintId, x, y }."] };
    const item = move as Record<string, unknown>;
    const keys = Object.keys(item).sort().join(",");
    if (keys !== "footprintId,x,y") return { ok: false, diagnostics: ["Each move must carry exactly footprintId, x and y."] };
    if (typeof item.footprintId !== "string" || item.footprintId.length === 0 || item.footprintId.length > 200) return { ok: false, diagnostics: ["footprintId must be the stable footprint id."] };
    if (!Number.isSafeInteger(item.x) || !Number.isSafeInteger(item.y)) return { ok: false, diagnostics: ["x and y must be integer nanometres."] };
    parsed.push({ footprintId: item.footprintId, x: item.x as number, y: item.y as number });
  }
  return { ok: true, plan: { family: "pcb.move-footprint", moves: parsed } };
}

const absent = (value: unknown): boolean => value === undefined || value === null;
const argumentRefusal = (...diagnostics: string[]): { ok: false; diagnostics: string[] } => ({ ok: false, diagnostics });

/** [B18-C I5] `{ targets: [{ footprintId, rotationDeg?, side? }] }` — absolute whole degrees 0–359 (counter-clockwise on screen). */
function parseRotateSideArguments(args: Record<string, unknown>, board: PcbBoard | null): { ok: true; plan: ExecutionPlan } | { ok: false; diagnostics: string[] } {
  const unknown = Object.keys(args).filter((key) => key !== "targets");
  if (unknown.length > 0) return argumentRefusal(`Unexpected argument "${unknown[0]!.slice(0, 40)}" — rotate/flip accepts only targets.`);
  const targets = args.targets;
  if (!Array.isArray(targets) || targets.length === 0 || targets.length > MAX_GRANT_OPERATIONS) return argumentRefusal(`targets must list 1–${MAX_GRANT_OPERATIONS} footprints.`);
  const parsed: Array<{ footprintId: string; rotationDeg: number; side: "top" | "bottom" }> = [];
  for (const target of targets) {
    if (typeof target !== "object" || target === null || Array.isArray(target)) return argumentRefusal("Each target must be an object { footprintId, rotationDeg, side }.");
    const item = target as Record<string, unknown>;
    const extra = Object.keys(item).filter((key) => key !== "footprintId" && key !== "rotationDeg" && key !== "side");
    if (extra.length > 0) return argumentRefusal(`Unexpected target field "${extra[0]!.slice(0, 40)}" — a target carries only footprintId, rotationDeg and side.`);
    if (typeof item.footprintId !== "string" || item.footprintId.length === 0 || item.footprintId.length > 200) return argumentRefusal("footprintId must be the stable footprint id.");
    const rotation = absent(item.rotationDeg) ? null : item.rotationDeg;
    const side = absent(item.side) ? null : item.side;
    if (rotation === null && side === null) return argumentRefusal("Each target must set a rotation, a side or both.");
    if (rotation !== null && (typeof rotation !== "number" || !Number.isSafeInteger(rotation) || rotation < 0 || rotation > 359)) return argumentRefusal("rotationDeg must be a whole number of degrees from 0 to 359 (absolute, counter-clockwise).");
    if (side !== null && side !== "top" && side !== "bottom") return argumentRefusal("side must be top or bottom.");
    const footprint = board?.footprints.find((candidate) => candidate.id === item.footprintId);
    if (!footprint && (rotation === null || side === null)) return argumentRefusal(`Footprint ${String(item.footprintId).slice(0, 60)} is not on this board.`);
    parsed.push({ footprintId: item.footprintId, rotationDeg: rotation === null ? footprint!.rotationDeg : (rotation as number), side: (side === null ? footprint!.side : side) as "top" | "bottom" });
  }
  return { ok: true, plan: { family: "pcb.rotate-side-footprint", targets: parsed } };
}

/** [B18-C I5] `{ mode, footprintIds, edge?, axis?, gridNm? }` — exactly the parameter its mode needs; the others must be absent. */
function parseArrangeArguments(args: Record<string, unknown>): { ok: true; plan: ExecutionPlan } | { ok: false; diagnostics: string[] } {
  const allowed = ["mode", "footprintIds", "edge", "axis", "gridNm"];
  const unknown = Object.keys(args).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) return argumentRefusal(`Unexpected argument "${unknown[0]!.slice(0, 40)}" — arrange accepts mode, footprintIds, edge, axis and gridNm.`);
  const mode = args.mode;
  if (mode !== "align" && mode !== "distribute" && mode !== "snap-to-grid") return argumentRefusal("mode must be align, distribute or snap-to-grid.");
  const ids = args.footprintIds;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_GRANT_OPERATIONS || ids.some((id) => typeof id !== "string" || id.length === 0 || id.length > 200)) return argumentRefusal(`footprintIds must list 1–${MAX_GRANT_OPERATIONS} stable footprint ids.`);
  const footprintIds = ids as string[];
  const present = (key: string): boolean => !absent(args[key]);
  if (mode === "align") {
    if (present("axis") || present("gridNm")) return argumentRefusal("align takes an edge only (axis and gridNm must be null).");
    if (!(ARRANGE_EDGES as readonly unknown[]).includes(args.edge)) return argumentRefusal(`edge must be one of ${ARRANGE_EDGES.join(", ")}.`);
    return { ok: true, plan: { family: "pcb.arrange", mode, footprintIds, edge: args.edge as ArrangeEdge } };
  }
  if (mode === "distribute") {
    if (present("edge") || present("gridNm")) return argumentRefusal("distribute takes an axis only (edge and gridNm must be null).");
    if (args.axis !== "h" && args.axis !== "v") return argumentRefusal("axis must be h or v.");
    return { ok: true, plan: { family: "pcb.arrange", mode, footprintIds, axis: args.axis } };
  }
  if (present("edge") || present("axis")) return argumentRefusal("snap-to-grid takes gridNm only (edge and axis must be null).");
  if (typeof args.gridNm !== "number" || !Number.isSafeInteger(args.gridNm) || args.gridNm <= 0) return argumentRefusal("gridNm must be a positive whole number of nanometres.");
  return { ok: true, plan: { family: "pcb.arrange", mode, footprintIds, gridNm: args.gridNm } };
}

export function sealExecutionIntent(input: { descriptor: ToolDescriptor; args: Record<string, unknown>; context: AgentRunContext }): SealOutcome {
  const { descriptor, context } = input;
  if (descriptor.binding.status !== "bound-mutation-editor-session" || !descriptor.binding.canonicalCommandId) return refuse("not_callable", "Only a canonical mutation binding can be sealed as an execution intent.");
  const family = descriptor.binding.canonicalCommandId;
  if (!isExecutionFamily(family)) return refuse("not_callable", `${family} is not an execution family (B18-B covers ${EXECUTION_FAMILIES.join(", ")}).`);
  if (permissionTierOfDescriptor(descriptor) !== 1) return refuse("tier_exceeded", `${descriptor.toolId} is permission Tier ${permissionTierOfDescriptor(descriptor)}; only Tier 1 may be executed under a grant.`);
  if (!descriptor.requiredRoles.includes(context.actor.actorRole)) return refuse("unauthorized", `Role ${context.actor.actorRole} is not permitted for ${descriptor.toolId}.`);
  if (!(TIER1_GRANTABLE_CAPABILITIES as readonly string[]).includes(descriptor.requiredCapability)) return refuse("unauthorized", `Capability ${descriptor.requiredCapability} is not grantable to an agent execution.`);
  const board = context.canonicalState?.pcb;
  if (!board || !context.canonicalRevisionDigest || !context.pcbProposalBasis) return refuse("authority_unavailable", "No verified canonical board with a PCB history basis exists for this run; execution intents are unavailable.");
  const parsed = parseExecutionArguments(family, input.args, board);
  if (!parsed.ok) return refuse("invalid_input", ...parsed.diagnostics);
  const built = buildExecutionOperations(board, parsed.plan);
  if (!built.ok) return refuse("invalid_input", built.message);
  const allowed = (KERNEL_OPERATION_BINDINGS as Record<string, readonly string[]>)[family] ?? [];
  const outside = built.operations.map((operation) => operation.kind).filter((kind) => !allowed.includes(kind));
  if (outside.length > 0) return refuse("kind_not_allowed", `Operation kind ${outside[0]} is outside the ${family} kernel binding.`);
  return {
    ok: true,
    plan: {
      family, toolId: descriptor.toolId, toolVersion: descriptor.version, capability: descriptor.requiredCapability as GrantableCapability,
      plan: parsed.plan, commands: built.commands, operations: built.operations, operationsDigest: built.operationsDigest, operationCount: built.operations.length,
      targets: built.targets, preview: built.preview, previewDigest: built.previewDigest, expectedPcbRevisionAfter: built.resultRevision,
    },
  };
}

/** [B18-C] The data-only projection the minter receives: the parsed plan and the edit commands stay behind (the browser
 *  recompiles from the grant's operations through the same builder). */
export function mintablePlanOf(sealed: SealedExecutionPlan): AgentExecutionPlan {
  return {
    family: sealed.family, toolId: sealed.toolId, toolVersion: sealed.toolVersion, capability: sealed.capability,
    operations: sealed.operations, operationsDigest: sealed.operationsDigest, operationCount: sealed.operationCount,
    targets: sealed.targets, preview: sealed.preview, previewDigest: sealed.previewDigest, expectedPcbRevisionAfter: sealed.expectedPcbRevisionAfter,
  };
}

/**
 * [B18-C] The grant BASE — what a grant pins about the state it was sealed against — derived ONLY from the verified run
 * context: the canonical revision digest, the verified board's revision id and fingerprint, the PCB history head and
 * lineage from the basis, and the validation policy the preset REGISTRY resolves for the editor's active DRC preset. A
 * missing board/basis or an unresolvable preset refuses; nothing is fabricated.
 */
export function buildExecutionGrantBase(context: AgentRunContext): { ok: true; base: ExecutionGrantBase } | { ok: false; diagnostics: string[] } {
  const board = context.canonicalState?.pcb;
  const basis = context.pcbProposalBasis;
  if (!board || !context.canonicalRevisionDigest || !basis) return { ok: false, diagnostics: ["No verified canonical board with a PCB history basis exists for this run; no grant base can be derived."] };
  const resolved = resolvePcbValidationPolicy(basis.activeDrcPresetId);
  if (!resolved) return { ok: false, diagnostics: [`The editor's active DRC preset "${basis.activeDrcPresetId.slice(0, 60)}" does not resolve in the preset registry; no grant base can be derived.`] };
  return {
    ok: true,
    base: {
      canonicalRevisionDigest: context.canonicalRevisionDigest,
      pcb: {
        pcbRevisionId: pcbRevisionId(board),
        boardDigest: executionBoardDigest(board),
        headSequence: basis.historyHeadSequence,
        lineageId: basis.lineageId,
        validationPolicy: { presetId: resolved.policy.presetId, presetVersion: String(resolved.policy.presetVersion), rulesDigest: resolved.policy.rulesDigest },
      },
      schematic: null,
    },
  };
}
