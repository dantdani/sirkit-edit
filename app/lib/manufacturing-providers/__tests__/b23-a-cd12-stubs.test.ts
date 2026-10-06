/**
 * [B23-A2] The four CD-12 refusing stubs, pinned by id (D23-21). `approveAsAgent`, `placePurchaseOrder` and
 * `sendExternalReviewRequest` (app/lib/release-engineering/governance.ts:8-10) and `writeManufacturingBytesFromLlm`
 * (app/lib/release-engineering/agent-tools.ts:8) each throw one literal and do nothing else; until B23-A2 only their sibling
 * `applyCd12Proposal` was named by a test (foundation.test.ts:2, :42). Each is pinned here by its id: the literal it throws whatever
 * it is handed, its one-line body, and that no production module calls it - the one route that imports their module calls neither.
 * [B23-A2 review tests-8] "Production" is the import gates' whole-root walk (`collectProductionFiles`: the repository root's own
 * files such as proxy.ts and instrumentation.ts included), never four directories.
 *
 * Nothing is written to disk.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { collectProductionFiles, type FileMap } from "@/app/lib/project/__tests__/_import-gate-helpers";
import { applyCd12Proposal, writeManufacturingBytesFromLlm } from "@/app/lib/release-engineering/agent-tools";
import { approveAsAgent, placePurchaseOrder, sendExternalReviewRequest } from "@/app/lib/release-engineering/governance";

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8").replaceAll(`${String.fromCharCode(13)}${NEWLINE}`, NEWLINE);

/** The four stubs by id: the module, the line, the literal. */
const STUBS = [
  { id: "approveAsAgent", run: approveAsAgent as (...args: unknown[]) => never, module: "app/lib/release-engineering/governance.ts", line: 8, literal: "CD12_AGENT_CANNOT_APPROVE_ALTERNATE_EXCEPTION_RISK_OR_RELEASE" },
  { id: "placePurchaseOrder", run: placePurchaseOrder as (...args: unknown[]) => never, module: "app/lib/release-engineering/governance.ts", line: 9, literal: "CD12_PROCUREMENT_SCENARIO_HAS_NO_PURCHASING_SIDE_EFFECT" },
  { id: "sendExternalReviewRequest", run: sendExternalReviewRequest as (...args: unknown[]) => never, module: "app/lib/release-engineering/governance.ts", line: 10, literal: "CD12_EXTERNAL_MESSAGE_REQUIRES_SEPARATE_AUTHORIZED_WORKFLOW_AND_VERIFIED_RECIPIENT" },
  { id: "writeManufacturingBytesFromLlm", run: writeManufacturingBytesFromLlm as (...args: unknown[]) => never, module: "app/lib/release-engineering/agent-tools.ts", line: 8, literal: "CD12_LLM_CANNOT_WRITE_MANUFACTURING_ARTIFACT_BYTES" },
] as const;

/** [B23-A2 review tests-8] Every production source: the import gates' whole-root walk (every supported extension; `__tests__`,
 *  node_modules, .next and the root's artifact, data, public and vendor trees aside), less any `*.test.*` or `*.spec.*` file. */
const production = (files: FileMap = collectProductionFiles(ROOT)): FileMap =>
  new Map([...files].filter(([path]) => !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path)).map(([path, source]) => [path, source.replaceAll(`${String.fromCharCode(13)}${NEWLINE}`, NEWLINE)] as const));
let cached: FileMap | null = null;
const productionFiles = (): FileMap => (cached ??= production());
/** The production files that call (`<id>(`) or name a stub outside its own declaration line, per stub. */
function stubReferences(files: FileMap): { calls: Record<string, string[]>; names: Record<string, string[]> } {
  const calls: Record<string, string[]> = {};
  const names: Record<string, string[]> = {};
  for (const { id, module } of STUBS) {
    const call = new RegExp(`\\b${id}\\s*\\(`);
    calls[id] = [...files].filter(([, source]) => call.test(source.split(NEWLINE).filter((text) => !text.startsWith(`export function ${id}(`)).join(NEWLINE))).map(([path]) => path);
    names[id] = [...files].filter(([path, source]) => path !== module && new RegExp(`\\b${id}\\b`).test(source)).map(([path]) => path);
  }
  return { calls, names };
}

describe("[B23-A2] the CD-12 refusing stubs, by id (D23-21)", () => {
  it.each(STUBS)("1. $id throws exactly its literal, with no argument and with any argument, and never returns", ({ run, literal }) => {
    const exact = new RegExp(`^${literal}$`);
    expect(() => run()).toThrowError(exact);
    for (const args of [[{}], ["approved"], [{ actorKind: "human", approved: true }, "now"], [null, undefined, 42]]) {
      let thrown: unknown = null;
      try {
        run(...args);
      } catch (error) {
        thrown = error;
      }
      expect(thrown, JSON.stringify(args) ?? "undefined").toBeInstanceOf(Error);
      expect((thrown as Error).message).toBe(literal);
    }
  });

  it.each(STUBS)("2. $id is one line, one throw: its cited line is exactly the declaration with the literal, and the literal appears nowhere else in production", ({ id, module, line, literal }) => {
    const lines = read(module).split(NEWLINE);
    expect(lines[line - 1]).toBe(`export function ${id}(): never { throw new Error("${literal}"); }`);
    const holders = [...productionFiles()].filter(([, source]) => source.includes(literal)).map(([path]) => path);
    expect(holders).toEqual([module]);
  });

  it("3. no production module calls any of the four; the one route whose closure reaches agent-tools.ts (the CD-12 propose route) calls neither stub and answers that it has no external or purchasing side effect", () => {
    const sources = productionFiles();
    expect(sources.size).toBeGreaterThan(500);
    expect(["proxy.ts", "instrumentation.ts"].filter((path) => sources.has(path)), "[B23-A2 review tests-8] the root's own production files are scanned").toEqual(["proxy.ts", "instrumentation.ts"]);
    const { calls, names } = stubReferences(sources);
    for (const { id } of STUBS) {
      expect(calls[id], id).toEqual([]);
      expect(names[id], `${id} is named nowhere else in production`).toEqual([]);
    }
    // [B23-A2 review tests-8] the scan bites at the root: a call added to proxy.ts (run on every matched request) is found
    const probed = new Map(sources).set("proxy.ts", `${sources.get("proxy.ts")!}\nimport { placePurchaseOrder } from "@/app/lib/release-engineering/governance";\nexport function probe(): void { placePurchaseOrder(); }\n`);
    expect(stubReferences(probed).calls.placePurchaseOrder).toEqual(["proxy.ts"]);
    const propose = read("app/api/release-engineering/propose/route.ts");
    for (const { id } of STUBS) expect(propose, id).not.toContain(id);
    expect(propose).toContain("hasExternalOrPurchasingSideEffects: false");
    // their sibling stays pinned where it was (foundation.test.ts:2, :42); it throws its own literal
    expect(() => (applyCd12Proposal as (...args: unknown[]) => never)()).toThrowError(/^CD12_PROPOSAL_REQUIRES_HUMAN_REVIEW_AND_AUTHORIZED_TRANSACTION$/);
  });
});
