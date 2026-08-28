import { describe, expect, it } from "vitest";
import { createEmptyBoard } from "@/app/lib/pcb/types";
import { POST as previewRoute } from "@/app/api/constraints/preview/route";
import { POST as explainRoute } from "@/app/api/constraints/explain/route";
import { ConstraintAgentTools } from "../agent-tools";
import { compileConstraintProgram } from "../compiler";
import { exportKicadDru, importKicadDru, importKicadNetClasses } from "../kicad-dru";
import { migrateBoardConstraintState } from "../legacy";
import { compilationInput, definition, document, quantity } from "./fixtures";
import { buildRoutedDemo } from "@/app/lib/pcb/demo/routed-demo";
import { boardToDsn } from "@/app/lib/pcb/dsn/write-dsn";
import { validateDsn } from "@/app/lib/pcb/dsn/preflight";
import { applyConstraintTransaction, previewConstraintTransaction } from "../transactions";

const KICAD_RULES = `(version 1)
# supported and unsupported rules coexist with explicit loss accounting
(rule "GND clearance"
  (condition "A.NetName == 'GND'")
  (constraint clearance (min 0.25mm)))
(rule "Unsupported creepage"
  (condition "A.NetName == 'GND'")
  (constraint creepage (min 5mm)))`;

describe("KiCad 10 rule interoperability", () => {
  it("imports a bounded real S-expression subset deterministically and reports unsupported semantics", () => {
    const first = importKicadDru({ text: KICAD_RULES, sourceId: "board.kicad_dru", sourceRevision: "sha:1", netNameToStableIds: { GND: ["net:gnd"] } });
    const second = importKicadDru({ text: KICAD_RULES, sourceId: "board.kicad_dru", sourceRevision: "sha:1", netNameToStableIds: { GND: ["net:gnd"] } });
    expect(first.ok).toBe(true);
    expect(first.quarantined).toBe(false);
    expect(first.document?.constraints).toHaveLength(1);
    expect(first.document?.constraints[0].selector.predicate).toEqual({ kind: "ids", ids: ["net:gnd"] });
    expect(first.losses.some((item) => item.disposition === "unsupported" && item.severity === "error")).toBe(true);
    expect(first.document).toEqual(second.document);
  });

  it("quarantines malformed syntax and converts KiCad order conflicts into visible compiler conflicts", () => {
    const malformed = importKicadDru({ text: `(version 1) (rule "x"`, sourceId: "bad.kicad_dru", sourceRevision: "1", netNameToStableIds: {} });
    expect(malformed).toEqual(expect.objectContaining({ ok: false, quarantined: true }));
    expect(malformed.document).toBeUndefined();

    const conflicting = importKicadDru({ text: `(version 1)
      (rule "minimum" (condition "A.NetName == 'GND'") (constraint track_width (min 0.30mm)))
      (rule "maximum" (condition "A.NetName == 'GND'") (constraint track_width (max 0.20mm)))`, sourceId: "conflict.kicad_dru", sourceRevision: "1", netNameToStableIds: { GND: ["net:gnd"] } });
    expect(conflicting.ok).toBe(true);
    const compiled = compileConstraintProgram(compilationInput([conflicting.document!]));
    expect(compiled.ok).toBe(false);
    if (!compiled.ok) expect(compiled.conflicts[0].code).toBe("EMPTY_NUMERIC_FEASIBLE_RANGE");
  });

  it("imports net-class defaults with accurate hard/soft semantics and exports with a hard-loss ledger", () => {
    const netClasses = importKicadNetClasses({ sourceId: "board.kicad_pro", sourceRevision: "1", classes: [{ id: "Power", name: "Power", netStableIds: ["net:gnd"], clearanceMm: 0.25, trackWidthMm: 0.5, viaDiameterMm: 0.8, viaDrillMm: 0.4 }] });
    expect(netClasses.document.constraints.find((item) => item.kind === "clearance")?.strength).toBe("hard");
    expect(netClasses.document.constraints.filter((item) => item.kind !== "clearance").every((item) => item.strength === "soft")).toBe(true);

    const rules = [
      definition({ id: "c:width", kind: "trace_width", requirement: { form: "minimum", value: quantity("length", "0.2", "mm") } }),
      definition({ id: "c:impedance", kind: "target_impedance", domain: "routing", requirement: { form: "target", value: quantity("impedance", "90", "Ohm"), toleranceMinus: quantity("impedance", "9", "Ohm"), tolerancePlus: quantity("impedance", "9", "Ohm") } }),
    ];
    const compiled = compileConstraintProgram(compilationInput([document(rules)]));
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const exported = exportKicadDru({ program: compiled.program, stableNetNames: { "net:gnd": "GND" } });
    expect(exported.text).toContain("(constraint track_width (min 0.2mm))");
    expect(exported.text).toContain(compiled.program.programHash);
    expect(exported.verified).toBe(false);
    expect(exported.losses.some((item) => item.constraintIds.includes("c:impedance") && item.severity === "error")).toBe(true);
  });
});

describe("constraint API and AI proposal boundaries", () => {
  function board() {
    const value = createEmptyBoard();
    value.nets.push({ id: 1, name: "GND", stableId: "net:gnd", endpointKeys: [] });
    return migrateBoardConstraintState(value, "fixture").board;
  }

  it("previews and explains through stateless canonical API routes without exposing an activation bypass", async () => {
    const value = board();
    const previewResponse = await previewRoute(new Request("http://localhost/api/constraints/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ board: value, projectId: "fixture", documents: value.constraintState!.documents }) }));
    expect(previewResponse.status).toBe(200);
    const preview = await previewResponse.json() as { ok: boolean; preview: { compilation: { ok: boolean } } };
    expect(preview.ok).toBe(true);
    expect(preview.preview.compilation.ok).toBe(true);

    const explainResponse = await explainRoute(new Request("http://localhost/api/constraints/explain", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ program: value.constraintState!.activeProgram, targetId: "net:gnd" }) }));
    expect(explainResponse.status).toBe(200);
    const explanation = await explainResponse.json() as { explanation: { programHash: string; matchedRules: unknown[] } };
    expect(explanation.explanation.programHash).toBe(value.constraintState!.activeProgram!.programHash);
    expect(explanation.explanation.matchedRules.length).toBeGreaterThan(0);
  });

  it("allows the agent to inspect/propose/preview only and rejects unsourced numbers", () => {
    const value = board();
    const tools = new ConstraintAgentTools(value, "fixture");
    expect(tools.list()).toHaveLength(1);
    expect(tools.explain("net:gnd")?.programHash).toBe(value.constraintState!.activeProgram!.programHash);
    expect("apply" in tools).toBe(false);
    const proposed = definition({ id: "c:ai", kind: "trace_width", requirement: { form: "minimum", value: quantity("length", "0.4", "mm") } });
    expect(() => tools.propose({ sourceDocumentId: "constraint-set:ai", sourceRevision: "1", requirementTextRef: "external:unsourced", constraints: [proposed] })).toThrow(/no evidence/);
    const safe = tools.propose({ sourceDocumentId: "constraint-set:ai", sourceRevision: "1", requirementTextRef: "user:requirement:42", constraints: [proposed] });
    expect(safe.documents.at(-1)?.constraints[0].origin).toEqual(expect.objectContaining({ kind: "ai_proposal", reviewState: "proposed" }));
    expect(safe.documents.at(-1)?.constraints[0].lifecycle.state).toBe("draft");
  });
});

describe("constraint-aware FreeRouting loss accounting", () => {
  it("blocks verified DSN preflight when a hard per-net layer rule cannot be preserved", () => {
    const board = migrateBoardConstraintState(buildRoutedDemo(), "fixture").board;
    const target = board.nets.find((net) => net.id !== 0)?.stableId;
    expect(target).toBeTruthy();
    const layerRule = definition({ id: "c:dsn-layer", kind: "allowed_layers", domain: "routing", selector: { objectType: "net", predicate: { kind: "ids", ids: [target!] }, cardinality: { kind: "exactly", count: 1 } }, requirement: { form: "allowed_set", values: ["layer:copperTop"] } });
    const documents = [...board.constraintState!.documents, document([layerRule], { id: "constraint-set:dsn-layer" })];
    const preview = previewConstraintTransaction({ board, projectId: "fixture", documents });
    const applied = applyConstraintTransaction({ board, projectId: "fixture", preview, actorId: "user:fixture" });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    const dsn = boardToDsn(applied.board);
    expect(dsn.integrity?.constraintProgramHash).toBe(applied.program.programHash);
    expect(dsn.integrity?.constraintLoss).toEqual(expect.arrayContaining([expect.objectContaining({ disposition: "unsupported", severity: "error" })]));
    expect(validateDsn(applied.board, dsn).issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "CONSTRAINT_SEMANTIC_LOSS", severity: "error" })]));
  });
});
