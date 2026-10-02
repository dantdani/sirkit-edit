/**
 * [B22-B] The closed computation catalog (runbook B22-B :908-920; discovery D22-15; OD-139, OD-149): exactly the runbook's five
 * operation kinds, each with a closed input schema, a profile id (the process-backed kinds), an output validator id and a budget;
 * no input anywhere carries argv, a path, a URL, deck text, a script or code - checked STRUCTURALLY over every schema, with a
 * counterexample for each rule; the server-side input validation refuses anything the schema does not name; the output
 * validators refuse non-finite, unknown or unbounded output. No process, worker, network or model is started here.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ANALYTICAL_MICROCASES,
  ARTIFACT_DIGEST_PATTERN,
  ARTIFACT_PARSERS,
  COMPUTATION_CATALOG,
  COMPUTATION_ID_FORBIDDEN,
  COMPUTATION_ID_PREFIX,
  COMPUTATION_KIND_IDS,
  COMPUTATION_VALIDATOR_IDS,
  FORBIDDEN_INPUT_FIELD,
  closedInputViolations,
  computationCatalogViolations,
  computationKind,
  validateComputationInput,
  validateComputationOutput,
  type ComputationKind,
} from "@/app/lib/computation/catalog";
import { ENGINE_HOST_ENGINE_IDS, ENGINE_HOST_PROFILES } from "@/app/lib/computation/engine-host";
import { RUNTIME_PROFILE_IDS } from "@/app/lib/computation/runtime-profile";
import { toStrictSchema } from "@/app/lib/agent/provider-tools";

const ROOT = process.cwd();
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8").replaceAll(String.fromCharCode(13), "");
const PAGE = "artifacts/ai-control-plane-b22/named-computations.md";
const RUNBOOK_ITEMS = [
  [912, "run a pinned SPICE analysis"],
  [913, "evaluate an approved equation/model"],
  [914, "parse a bounded approved file"],
  [915, "run a pinned placement/routing experiment"],
  [916, "compare deterministic artifacts"],
] as const;
const DIGEST_A = `dw1-${"a".repeat(64)}`;
const DIGEST_B = `dw1-${"b".repeat(64)}`;
const isFrozenDeep = (value: unknown): boolean => {
  if (value === null || typeof value !== "object") return true;
  if (!Object.isFrozen(value)) return false;
  return Object.values(value as Record<string, unknown>).every(isFrozenDeep);
};
const mutate = (kind: ComputationKind, change: (copy: Record<string, unknown>) => void): ComputationKind => {
  const copy = structuredClone(kind) as unknown as Record<string, unknown>;
  change(copy);
  return copy as unknown as ComputationKind;
};

describe("[B22-B] the closed computation catalog (OD-139)", () => {
  it("1. exactly the runbook's five kinds, in its order (:912-916), each under sirkit.computation.* with no forbidden segment, deep-frozen; the process-free kinds are read class run in the bounded engine host, the process-backed kinds are propose class with a profile; every engine, profile and validator id resolves", () => {
    expect(COMPUTATION_CATALOG.map((kind) => kind.id)).toEqual([...COMPUTATION_KIND_IDS]);
    expect(COMPUTATION_CATALOG.map((kind) => [kind.runbookLine, kind.runbookText])).toEqual(RUNBOOK_ITEMS.map(([line, text]) => [line, text]));
    expect(isFrozenDeep(COMPUTATION_CATALOG)).toBe(true);
    expect(computationCatalogViolations()).toEqual([]);
    expect(COMPUTATION_ID_FORBIDDEN.source).toBe("spice|simulate|exec|process|shell|file\\.|order|ship|qualif");
    for (const kind of COMPUTATION_CATALOG) {
      expect(kind.id.startsWith(COMPUTATION_ID_PREFIX), kind.id).toBe(true);
      expect(COMPUTATION_ID_FORBIDDEN.test(kind.id), kind.id).toBe(false);
      expect(kind.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(computationKind(kind.id)).toBe(kind);
      expect(COMPUTATION_VALIDATOR_IDS, kind.id).toContain(kind.outputValidatorId);
      expect(Number.isInteger(kind.budget.wallClockMs) && kind.budget.wallClockMs > 0, kind.id).toBe(true);
      expect(Number.isInteger(kind.budget.maxOutputBytes) && kind.budget.maxOutputBytes > 0 && kind.budget.maxOutputBytes <= 16_384, kind.id).toBe(true);
      expect(Number.isInteger(kind.budget.heapMiB) && kind.budget.heapMiB > 0 && kind.budget.heapMiB <= 512, kind.id).toBe(true);
      expect(kind.mcp.withheld, kind.id).toBe(true);
      expect(kind.mcp.reason.length, kind.id).toBeGreaterThan(40);
      expect(kind.specialists.dormant, kind.id).toBe(true);
      if (kind.backing === "in-process") {
        expect(kind.operationClass, kind.id).toBe("read");
        expect(kind.execution, kind.id).toBe("engine-host");
        expect(kind.profileId, kind.id).toBeNull();
        expect(ENGINE_HOST_ENGINE_IDS, kind.id).toContain(kind.engineId);
        expect(kind.exposure.agent, kind.id).toBe("exposed");
      } else {
        expect(kind.operationClass, kind.id).toBe("propose");
        expect(kind.profileId, kind.id).not.toBeNull();
        expect(kind.exposure.agent, kind.id).toBe("dormant");
        if (kind.execution === "diagnostic-runner") {
          expect(kind.engineId, kind.id).toBeNull();
          expect(RUNTIME_PROFILE_IDS, kind.id).toContain(kind.profileId);
        } else {
          expect(ENGINE_HOST_ENGINE_IDS, kind.id).toContain(kind.engineId);
          expect(Object.values(ENGINE_HOST_PROFILES).map((profile) => profile.profileId), kind.id).toContain(kind.profileId);
        }
      }
    }
    expect(COMPUTATION_CATALOG.filter((kind) => kind.backing === "in-process").map((kind) => kind.id).sort()).toEqual(["sirkit.computation.analytical-equation", "sirkit.computation.artifact-compare", "sirkit.computation.artifact-parse"]);
    expect(computationKind("sirkit.computation.shell")).toBeUndefined();
    expect(computationKind("__proto__")).toBeUndefined();
    expect(computationKind("constructor")).toBeUndefined();
  });

  it("2. closed inputs, checked structurally over EVERY schema: every object closed and every property named in it; every string a closed enum or a declared digest field; every number bounded server-side; no array, no nested object, no field named like argv, a path, a URL, a deck, a script or code; each schema is wire-strict; a counterexample for every rule is caught", () => {
    for (const kind of COMPUTATION_CATALOG) {
      expect(closedInputViolations(kind), kind.id).toEqual([]);
      expect(() => toStrictSchema(kind.inputSchema), kind.id).not.toThrow();
      const properties = kind.inputSchema.properties as Record<string, Record<string, unknown>>;
      for (const [name, property] of Object.entries(properties)) {
        expect(FORBIDDEN_INPUT_FIELD.test(name), `${kind.id}.${name}`).toBe(false);
        expect(["string", "number", "integer"], `${kind.id}.${name}`).toContain(property.type);
        if (property.type === "string") expect(Array.isArray(property.enum) || kind.digestFields.includes(name), `${kind.id}.${name}`).toBe(true);
        else expect(kind.numberFields[name], `${kind.id}.${name}`).toBeDefined();
      }
      // the schema's text (its keywords and every value; the keyword `description` itself aside) names nothing executable or addressable
      expect(JSON.stringify(kind.inputSchema).replaceAll('"description":', '"d":'), kind.id).not.toMatch(/"format"|"pattern"|argv|https?:|file:|\.include|\.control|shell|eval|script/i);
    }
    const base = computationKind("sirkit.computation.analytical-equation")!;
    const counterexamples: Array<[string, (copy: Record<string, unknown>) => void, RegExp]> = [
      ["an argv array", (copy) => { (copy.inputSchema as Record<string, Record<string, unknown>>).properties!.argv = { type: "array", items: { type: "string" } }; }, /argv/],
      ["a path field", (copy) => { (copy.inputSchema as Record<string, Record<string, unknown>>).properties!.outputPath = { type: "string", enum: ["a"] }; }, /outputPath/],
      ["a URL field", (copy) => { (copy.inputSchema as Record<string, Record<string, unknown>>).properties!.sourceUrl = { type: "string", enum: ["a"] }; }, /sourceUrl/],
      ["deck text", (copy) => { (copy.inputSchema as Record<string, Record<string, unknown>>).properties!.deck = { type: "string" }; }, /deck/],
      ["a script", (copy) => { (copy.inputSchema as Record<string, Record<string, unknown>>).properties!.script = { type: "string" }; }, /script/],
      ["code", (copy) => { (copy.inputSchema as Record<string, Record<string, unknown>>).properties!.code = { type: "string" }; }, /code/],
      ["an expression", (copy) => { (copy.inputSchema as Record<string, Record<string, unknown>>).properties!.expression = { type: "string" }; }, /expression/],
      ["a free string under a harmless name", (copy) => { (copy.inputSchema as Record<string, Record<string, unknown>>).properties!.note = { type: "string" }; }, /note/],
      ["an open object", (copy) => { (copy.inputSchema as Record<string, unknown>).additionalProperties = true; }, /additionalProperties/],
      ["a nested object", (copy) => { (copy.inputSchema as Record<string, Record<string, unknown>>).properties!.options = { type: "object", additionalProperties: false, properties: {} }; }, /options/],
      ["an unbounded number", (copy) => { (copy.inputSchema as Record<string, Record<string, unknown>>).properties!.gain = { type: "number" }; }, /gain/],
      ["a keyword outside the closed set", (copy) => { (copy.inputSchema as Record<string, unknown>).patternProperties = {}; }, /patternProperties/],
      ["a required name that is no property", (copy) => { (copy.inputSchema as Record<string, unknown>).required = ["equation", "missing"]; }, /missing/],
      ["an empty enum", (copy) => { ((copy.inputSchema as Record<string, Record<string, Record<string, unknown>>>).properties!.equation!).enum = []; }, /equation/],
    ];
    for (const [label, change, named] of counterexamples) {
      const violations = closedInputViolations(mutate(base, change));
      expect(violations.length, label).toBeGreaterThan(0);
      expect(violations.join("\n"), label).toMatch(named);
    }
    // the catalog-level rules: an id outside the prefix or spelling a forbidden word, a process-backed kind without a profile
    const catalogCounterexamples: Array<[string, (copy: Record<string, unknown>) => void]> = [
      ["a generic id", (copy) => { copy.id = "sirkit.computation.shell-run"; }],
      ["a simulate id", (copy) => { copy.id = "sirkit.computation.simulate-anything"; }],
      ["an id outside the prefix", (copy) => { copy.id = "sirkit.tools.evaluate"; }],
      ["an unknown validator", (copy) => { copy.outputValidatorId = "sirkit.computation-validator.anything/1"; }],
      ["a zero budget", (copy) => { (copy.budget as Record<string, number>).wallClockMs = 0; }],
      ["a process-backed kind without a profile", (copy) => { copy.backing = "process-backed"; copy.operationClass = "propose"; copy.profileId = null; }],
      ["an in-process kind with a profile", (copy) => { copy.profileId = "ngspice-local-diagnostic"; }],
      ["an exposed process-backed kind", (copy) => { copy.backing = "process-backed"; copy.operationClass = "propose"; copy.profileId = "ngspice-local-diagnostic"; copy.execution = "diagnostic-runner"; copy.engineId = null; }],
      ["an MCP-exposed kind", (copy) => { (copy.mcp as Record<string, unknown>).withheld = false; }],
    ];
    for (const [label, change] of catalogCounterexamples) {
      expect(computationCatalogViolations([...COMPUTATION_CATALOG.filter((kind) => kind.id !== base.id), mutate(base, change)]).length, label).toBeGreaterThan(0);
    }
    expect(computationCatalogViolations([...COMPUTATION_CATALOG, base]).join("\n")).toMatch(/duplicate/);
    expect(computationCatalogViolations(COMPUTATION_CATALOG.slice(1)).join("\n")).toMatch(/exactly the five/);
  });

  it("3. the server-side input validation admits exactly what the schema names: a microcase's own bounded numbers, a closed enum value, a digest of the closed grammar; it refuses an unknown key, a missing or extra parameter, an out-of-bound, non-finite or non-integer number, a string outside its enum, a malformed digest, a prototype key and anything that is not a plain object", () => {
    expect(validateComputationInput("sirkit.computation.analytical-equation", { equation: "resistor-divider", vin: 5, r1: 1_000, r2: 2_000 })).toEqual({ ok: true, input: { equation: "resistor-divider", vin: 5, r1: 1_000, r2: 2_000 } });
    // strict providers send every optional property as null: null is absence
    expect(validateComputationInput("sirkit.computation.analytical-equation", { equation: "one-pole-lowpass", r: 1_000, c: 1e-6, frequency: 159.15, vin: null, r1: null, r2: null, time: null })).toEqual({ ok: true, input: { equation: "one-pole-lowpass", r: 1_000, c: 1e-6, frequency: 159.15 } });
    expect(validateComputationInput("sirkit.computation.artifact-compare", { left: DIGEST_A, right: DIGEST_B })).toMatchObject({ ok: true });
    expect(validateComputationInput("sirkit.computation.artifact-parse", { artifact: "eng1-0123456789abcdef", parser: "board-statistics" })).toMatchObject({ ok: true });
    expect(validateComputationInput("sirkit.computation.layout-experiment", { experiment: "placement", seed: 7, budgetSeconds: 30 })).toMatchObject({ ok: true });
    expect(validateComputationInput("sirkit.computation.circuit-analysis", { circuit: "rc-step", vin: 1, r: 1_000, c: 1e-6, time: 0.002 })).toMatchObject({ ok: true });
    const refused: Array<[string, string, unknown]> = [
      ["an unknown key", "sirkit.computation.analytical-equation", { equation: "resistor-divider", vin: 5, r1: 1, r2: 1, deck: "V1 1 0 1" }],
      ["a missing parameter", "sirkit.computation.analytical-equation", { equation: "resistor-divider", vin: 5, r1: 1 }],
      ["another microcase's parameter", "sirkit.computation.analytical-equation", { equation: "resistor-divider", vin: 5, r1: 1, r2: 1, c: 1e-6 }],
      ["no selector", "sirkit.computation.analytical-equation", { vin: 5, r1: 1, r2: 1 }],
      ["a selector outside the enum", "sirkit.computation.analytical-equation", { equation: "x = 1; process.exit()", vin: 5 }],
      ["a negative resistance", "sirkit.computation.analytical-equation", { equation: "resistor-divider", vin: 5, r1: -1, r2: 1 }],
      ["an infinite voltage", "sirkit.computation.analytical-equation", { equation: "resistor-divider", vin: Number.POSITIVE_INFINITY, r1: 1, r2: 1 }],
      ["NaN", "sirkit.computation.analytical-equation", { equation: "resistor-divider", vin: Number.NaN, r1: 1, r2: 1 }],
      ["a numeric string", "sirkit.computation.analytical-equation", { equation: "resistor-divider", vin: "5", r1: 1, r2: 1 }],
      ["a fractional seed", "sirkit.computation.layout-experiment", { experiment: "placement", seed: 1.5, budgetSeconds: 30 }],
      ["a budget over the ceiling", "sirkit.computation.layout-experiment", { experiment: "placement", seed: 1, budgetSeconds: 3_600 }],
      ["a path in a digest field", "sirkit.computation.artifact-compare", { left: "C:/Windows/win.ini", right: DIGEST_B }],
      ["a URL in a digest field", "sirkit.computation.artifact-parse", { artifact: "https://example.invalid/a", parser: "board-statistics" }],
      ["a digest with a trailing line", "sirkit.computation.artifact-compare", { left: `${DIGEST_A}${String.fromCharCode(10)}x`, right: DIGEST_B }],
      ["a parser outside the enum", "sirkit.computation.artifact-parse", { artifact: DIGEST_A, parser: "javascript" }],
      ["an array", "sirkit.computation.artifact-compare", [DIGEST_A, DIGEST_B]],
      ["null", "sirkit.computation.artifact-compare", null],
      ["an unknown kind", "sirkit.computation.shell", {}],
    ];
    for (const [label, kindId, args] of refused) {
      const outcome = validateComputationInput(kindId, args);
      expect(outcome.ok, label).toBe(false);
      if (!outcome.ok) expect(outcome.errors.length, label).toBeGreaterThan(0);
    }
    const polluted = JSON.parse(`{"equation":"resistor-divider","vin":5,"r1":1,"r2":1,"__proto__":{"admin":true}}`) as unknown;
    expect(validateComputationInput("sirkit.computation.analytical-equation", polluted).ok).toBe(false);
    const inherited = Object.assign(Object.create({ vin: 5 }) as Record<string, unknown>, { equation: "resistor-divider", r1: 1, r2: 1 });
    expect(validateComputationInput("sirkit.computation.analytical-equation", inherited).ok).toBe(false);
    // every microcase names exactly its own bounded parameters, and the digest grammar is closed
    for (const microcase of ANALYTICAL_MICROCASES) expect(computationKind("sirkit.computation.analytical-equation")!.selectorFields[microcase]!.length, microcase).toBeGreaterThan(0);
    expect(ARTIFACT_DIGEST_PATTERN.test(DIGEST_A) && ARTIFACT_DIGEST_PATTERN.test("eng1-0123456789abcdef")).toBe(true);
    for (const bad of ["dw1-", `dw1-${"g".repeat(64)}`, "eng1-012", "sha256:abc", "../a", ""]) expect(ARTIFACT_DIGEST_PATTERN.test(bad), bad).toBe(false);
    expect([...ARTIFACT_PARSERS]).toEqual(["board-statistics", "result-fields"]);
  });

  it("4. the output validators are typed and closed: a well-formed result passes; a non-finite value, an unknown key, an unknown quantity, a missing label, an authoritative claim, a malformed digest or an over-long list is refused, never trimmed", () => {
    const envelope = (body: Record<string, unknown>, kindId = "sirkit.computation.analytical-equation"): Record<string, unknown> => ({
      schema: "sirkit.computation-result.v1",
      kindId,
      kindVersion: "1.0.0",
      engineId: "sirkit.engine.analytical-equations/1",
      inputDigest: DIGEST_A,
      resultDigest: DIGEST_B,
      labels: ["computation_evidence", "not_authoritative"],
      authority: "computation evidence - never engineering authority",
      elapsedMs: 3,
      body,
    });
    const divider = { equation: "resistor-divider", provider: { providerId: "provider:analytical-reference", reviewState: "unreviewed", authoritative: false }, quantities: [{ name: "vout", value: 3.3333333333, unit: "V" }, { name: "current", value: 0.0016666667, unit: "A" }, { name: "ratio", value: 0.6666666667, unit: "1" }] };
    const ANALYTICAL = "sirkit.computation-validator.analytical-quantities/1";
    expect(validateComputationOutput(ANALYTICAL, envelope(divider))).toEqual([]);
    const bad: Array<[string, Record<string, unknown>]> = [
      ["a non-finite value", envelope({ ...divider, quantities: [{ name: "vout", value: Number.NaN, unit: "V" }] })],
      ["an infinite value", envelope({ ...divider, quantities: [{ name: "vout", value: Number.POSITIVE_INFINITY, unit: "V" }] })],
      ["an unknown quantity", envelope({ ...divider, quantities: [{ name: "eval", value: 1, unit: "V" }] })],
      ["a wrong unit", envelope({ ...divider, quantities: [{ name: "vout", value: 1, unit: "A" }] })],
      ["an unknown body key", envelope({ ...divider, note: "run this next" })],
      ["an authoritative provider", envelope({ ...divider, provider: { ...divider.provider, authoritative: true } })],
      ["an unknown envelope key", { ...envelope(divider), approved: true }],
      ["a missing label", { ...envelope(divider), labels: ["computation_evidence"] }],
      ["a malformed digest", { ...envelope(divider), resultDigest: "dw1-xyz" }],
      ["a body for another kind", envelope(divider, "sirkit.computation.artifact-compare")],
      ["too many quantities", envelope({ ...divider, quantities: Array.from({ length: 40 }, () => ({ name: "vout", value: 1, unit: "V" })) })],
    ];
    for (const [label, result] of bad) expect(validateComputationOutput(ANALYTICAL, result).length, label).toBeGreaterThan(0);
    expect(validateComputationOutput("sirkit.computation-validator.unknown/1", envelope(divider)).length).toBeGreaterThan(0);
    const comparison = { left: { digest: DIGEST_A, kindId: "sirkit.computation.analytical-equation" }, right: { digest: DIGEST_B, kindId: "sirkit.computation.analytical-equation" }, comparable: true, identical: false, fields: [{ name: "vout", unit: "V", left: 3.3, right: 3.4, absoluteDifference: 0.1, relativeDifference: 0.1 / 3.4 }] };
    expect(validateComputationOutput("sirkit.computation-validator.artifact-comparison/1", { ...envelope(comparison, "sirkit.computation.artifact-compare"), engineId: "sirkit.engine.artifact-compare/1" })).toEqual([]);
    expect(validateComputationOutput("sirkit.computation-validator.artifact-comparison/1", { ...envelope({ ...comparison, fields: [{ ...comparison.fields[0], absoluteDifference: -1 }] }, "sirkit.computation.artifact-compare"), engineId: "sirkit.engine.artifact-compare/1" }).length).toBeGreaterThan(0);
    // [B22-B review] tests-8: the 16-entry bound ALONE refuses - every name distinct and well formed, so 16 pass and 17 do not
    const names = (count: number): string[] => Array.from({ length: count }, (_, index) => `q${String.fromCharCode(97 + Math.floor(index / 26))}${String.fromCharCode(97 + (index % 26))}`);
    const COMPARISON = "sirkit.computation-validator.artifact-comparison/1";
    const comparisonOf = (count: number) => ({ ...envelope({ ...comparison, fields: names(count).map((name) => ({ name, unit: "V", left: 1, right: 2, absoluteDifference: 1, relativeDifference: 0.5 })) }, "sirkit.computation.artifact-compare"), engineId: "sirkit.engine.artifact-compare/1" });
    const STATISTICS = "sirkit.computation-validator.artifact-statistics/1";
    const statisticsOf = (body: Record<string, unknown>) => ({ ...envelope(body, "sirkit.computation.artifact-parse"), engineId: "sirkit.engine.artifact-parse/1" });
    const boardOf = (count: number) => statisticsOf({ artifact: { digest: "eng1-0123456789abcdef", kind: "canonical-board" }, parser: "board-statistics", statistics: { copperLayers: 2, footprints: 0, nets: 0, tracks: count, vias: 0, zones: 0, texts: 0, layers: Array.from({ length: count }, (_, index) => ({ layer: `L${index}`, tracks: 1, lengthNm: 1_000 })) } });
    const fieldsOf = (count: number) => statisticsOf({ artifact: { digest: DIGEST_A, kind: "computation-result" }, parser: "result-fields", statistics: { kindId: "sirkit.computation.analytical-equation", fields: names(count).map((name) => ({ name, value: 1, unit: "V" })) } });
    for (const [label, validator, build] of [["comparison fields", COMPARISON, comparisonOf], ["board layers", STATISTICS, boardOf], ["result fields", STATISTICS, fieldsOf]] as const) {
      expect(validateComputationOutput(validator, build(16)), label).toEqual([]);
      const over = validateComputationOutput(validator, build(17));
      expect(over.length, label).toBeGreaterThan(0);
      expect(over.join("\n"), label).toMatch(/17 entries outside \[\d+, 16\]/);
      expect(over.join("\n"), label).not.toMatch(/repeats|malformed/);
    }
  });

  it("5. each process-free kind's descriptor input schema IS the catalog's wire schema, and the model-generated-script rule holds (OD-149): no kind, schema or validator accepts code or a script, and no catalog text invites it", () => {
    for (const kind of COMPUTATION_CATALOG) {
      expect(kind.exposure.reason.length, kind.id).toBeGreaterThan(40);
      expect(JSON.stringify(kind), kind.id).not.toMatch(/javascript|python|typescript|\bnode\b|npm|pip install|\beval\b/i);
    }
    expect(COMPUTATION_CATALOG.some((kind) => Object.keys(kind.inputSchema.properties as object).some((name) => /script|code|program|source/i.test(name)))).toBe(false);
  });

  it("6. the page records each kind as the code holds it, dates the Node worker_threads reading, and records the OD-82/OD-87 precondition with the reversal NOT performed", () => {
    const page = read(PAGE);
    for (const kind of COMPUTATION_CATALOG) {
      const row = new RegExp(`^\\| \`${kind.id.replace(/[.]/g, "\\.")}\` \\| :${kind.runbookLine} \\| ${kind.operationClass} \\| ${kind.backing} \\| ${kind.execution} \\| ${kind.profileId ? `\`${kind.profileId}\`` : "-"} \\| \`${kind.outputValidatorId.replace(/[.]/g, "\\.")}\` \\| ${kind.budget.wallClockMs} ms \\| ${kind.exposure.agent} \\|$`, "m");
      expect(page, kind.id).toMatch(row);
    }
    expect(page).toContain("https://nodejs.org/api/worker_threads.html");
    expect(page).toMatch(/read 2026-10-01/);
    expect(page).toContain("These limits only affect the JS engine, and no external data, including no `ArrayBuffer`s.");
    expect(page).toMatch(/reversal itself is NOT performed/);
    expect(page).toMatch(/OD-83\.\.86 and OD-88 stay reserved/);
    expect(page).not.toMatch(/\bsandbox(?:ed)? (?:run|runner|execution)\b/i);
    // D22-22: the reserved design is in the repository as a RECORDED verbatim copy under its provenance header; the body below the
    // rule is pinned by its SHA-256 (lines 786-923 of the B20-B4 task, its final blank line included), so an edit of the copy fails here
    const design = read("artifacts/ai-control-plane-b22/mcp-proposal-reversal-design.md");
    expect(design).toMatch(/^# The reserved MCP proposal-reversal design \(OD-83\.\.86, OD-88\): a verbatim copy, RECORDED only$/m);
    expect(design).toContain("`scratchpad/b20/task-B4.md`, lines 786-923");
    expect(design).toMatch(/proposal reversal is \*\*NOT performed\*\* in B22/);
    expect(design).toContain("OD-83, OD-84, OD-85, OD-86 and OD-88 stay reserved and unspent");
    const body = design.slice(design.indexOf(`${String.fromCharCode(10)}---${String.fromCharCode(10)}${String.fromCharCode(10)}`) + 6);
    expect(body.startsWith("## 8. Owner decisions")).toBe(true);
    expect(createHash("sha256").update(body, "utf8").digest("hex")).toBe("651d69caf43fcaeb00fc2562dc5f0a055f77d2026c032dddaa6140eaf8f078cb");
  });

  it("7. [B22-B review] the records B22-B touched say what the code now holds: OD-87's three reversal paths with only the first delivered (coverage-5); `next dev`'s heap flag and the opt-in withheld under it (regressions-1, coverage-3); the per-tenant share; the threat model's T10, its section 5 and its census paragraph and the isolation verdict (coverage-4); the B21 page's stale 33s and the stale titles listed for the closeout (coverage-8)", () => {
    const page = read(PAGE);
    for (const text of ["a bounded engine host with kill semantics, stopped hard at the budget", "an accepted bound, after a real-board probe", "serving placement only below a measured footprint cap", "NEXT_DISABLE_MEM_OVERRIDE=1", "ENGINE_HOST_MAX_RUNNING_PER_HOLDER", "--max-old-space-size-percentage"]) expect(page, text).toContain(text);
    expect(page).toMatch(/delivers only the first/);
    for (const title of ["no id of the reviewed 33 matches a pattern today", "B3's 32 without A4's one addition (33 with it)"]) expect(page, title).toContain(title);
    const threat = read("artifacts/ai-control-plane-b22/threat-model.md");
    const t10 = threat.split(String.fromCharCode(10)).find((line) => line.startsWith("| T10 |"))!;
    expect(t10).toMatch(/\[B22-B review, 2026-10-02\]/);
    expect(t10).toContain("b22-b-bounded-host");
    expect(threat).not.toContain("- **B22-B**: no named computation exists; in-process engines cannot be stopped (T10).");
    expect(threat).toMatch(/- \*\*B22-B\*\*: .*\[B22-B review, 2026-10-02\]/);
    expect(threat).toMatch(/\[B22-B review, 2026-10-02\] five: the three spawners and the two thread starters/);
    const verdict = read("artifacts/ai-control-plane-b22/isolation-verdict.md");
    expect(verdict).toMatch(/\[B22-B review, 2026-10-02\][^\n]*worker thread of the server process[^\n]*no isolation boundary/);
    const roles = read("artifacts/ai-control-plane-b21/specialist-roles.md").split(String.fromCharCode(10));
    // the prose only: the section 8 citation table records the base, as of its date (its C27 row names "the one reviewed 33-id list")
    const stale = roles.filter((line) => !line.startsWith("| C") && /outside the 33|reviewed 33|the 33 are not/.test(line));
    expect(stale.length).toBeGreaterThanOrEqual(3);
    for (const line of stale) expect(line).toMatch(/\[B22-B review, 2026-10-02: 36\]/);
  });
});
