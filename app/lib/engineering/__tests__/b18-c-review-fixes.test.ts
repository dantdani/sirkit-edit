/**
 * [B18-C review] Regressions for the adversarial review of I1–I3 (recorded in
 * artifacts/remaining-builder-program/EXECUTION_LEDGER.md):
 *
 *  V0 (high)  a correct granted move on a board with a copper zone was
 *             reported POISONED: the expected revision came from the editor
 *             mutator, but the canonical kernel re-marks every zone fill dirty
 *             on a move. The builder now predicts the result with the kernel's
 *             own applier, and the ritual's postcondition compares the
 *             fill-normalized semantic digest (robust to a refill landing in
 *             the editor before the check);
 *  V1         the retry guard counts a POISONED settlement (a transaction
 *             landed) as a possible change: a re-sent identical message is
 *             only previewed;
 *  V2         an ambiguous reference designator is never an explicit request;
 *  V4         a commit that REJECTS after the consume is settled not committed
 *             (or poisoned / left to recovery, by the canonical evidence);
 *  V8, U0, U1 isolating pins: the discovery tightening, the never-granted
 *             command rule, and the never-exposed patterns (now a runtime key
 *             on every lift);
 *  U2, U3     page / editor grant hygiene (source pins).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compileEdits } from "../../pcb/edit/apply";
import { pcbRevisionId } from "../../pcb/revision";
import { mmToNm } from "../../pcb/units";
import { applyEngineeringOperations } from "../operations";
import { canonicalLineageDigest } from "../semantic-board-digest";
import { canonicalLineageDigest as sessionLineageDigest, canonicalSessionFor } from "../editor-adapter";
import { buildExecutionOperations } from "../execution-operations";
import { deriveExplicitPlan, proveExplicitUserRequest } from "../explicit-request";
import { EXECUTION_FAMILIES } from "../execution-grant";
import { GRANTED_EXECUTION_TOOLS, NEVER_EXPOSED_TOOL_PATTERNS, NEVER_GRANTED_COMMAND_IDS, grantedExecutionViolations, type GrantedExecutionTool } from "../granted-execution-families";
import { NEVER_EXPOSED_TOOL_PATTERNS as EXPOSURE_MODULE_PATTERNS } from "../agent-exposure";
import { SIRKIT_TOOL_CATALOG, sirkitToolRegistry } from "../tool-catalog";
import { ToolRegistry, type ToolDescriptor } from "../tool-registry";
import { discoverTools, type DiscoveryContext } from "../tool-discovery";
import { STAGE10_SCHEMA_VERSION } from "../types";
import { MESSAGE, SCOPE, call, composition, fixtureBoard, headOf, movesBy, r3Of, runScenario } from "./b18c-harness";

const answerOf = (adapter: { continueInputs: ReadonlyArray<ReadonlyArray<{ outputText: string }>> }, step = 0, index = 0) => JSON.parse(adapter.continueInputs[step]![index]!.outputText) as Record<string, unknown>;
const moveScript = (c: Awaited<ReturnType<typeof composition>>, dxMm = 2) => (move: string) => [() => ({ toolCalls: [call("c1", move, movesBy(c, dxMm))] }), () => ({ text: "done" })];

describe("B18-C review V0 — a zone-bearing board: the kernel predicts the result; the postcondition is fill-normalized", () => {
  it("the builder's expected revision is the KERNEL's (every zone fill re-marked dirty from the operation id), not the editor mutator's; the fill-normalized digests agree; the session re-exports the one digest", () => {
    const board = fixtureBoard({ zone: true });
    const r3 = board.footprints.find((f) => f.ref === "R3")!;
    const built = buildExecutionOperations(board, { family: "pcb.move-footprint", moves: [{ footprintId: r3.id, x: r3.at.x + mmToNm(2), y: r3.at.y }] });
    if (!built.ok) throw new Error(built.message);
    const kernel = applyEngineeringOperations({ schemaVersion: STAGE10_SCHEMA_VERSION, tenantId: "t", projectId: "p", branchId: "b", pcb: board, pinnedAssets: [] }, built.operations).project.pcb;
    const mutator = compileEdits(board, built.commands).result;
    expect(built.resultRevision).toBe(pcbRevisionId(kernel));
    expect(built.resultRevision).not.toBe(pcbRevisionId(mutator)); // the V0 cause: the mutator keeps the derived fill
    expect(kernel.zones[0]).toMatchObject({ dirty: true, fill: [] });
    expect(built.resultLineageDigest).toBe(canonicalLineageDigest(kernel));
    expect(canonicalLineageDigest(kernel)).toBe(canonicalLineageDigest(mutator));
    expect(sessionLineageDigest).toBe(canonicalLineageDigest);
  });

  it("end to end: an explicit move on a board with a copper zone commits ONE transaction and the model is told `executed` — never poisoned", async () => {
    const c = await composition("execute_explicit_tier1", { zone: true });
    const before = headOf(c).headSequence;
    const x0 = r3Of(c).at.x;
    const { adapter, rituals, grants } = await runScenario(c, moveScript(c));
    expect(rituals[0]).toMatchObject({ ok: true, status: "committed", settled: "settled" });
    expect(answerOf(adapter)).toMatchObject({ ok: true, status: "executed", grantId: grants[0]!.grantId });
    expect(headOf(c).headSequence).toBe(before + 1);
    expect(r3Of(c).at.x).toBe(x0 + mmToNm(2));
    expect(c.history.committedPresent.zones[0]).toMatchObject({ dirty: true }); // the kernel re-marked the fill; the editor refills later
  }, 30_000);

  it("a zone refill that lands in the editor between the commit and the postcondition does not poison the execution", async () => {
    const c = await composition("execute_explicit_tier1", { zone: true });
    const session = canonicalSessionFor(c.history)!;
    const realCommit = session.commit.bind(session);
    session.commit = async (request) => {
      const result = await realCommit(request);
      // The editor's zone-fill hook refills DERIVED state (no history entry) before the ritual reads the board — and the
      // recomputed pour differs from the pre-move one because the footprint moved (here: a pour clipped by 1 mm).
      c.history.applyDerived("zone refill", (draft) => {
        const outer = [{ x: 0, y: 0 }, { x: mmToNm(39), y: 0 }, { x: mmToNm(39), y: mmToNm(29) }, { x: 0, y: mmToNm(29) }];
        for (const zone of draft.zones) { zone.fill = [{ outer, holes: [], areaNm2: mmToNm(39) * mmToNm(29), boundingBox: { minX: 0, minY: 0, maxX: mmToNm(39), maxY: mmToNm(29) } }]; zone.dirty = false; }
      });
      return result;
    };
    const before = headOf(c).headSequence;
    const { adapter, rituals } = await runScenario(c, moveScript(c));
    expect(rituals[0]).toMatchObject({ ok: true, status: "committed" });
    expect(answerOf(adapter)).toMatchObject({ ok: true, status: "executed" });
    expect(headOf(c).headSequence).toBe(before + 1);
    expect(c.history.committedPresent.zones[0]).toMatchObject({ dirty: false }); // refilled after the commit
  }, 30_000);
});

describe("B18-C review V1 — a poisoned settlement guards a retry", () => {
  it("a transaction that LANDED but could not be verified (poisoned) makes a re-sent identical message a PREVIEW, never a second unconfirmed execution", async () => {
    const c = await composition("execute_explicit_tier1");
    const session = canonicalSessionFor(c.history)!;
    const realCommit = session.commit.bind(session);
    let poisonNext = true;
    session.commit = async (request) => {
      const result = await realCommit(request);
      if (poisonNext && result.ok && result.status === "executed") { poisonNext = false; return { ...result, status: "idempotent_replay" } as typeof result; }
      return result;
    };
    const first = await runScenario(c, moveScript(c));
    expect(first.rituals[0]).toMatchObject({ ok: false, code: "recovery-required", changed: true });
    expect(answerOf(first.adapter)).toMatchObject({ ok: false, status: "execution_poisoned" });
    const landed = headOf(c).headSequence;
    const second = await runScenario(c, moveScript(c));
    expect(second.rituals).toEqual([]); // nothing ran without the human
    expect(second.events.find((event) => event.type === "execution_grant_ready")).toMatchObject({ decision: "preview_then_confirm", note: expect.stringMatching(/already landed a change that could not be verified/) });
    expect(answerOf(second.adapter)).toMatchObject({ ok: true, status: "execution_preview_issued" });
    expect(headOf(c).headSequence).toBe(landed);
  }, 30_000);
});

describe("B18-C review V2 — an ambiguous reference designator is never explicit", () => {
  it("an exact duplicate or a case-variant duplicate of R3 refuses the grammar and proves nothing for either footprint; an unambiguous board still proves", () => {
    for (const variant of ["R3", "r3", " R3 "]) {
      const board = fixtureBoard();
      const r4 = board.footprints.find((f) => f.ref === "R4")!;
      r4.ref = variant;
      expect(deriveExplicitPlan(MESSAGE, "pcb.move-footprint", board), variant).toMatchObject({ refusal: expect.stringMatching(/R3 names 2 footprints on this board/) });
      for (const target of board.footprints) {
        const built = buildExecutionOperations(board, { family: "pcb.move-footprint", moves: [{ footprintId: target.id, x: target.at.x + mmToNm(2), y: target.at.y }] });
        if (!built.ok) throw new Error(built.message);
        expect(proveExplicitUserRequest({ userMessage: MESSAGE, family: "pcb.move-footprint", board, operationsDigest: built.operationsDigest }), `${variant}/${target.id}`).toMatchObject({ proven: false, coverage: "unproven" });
      }
    }
    const clean = fixtureBoard();
    const r3 = clean.footprints.find((f) => f.ref === "R3")!;
    const built = buildExecutionOperations(clean, { family: "pcb.move-footprint", moves: [{ footprintId: r3.id, x: r3.at.x + mmToNm(2), y: r3.at.y }] });
    if (!built.ok) throw new Error(built.message);
    expect(proveExplicitUserRequest({ userMessage: MESSAGE, family: "pcb.move-footprint", board: clean, operationsDigest: built.operationsDigest })).toMatchObject({ proven: true, coverage: "whole-message" });
  });
});

describe("B18-C review V4 — a commit that rejects after the consume is settled, never left dangling", () => {
  for (const [label, error] of [["a disposed session (rejects before the queued task starts)", "CANONICAL_SESSION_DISPOSED"], ["another failure with no canonical evidence", "unexpected commit failure"]] as const) {
    it(`${label}: settled not committed and abandoned; the model is told nothing changed; the head did not move`, async () => {
      const c = await composition("execute_explicit_tier1");
      const session = canonicalSessionFor(c.history)!;
      session.commit = () => Promise.reject(new Error(error));
      const before = headOf(c).headSequence;
      const { adapter, rituals, grants } = await runScenario(c, moveScript(c));
      expect(rituals[0]).toMatchObject({ ok: false, code: "commit-rejected", changed: false });
      expect(answerOf(adapter)).toMatchObject({ ok: false, status: "execution_not_committed" });
      expect((await c.store.load(SCOPE, grants[0]!.grantId, c.now()))!.record.state).toMatchObject({ status: "settled", settlement: { outcome: "not-committed" } });
      expect(await c.journal.lookupByGrant(grants[0]!.grantId)).toMatchObject({ kind: "entry", entry: { state: "abandoned" } });
      expect(headOf(c).headSequence).toBe(before);
    }, 30_000);
  }
});

describe("B18-C review V8 / U0 / U1 — isolating gate pins", () => {
  const registry = sirkitToolRegistry();
  const agentContext = (overrides: Partial<DiscoveryContext>): DiscoveryContext => ({
    tenantId: "local", projectId: "p", branchId: "main", actorId: "u1", actorRole: "pcb_editor", grantedCapabilities: ["read_project"], channel: "assistant-agent",
    currentRevisionDigest: "eng1-0000000000000000", lineageId: "", currentEditor: "", selectedKinds: [], projectState: ["board-present"], availableAuthority: ["local-working-copy"],
    providerCapabilities: { supportsJsonSchema: true, toolNameMaxLength: 64, maxToolCount: 64 }, riskCeiling: "mutate", approvalsAvailable: ["reversible"], enabledFlags: [], requestedCategories: [],
    grantLineageId: "lin1-0000000000000001", ...overrides,
  });

  it("V8: with the grant lineage present, an actor-held edit_placement never satisfies a granted execution on the agent channel (only the grantable set does)", () => {
    const actorOnly = discoverTools(registry, agentContext({ grantedCapabilities: ["read_project", "edit_placement"], grantableCapabilities: [] }));
    expect(actorOnly.excluded.find((entry) => entry.toolId === "sirkit.pcb.move-footprint")?.reason).toBe("capability_missing");
    expect(discoverTools(registry, agentContext({ grantableCapabilities: ["edit_placement"] })).included.map((item) => item.toolId)).toContain("sirkit.pcb.move-footprint");
  });

  it("U0: the never-granted COMMAND rule fires on its own; no execution family collides with the never-granted list", () => {
    const editTrack = SIRKIT_TOOL_CATALOG.find((d) => d.toolId === "sirkit.pcb.edit-track")!;
    const rows: GrantedExecutionTool[] = [{ toolId: editTrack.toolId, family: "pcb.move-footprint", reason: "test" }];
    expect(grantedExecutionViolations({ ...editTrack, agentExposed: true, executionMode: "granted" }, rows)).toEqual(expect.arrayContaining(["canonical command pcb.edit-track can never be granted"]));
    expect(EXECUTION_FAMILIES.filter((family) => (NEVER_GRANTED_COMMAND_IDS as readonly string[]).includes(family))).toEqual([]);
  });

  it("U1: the never-exposed patterns are a RUNTIME key — a pattern-listed mutation with a reviewed-looking row is refused by the validator; the exposure module re-exports the same list", () => {
    expect(EXPOSURE_MODULE_PATTERNS).toBe(NEVER_EXPOSED_TOOL_PATTERNS);
    const rotate = SIRKIT_TOOL_CATALOG.find((d) => d.toolId === "sirkit.pcb.rotate-side-footprint")!;
    const rows: GrantedExecutionTool[] = [...GRANTED_EXECUTION_TOOLS, { toolId: rotate.toolId, family: "pcb.rotate-side-footprint", reason: "test: a lift that forgot to remove the pattern" }];
    const exposed: ToolDescriptor = { ...rotate, agentExposed: true, executionMode: "granted" };
    expect(grantedExecutionViolations(exposed, rows)).toEqual([`${rotate.toolId} matches a never-exposed tool pattern`]);
    expect(() => new ToolRegistry(SIRKIT_TOOL_CATALOG.map((d) => (d.toolId === rotate.toolId ? exposed : d)), undefined, { grantedExecutionTools: rows })).toThrow(/matches a never-exposed tool pattern/);
  });
});

describe("B18-C review U2 / U3 — page and editor grant hygiene (source pins)", () => {
  const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");

  it("a pending execution grant never crosses projects; every editor cancel uses the grant's OWN scope; a preview refused for a transient reason keeps its dialog", () => {
    const page = read("app", "page.tsx");
    const reset = page.slice(page.indexOf("const resetTransientProjectState"), page.indexOf("const installProject"));
    expect(reset).toContain("setPendingExecutionGrant(null)");
    const editor = read("app", "components", "pcb", "PcbEditor.tsx");
    const cancels = editor.match(/cancelGrantedExecution\(\{[^;]*/g) ?? [];
    expect(cancels.length).toBeGreaterThanOrEqual(3);
    for (const cancel of cancels) {
      expect(cancel).toMatch(/binding\.scope\.projectId/);
      expect(cancel).not.toMatch(/syncIdentity\.projectId/);
    }
    expect(editor).toMatch(/mode === "confirm" && grant\.binding\.operation\.decision === "preview_then_confirm" && transient/);
  });
});
