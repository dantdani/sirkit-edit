/**
 * B14.5 — lexical `require` and parse-diagnostic closure.
 *
 * B14.4 exempted a whole FILE from module-loader classification whenever it
 * declared any binding named `require`. That was unsound in both
 * directions: an unrelated NESTED binding (a parameter inside one function)
 * suppressed classification of genuinely global `require()` calls (R1), and
 * the single pinned production file could be POISONED by prepending a
 * global `require()` of a protected module (R2). Separately, the gate
 * consumed TypeScript's error-recovered AST and reported malformed source
 * as boundary-clean (R3).
 *
 * B14.5 removes the exemption entirely (the production role helper was
 * renamed `requireRole`), makes classification unconditional, reports
 * `require` shadow declarations as boundary violations pinned at ZERO, and
 * fails the production gate on ANY parser diagnostic.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  collectProductionFiles,
  moduleImportOffenders,
  opaqueModuleLoads,
  PRODUCTION_SOURCE_EXTENSIONS,
  requireShadowDeclarations,
  sourceParseDiagnostics,
  type FileMap,
} from "./_import-gate-helpers";

const files = collectProductionFiles();

const CHANNEL = "app/lib/project/replacement-reauthorization";
const CONTROLLER = "app/lib/project/replacement-approval-controller.internal";
const INTENT = "app/lib/engineering/replacement-approval.internal";

// The approved importer sets, asserted BYTE-FOR-BYTE unchanged from
// B14.1/B14.2 (§3 test 14) — B14.5 changes no boundary, only its proof.
const CHANNEL_APPROVED = new Set([
  "app/lib/project/replacement-reauthorization.ts",
  "app/lib/project/replacement-approval-controller.internal.ts",
  "app/lib/engineering/approved-replacement-mutations.ts",
]);
const CONTROLLER_APPROVED = new Set([
  "app/lib/project/replacement-approval-controller.internal.ts",
  "app/page.tsx",
]);
const INTENT_APPROVED = new Set([
  "app/lib/engineering/replacement-approval.internal.ts",
  "app/lib/engineering/approved-replacement-mutations.ts",
  "app/lib/project/replacement-approval-controller.internal.ts",
]);

function only(path: string, source: string): FileMap {
  return new Map([[path, source]]);
}

// ─── §1 — no declaration can suppress unrelated loader detection ─────────────

describe("B14.5 §1 — lexical require: no exemption, anywhere", () => {
  it("1. R1: an unrelated NESTED require parameter cannot hide a global forbidden require", () => {
    const path = "app/lib/agent/evil-r1.ts";
    const source = [
      'const stolen = require("../project/replacement-reauthorization");',
      'function unrelated(require: (x: string) => void) { require("not-a-module"); }',
    ].join("\n");
    const map = only(path, source);
    // pre-edit this was [] on EVERY axis; the global load is now an OFFENDER
    expect(moduleImportOffenders(map, CHANNEL, CHANNEL_APPROVED)).toEqual([path]);
    // …and the shadow itself is reported as a boundary violation, never an exemption
    expect(requireShadowDeclarations(map)).toEqual([
      { file: path, kind: "parameter", line: 2, character: 20 },
    ]);
  });

  it("2. R2: the formerly pinned production file cannot be POISONED (in-memory; disk untouched)", () => {
    const path = "app/lib/pcb/fab/validate-package.ts";
    const real = readFileSync(join(process.cwd(), path), "utf8");
    const poisoned = 'const stolen =\n  require("../../project/replacement-reauthorization");\n' + real;
    expect(moduleImportOffenders(only(path, poisoned), CHANNEL, CHANNEL_APPROVED)).toEqual([path]);
    // the real on-disk file is unpoisoned AND shadow-free (renamed helper)
    expect(moduleImportOffenders(only(path, real), CHANNEL, CHANNEL_APPROVED)).toEqual([]);
    expect(requireShadowDeclarations(only(path, real))).toEqual([]);
    expect(opaqueModuleLoads(only(path, real))).toEqual([]);
  });

  it("3. a BLOCK-local require cannot hide another scope's loader call", () => {
    const path = "app/lib/agent/evil-block.ts";
    const source = [
      "function scoped(): void {",
      '  { const require = (x: string) => x; require("inner-noise"); }',
      "}",
      'export const stolen = require("../project/replacement-reauthorization");',
    ].join("\n");
    expect(moduleImportOffenders(only(path, source), CHANNEL, CHANNEL_APPROVED)).toEqual([path]);
    expect(requireShadowDeclarations(only(path, source))).toHaveLength(1);
  });

  it("4. a MODULE-LEVEL local require creates no exemption at all", () => {
    const path = "app/lib/agent/evil-module-level.ts";
    const source = [
      "const require = (role: string): string => role;",
      'export const noise = require("just-a-role");',
      'import { createReplacementReauthorization } from "../project/replacement-reauthorization";',
      "export { createReplacementReauthorization };",
    ].join("\n");
    // the static import is caught regardless…
    expect(moduleImportOffenders(only(path, source), CHANNEL, CHANNEL_APPROVED)).toEqual([path]);
    // …and the module-level shadow is itself a violation
    expect(requireShadowDeclarations(only(path, source))).toEqual([
      { file: path, kind: "variable", line: 1, character: 7 },
    ]);
    // …and a shadowed require() call is now CLASSIFIED, never skipped: a
    // forbidden specifier through it is an offender.
    const shadowedCall = [
      "const require = (r: string) => r;",
      'const m = require("../project/replacement-reauthorization");',
    ].join("\n");
    expect(moduleImportOffenders(only("app/lib/agent/evil-shadow-call.ts", shadowedCall), CHANNEL, CHANNEL_APPROVED))
      .toEqual(["app/lib/agent/evil-shadow-call.ts"]);
  });

  it("5. an ALIASED or reflected global require still FAILS CLOSED even beside a shadow", () => {
    const aliasPath = "app/lib/agent/evil-alias.ts";
    const alias = "function f(require: unknown) { return require; }\nconst r = require;\nexport { r };";
    const loads = opaqueModuleLoads(only(aliasPath, alias));
    expect(loads.length).toBeGreaterThan(0);
    expect(loads[0]).toMatchObject({ file: aliasPath, kind: "require" });
    // a non-static dynamic target beside a shadow is still opaque
    const opaquePath = "app/lib/agent/evil-opaque.ts";
    const opaque = "declare const name: string;\nfunction g(require: unknown) { void require; }\nconst m = import(name);";
    expect(opaqueModuleLoads(only(opaquePath, opaque))).toContainEqual(
      { file: opaquePath, kind: "dynamic-import", argumentText: "name" });
  });

  it("6. the REAL production tree contains ZERO require shadow declarations", { timeout: 60_000 }, () => {
    expect(requireShadowDeclarations(files)).toEqual([]);
    // and the renamed helper carries no bare `require` identifier at all
    const helper = files.get("app/lib/pcb/fab/validate-package.ts") ?? "";
    expect(helper).toContain("requireRole");
    expect(helper).not.toMatch(/\brequire\b/);
  });
});

// ─── §2 — parser diagnostics fail closed ─────────────────────────────────────

describe("B14.5 §2 — parse diagnostics fail the gate", () => {
  it("7. R3: malformed source is REPORTED, not silently recovered", () => {
    const path = "app/lib/agent/malformed.ts";
    const records = sourceParseDiagnostics(only(path, "const = ;"));
    expect(records.length).toBeGreaterThan(0);
    expect(records[0]!.file).toBe(path);
    expect(records[0]!.message).toContain("Variable declaration expected");
    expect(typeof records[0]!.code).toBe("number");
    expect(records[0]!.line).toBe(1);
    expect(typeof records[0]!.character).toBe("number");
  });

  it("8. malformed source in EVERY supported extension trips the gate", () => {
    for (const extension of PRODUCTION_SOURCE_EXTENSIONS) {
      const path = `app/lib/agent/malformed${extension}`;
      const records = sourceParseDiagnostics(only(path, "const = ;"));
      expect(records.length, extension).toBeGreaterThan(0);
      expect(records[0]!.file, extension).toBe(path);
    }
  });

  it("9. VALID source in every supported extension stays diagnostic-free", () => {
    for (const extension of PRODUCTION_SOURCE_EXTENSIONS) {
      const path = `app/lib/agent/valid${extension}`;
      expect(sourceParseDiagnostics(only(path, "export const x = 1;\n")), extension).toEqual([]);
    }
  });

  it("10. the COMPLETE scanned production tree has ZERO parse diagnostics", { timeout: 60_000 }, () => {
    expect(sourceParseDiagnostics(files)).toEqual([]);
  });

  it("11. diagnostic records are BOUNDED (record count and message length)", () => {
    const many: FileMap = new Map();
    for (let index = 0; index < 300; index += 1) many.set(`app/lib/agent/bad-${index}.ts`, "const = ;");
    const records = sourceParseDiagnostics(many);
    expect(records.length).toBeLessThanOrEqual(100);
    for (const record of records) expect(record.message.length).toBeLessThanOrEqual(200);
  });
});

// ─── §3 — nothing else moved ─────────────────────────────────────────────────

describe("B14.5 §3 — B14.4 guarantees preserved", () => {
  it("12. comments and harmless strings remain NON-offenders", () => {
    const path = "app/lib/agent/harmless.ts";
    const source = [
      "// see ../project/replacement-reauthorization for the channel",
      '/* require("../project/replacement-reauthorization") in a comment */',
      'export const label = "../project/replacement-reauthorization";',
      "export const note = `app/lib/project/replacement-reauthorization`;",
    ].join("\n");
    expect(moduleImportOffenders(only(path, source), CHANNEL, CHANNEL_APPROVED)).toEqual([]);
    expect(opaqueModuleLoads(only(path, source))).toEqual([]);
    expect(sourceParseDiagnostics(only(path, source))).toEqual([]);
  });

  it("13. every B14.4 import form is still detected under the exemption-free gate", () => {
    const cases: Array<[string, string, string]> = [
      ["static", "app/lib/agent/f1.ts", 'import { x } from "../project/replacement-reauthorization";'],
      ["comment-in-dynamic", "app/lib/agent/f2.ts", 'const c = import(\n  /* chunk */ "../project/replacement-reauthorization"\n);'],
      ["comment-between-tokens", "app/lib/agent/f3.ts", 'import { x }\n  from /* b */ "../project/replacement-reauthorization";'],
      ["escaped-literal", "app/lib/project/f4.ts", 'import { x } from "./replacement\\u002dreauthorization";'],
      ["concatenated", "app/lib/agent/f5.ts", 'const c = import("../project/replacement-" + "reauthorization");'],
      ["require", "app/lib/agent/f6.ts", 'const c = require("../project/replacement-reauthorization");'],
      ["import-equals", "app/lib/agent/f7.ts", 'import c = require("../project/replacement-reauthorization");'],
      ["import-type", "app/lib/agent/f8.ts", 'export type T = import("../project/replacement-reauthorization").AuthenticFreshFacts;'],
      ["re-export", "app/lib/agent/f9.ts", 'export * from "../project/replacement-reauthorization";'],
      ["alias", "app/api/f10/route.ts", 'import { x } from "@/app/lib/project/replacement-reauthorization";'],
      ["require-resolve", "app/lib/agent/f11.ts", 'const p = require.resolve("../project/replacement-reauthorization");'],
    ];
    for (const [label, path, source] of cases) {
      expect(moduleImportOffenders(only(path, source), CHANNEL, CHANNEL_APPROVED), label).toEqual([path]);
    }
    // the controller and intent modules keep their own boundaries
    expect(moduleImportOffenders(only("app/lib/project/evil-c.ts", 'import { a } from "./replacement-approval-controller.internal";'), CONTROLLER, CONTROLLER_APPROVED))
      .toEqual(["app/lib/project/evil-c.ts"]);
    expect(moduleImportOffenders(only("app/lib/engineering/evil-i.ts", 'export * from "./replacement-approval.internal";'), INTENT, INTENT_APPROVED))
      .toEqual(["app/lib/engineering/evil-i.ts"]);
  });

  it("14. the approved importer sets are BYTE-FOR-BYTE unchanged, and the real tree is clean under them", { timeout: 60_000 }, () => {
    expect([...CHANNEL_APPROVED].sort()).toEqual([
      "app/lib/engineering/approved-replacement-mutations.ts",
      "app/lib/project/replacement-approval-controller.internal.ts",
      "app/lib/project/replacement-reauthorization.ts",
    ]);
    expect([...CONTROLLER_APPROVED].sort()).toEqual([
      "app/lib/project/replacement-approval-controller.internal.ts",
      "app/page.tsx",
    ]);
    expect([...INTENT_APPROVED].sort()).toEqual([
      "app/lib/engineering/approved-replacement-mutations.ts",
      "app/lib/engineering/replacement-approval.internal.ts",
      "app/lib/project/replacement-approval-controller.internal.ts",
    ]);
    expect(moduleImportOffenders(files, CHANNEL, CHANNEL_APPROVED)).toEqual([]);
    expect(moduleImportOffenders(files, CONTROLLER, CONTROLLER_APPROVED)).toEqual([]);
    expect(moduleImportOffenders(files, INTENT, INTENT_APPROVED)).toEqual([]);
    expect(opaqueModuleLoads(files)).toEqual([]);
  });
});

// ─── §4 — closures found by the independent adversarial audit ───────────────

describe("B14.5 §4 — audit-found loader, JSDoc, and diagnostic closures", () => {
  it("15. createRequire-minted loaders are classified (the BLOCKING audit finding)", () => {
    const cases: Array<[string, string, string]> = [
      ["node:module alias", "app/lib/agent/cr1.mts",
        'import { createRequire } from "node:module";\nconst load = createRequire(import.meta.url);\nexport const c = load("../project/replacement-reauthorization");'],
      ["bare module alias", "app/lib/agent/cr2.mts",
        'import { createRequire } from "module";\nconst load = createRequire(import.meta.url);\nexport const c = load("../project/replacement-reauthorization");'],
      ["renamed import", "app/lib/agent/cr3.mts",
        'import { createRequire as mk } from "node:module";\nconst load = mk(import.meta.url);\nexport const c = load("../project/replacement-reauthorization");'],
      ["namespace member", "app/lib/agent/cr4.mts",
        'import * as mod from "node:module";\nconst load = mod.createRequire(import.meta.url);\nexport const c = load("../project/replacement-reauthorization");'],
      ["immediately invoked", "app/lib/agent/cr5.mts",
        'import { createRequire } from "node:module";\nexport const c = createRequire(import.meta.url)("../project/replacement-reauthorization");'],
      ["factory alias chain", "app/lib/agent/cr6.mts",
        'import { createRequire } from "node:module";\nconst mk = createRequire;\nconst load = mk(import.meta.url);\nexport const c = load("../project/replacement-reauthorization");'],
      ["getBuiltinModule", "app/lib/agent/cr7.mts",
        'const load = process.getBuiltinModule("module").createRequire(import.meta.url);\nexport const c = load("../project/replacement-reauthorization");'],
      ["Module._load reflection", "app/lib/agent/cr8.ts",
        'declare const module: { constructor: { _load(id: string): unknown } };\nexport const c = module.constructor._load("../project/replacement-reauthorization");'],
    ];
    for (const [label, path, source] of cases) {
      expect(moduleImportOffenders(only(path, source), CHANNEL, CHANNEL_APPROVED), label).toEqual([path]);
    }
    // an UNCLASSIFIED createRequire reference (aliasing/reflection) fails closed
    const stashed = 'import { createRequire } from "node:module";\nexport const factory = createRequire;';
    expect(opaqueModuleLoads(only("app/lib/agent/cr9.mts", stashed)).length).toBeGreaterThan(0);
    // a NON-static minted load is opaque, never silent
    const dynamic = 'import { createRequire } from "node:module";\nconst load = createRequire(import.meta.url);\ndeclare const id: string;\nexport const c = load(id);';
    expect(opaqueModuleLoads(only("app/lib/agent/cr10.mts", dynamic))).toContainEqual(
      { file: "app/lib/agent/cr10.mts", kind: "require", argumentText: "id" });
  });

  it("16. JSDoc import() types in JS-family files are extracted", () => {
    const path = "app/lib/agent/jsdoc.js";
    const source = '/** @type {import("../project/replacement-reauthorization").AuthenticFreshFacts} */\nexport const facts = undefined;\n';
    expect(moduleImportOffenders(only(path, source), CHANNEL, CHANNEL_APPROVED)).toEqual([path]);
  });

  it("17. TS-only syntax in a JS-family file is reported as a diagnostic", () => {
    const bad: Array<[string, string]> = [
      ["app/lib/agent/bad1.js", "export const x: number = 1;"],
      ["app/lib/agent/bad2.mjs", "export interface I { a: string }"],
      ["app/lib/agent/bad3.jsx", "export enum E { A }"],
      ["app/lib/agent/bad4.cjs", "const y = 1 as number;"],
    ];
    for (const [path, source] of bad) {
      expect(sourceParseDiagnostics(only(path, source)).length, path).toBeGreaterThan(0);
    }
    const good: Array<[string, string]> = [
      ["app/lib/agent/ok1.js", "export const x = 1;\n"],
      ["app/lib/agent/ok2.jsx", "export const C = () => <div className=\"a\">hi</div>;\n"],
      ["app/lib/agent/ok3.mjs", "import path from \"node:path\";\nexport const j = path.join;\n"],
      ["app/lib/agent/ok4.cjs", "const x = require(\"node:path\");\nmodule.exports = { x };\n"],
    ];
    for (const [path, source] of good) {
      expect(sourceParseDiagnostics(only(path, source)), path).toEqual([]);
    }
  });

  it("18. NAME positions spelled `require` are not loader references (no false positives)", () => {
    const harmless: Array<[string, string]> = [
      ["object key", 'export const externals = { require: "commonjs require" };'],
      ["member read", "declare const cfg: { require: string[] };\nexport const deps = cfg.require;"],
      ["type member", "export interface PackageJson { require?: string }"],
      ["enum member", "export enum Mode { require, optional }"],
      ["word-boundary neighbours", "export const requireRole = 1;\nexport const required = 2;\nexport const requires = 3;"],
    ];
    for (const [label, source] of harmless) {
      const path = "app/lib/agent/harmless-name.ts";
      expect(opaqueModuleLoads(only(path, source)), label).toEqual([]);
      expect(requireShadowDeclarations(only(path, source)), label).toEqual([]);
      expect(moduleImportOffenders(only(path, source), CHANNEL, CHANNEL_APPROVED), label).toEqual([]);
    }
  });

  it("19. widened shadow coverage: more declaration forms named `require` are reported", () => {
    const forms: Array<[string, string, string]> = [
      ["enum", "app/lib/agent/s1.ts", "enum require { A }"],
      ["namespace", "app/lib/agent/s2.ts", "namespace require { export const a = 1; }"],
      ["class-expression", "app/lib/agent/s3.ts", "const C = class require {};"],
      ["function-expression", "app/lib/agent/s4.ts", "const f = function require() {};"],
      ["getter", "app/lib/agent/s5.ts", "class K { get require() { return 1; } }"],
      ["interface", "app/lib/agent/s6.ts", "interface require { a: string }"],
      ["namespace-import", "app/lib/agent/s7.ts", 'import * as require from "node:path";'],
    ];
    for (const [label, path, source] of forms) {
      const shadows = requireShadowDeclarations(only(path, source));
      expect(shadows.length, label).toBeGreaterThan(0);
      expect(shadows[0]!.file, label).toBe(path);
    }
  });
});
