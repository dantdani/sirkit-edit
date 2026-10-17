/**
 * B10 — project-owned PCB/editor context bridge and truthful read
 * activation. Permanent regressions for the eight pre-edit counterexamples
 * plus the section A–F required coverage (bridge ownership, server
 * validation, selection/netlist resources, resource-aware discovery,
 * runtime availability matrix, entry-gate-0 schema edge).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SchematicState } from "@/lib/schematic-types";
import { assembleAgentRunContext, buildAgentResourceBundle, MAX_SELECTION_REFS } from "../context";
import { EditorContextBridge, EDITOR_CONTEXT_SCHEMA } from "../editor-context-bridge";
import { createAgentToolGateway, verifyAgentContextIntegrity } from "../gateway";
import { availableResourceKinds, buildRunToolset } from "../loop";
import { toStrictSchema } from "../provider-tools";
import { AGENT_NETLIST_SCHEMA, projectAgentNetlist, validateAgentNetlistProjection, type AgentNetlistProjection } from "../netlist-validation";
import { buildNetlist } from "../../pcb/netlist-bridge";
import { sirkitToolRegistry } from "../../engineering/tool-catalog";
import { schematicStateDigest } from "../../engineering/schematic-model";
import { createEmptyBoard, type PcbBoard } from "../../pcb/types";
import { pcbRevisionId } from "../../pcb/revision";
import { INTENTIONAL_AGENT_EXPOSED_TOOL_IDS, isAgentExposableDescriptor } from "@/app/lib/engineering/agent-exposure"; // [B17-F] the ONE reviewed exposure set — never a hard-coded count

const SCHEMATIC: SchematicState = { components: [{ id: "r1", type: "resistor", x: 100, y: 100, rotation: 0, value: "10k" }], wires: [] };
const MARK = { lineageId: "lin1-1234567890abcdef", headSequence: 1, canonicalStateDigest: "eng1-1234567890abcdef" };
const SCOPE = { tenantId: "local", projectId: "p10", branchId: "main" };
const PROPOSAL_ID = "sirkit.schematic.propose-tier1-edit";
const SELECTION_ID = "sirkit.selection.inspect";

function boardWithTrack(): PcbBoard {
  const board = createEmptyBoard();
  board.nets.push({ id: 1, name: "SIG", stableId: "net:sig", endpointKeys: [] });
  board.tracks.push({ id: "t1", layer: "copperTop", width: 250_000, start: { x: 1_000_000, y: 3_000_000 }, end: { x: 5_000_000, y: 3_000_000 }, netId: 1, source: "human" });
  board.vias.push({ id: "v1", at: { x: 3_000_000, y: 3_000_000 }, size: 600_000, drill: 300_000, netId: 1, layers: ["copperTop", "copperBottom"] });
  return board;
}

function validNetlist(): AgentNetlistProjection {
  // [B10.2] the ONLY valid projection is the server derivation itself —
  // fixtures are derived through the production netlist authority, never
  // hand-written.
  return projectAgentNetlist(buildNetlist(SCHEMATIC));
}

function assemble(input?: {
  board?: unknown; schematic?: unknown; mark?: unknown;
  selection?: unknown; netlist?: unknown; editorSchematicDigest?: unknown;
}) {
  const assembly = assembleAgentRunContext({
    ...SCOPE,
    schematic: input && "schematic" in input ? input.schematic : SCHEMATIC,
    board: input && "board" in input ? input.board : boardWithTrack(),
    ...(input && "mark" in input ? (input.mark !== undefined ? { schematicHeadMark: input.mark } : {}) : { schematicHeadMark: MARK }),
    ...(input?.selection !== undefined ? { selection: input.selection } : {}),
    ...(input?.netlist !== undefined ? { netlist: input.netlist } : {}),
    ...(input?.editorSchematicDigest !== undefined ? { editorSchematicDigest: input.editorSchematicDigest } : {}),
  });
  if (!assembly.ok) throw new Error(assembly.reason);
  return assembly;
}

function toolsetIds(context: ReturnType<typeof assemble>["context"]): string[] {
  return buildRunToolset(sirkitToolRegistry(), context, () => undefined).declarations.map((declaration) => declaration.toolId).sort();
}

// ─── §A — the bridge ─────────────────────────────────────────────────────────

describe("B10 §A — project-owned editor-context bridge", () => {
  function publisherFor(bridge: EditorContextBridge, working: { board: PcbBoard | null }, options?: { scope?: typeof SCOPE; alive?: { current: boolean }; selectionRefs?: unknown[] }) {
    const alive = options?.alive ?? { current: true };
    return {
      outcome: bridge.publish({
        scope: options?.scope ?? SCOPE,
        isCurrent: () => alive.current,
        read: () => ({
          board: working.board,
          selection: { refs: (options?.selectionRefs ?? []) as never, primary: null },
          netlist: null,
          schematicDigest: schematicStateDigest(SCHEMATIC),
        }),
      }),
      alive,
    };
  }

  it("capture returns the EXACT current working copy — an UNSAVED edit made after the first capture is visible in the next one", () => {
    const bridge = new EditorContextBridge();
    bridge.beginProject(SCOPE);
    const working = { board: boardWithTrack() };
    expect(publisherFor(bridge, working).outcome.ok).toBe(true);
    const first = bridge.capture(SCOPE)!;
    expect(first.schema).toBe(EDITOR_CONTEXT_SCHEMA);
    expect(first.pcbRevisionId).toBe(pcbRevisionId(working.board!));
    // UNSAVED local edit (track width change) — never synced to any durable record.
    working.board = structuredClone(working.board!);
    working.board.tracks[0]!.width = 500_000;
    const second = bridge.capture(SCOPE)!;
    expect(second.pcbRevisionId).toBe(pcbRevisionId(working.board));
    expect(second.pcbRevisionId).not.toBe(first.pcbRevisionId);
    expect(second.board.tracks[0]!.width).toBe(500_000);
  });

  it("the durable authoritative record can NEVER overwrite the working-copy read source (the bridge reads only the publisher's live board)", () => {
    const bridge = new EditorContextBridge();
    bridge.beginProject(SCOPE);
    const durable = boardWithTrack(); // what authorityRef would hold
    const working = { board: structuredClone(durable) };
    working.board.tracks[0]!.width = 777_000; // unsaved divergence
    publisherFor(bridge, working);
    const captured = bridge.capture(SCOPE)!;
    expect(captured.board.tracks[0]!.width).toBe(777_000);
    expect(captured.pcbRevisionId).not.toBe(pcbRevisionId(durable));
    expect(captured.authoritySource).toBe("local-working-copy");
  });

  it("captured snapshots are immutable clones — later editor mutation and external aliases cannot alter them", () => {
    const bridge = new EditorContextBridge();
    bridge.beginProject(SCOPE);
    const working = { board: boardWithTrack() };
    publisherFor(bridge, working);
    const captured = bridge.capture(SCOPE)!;
    const revisionAtCapture = captured.pcbRevisionId;
    // Later editor mutation (same object identity) cannot alter the capture.
    working.board!.tracks[0]!.width = 999_000;
    expect(captured.board.tracks[0]!.width).toBe(250_000);
    // External aliases cannot mutate the captured snapshot (deep-frozen).
    expect(Object.isFrozen(captured)).toBe(true);
    expect(Object.isFrozen(captured.board)).toBe(true);
    expect(Object.isFrozen(captured.board.tracks[0])).toBe(true);
    expect(() => { (captured.board.tracks[0] as { width: number }).width = 1; }).toThrow();
    expect(pcbRevisionId(captured.board)).toBe(revisionAtCapture);
  });

  it("project A context can never appear in project B: hydration (beginProject) retires the previous publisher; scope-mismatched capture is unavailable", () => {
    const bridge = new EditorContextBridge();
    bridge.beginProject(SCOPE);
    const working = { board: boardWithTrack() };
    publisherFor(bridge, working);
    expect(bridge.capture(SCOPE)).not.toBeNull();
    // Branch mismatch refuses.
    expect(bridge.capture({ ...SCOPE, branchId: "other-branch" })).toBeNull();
    // Foreign project refuses.
    expect(bridge.capture({ ...SCOPE, projectId: "project-b" })).toBeNull();
    // Hydration into project B retires project A's publisher entirely.
    bridge.beginProject({ ...SCOPE, projectId: "project-b" });
    expect(bridge.capture({ ...SCOPE, projectId: "project-b" })).toBeNull(); // no publisher yet
    expect(bridge.capture(SCOPE)).toBeNull(); // old scope gone
  });

  it("a LATE publication from a retired editor refuses; a publisher whose lifecycle retires after publishing can no longer serve captures; board removal is unavailable", () => {
    const bridge = new EditorContextBridge();
    bridge.beginProject(SCOPE);
    const working: { board: PcbBoard | null } = { board: boardWithTrack() };
    // Late publication: lifecycle already retired at publish time.
    const dead = publisherFor(bridge, working, { alive: { current: false } });
    expect(dead.outcome.ok).toBe(false);
    expect(bridge.capture(SCOPE)).toBeNull();
    // Publisher retires AFTER publishing (unmount): captures stop.
    const live = publisherFor(bridge, working);
    expect(bridge.capture(SCOPE)).not.toBeNull();
    live.alive.current = false;
    expect(bridge.capture(SCOPE)).toBeNull();
    // Foreign-scope publication refuses outright.
    const foreign = publisherFor(bridge, working, { scope: { ...SCOPE, projectId: "someone-else" } });
    expect(foreign.outcome.ok).toBe(false);
    // Board removal ⇒ unavailable.
    const fresh = publisherFor(bridge, working);
    expect(fresh.outcome.ok).toBe(true);
    working.board = null;
    expect(bridge.capture(SCOPE)).toBeNull();
  });

  it("demo state cannot claim current-project authority: the editor's production publisher seam is demo-gated and reads only the working copy", () => {
    const editorSource = readFileSync(join(process.cwd(), "app/components/pcb/PcbEditor.tsx"), "utf8");
    // [B10.1] the extracted PRODUCTION hook is the registration seam.
    expect(editorSource).toContain("useEditorContextPublisher({");
    expect(editorSource).toContain("enabled: !init.demo && init.scope !== null");
    // And the read source is the live board ref — never authorityRef/storage.
    const publisherBlock = editorSource.slice(editorSource.indexOf("B10/B10.1 — editor-context publisher"), editorSource.indexOf("R06: durable checkpoint"));
    expect(publisherBlock).toContain("board: boardRef.current");
    expect(publisherBlock).not.toContain("authorityRef.current");
    expect(publisherBlock).not.toContain("localStorage");
    expect(publisherBlock).not.toContain("loadWorkingCopy");
  });
});

// ─── §B — server validation of the captured context ──────────────────────────

describe("B10 §B — server-side context assembly over the editor context", () => {
  it("the server recomputes every revision/digest from the validated board; missing board ⇒ tool-less read set; malformed board ⇒ no canonical resource", () => {
    const board = boardWithTrack();
    const assembly = assemble({ board });
    expect(assembly.context.canonicalRevisionDigest).not.toBeNull();
    expect(assembly.context.canonicalState!.pcb).toEqual(board);
    // Missing board: canonical reads all gone. [PR-D, 2026-10-17] pin move: the Schematic to PCB preflight read stays (a Tier 0 read over the verified schematic snapshot, no board needed; its own binding, not B05's)
    const boardless = assemble({ board: undefined });
    expect(toolsetIds(boardless.context)).toEqual(["sirkit.pcb-sync.preflight", PROPOSAL_ID]);
    // Malformed board: no canonical resource, no reads.
    const malformed = assemble({ board: { stackup: 2, nets: [], footprints: [], tracks: [{ id: "" }], vias: [], zones: [] } });
    expect(malformed.context.canonicalState).toBeNull();
    expect(() => buildAgentResourceBundle(malformed.context)).toThrow(/CANONICAL_RESOURCE_UNAVAILABLE/);
  });

  it("post-assembly tampering with board, selection, or netlist fails context integrity before invocation", async () => {
    const assembly = assemble({
      selection: { refs: [{ kind: "track", id: "t1" }], primary: null },
      netlist: validNetlist(),
      editorSchematicDigest: schematicStateDigest(SCHEMATIC),
    });
    expect(verifyAgentContextIntegrity(assembly.context)).toEqual([]);
    const gateway = createAgentToolGateway(sirkitToolRegistry());
    const tampered = [
      (() => { const context = structuredClone(assembly.context); context.canonicalState!.pcb.tracks[0]!.width = 1_000_000; return context; })(),
      (() => { const context = structuredClone(assembly.context); (context.selection!.refs as unknown as Array<unknown>).push({ kind: "via", id: "v1" }); return context; })(),
      (() => { const context = structuredClone(assembly.context); (context.netlist!.components as unknown as Array<unknown>).pop(); return context; })(),
    ];
    for (const context of tampered) {
      expect(verifyAgentContextIntegrity(context).length).toBeGreaterThan(0);
      const outcome = await gateway.invoke({ runId: "r", provider: "openai", toolId: "sirkit.pcb.board-inspect", version: "1.1.0", args: {}, context, timeoutMs: 3000 });
      expect(outcome).toMatchObject({ kind: "refused", status: "context_integrity" });
    }
  });
});

// ─── §C — selection resource + tool ──────────────────────────────────────────

describe("B10 §C — selection resource and selection.inspect", () => {
  it("a current EMPTY selection is truthful: the resource seals, the tool is advertised, and it returns an empty result", async () => {
    const assembly = assemble({ selection: { refs: [], primary: null } });
    expect(assembly.context.selection).toEqual({ refs: [], primary: null });
    expect(toolsetIds(assembly.context)).toContain(SELECTION_ID);
    const gateway = createAgentToolGateway(sirkitToolRegistry());
    const outcome = await gateway.invoke({ runId: "r", provider: "openai", toolId: SELECTION_ID, version: "1.1.0", args: {}, context: assembly.context, timeoutMs: 3000 });
    if (outcome.kind !== "read" || !outcome.ok) throw new Error(`expected read, got ${JSON.stringify(outcome).slice(0, 200)}`);
    expect((outcome.output as { items: unknown[] }).items).toEqual([]);
  });

  it("dead refs are removed; live refs resolve; the primary survives only while live", async () => {
    const assembly = assemble({
      selection: {
        refs: [{ kind: "track", id: "t1" }, { kind: "track", id: "t-gone" }, { kind: "via", id: "v1" }, { kind: "track", id: "t1" }],
        primary: { kind: "track", id: "t-gone" },
      },
    });
    expect(assembly.context.selection!.refs).toEqual([{ kind: "track", id: "t1" }, { kind: "via", id: "v1" }]); // deduped, dead ref removed
    expect(assembly.context.selection!.primary).toBeNull(); // dead primary dropped
    const gateway = createAgentToolGateway(sirkitToolRegistry());
    const outcome = await gateway.invoke({ runId: "r", provider: "openai", toolId: SELECTION_ID, version: "1.1.0", args: {}, context: assembly.context, timeoutMs: 3000 });
    if (outcome.kind !== "read" || !outcome.ok) throw new Error("expected read");
    expect((outcome.output as { items: Array<{ id: string }> }).items.map((item) => item.id).sort()).toEqual(["t1", "v1"]);
  });

  it("an OVERSIZED selection is rejected (withheld), never truncated — and only selection.inspect disappears", () => {
    const oversized = { refs: Array.from({ length: MAX_SELECTION_REFS + 1 }, (_ignored, index) => ({ kind: "track", id: `t${index}` })), primary: null };
    const assembly = assemble({ selection: oversized });
    expect(assembly.context.selection).toBeNull();
    expect(assembly.warnings.some((warning) => warning.includes("rejected, not truncated"))).toBe(true);
    const ids = toolsetIds(assembly.context);
    expect(ids).not.toContain(SELECTION_ID);
    expect(ids).toContain("sirkit.pcb.board-inspect"); // canonical reads unaffected
  });

  it("a missing selection resource withholds ONLY selection.inspect; discovery never advertises an unsatisfied binding", () => {
    const withoutSelection = assemble({});
    const ids = toolsetIds(withoutSelection.context);
    expect(ids).not.toContain(SELECTION_ID);
    expect(ids).toContain("sirkit.validation.drc-run");
    expect(availableResourceKinds(withoutSelection.context).has("selection-snapshot")).toBe(false);
  });
});

// ─── §D — optional netlist resource ──────────────────────────────────────────

describe("B10 §D — optional validated netlist resource", () => {
  it("an INVALID netlist (duplicate identity / dangling reference) is withheld; readiness stays available and reports schematic parity as NOT evaluated", async () => {
    const contractPins = [{ number: "1", name: "left" }, { number: "2", name: "right" }];
    const duplicate = { schema: AGENT_NETLIST_SCHEMA, components: [{ id: "r1", ref: "r1", pins: contractPins }, { id: "r1", ref: "r1", pins: contractPins }], nets: [] };
    expect(validateAgentNetlistProjection(duplicate, SCHEMATIC).some((issue) => issue.includes("duplicate component identity"))).toBe(true);
    const dangling = { schema: AGENT_NETLIST_SCHEMA, components: [{ id: "r1", ref: "r1", pins: contractPins }], nets: [{ id: 1, name: "N", nodes: [{ componentId: "ghost", pinNumber: "1" }], endpointKeys: [] }] };
    expect(validateAgentNetlistProjection(dangling, SCHEMATIC).some((issue) => issue.includes("unknown component"))).toBe(true);

    const assembly = assemble({ netlist: duplicate, editorSchematicDigest: schematicStateDigest(SCHEMATIC) });
    expect(assembly.context.netlist).toBeNull();
    expect(assembly.warnings.some((warning) => warning.includes("netlist resource was withheld"))).toBe(true);
    const gateway = createAgentToolGateway(sirkitToolRegistry());
    const readiness = await gateway.invoke({ runId: "r", provider: "openai", toolId: "sirkit.manufacturing.readiness-inspect", version: "1.0.0", args: {}, context: assembly.context, timeoutMs: 5000 });
    if (readiness.kind !== "read" || !readiness.ok) throw new Error(`expected readiness read, got ${JSON.stringify(readiness).slice(0, 200)}`);
    const output = readiness.output as { report: { parity: { diagnostics?: Array<{ code: string }> } }; pinned: Record<string, unknown> };
    expect(JSON.stringify(output.report.parity)).toContain("SCHEMATIC_PARITY_NOT_EVALUATED");
    expect(output.pinned.netlist).toBeUndefined();
  });

  it("a netlist without schematic-digest agreement is withheld (atomic capture unproven); a VALID one is sealed and pinned into readiness provenance", async () => {
    const stale = assemble({ netlist: validNetlist(), editorSchematicDigest: "eng1-someothersnapshot" });
    expect(stale.context.netlist).toBeNull();
    expect(stale.warnings.some((warning) => warning.includes("schematic-digest agreement failed"))).toBe(true);

    const valid = assemble({ netlist: validNetlist(), editorSchematicDigest: schematicStateDigest(SCHEMATIC) });
    expect(valid.context.netlist).not.toBeNull();
    expect(availableResourceKinds(valid.context).has("netlist")).toBe(true);
    const gateway = createAgentToolGateway(sirkitToolRegistry());
    const readiness = await gateway.invoke({ runId: "r", provider: "openai", toolId: "sirkit.manufacturing.readiness-inspect", version: "1.0.0", args: {}, context: valid.context, timeoutMs: 5000 });
    if (readiness.kind !== "read" || !readiness.ok) throw new Error("expected readiness read");
    const pinned = (readiness.output as { pinned: { netlist?: { kind: string; contentDigest: string } } }).pinned;
    expect(pinned.netlist?.kind).toBe("netlist");
    expect(typeof pinned.netlist?.contentDigest).toBe("string");
  });
});

// ─── §E — runtime availability matrix ────────────────────────────────────────

describe("B10 §E — runtime tool availability matrix (matches the committed artifact)", () => {
  const digestOf = () => schematicStateDigest(SCHEMATIC);
  const CASES: Array<{ id: string; context: () => ReturnType<typeof assemble>["context"] }> = [
    { id: "no-board-no-mark", context: () => assemble({ board: undefined, schematic: undefined, mark: undefined }).context },
    { id: "schematic+mark-no-board", context: () => assemble({ board: undefined }).context },
    { id: "board+schematic+mark+selection", context: () => assemble({ selection: { refs: [{ kind: "track", id: "t1" }], primary: null } }).context },
    { id: "board+schematic-no-mark", context: () => assemble({ mark: undefined, selection: { refs: [], primary: null } }).context },
    { id: "board-no-schematic", context: () => assemble({ schematic: undefined, mark: undefined, selection: { refs: [], primary: null } }).context },
    { id: "board+invalid-netlist", context: () => assemble({ netlist: { components: "x", nets: [] }, editorSchematicDigest: digestOf() }).context },
    { id: "no-selection-resource", context: () => assemble({}).context },
    { id: "no-component-authority-resource", context: () => assemble({ selection: { refs: [], primary: null }, netlist: validNetlist(), editorSchematicDigest: digestOf() }).context },
  ];

  it("every case yields exactly the recorded tool set", () => {
    const committed = readFileSync(join(process.cwd(), "artifacts/ai-control-plane-b10/runtime-tool-availability.csv"), "utf8")
      .trim().split("\n").slice(1)
      .map((line) => { const [id, tools] = line.split(","); return [id, tools === "(none)" ? "" : tools] as const; });
    const actual = CASES.map(({ id, context }) => [id, toolsetIds(context()).join(";")] as const);
    expect(actual).toEqual(committed);
    // Spot semantics: full context exposes selection + all reads + proposal;
    // component-authority inspection NEVER appears (no proven producer).
    const full = new Map(actual).get("board+schematic+mark+selection")!;
    expect(full).toContain(SELECTION_ID);
    expect(full).toContain(PROPOSAL_ID);
    expect(full).not.toContain("sirkit.component-authority.inspect");
    // Board without schematic: board-compatible reads only, no schematic
    // inspection, no proposal.
    const boardOnly = new Map(actual).get("board-no-schematic")!;
    expect(boardOnly).not.toContain("sirkit.schematic.inspect");
    expect(boardOnly).not.toContain(PROPOSAL_ID);
  });
});

// ─── §F — exposure discipline + entry gate 0 ─────────────────────────────────

describe("B10 §F — exposure discipline and the entry-gate-0 schema edge", () => {
  // [B20 B2] retitled (D-13, D20-30): the MCP endpoint now exists, and the old clauses were never asserted (the exposed set holds
  // reviewed granted mutations and a view-session control); the assertions are unchanged
  // [B20 A4] retitled (D19, D20-30): the agent's one MCP tool is a bound external read of approved servers; assertion unchanged
  it("static exposure is exactly the reviewed list and every exposed tool is agent-exposable (a read, a proposal, a view-session control or a reviewed granted execution — never destructive or release); the agent's one MCP tool is a bound external read of approved servers (B20-A4); the agent exposure is independent of the MCP endpoint (B20-B2), whose subset b20-b1 pins", () => {
    const exposed = sirkitToolRegistry().list().filter((descriptor) => descriptor.agentExposed);
    expect(new Set(exposed.map((descriptor) => descriptor.toolId)).size).toBe(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS.length); // B15.3: + sirkit.pcb.propose-bounded-edit
    for (const descriptor of exposed) {
      expect(isAgentExposableDescriptor(descriptor), descriptor.toolId).toBe(true);
    }
    expect(exposed.some((descriptor) => descriptor.toolId === SELECTION_ID)).toBe(true);
  });

  it("entry gate 0: nested properties-without-type and items-without-array-type REFUSE instead of silent object/array inference; valid schemas still render", () => {
    expect(() => toStrictSchema({
      type: "object",
      properties: { a: { properties: { x: { type: "string" } }, required: ["x"], additionalProperties: false } },
      required: ["a"], additionalProperties: false,
    } as never)).toThrow(/STRICT_SCHEMA_UNSUPPORTED/);
    expect(() => toStrictSchema({
      type: "object",
      properties: { a: { items: { type: "string" }, enum: undefined, anyOf: [{ type: "string" }] } },
      required: ["a"], additionalProperties: false,
    } as never)).toThrow(/STRICT_SCHEMA_UNSUPPORTED/);
    // Valid control: explicit nested object type renders unchanged in meaning.
    const strict = toStrictSchema({
      type: "object",
      properties: { a: { type: "object", properties: { x: { type: "string" } }, required: ["x"], additionalProperties: false } },
      required: ["a"], additionalProperties: false,
    } as never) as { properties: { a: { type: string } } };
    expect(strict.properties.a.type).toBe("object");
  });
});
