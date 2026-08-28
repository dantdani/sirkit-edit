/**
 * B16.0.17.2 §C — EXECUTABLE schema-parity gate: the local
 * `validateSchematicProposalToolInput` must agree with EVERY relevant
 * constraint of the declared `SCHEMATIC_PROPOSAL_TOOL.schema`. All boundary
 * values in these tests are READ FROM the schema nodes — no copied limits
 * table — so a schema change re-derives the expectations automatically.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SCHEMATIC_PROPOSAL_TOOL, validateSchematicProposalToolInput } from "../agent-tools";

const SCHEMA = SCHEMATIC_PROPOSAL_TOOL.schema;
const P = SCHEMA.properties;
const ACTION = P.proposedActions.items.properties;
const validate = validateSchematicProposalToolInput;

const valid = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  proposalKind: P.proposalKind.enum[0],
  referencedSemanticObjectIds: [],
  proposedActions: [{ actionKind: ACTION.actionKind.enum[0], targetObjectIds: ["id:1"], rationale: "r" }],
  assumptions: [], warnings: [],
  ...over,
});
const action = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  actionKind: ACTION.actionKind.enum[0], targetObjectIds: ["id:1"], rationale: "r", ...over,
});

describe("B16.0.17.2 §C — string-length boundaries agree with the schema nodes", () => {
  it("1–3. referencedSemanticObjectIds: exactly items.maxLength accepted; maxLength+1 refused (boundary read from the schema)", () => {
    const max = P.referencedSemanticObjectIds.items.maxLength;
    expect(typeof max).toBe("number"); // the schema DECLARES the limit (B16.0.17.2 §B)
    expect(validate(valid({ referencedSemanticObjectIds: ["x".repeat(max)] }))).toEqual([]);
    expect(validate(valid({ referencedSemanticObjectIds: ["x".repeat(max + 1)] }))).not.toEqual([]);
  });
  it("4. targetObjectIds: exactly items.maxLength accepted; maxLength+1 refused", () => {
    const max = ACTION.targetObjectIds.items.maxLength;
    expect(typeof max).toBe("number");
    expect(validate(valid({ proposedActions: [action({ targetObjectIds: ["x".repeat(max)] })] }))).toEqual([]);
    expect(validate(valid({ proposedActions: [action({ targetObjectIds: ["x".repeat(max + 1)] })] }))).not.toEqual([]);
  });
  it("5. rationale min/max agree", () => {
    expect(validate(valid({ proposedActions: [action({ rationale: "x".repeat(ACTION.rationale.maxLength) })] }))).toEqual([]);
    expect(validate(valid({ proposedActions: [action({ rationale: "x".repeat(ACTION.rationale.maxLength + 1) })] }))).not.toEqual([]);
    expect(validate(valid({ proposedActions: [action({ rationale: "x".repeat(ACTION.rationale.minLength) })] }))).toEqual([]);
    expect(validate(valid({ proposedActions: [action({ rationale: "" })] }))).not.toEqual([]); // below minLength 1
  });
  it("6./7. assumption + warning maxLength agree", () => {
    for (const field of ["assumptions", "warnings"] as const) {
      const max = P[field].items.maxLength;
      expect(validate(valid({ [field]: ["x".repeat(max)] }))).toEqual([]);
      expect(validate(valid({ [field]: ["x".repeat(max + 1)] }))).not.toEqual([]);
    }
  });
});

describe("B16.0.17.2 §C — array caps, enums, required keys, additionalProperties", () => {
  it("8. array maxItems agree (at cap accepted, cap+1 refused) for every array field", () => {
    const fill = (n: number): string[] => Array.from({ length: n }, (_, index) => `id:${index}`);
    expect(validate(valid({ referencedSemanticObjectIds: fill(P.referencedSemanticObjectIds.maxItems) }))).toEqual([]);
    expect(validate(valid({ referencedSemanticObjectIds: fill(P.referencedSemanticObjectIds.maxItems + 1) }))).not.toEqual([]);
    expect(validate(valid({ assumptions: fill(P.assumptions.maxItems) }))).toEqual([]);
    expect(validate(valid({ assumptions: fill(P.assumptions.maxItems + 1) }))).not.toEqual([]);
    expect(validate(valid({ warnings: fill(P.warnings.maxItems) }))).toEqual([]);
    expect(validate(valid({ warnings: fill(P.warnings.maxItems + 1) }))).not.toEqual([]);
    const actions = (n: number): Record<string, unknown>[] => Array.from({ length: n }, () => action());
    expect(validate(valid({ proposedActions: actions(P.proposedActions.maxItems) }))).toEqual([]);
    expect(validate(valid({ proposedActions: actions(P.proposedActions.maxItems + 1) }))).not.toEqual([]);
    expect(validate(valid({ proposedActions: [action({ targetObjectIds: fill(ACTION.targetObjectIds.maxItems) })] }))).toEqual([]);
    expect(validate(valid({ proposedActions: [action({ targetObjectIds: fill(ACTION.targetObjectIds.maxItems + 1) })] }))).not.toEqual([]);
  });
  it("9./10. every declared proposalKind and actionKind is accepted; any non-declared kind is refused", () => {
    for (const kind of P.proposalKind.enum) expect(validate(valid({ proposalKind: kind }))).toEqual([]);
    expect(validate(valid({ proposalKind: "not-a-kind" }))).not.toEqual([]);
    for (const kind of ACTION.actionKind.enum) expect(validate(valid({ proposedActions: [action({ actionKind: kind })] }))).toEqual([]);
    expect(validate(valid({ proposedActions: [action({ actionKind: "not-a-kind" })] }))).not.toEqual([]);
  });
  it("11./12. additionalProperties:false is enforced at both levels", () => {
    expect(SCHEMA.additionalProperties).toBe(false);
    expect(P.proposedActions.items.additionalProperties).toBe(false);
    expect(validate(valid({ surprise: 1 }))).not.toEqual([]);
    expect(validate(valid({ proposedActions: [action({ surprise: 1 })] }))).not.toEqual([]);
  });
  it("13. every schema-required field is actually required by the validator (top level and action level)", () => {
    for (const field of SCHEMA.required) {
      const broken = valid();
      delete broken[field];
      expect(validate(broken), `missing ${field}`).not.toEqual([]);
    }
    for (const field of P.proposedActions.items.required) {
      const broken = action();
      delete broken[field];
      expect(validate(valid({ proposedActions: [broken] })), `missing action ${field}`).not.toEqual([]);
    }
  });
});

describe("B16.0.17.2 §C — live-schema tripwires", () => {
  it("14. changing a schema limit changes validator behavior AUTOMATICALLY (temporary runtime mutation, restored)", () => {
    const node = P.referencedSemanticObjectIds.items as { maxLength?: number };
    const original = node.maxLength;
    expect(validate(valid({ referencedSemanticObjectIds: ["x".repeat(10)] }))).toEqual([]);
    try {
      node.maxLength = 5; // tighten the DECLARED limit at runtime
      expect(validate(valid({ referencedSemanticObjectIds: ["x".repeat(10)] }))).not.toEqual([]); // the validator followed
      expect(validate(valid({ referencedSemanticObjectIds: ["x".repeat(5)] }))).toEqual([]);
    } finally {
      node.maxLength = original;
    }
    expect(validate(valid({ referencedSemanticObjectIds: ["x".repeat(10)] }))).toEqual([]); // restored
  });
  it("15. no schema numeric limit is independently hard-coded in the validator source", () => {
    const src = readFileSync(join(process.cwd(), "app/lib/schematic-compiler/agent-tools.ts"), "utf8");
    const start = src.indexOf("export function validateSchematicProposalToolInput");
    const end = src.indexOf("export function normalizeSchematicChangeProposal");
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start, end)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1")
      .replace(/`(?:\\.|[^`\\])*`/g, "``")
      .replace(/"(?:\\.|[^"\\])*"/g, '""');
    // every numeric limit the schema declares (≥ 32, to skip incidental small
    // literals like diagnostic truncation offsets) must be ABSENT as a literal
    const declared = new Set<number>([
      P.referencedSemanticObjectIds.maxItems, P.referencedSemanticObjectIds.items.maxLength,
      P.proposedActions.maxItems, ACTION.targetObjectIds.maxItems, ACTION.targetObjectIds.items.maxLength,
      ACTION.rationale.maxLength, P.assumptions.maxItems, P.assumptions.items.maxLength,
      P.warnings.maxItems, P.warnings.items.maxLength,
    ]);
    for (const limit of declared) {
      if (limit >= 32) expect(body, `validator hard-codes ${limit}`).not.toMatch(new RegExp(`(?<![\\d_])${limit}(?![\\d_])`));
    }
  });
});
