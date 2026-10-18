/**
 * B09.3 — lineage integrity, semantic provider-schema validation, and
 * control-plane truth closure. The four pre-edit counterexamples (R1–R4)
 * are permanent regressions here, plus the section A–D required coverage.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { SchematicState } from "@/lib/schematic-types";
import { assembleAgentRunContext } from "../context";
import { createAgentToolGateway, verifyAgentContextIntegrity, AGENT_PROPOSAL_TOOL_VERSION } from "../gateway";
import { buildRunToolset } from "../loop";
import { buildAgentToolDeclarations, renderAnthropicAgentTool, renderOpenAiResponsesTool, toStrictSchema, validateSchemaStructure } from "../provider-tools";
import { sirkitToolRegistry } from "../../engineering/tool-catalog";
import { discoverTools } from "../../engineering/tool-discovery";
import { canonicalJson } from "../../engineering/stable";
import { createEmptyBoard } from "../../pcb/types";
import { INTENTIONAL_AGENT_EXPOSED_TOOL_IDS } from "@/app/lib/engineering/agent-exposure"; // [B17-F] the ONE reviewed exposure set — never a hard-coded count

const SCHEMATIC: SchematicState = { components: [{ id: "r1", type: "resistor", x: 100, y: 100, rotation: 0, value: "10k" }], wires: [] };
const MARK = { lineageId: "lin1-1234567890abcdef", headSequence: 1, canonicalStateDigest: "eng1-1234567890abcdef" };
const PROPOSAL_ID = "sirkit.schematic.propose-tier1-edit";

function assemble(input?: { board?: unknown; schematic?: unknown; mark?: unknown; branchId?: string }) {
  const assembly = assembleAgentRunContext({
    tenantId: "local", projectId: "p93", branchId: input?.branchId ?? "main",
    schematic: input && "schematic" in input ? input.schematic : SCHEMATIC,
    board: input && "board" in input ? input.board : createEmptyBoard(),
    ...(input && "mark" in input ? (input.mark !== undefined ? { schematicHeadMark: input.mark } : {}) : { schematicHeadMark: MARK }),
  });
  if (!assembly.ok) throw new Error(assembly.reason);
  return assembly;
}

describe("B09.3 §A — lineage is part of context integrity (R1)", () => {
  it("a valid assembled context carries the head mark's lineage in discovery and passes integrity; gateway reads succeed", async () => {
    const assembly = assemble();
    expect(assembly.context.discovery.lineageId).toBe(MARK.lineageId);
    expect(verifyAgentContextIntegrity(assembly.context)).toEqual([]);
    const gateway = createAgentToolGateway(sirkitToolRegistry());
    const outcome = await gateway.invoke({ runId: "r", provider: "openai", toolId: "sirkit.project.canonical-revision-inspect", version: "1.0.0", args: {}, context: assembly.context, timeoutMs: 3000 });
    expect(outcome.kind).toBe("read");
    expect(outcome.ok).toBe(true);
  });

  it("R1: a FOREIGN discovery lineage is an integrity failure and every gateway path (read AND proposal) refuses context_integrity before execution", async () => {
    const assembly = assemble();
    const diverged = { ...assembly.context, discovery: { ...assembly.context.discovery, lineageId: "lin1-ffffffffffffffff" } };
    const issues = verifyAgentContextIntegrity(diverged);
    expect(issues.some((issue) => issue.includes("lineage"))).toBe(true);
    const gateway = createAgentToolGateway(sirkitToolRegistry());
    for (const [toolId, version] of [["sirkit.project.canonical-revision-inspect", "1.0.0"], ["sirkit.schematic.inspect", "1.1.0"], [PROPOSAL_ID, AGENT_PROPOSAL_TOOL_VERSION]] as const) {
      const outcome = await gateway.invoke({ runId: "r", provider: "openai", toolId, version, args: toolId === PROPOSAL_ID ? { ops: [{ op: "set-value", target: "r1", value: "1k" }] } : {}, context: diverged, timeoutMs: 3000 });
      expect(outcome, toolId).toMatchObject({ kind: "refused", status: "context_integrity" });
    }
  });

  it("a head mark with an EMPTY discovery lineage refuses; a discovery lineage WITHOUT a head mark refuses", () => {
    const assembly = assemble();
    const emptied = { ...assembly.context, discovery: { ...assembly.context.discovery, lineageId: "" } };
    expect(verifyAgentContextIntegrity(emptied).some((issue) => issue.includes("lineage"))).toBe(true);

    const noMark = assemble({ mark: undefined });
    expect(noMark.context.discovery.lineageId).toBe("");
    expect(verifyAgentContextIntegrity(noMark.context)).toEqual([]);
    const injected = { ...noMark.context, discovery: { ...noMark.context.discovery, lineageId: "lin1-1234567890abcdef" } };
    expect(verifyAgentContextIntegrity(injected).some((issue) => issue.includes("lineage"))).toBe(true);
  });

  it("POST-ASSEMBLY head-mark tampering is caught by revalidation inside the integrity boundary", async () => {
    const assembly = assemble();
    const tamperedMarks = [
      { ...MARK, lineageId: "not-a-lineage" },
      { ...MARK, headSequence: -1 },
      { ...MARK, extra: "key" },
      "not-an-object",
    ];
    const gateway = createAgentToolGateway(sirkitToolRegistry());
    for (const mark of tamperedMarks) {
      const tampered = { ...assembly.context, schematicHeadMark: mark as never };
      const issues = verifyAgentContextIntegrity(tampered);
      expect(issues.some((issue) => issue.includes("malformed")), JSON.stringify(mark)).toBe(true);
      const outcome = await gateway.invoke({ runId: "r", provider: "openai", toolId: PROPOSAL_ID, version: AGENT_PROPOSAL_TOOL_VERSION, args: { ops: [{ op: "delete", target: "r1" }] }, context: tampered, timeoutMs: 3000 });
      expect(outcome).toMatchObject({ kind: "refused", status: "context_integrity" });
    }
  });

  it("proposal discovery requires BOTH a revision anchor and an open lineage (descriptor metadata + discovery behavior)", () => {
    const descriptor = sirkitToolRegistry().get(PROPOSAL_ID, AGENT_PROPOSAL_TOOL_VERSION)!;
    expect(descriptor.requiresExpectedRevision).toBe(true);
    expect(descriptor.requiresLineage).toBe(true);
    // No mark → empty lineage → discovery excludes lineage_required.
    const noMark = assemble({ mark: undefined });
    const noMarkDiscovery = discoverTools(sirkitToolRegistry(), noMark.context.discovery);
    expect(noMarkDiscovery.included.some((item) => item.toolId === PROPOSAL_ID)).toBe(false);
    expect(noMarkDiscovery.excluded.find((entry) => entry.toolId === PROPOSAL_ID)?.reason).toBe("lineage_required");
    // No schematic and no board → empty revision anchor → revision_required.
    const bare = assemble({ schematic: undefined, board: undefined, mark: undefined });
    const bareDiscovery = discoverTools(sirkitToolRegistry(), bare.context.discovery);
    expect(bareDiscovery.excluded.find((entry) => entry.toolId === PROPOSAL_ID)?.reason).toBe("revision_required");
  });

  it("a CONSISTENT non-main branch proposal still succeeds, sealed with the captured branch and lineage", async () => {
    const assembly = assemble({ branchId: "release-c" });
    expect(verifyAgentContextIntegrity(assembly.context)).toEqual([]);
    const gateway = createAgentToolGateway(sirkitToolRegistry());
    const outcome = await gateway.invoke({ runId: "r", provider: "anthropic", toolId: PROPOSAL_ID, version: AGENT_PROPOSAL_TOOL_VERSION, args: { ops: [{ op: "set-value", target: "r1", value: "2k" }] }, context: assembly.context, timeoutMs: 3000 });
    if (outcome.kind !== "proposal") throw new Error(`expected proposal, got ${JSON.stringify(outcome).slice(0, 160)}`);
    expect(outcome.proposal.scope.branchId).toBe("release-c");
    expect(outcome.proposal.scope.headMark.lineageId).toBe(MARK.lineageId);
  });
});

describe("B09.3 §B — the registered resource path is the ONLY read path (R3)", () => {
  it("boardless toolset contains ONLY the proposal tool when its schematic/head prerequisites exist; ZERO tools when they are absent", () => {
    const withMark = assemble({ board: undefined });
    const toolset = buildRunToolset(sirkitToolRegistry(), withMark.context, () => undefined);
    expect(toolset.declarations.map((declaration) => declaration.toolId)).toEqual(["sirkit.module.propose-contracts", "sirkit.parts.draft-request", "sirkit.parts.missing-facts", "sirkit.pcb-sync.preflight", "sirkit.schematic.instance-inspect", PROPOSAL_ID]); /* [PR-M, 2026-10-17] pin move: + the schematic-instance inspection (a Tier 0 read over the verified schematic, no board; by tool id before the tier-1 proposal) */ /* [PR-F fD, 2026-10-17] pin move: + the module contract proposal (a Tier 2 sealed engineering note that needs the head mark like every schematic proposal) */ /* [PR-F fB, 2026-10-17] pin move: + the part draft request (the toolset lists declarations by tool id; a Tier 2 sealed review task that needs the head mark like every schematic proposal) and the missing-facts read (validation category, beside the preflight read) */ // [PR-D, 2026-10-17] pin move: + the Schematic to PCB preflight read, a Tier 0 read over the run's verified schematic snapshot (no board; its own binding, not a B05 canonical read)

    const noMark = assemble({ board: undefined, mark: undefined });
    expect(buildRunToolset(sirkitToolRegistry(), noMark.context, () => undefined).declarations.map((declaration) => declaration.toolId)).toEqual(["sirkit.parts.missing-facts", "sirkit.pcb-sync.preflight", "sirkit.schematic.instance-inspect"]); /* [PR-M, 2026-10-17] pin move: + the schematic-instance inspection (no head mark needed: a Tier 0 read seals nothing) */ /* [PR-F fB, 2026-10-17] pin move: + the missing-facts read (no head mark needed; the draft request needs one, so it is absent here) */ // [PR-D, 2026-10-17] pin move: was [] - the preflight read needs the verified schematic snapshot only (no head mark: a Tier 0 read seals nothing, so it carries no lineage requirement); the proposal still needs the mark
    const nothing = assemble({ board: undefined, schematic: undefined, mark: undefined });
    expect(buildRunToolset(sirkitToolRegistry(), nothing.context, () => undefined).declarations).toEqual([]);
  });

  it("R3: boardless schematic inspection refuses through the gateway with structured authority_unavailable", async () => {
    const assembly = assemble({ board: undefined });
    const gateway = createAgentToolGateway(sirkitToolRegistry());
    const outcome = await gateway.invoke({ runId: "r", provider: "openai", toolId: "sirkit.schematic.inspect", version: "1.1.0", args: {}, context: assembly.context, timeoutMs: 3000 });
    expect(outcome).toMatchObject({ kind: "refused", ok: false, status: "authority_unavailable" });
  });

  it("no production source mentions the nonexistent schematic-snapshot resource", () => {
    const phrase = "schematic-snapshot" + "-resource"; // split so this test never matches itself
    const offenders: string[] = [];
    const scan = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          if (entry === "__tests__" || entry === "node_modules") continue;
          scan(full);
        } else if (/\.(ts|tsx)$/.test(entry) && readFileSync(full, "utf8").includes(phrase)) {
          offenders.push(full);
        }
      }
    };
    scan(join(process.cwd(), "app"));
    scan(join(process.cwd(), "scripts"));
    expect(offenders).toEqual([]);
  });

  it("a complete valid canonical context serves schematic inspection through the REGISTERED ReadToolInvocationService path", async () => {
    const assembly = assemble();
    const gateway = createAgentToolGateway(sirkitToolRegistry());
    const outcome = await gateway.invoke({ runId: "r", provider: "openai", toolId: "sirkit.schematic.inspect", version: "1.1.0", args: {}, context: assembly.context, timeoutMs: 3000 });
    if (outcome.kind !== "read" || !outcome.ok) throw new Error(`expected read, got ${JSON.stringify(outcome).slice(0, 200)}`);
    expect(outcome.verification).not.toContain("snapshot");
    expect(outcome.sourceRevisionDigest).toBe(assembly.context.canonicalRevisionDigest);
  });

  it("the static exposed registry remains the exact intentional agent-exposed set (ELEVEN distinct ids since B14 when written; the set has since grown by reviewed moves, B20-A4 among them, and the assertion counts the set itself)", () => { // [B21 closeout, 2026-09-29] retitled (D21-27, OD-113): the B20 closeout's wording (8a5637f) for the ELEVEN title it missed; assertions unchanged
    const exposed = sirkitToolRegistry().list().filter((descriptor) => descriptor.agentExposed);
    expect(new Set(exposed.map((descriptor) => descriptor.toolId)).size).toBe(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS.length); // B14: + replacement; B15.3: + pcb.propose-bounded-edit
  });
});

describe("B09.3 §C — semantic provider-schema validation (R2)", () => {
  it("R2: every previously accepted semantically invalid schema now throws", () => {
    const hostile: Array<[string, unknown]> = [
      ["root {type:string}", { type: "string" }],
      ["string with properties", { type: "string", properties: { x: { type: "string" } } }],
      ["object with numeric description", { type: "object", properties: {}, description: 42 }],
      ["object with object title", { type: "object", properties: {}, title: { x: 1 } }],
      ["{type:string, enum:[1]}", { type: "string", enum: [1] }],
      ["string carrying items", { type: "string", items: { type: "string" } }],
      ["empty unconstrained {}", {}],
      ["multi non-null type array", { type: ["string", "number"] }],
    ];
    for (const [name, schema] of hostile) {
      expect(() => toStrictSchema(schema as never), name).toThrow(/STRICT_SCHEMA_UNSUPPORTED/);
    }
  });

  it("NaN/Infinity enum and const values, cross-type keywords, and meaningless combinations all refuse — nested included", () => {
    const hostile: Array<[string, unknown]> = [
      ["NaN enum", { type: "object", properties: { a: { type: "number", enum: [Number.NaN] } }, required: ["a"] }],
      ["Infinity enum", { type: "object", properties: { a: { type: "number", enum: [Number.POSITIVE_INFINITY] } }, required: ["a"] }],
      ["NaN const", { type: "object", properties: { a: { type: "number", const: Number.NaN } }, required: ["a"] }],
      ["Infinity const", { type: "object", properties: { a: { const: Number.NEGATIVE_INFINITY } }, required: ["a"] }],
      ["properties on array", { type: "object", properties: { a: { type: "array", items: { type: "string" }, properties: { x: { type: "string" } } } }, required: ["a"] }],
      ["items on object", { type: "object", properties: { a: { type: "object", properties: {}, items: { type: "string" } } }, required: ["a"] }],
      ["required on non-object", { type: "object", properties: { a: { type: "string", required: ["x"] } }, required: ["a"] }],
      ["nested multi non-null union", { type: "object", properties: { a: { type: ["integer", "boolean"] } }, required: ["a"] }],
      ["tuple items", { type: "object", properties: { a: { type: "array", items: [{ type: "string" }] } }, required: ["a"] }],
      ["enum+const combined", { type: "object", properties: { a: { type: "string", enum: ["x"], const: "x" } }, required: ["a"] }],
      ["anyOf with sibling type", { type: "object", properties: { a: { type: "string", anyOf: [{ type: "string" }] } }, required: ["a"] }],
      ["enum value off declared type", { type: "object", properties: { a: { type: "integer", enum: [1.5] } }, required: ["a"] }],
      ["const off declared type", { type: "object", properties: { a: { type: "boolean", const: "true" } }, required: ["a"] }],
      ["annotation-only property", { type: "object", properties: { a: { description: "no constraint at all" } }, required: ["a"] }],
    ];
    for (const [name, schema] of hostile) {
      expect(() => toStrictSchema(schema as never), name).toThrow(/STRICT_SCHEMA_UNSUPPORTED/);
    }
  });

  it("valid controls: nullable object and nullable array properties pass; the source object is never mutated", () => {
    const source = {
      type: "object",
      properties: {
        maybeObject: { type: ["object", "null"], properties: { inner: { type: "string" } }, required: ["inner"], additionalProperties: false },
        maybeList: { type: ["array", "null"], items: { type: "string" } },
        kind: { type: "string", enum: ["a", "b"] },
      },
      required: ["maybeObject", "maybeList", "kind"],
      additionalProperties: false,
    };
    const frozen = JSON.stringify(source);
    const strict = toStrictSchema(source as never);
    expect(JSON.stringify(source)).toBe(frozen); // no mutation
    expect(validateSchemaStructure(strict)).toEqual([]);
  });

  it("all exposed schemas keep rendering deterministically for BOTH providers", () => {
    const exposed = sirkitToolRegistry().list().filter((descriptor) => descriptor.agentExposed);
    expect(exposed).toHaveLength(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS.length); // B14: + replacement; B15.3: + pcb.propose-bounded-edit
    const render = () => {
      const declarations = buildAgentToolDeclarations(exposed).declarations;
      return canonicalJson(declarations.map((declaration) => ({
        openai: renderOpenAiResponsesTool(declaration),
        anthropic: renderAnthropicAgentTool(declaration),
      })));
    };
    const first = render();
    expect(render()).toBe(first); // deterministic
    expect(first).toContain('"strict":true');
  });
});

describe("B09.3 §D — catalog and generated runtime truth (R4)", () => {
  const read = (relative: string): string => readFileSync(join(process.cwd(), relative), "utf8");

  it("CI tripwire: no production source or generated B09 manifest carries the confirmed stale phrases", () => {
    // Phrases assembled by concatenation so this test file never trips itself.
    const stale = [
      "Missing capabilities " + "(pcb.dimension)",
      "create" + "_via",
      "run-context resources " + "assemblable",
      "sirkit.schematic-snapshot" + "-resource.v1",
    ];
    const targets = [
      "app/lib/engineering/tool-catalog.ts",
      "app/lib/agent/gateway.ts",
      "app/lib/agent/loop.ts",
      "app/lib/agent/context.ts",
      "scripts/generate-agent-artifacts.ts",
      "artifacts/ai-control-plane-b09/agent-exposed-tool-manifest.csv",
      "artifacts/ai-control-plane-b09/agent-exposed-tool-manifest.json",
      "artifacts/ai-control-plane-b09/tool-activation-audit.csv",
    ];
    const hits: string[] = [];
    for (const target of targets) {
      const content = read(target);
      for (const phrase of stale) {
        if (content.includes(phrase)) hits.push(`${target}: ${phrase}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("runtime-availability gate [updated by B10]: the generated manifest distinguishes static exposure from per-run availability and records the ACTUAL browser runtime contract", () => {
    const manifest = JSON.parse(read("artifacts/ai-control-plane-b09/agent-exposed-tool-manifest.json")) as {
      schema: string;
      tools: Array<{ toolId: string; operationClass: string; staticallyExposed: boolean; bindingResolved: boolean; requiredRuntimeResources: string; browserRuntimeAvailability: string; reason: string }>;
    };
    expect(manifest.schema).toBe("sirkit.agent-exposed-tool-manifest.v3");
    const exposed = manifest.tools.filter((tool) => tool.staticallyExposed);
    expect(exposed).toHaveLength(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS.length); // B14: + replacement; B15.3: + pcb.propose-bounded-edit
    for (const tool of exposed.filter((entry) => entry.operationClass === "read")) {
      // [B10] reads are CONDITIONAL on the editorContext's published,
      // validated working-copy resources — never unconditional, never
      // withheld when the board is genuinely present and valid.
      expect(tool.browserRuntimeAvailability, tool.toolId).toBe("conditional");
      if (tool.toolId.startsWith("sirkit.computation.")) expect(tool.requiredRuntimeResources, tool.toolId).toBe("computation-port"); else if (tool.toolId === "sirkit.pcb-sync.preflight") expect(tool.requiredRuntimeResources, tool.toolId).toBe("validated-schematic"); else if (tool.toolId === "sirkit.parts.catalog-inspect") expect(tool.requiredRuntimeResources, tool.toolId).toBe("catalog-port"); else if (tool.toolId === "sirkit.parts.missing-facts") expect(tool.requiredRuntimeResources, tool.toolId).toBe("validated-schematic"); else if (tool.toolId === "sirkit.schematic.instance-inspect") expect(tool.requiredRuntimeResources, tool.toolId).toBe("validated-schematic"); else if (tool.toolId === "sirkit.parts.candidate-search") expect(tool.requiredRuntimeResources, tool.toolId).toBe("catalog-port;catalog-search-port;revision-evidence-port"); /* [PR-M, 2026-10-17] reviewed branches: the instance inspection needs the validated schematic only (its catalog port optional); the candidate search needs the chat route's catalog, search and revision evidence ports (no board) */ else expect(tool.requiredRuntimeResources, tool.toolId).toContain("canonical-state"); /* [PR-F fB, 2026-10-17] the missing-facts read needs the validated schematic only; its catalog port is optional */ // [PR-D, 2026-10-17] reviewed branches (OD-244): the preflight read needs the validated schematic only (no board); the catalog read needs the chat route's catalog port; // [B22-B, 2026-10-01] reviewed pin move (OD-139): a named computation read is conditional on the computation port the chat route binds alone (an equation needs no board; a board parse refuses without the run's canonical state)
      expect(tool.bindingResolved, tool.toolId).toBe(true);
    }
    const selection = exposed.find((entry) => entry.toolId === "sirkit.selection.inspect")!;
    expect(selection.requiredRuntimeResources).toBe("canonical-state;selection-snapshot");
    expect(selection.reason).toContain("sealed live selection");
    const proposal = exposed.find((entry) => entry.toolId === PROPOSAL_ID)!;
    expect(proposal.browserRuntimeAvailability).toBe("conditional");
    expect(proposal.requiredRuntimeResources).toBe("validated-schematic;canonical-head-mark");
  });

  it("the manifest truth matches RUNTIME behavior for the boardless browser request shape (scope + schematic + mark, NO board)", () => {
    const browserShaped = assemble({ board: undefined });
    const withMark = buildRunToolset(sirkitToolRegistry(), browserShaped.context, () => undefined);
    expect(withMark.declarations.map((declaration) => declaration.toolId)).toEqual(["sirkit.module.propose-contracts", "sirkit.parts.draft-request", "sirkit.parts.missing-facts", "sirkit.pcb-sync.preflight", "sirkit.schematic.instance-inspect", PROPOSAL_ID]); /* [PR-M, 2026-10-17] pin move: + the schematic-instance inspection (a Tier 0 read over the verified schematic, no board; by tool id before the tier-1 proposal) */ /* [PR-F fD, 2026-10-17] pin move: + the module contract proposal (a Tier 2 sealed engineering note that needs the head mark like every schematic proposal) */ /* [PR-F fB, 2026-10-17] pin move: + the part draft request (the toolset lists declarations by tool id; a Tier 2 sealed review task that needs the head mark like every schematic proposal) and the missing-facts read (validation category, beside the preflight read) */ // [PR-D, 2026-10-17] pin move: + the preflight read (as section B above)
    const noMark = assemble({ board: undefined, mark: undefined });
    expect(buildRunToolset(sirkitToolRegistry(), noMark.context, () => undefined).declarations.map((declaration) => declaration.toolId)).toEqual(["sirkit.parts.missing-facts", "sirkit.pcb-sync.preflight", "sirkit.schematic.instance-inspect"]); /* [PR-M, 2026-10-17] pin move: + the schematic-instance inspection (no head mark needed: a Tier 0 read seals nothing) */ /* [PR-F fB, 2026-10-17] pin move: + the missing-facts read (no head mark needed; the draft request needs one, so it is absent here) */ // [PR-D, 2026-10-17] pin move: was [] - the preflight read needs the verified schematic snapshot only (no head mark: a Tier 0 read seals nothing, so it carries no lineage requirement); the proposal still needs the mark
  });

  it("every catalog sourceEvidence path still exists (preserved gate)", () => {
    const missing: string[] = [];
    for (const descriptor of sirkitToolRegistry().list()) {
      for (const evidence of descriptor.sourceEvidence) {
        if (!existsSync(join(process.cwd(), evidence))) missing.push(`${descriptor.toolId}: ${evidence}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
