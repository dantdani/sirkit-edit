/**
 * [PR-J5, 2026-10-23] Runbook J.3 item 4, J.6 items 4-6 (OD-259 items 4-5): the page's SAFE receiver of the agent's sealed organise
 * proposal (app/lib/project/sheet-organization-events.ts) and the Sheets controller's ONE organise transaction it applies through
 * (`applyOrganizeProposal`, app/components/schematic/hooks/sheet-navigation-controller.ts), driven with a proposal the tool's OWN
 * compiler and sealer produced over the flat fixture drone (no provider, no network, no process). What it proves:
 *
 *  1. a sealed proposal is received with its run id as audit metadata; a wrong event type, a wrong schema, a tampered group, an extra key,
 *     a non-object and a wrong-shaped proposal are dropped;
 *  2. the currency check against the live editor refuses a foreign scope, an expired proposal, a moved head and a changed base, each with
 *     the page's sentence; a current one is offered;
 *  3. the review projects the sealed facts (groups, members, interfaces, unassigned, equivalence, rationale) and blocks Approve, with the
 *     reason, while the proposal is stale or already applied;
 *  4. Approve through the controller: ONE schematic.move-to-sheet command pinned to the base digest and the sealed head mark, whose
 *     operations are the tool's re-plan on the canonical base (the sealed operation count); a differing base refuses with the tool's
 *     sentence and applies nothing; the re-plan base carries the sheet-size fallback only when the canonical state has none;
 *  5. the sentences name the sheets, the parts and the interfaces, and never claim a change before the apply.
 */
import { describe, expect, it } from "vitest";
import type { CanonicalSchematic } from "@/app/lib/engineering/schematic-model";
import { fromCanonicalSchematic, schematicStateDigest, toCanonicalSchematic } from "@/app/lib/engineering/schematic-model";
import { buildAuthorizationBinding } from "@/app/lib/engineering/proposal-authorization";
import { compileSheetOrganizationProposal, sealSheetOrganizationProposal, SHEET_ORGANIZATION_PROPOSAL_SCHEMA, type SealedSheetOrganizationProposal } from "@/app/lib/engineering/sheet-organization-proposal";
import type { EngineeringOperation } from "@/app/lib/engineering/types";
import { SheetNavigationController, type RunSchematicCommand } from "@/app/components/schematic/hooks/sheet-navigation-controller";
import { fixtureParts } from "@/app/lib/schematic/__tests__/_j1-fixtures";
import { J4_DRONE_HINTED_PROPOSAL, flatDroneProjectState } from "@/app/lib/schematic/__tests__/_j4-organize-fixtures";
import type { SchematicState } from "@/lib/schematic-types";
import {
  SHEET_ORGANIZATION_READY_EVENT, receiveSheetOrganizationEvent, replanSheetOrganization, sheetOrganizationApplyLabel, sheetOrganizationCurrency, sheetOrganizationLines,
  sheetOrganizationReplanBase, sheetOrganizationReview,
} from "../sheet-organization-events";

const SCOPE = { tenantId: "local", projectId: "p-j5-organise", branchId: "main" };
const HEAD_MARK = { lineageId: "lin1-a9e2470c11bd8833", headSequence: 7, canonicalStateDigest: "eng1-77aa66bb55cc44dd" };
const NOW = 1_761_200_000_000;
const parts = fixtureParts();
const getPart = (partId: string) => parts.get(partId) ?? null;
const wire = <T,>(value: T): Record<string, unknown> => JSON.parse(JSON.stringify(value)) as Record<string, unknown>;

/** The flat fixture drone with the page's sheet size (what the chat run posts and the seal digests). */
const base = (): SchematicState => ({ ...flatDroneProjectState(), pageSize: "A4" });

function sealed(state: SchematicState = base()): SealedSheetOrganizationProposal {
  const compiled = compileSheetOrganizationProposal({ state, request: { groups: J4_DRONE_HINTED_PROPOSAL.map((group) => ({ name: group.name, members: [...group.refs] })) }, getPart });
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.blockers));
  const outcome = sealSheetOrganizationProposal({ state, compilation: compiled.compilation, scope: { ...SCOPE, headMark: HEAD_MARK }, authorization: buildAuthorizationBinding({ principalId: "u-1", scope: SCOPE }), version: "1.0.0", provenance: { provider: "fixture", runId: "run-j5", note: "Four subsystems: the motor drivers, the power, the MCU, the IMU.", instruction: "Organize this schematic into subsystem sheets" }, now: NOW });
  if (outcome.kind !== "sealed") throw new Error(JSON.stringify(outcome.blockers));
  return outcome.proposal;
}
const live = (state: SchematicState = base()) => ({ scope: SCOPE, headMark: HEAD_MARK, baseDigest: schematicStateDigest(state), now: NOW + 1 });

describe("[PR-J5] 1. the SAFE receiver", () => {
  it("receives the sealed proposal with the run id as audit metadata; drops anything else", () => {
    const proposal = sealed();
    expect(proposal.schema).toBe(SHEET_ORGANIZATION_PROPOSAL_SCHEMA);
    expect(proposal.groups.map((group) => group.name)).toEqual(J4_DRONE_HINTED_PROPOSAL.map((group) => group.name));
    const received = receiveSheetOrganizationEvent({ type: SHEET_ORGANIZATION_READY_EVENT, runId: "run-j5", toolId: proposal.toolId, proposal: wire(proposal) });
    expect(received).not.toBeNull();
    expect(received!.runId).toBe("run-j5");
    expect(received!.proposal.proposalId).toBe(proposal.proposalId);
    expect(receiveSheetOrganizationEvent({ type: SHEET_ORGANIZATION_READY_EVENT, runId: 42, proposal: wire(proposal) })!.runId).toBeNull();
    expect(receiveSheetOrganizationEvent({ type: "component_resolution_ready", proposal: wire(proposal) })).toBeNull();
    expect(receiveSheetOrganizationEvent({ type: SHEET_ORGANIZATION_READY_EVENT, proposal: { ...wire(proposal), schema: "sirkit.component-resolution-proposal.v1" } })).toBeNull();
    const tampered = wire(proposal); (tampered.groups as Array<{ name: string }>)[0]!.name = "Motors (renamed)";
    expect(receiveSheetOrganizationEvent({ type: SHEET_ORGANIZATION_READY_EVENT, proposal: tampered })).toBeNull();
    expect(receiveSheetOrganizationEvent({ type: SHEET_ORGANIZATION_READY_EVENT, proposal: { ...wire(proposal), apply: true } })).toBeNull();
    expect(receiveSheetOrganizationEvent({ type: SHEET_ORGANIZATION_READY_EVENT, proposal: "shorg-x" })).toBeNull();
    expect(receiveSheetOrganizationEvent({ type: SHEET_ORGANIZATION_READY_EVENT, proposal: [wire(proposal)] })).toBeNull();
    expect(receiveSheetOrganizationEvent(null)).toBeNull();
    expect(receiveSheetOrganizationEvent(undefined)).toBeNull();
  });
});

describe("[PR-J5] 2. the currency check against the live editor", () => {
  it("current: ok; foreign scope, expiry, a moved head and a changed base refuse with the page's sentence, in that order", () => {
    const proposal = sealed();
    expect(sheetOrganizationCurrency(proposal, live())).toEqual({ ok: true });
    expect(sheetOrganizationCurrency(proposal, { ...live(), scope: { ...SCOPE, projectId: "p-other" } })).toMatchObject({ ok: false, code: "foreign-scope", detail: "the sheet organisation was sealed for another project or branch; nothing was changed." });
    expect(sheetOrganizationCurrency(proposal, { ...live(), now: proposal.expiresAt })).toMatchObject({ ok: false, code: "expired" });
    expect(sheetOrganizationCurrency(proposal, { ...live(), headMark: { ...HEAD_MARK, headSequence: 8 } })).toMatchObject({ ok: false, code: "stale-head", detail: expect.stringContaining("canonical head moved") });
    expect(sheetOrganizationCurrency(proposal, { ...live(), headMark: null })).toMatchObject({ ok: false, code: "stale-head", detail: "the schematic session is not ready; nothing was changed." });
    const moved = base(); moved.kicadComponents = moved.kicadComponents!.map((item, index) => (index === 0 ? { ...item, value: `${item.value}x` } : item));
    expect(sheetOrganizationCurrency(proposal, live(moved))).toMatchObject({ ok: false, code: "stale-base", detail: expect.stringContaining("stale") });
  });
});

describe("[PR-J5] 3. the review card's view", () => {
  it("projects the sealed facts and blocks Approve while stale or already applied", () => {
    const proposal = sealed();
    const review = sheetOrganizationReview(proposal, { currency: { ok: true }, alreadyApplied: false });
    expect(review.proposalId).toBe(proposal.proposalId);
    expect(review.sourceSheetName).toBe("Overview");
    expect(review.groups.map((group) => [group.name, group.members.length])).toEqual(J4_DRONE_HINTED_PROPOSAL.map((group) => [group.name, group.refs.length]));
    expect(review.groups.every((group) => group.sheetId.startsWith("sheet-org-"))).toBe(true);
    // one line per port the organisation creates (a crossing net is a port on each sheet it joins), in the sealed order
    expect(review.interfaces.map((entry) => `${entry.childSheetName}:${entry.portName}`)).toEqual(proposal.interfaces.map((entry) => `${entry.childSheetName}:${entry.portName}`));
    expect([...new Set(review.interfaces.map((entry) => entry.portName))].sort()).toEqual(["I2C_SCL", "I2C_SDA", "IMU_INT1", "PWM1", "PWM2", "PWM3", "PWM4"]);
    expect(review.interfaces.every((entry) => entry.line.includes(`a port of "${entry.childSheetName}"`))).toBe(true);
    expect(review.unassigned).toEqual([]);
    expect(review.equivalence).toEqual({ partitionDigest: proposal.equivalence.partitionDigest, componentCount: 41, operationCount: proposal.operationCount });
    expect(review.rationale).toBe("Four subsystems: the motor drivers, the power, the MCU, the IMU.");
    expect(review.approveBlockedReason).toBeNull();
    expect(sheetOrganizationReview(proposal, { currency: { ok: false, code: "stale-base", detail: "the schematic changed." }, alreadyApplied: false }).approveBlockedReason).toBe("Approve is disabled: the schematic changed.");
    expect(sheetOrganizationReview(proposal, { currency: { ok: true }, alreadyApplied: true }).approveBlockedReason).toContain("already applied");
    // a part the model leaves out stays on the source sheet and is listed (OD-259 item 4)
    const state = base();
    const compiled = compileSheetOrganizationProposal({ state, request: { groups: J4_DRONE_HINTED_PROPOSAL.map((group) => ({ name: group.name, members: group.refs.filter((ref) => ref !== "C7") })) }, getPart });
    expect(compiled.ok).toBe(true);
    if (compiled.ok) expect(compiled.compilation.unassigned).toEqual(["C7"]);
  });
});

describe("[PR-J5] 4. Approve through the Sheets controller's one organise transaction", () => {
  const graph = { run: () => {}, begin: () => true, preview: () => {}, cancel: () => {}, commit: () => {} };
  function controllerOver(state: SchematicState, run: RunSchematicCommand): SheetNavigationController {
    return new SheetNavigationController({ authoritative: state, projectId: SCOPE.projectId, graph, runSchematicCommand: run, getPart, viewSessionBridge: null, selectedId: undefined, selectedKicadId: undefined, captureScope: undefined, onSheetSwitch: undefined }, null);
  }
  const replanOn = (proposal: SealedSheetOrganizationProposal) => (canonical: CanonicalSchematic) => {
    const again = replanSheetOrganization(proposal, sheetOrganizationReplanBase(fromCanonicalSchematic(canonical), "A4"), getPart);
    return again.ok ? { ok: true as const, operations: again.operations } : { ok: false as const, detail: again.detail };
  };

  it("ONE schematic.move-to-sheet command, pinned to the base digest and the sealed head mark, whose operations are the tool's re-plan", async () => {
    const state = base();
    const proposal = sealed(state);
    const calls: Array<{ label: string; commandId: string; operations: EngineeringOperation[]; options: Parameters<RunSchematicCommand>[3] }> = [];
    const run: RunSchematicCommand = async (label, commandId, buildOperations, options) => {
      const operations = buildOperations(toCanonicalSchematic(state));
      calls.push({ label, commandId, operations, options });
      return { ok: true };
    };
    const controller = controllerOver(state, run);
    const outcome = await controller.applyOrganizeProposal({ label: sheetOrganizationApplyLabel(proposal), expectedBaseDigest: schematicStateDigest(state), expectedHeadMark: proposal.scope.headMark, replan: replanOn(proposal) });
    expect(outcome).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.commandId).toBe("schematic.move-to-sheet");
    expect(calls[0]!.label).toBe("Organized 41 parts into 4 sheets (assistant proposal)");
    expect(calls[0]!.operations).toHaveLength(proposal.operationCount);
    expect(calls[0]!.options).toMatchObject({ expectedBaseDigest: schematicStateDigest(state), expectedHeadMark: HEAD_MARK });
    expect(new Set(calls[0]!.operations.map((operation) => operation.kind))).toEqual(new Set(["schematic_create_sheet", "schematic_assign_sheet", "schematic_add_sheet_port", "schematic_add_net_label", "schematic_add_sheet_pin"].filter((kind) => calls[0]!.operations.some((operation) => operation.kind === kind))));
    expect(controller.getSnapshot().notice).toBeNull();
  });

  it("a differing base inside the queue refuses with the tool's sentence; nothing is applied; the notice says why", async () => {
    const state = base();
    const proposal = sealed(state);
    const moved: SchematicState = { ...state, kicadComponents: state.kicadComponents!.map((item, index) => (index === 0 ? { ...item, value: `${item.value}x` } : item)) };
    let built: EngineeringOperation[] | null = null;
    let thrown: string | null = null;
    const run: RunSchematicCommand = async (_label, _commandId, buildOperations) => {
      try { built = buildOperations(toCanonicalSchematic(moved)); } catch (error) { thrown = error instanceof Error ? error.message : String(error); }
      return { ok: false };
    };
    const controller = controllerOver(moved, run);
    const outcome = await controller.applyOrganizeProposal({ label: "x", expectedBaseDigest: schematicStateDigest(moved), expectedHeadMark: HEAD_MARK, replan: replanOn(proposal) });
    expect(built).toBeNull();
    expect(thrown).toBe("The schematic is not the one the organisation was proposed for. Nothing was changed.");
    expect(outcome).toEqual({ ok: false, message: "The schematic is not the one the organisation was proposed for. Nothing was changed." });
    expect(controller.getSnapshot().notice).toBe("The schematic is not the one the organisation was proposed for. Nothing was changed.");
  });

  it("the re-plan base takes the sheet-size fallback only when the canonical state has none (the chat run's posting recipe)", () => {
    const withSize = base();
    expect(sheetOrganizationReplanBase(withSize, "A3")).toBe(withSize);
    const without: SchematicState = { ...withSize }; delete without.pageSize;
    expect(sheetOrganizationReplanBase(without, "A4").pageSize).toBe("A4");
    expect(sheetOrganizationReplanBase(without, undefined)).toBe(without);
    // the fallback makes the digest the sealed one again
    expect(schematicStateDigest(sheetOrganizationReplanBase(without, "A4"))).toBe(schematicStateDigest(withSize));
  });
});

describe("[PR-J5] 5. the sentences", () => {
  it("name the sheets, parts and interfaces; nothing claims a change before the apply", () => {
    const proposal = sealed();
    const awaiting = sheetOrganizationLines.awaitingReview(proposal);
    expect(awaiting).toContain("organise 41 parts into 4 sheets");
    for (const group of proposal.groups) expect(awaiting).toContain(`"${group.name}" (${group.members.length})`);
    expect(awaiting).toContain("Nothing has changed yet");
    expect(sheetOrganizationLines.applied(proposal)).toContain("ONE undoable transaction");
    expect(sheetOrganizationLines.refused("the base moved")).toBe("The sheet organisation was not applied: the base moved");
    expect(sheetOrganizationLines.discarded()).toContain("nothing was changed and nothing was recorded");
    expect(sheetOrganizationLines.dropped()).toContain("failed the integrity checks");
    expect(sheetOrganizationLines.notOffered("it expired")).toBe("Sheet organisation not offered — it expired");
  });
});
