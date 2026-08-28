/**
 * B14.4 — AST-proven capability import boundaries.
 *
 * The gate parses production source with the TypeScript compiler (correct
 * ScriptKind per extension) instead of regexes: comments and formatting
 * cannot affect detection, escaped literals decode to their real module
 * names, dynamic import()/require() arguments are statically evaluated
 * within a bounded side-effect-free grammar, opaque module loads FAIL
 * CLOSED, and module identities are compared canonically after safe
 * resolution — never by raw substring. Every B14.4 pre-edit counterexample
 * (R1 comment-inside-dynamic-import, R2 comment-between-tokens, R3
 * escaped literal, R4 static concatenation) is a permanent tripwire here.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  collectProductionFiles,
  identifierReferences,
  requireShadowDeclarations,
  moduleImportOffenders,
  moduleReferences,
  opaqueModuleLoads,
  resolveSpecifier,
  rootEscapingImports,
  type FileMap,
} from "./_import-gate-helpers";

const files = collectProductionFiles();

const CHANNEL = "app/lib/project/replacement-reauthorization";
const CONTROLLER = "app/lib/project/replacement-approval-controller.internal";
const INTENT = "app/lib/engineering/replacement-approval.internal";
const FACTORY = "__createTestReplacementReauthorizationChannel";

// The EXACT approved importer sets — unchanged since B14.1/B14.2.
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
const FACTORY_APPROVED = new Set(["app/lib/project/replacement-reauthorization.ts"]);

function inject(path: string, source: string): FileMap {
  const injected: FileMap = new Map(files);
  injected.set(path, source);
  return injected;
}

// ─── §1 — the real production tree ───────────────────────────────────────────

describe("B14.4 §1 — the real production tree under the AST gate", () => {
  it("1. every capability target is clean with its exact approved importer set", { timeout: 60_000 }, () => {
    expect(moduleImportOffenders(files, CHANNEL, CHANNEL_APPROVED)).toEqual([]);
    expect(moduleImportOffenders(files, CONTROLLER, CONTROLLER_APPROVED)).toEqual([]);
    expect(moduleImportOffenders(files, INTENT, INTENT_APPROVED)).toEqual([]);
    expect(identifierReferences(files, FACTORY, FACTORY_APPROVED)).toEqual([]);
  });

  it("2. ZERO opaque module loads and ZERO root-escaping imports exist in production", () => {
    expect(opaqueModuleLoads(files)).toEqual([]);
    expect(rootEscapingImports(files)).toEqual([]);
  });

  it("3. [B14.5] the production tree contains ZERO `require` shadow declarations (the exemption is GONE)", () => {
    // B14.4 pinned ONE exempt file here. B14.5 proved a file-wide exemption
    // is unsound in both directions (an unrelated nested binding suppressed
    // real global loads; the pinned file itself was poisonable), so the
    // exemption was deleted, the production helper was renamed to
    // `requireRole`, and a shadow declaration is now a BOUNDARY VIOLATION
    // pinned at zero rather than an allowance.
    expect(requireShadowDeclarations(files)).toEqual([]);
  });

  it("4. soundness: harmless non-import string literals are NOT flagged", () => {
    // The endpoint legitimately contains the module NAME as a string
    // literal (`canonicalRevision: "replacement-reauthorization"`).
    const route = files.get("app/api/replacement-authority/route.ts") ?? "";
    expect(route).toContain('"replacement-reauthorization"');
    expect(CHANNEL_APPROVED.has("app/api/replacement-authority/route.ts")).toBe(false);
    // ...and a file whose ONLY mention is a plain string constant (not an
    // import, not a module-load argument) is not an offender either:
    const withLabel = inject("app/lib/agent/harmless-label.ts",
      'export const label = "../project/replacement-reauthorization";\nexport const note = `app/lib/project/replacement-reauthorization`;');
    expect(moduleImportOffenders(withLabel, CHANNEL, CHANNEL_APPROVED)).toEqual([]);
  });
});

// ─── §2 — the pre-edit counterexamples as permanent tripwires ────────────────

describe("B14.4 §2 — R1–R4 equivalent spellings are detected", () => {
  it("5. R1: a comment INSIDE the dynamic import parentheses", () => {
    const path = "app/lib/agent/evil-r1.ts";
    const source = 'const channel = import(\n  /* webpackChunkName: "reauth" */\n  "../project/replacement-reauthorization"\n);\n';
    expect(moduleImportOffenders(inject(path, source), CHANNEL, CHANNEL_APPROVED)).toEqual([path]);
  });

  it("6. R2: a comment BETWEEN the import tokens", () => {
    const path = "app/lib/agent/evil-r2.ts";
    const source = 'import { createReplacementReauthorization }\n  from /* boundary */ "../project/replacement-reauthorization";\n';
    expect(moduleImportOffenders(inject(path, source), CHANNEL, CHANNEL_APPROVED)).toEqual([path]);
  });

  it("7. R3: an ESCAPED module literal decodes to the protected module", () => {
    const path = "app/lib/project/evil-r3.ts";
    const source = 'import { createReplacementReauthorization }\n  from "./replacement\\u002dreauthorization";\n';
    expect(moduleImportOffenders(inject(path, source), CHANNEL, CHANNEL_APPROVED)).toEqual([path]);
  });

  it("8. R4: a statically CONCATENATED dynamic import evaluates to the protected module", () => {
    const path = "app/lib/agent/evil-r4.ts";
    const source = 'const channel =\n  import("../project/replacement-" + "reauthorization");\n';
    expect(moduleImportOffenders(inject(path, source), CHANNEL, CHANNEL_APPROVED)).toEqual([path]);
    // parenthesized + template-literal composition too:
    const composed = 'const c = import(("../project/" + `replacement-` + "reauthorization"));\n';
    expect(moduleImportOffenders(inject(path, composed), CHANNEL, CHANNEL_APPROVED)).toEqual([path]);
  });
});

// ─── §3 — every import form, extension, and spelling ─────────────────────────

describe("B14.4 §3 — form, extension, and spelling tripwires", () => {
  it("9. every syntactic import form referencing the channel is detected", () => {
    const cases: Array<[string, string, string]> = [
      ["same-directory", "app/lib/project/evil-same-dir.ts", 'import { createReplacementReauthorization } from "./replacement-reauthorization";'],
      ["parent-relative", "app/lib/agent/evil-parent.ts", 'import { consumeReplacementReauthorization } from "../project/replacement-reauthorization";'],
      ["alias", "app/api/evil/route.ts", 'import { createReplacementReauthorization } from "@/app/lib/project/replacement-reauthorization";'],
      ["static-re-export", "app/lib/engineering/evil-reexport.ts", 'export * from "../project/replacement-reauthorization";'],
      ["named-re-export", "app/lib/engineering/evil-named-reexport.ts", 'export { createReplacementReauthorization } from "../project/replacement-reauthorization";'],
      ["dynamic-import", "app/lib/agent/evil-dynamic.ts", 'const channel = await import("../project/replacement-reauthorization");'],
      ["require", "app/lib/agent/evil-require.ts", 'const channel = require("../project/replacement-reauthorization");'],
      ["import-equals", "app/lib/agent/evil-import-equals.ts", 'import channel = require("../project/replacement-reauthorization");'],
      ["import-type", "app/lib/agent/evil-import-type.ts", 'export type Facts = import("../project/replacement-reauthorization").AuthenticFreshFacts;'],
      ["side-effect-import", "app/lib/agent/evil-side-effect.ts", 'import "../project/replacement-reauthorization";'],
      ["explicit-extension", "app/lib/project/evil-extension.ts", 'import { createReplacementReauthorization } from "./replacement-reauthorization.ts";'],
      ["mixed-dot-segments", "app/lib/agent/evil-mixed.ts", 'import { createReplacementReauthorization } from "./../project/./replacement-reauthorization";'],
      ["case-variant", "app/lib/project/evil-case.ts", 'import { createReplacementReauthorization } from "./Replacement-Reauthorization";'],
      ["type-only-import", "app/lib/agent/evil-type-only.ts", 'import type { AuthenticFreshFacts } from "../project/replacement-reauthorization";'],
      ["windows-backslash", "app/lib/project/evil-backslash.ts", 'import { createReplacementReauthorization } from ".\\\\replacement-reauthorization";'],
      ["query-suffix", "app/lib/agent/evil-query.ts", 'import { createReplacementReauthorization } from "../project/replacement-reauthorization?raw";'],
      ["fragment-suffix", "app/lib/agent/evil-fragment.ts", 'import { createReplacementReauthorization } from "../project/replacement-reauthorization#frag";'],
    ];
    for (const [label, path, source] of cases) {
      expect(moduleImportOffenders(inject(path, source), CHANNEL, CHANNEL_APPROVED), label).toEqual([path]);
    }
  });

  it("10. the forbidden import is detected in EVERY supported production extension", () => {
    const tsForms = ["ts", "tsx", "mts", "cts"];
    const jsForms = ["js", "jsx", "mjs", "cjs"];
    for (const extension of tsForms) {
      const path = `app/lib/agent/evil-ext.${extension}`;
      const source = 'import { createReplacementReauthorization } from "../project/replacement-reauthorization";';
      expect(moduleImportOffenders(inject(path, source), CHANNEL, CHANNEL_APPROVED), extension).toEqual([path]);
    }
    for (const extension of jsForms) {
      const path = `app/lib/agent/evil-ext.${extension}`;
      const source = 'const { createReplacementReauthorization } = require("../project/replacement-reauthorization");';
      expect(moduleImportOffenders(inject(path, source), CHANNEL, CHANNEL_APPROVED), extension).toEqual([path]);
    }
  });

  it("11. the gate fails while the forbidden importer exists and passes ONLY once removed or approved", () => {
    const path = "app/lib/agent/evil-lifecycle.ts";
    const source = 'import { createReplacementReauthorization } from "@/app/lib/project/replacement-reauthorization";';
    const injected = inject(path, source);
    expect(moduleImportOffenders(injected, CHANNEL, CHANNEL_APPROVED)).toEqual([path]); // fails while present
    injected.delete(path);
    expect(moduleImportOffenders(injected, CHANNEL, CHANNEL_APPROVED)).toEqual([]);     // passes once removed
    const approvedToo = new Set([...CHANNEL_APPROVED, path]);
    expect(moduleImportOffenders(inject(path, source), CHANNEL, approvedToo)).toEqual([]); // or once approved
  });

  it("12. controller and intent-module targets are equally protected", () => {
    const cases: Array<[string, string, string, ReadonlySet<string>]> = [
      ["app/lib/project/evil-controller.ts", 'import { approveAndApplyReplacement } from /* c */ "./replacement-approval-controller.internal";', CONTROLLER, CONTROLLER_APPROVED],
      ["app/lib/agent/evil-controller-dynamic.ts", 'const mod = import("../project/replacement-approval-" + "controller.internal");', CONTROLLER, CONTROLLER_APPROVED],
      ["app/lib/engineering/evil-intent.ts", 'export { issueReplacementApprovalIntent } from "./replacement-approval.internal";', INTENT, INTENT_APPROVED],
      ["app/api/evil-intent/route.ts", 'const intent = await import("@/app/lib/engineering/replacement-approval.internal");', INTENT, INTENT_APPROVED],
      ["app/lib/agent/evil-intent-equals.ts", 'import intent = require("../engineering/replacement-approval.internal");', INTENT, INTENT_APPROVED],
    ];
    for (const [path, source, module, approved] of cases) {
      expect(moduleImportOffenders(inject(path, source), module, approved), path).toEqual([path]);
    }
  });
});

// ─── §4 — opaque loads fail closed; static evaluation is bounded ─────────────

describe("B14.4 §4 — opaque module loads and bounded static evaluation", () => {
  it("13. a NON-static dynamic import or require is surfaced as an opaque load (fail closed), not ignored", () => {
    const dynamicPath = "app/lib/agent/evil-opaque-import.ts";
    const withOpaqueImport = inject(dynamicPath, 'declare const name: string;\nconst mod = import(name);');
    expect(opaqueModuleLoads(withOpaqueImport)).toEqual([
      { file: dynamicPath, kind: "dynamic-import", argumentText: "name" },
    ]);
    const templatePath = "app/lib/agent/evil-opaque-template.ts";
    const withSubstitution = inject(templatePath, "declare const x: string;\nconst mod = import(`../project/${x}`);");
    expect(opaqueModuleLoads(withSubstitution)).toHaveLength(1);
    const requirePath = "app/lib/agent/evil-opaque-require.ts";
    const withOpaqueRequire = inject(requirePath, "declare const target: string;\nconst mod = require(target);");
    expect(opaqueModuleLoads(withOpaqueRequire)).toEqual([
      { file: requirePath, kind: "require", argumentText: "target" },
    ]);
  });

  it("14. static evaluation accepts ONLY the bounded side-effect-free grammar", () => {
    const source = [
      'const a = import("./plain");',
      "const b = import(`./no-substitution`);",
      'const c = import(("./parenthesized"));',
      'const d = import("./left-" + "right" + `-tail`);',
      "declare const x: string;",
      "const e = import(`./with-${x}`);", // substitution → opaque
      'const f = import("./call-" + String(1));', // call → opaque
    ].join("\n");
    const refs = moduleReferences("app/lib/agent/static-eval.ts", source);
    expect(refs.map((entry) => entry.specifier)).toEqual([
      "./plain", "./no-substitution", "./parenthesized", "./left-right-tail",
    ]);
    const opaque = opaqueModuleLoads(new Map([["app/lib/agent/static-eval.ts", source]]));
    expect(opaque).toHaveLength(2);
  });

  it("15b. property-access and aliased loader shapes are classified or fail closed — never silent", () => {
    // require.resolve with a STATIC protected target → an offender.
    const resolvePath = "app/lib/agent/evil-require-resolve.ts";
    const withResolve = inject(resolvePath, 'const p = require.resolve("../project/replacement-reauthorization");');
    expect(moduleImportOffenders(withResolve, CHANNEL, CHANNEL_APPROVED)).toEqual([resolvePath]);
    // import.meta.resolve with a STATIC protected target → an offender.
    const metaPath = "app/lib/agent/evil-meta-resolve.mts";
    const withMeta = inject(metaPath, 'const p = import.meta.resolve("../project/replacement-reauthorization");');
    expect(moduleImportOffenders(withMeta, CHANNEL, CHANNEL_APPROVED)).toEqual([metaPath]);
    // require.context / non-static property-access loads → OPAQUE.
    const contextPath = "app/lib/agent/evil-require-context.ts";
    const opaqueContext = opaqueModuleLoads(new Map([[contextPath, 'declare const dir: string;\nconst ctx = require.context(dir);']]));
    expect(opaqueContext).toEqual([{ file: contextPath, kind: "require", argumentText: "dir" }]);
    // ALIASED require (`const r = require`) → fails closed as opaque.
    const aliasPath = "app/lib/agent/evil-require-alias.ts";
    const opaqueAlias = opaqueModuleLoads(new Map([[aliasPath, 'const r = require;\nexport { r };']]));
    expect(opaqueAlias).toEqual([{ file: aliasPath, kind: "require", argumentText: "bare `require` reference (aliasing/reflection)" }]);
    // module.require reflection → [B14.5 audit] now CLASSIFIED as a loader:
    // a static protected target is an OFFENDER (stronger than the previous
    // behaviour, where it merely fell through to an opaque load)…
    const reflectPath = "app/lib/agent/evil-module-require.ts";
    const reflectSource = 'declare const module: { require(id: string): unknown };\nconst m = module.require("../project/replacement-reauthorization");';
    expect(moduleImportOffenders(new Map([[reflectPath, reflectSource]]), CHANNEL, CHANNEL_APPROVED)).toEqual([reflectPath]);
    // …and a NON-static target still fails closed as opaque.
    const reflectOpaque = 'declare const module: { require(id: string): unknown };\ndeclare const id: string;\nconst m = module.require(id);';
    expect(opaqueModuleLoads(new Map([[reflectPath, reflectOpaque]])).length).toBeGreaterThan(0);
    // …and the former "exempt" helper is silent for the RIGHT reason now:
    // [B14.5] it no longer contains the identifier `require` at all (its
    // role helper was renamed `requireRole`), so nothing is exempted.
    const helperSource = files.get("app/lib/pcb/fab/validate-package.ts")!;
    expect(helperSource).not.toMatch(/\brequire\b/);
    expect(opaqueModuleLoads(new Map([["app/lib/pcb/fab/validate-package.ts", helperSource]]))).toEqual([]);
  });

  it("15c. a leading-# package-imports specifier classifies as bare, never as an erased match", () => {
    expect(resolveSpecifier("app/x.ts", "#internal/thing")).toEqual({ kind: "bare" });
    expect(resolveSpecifier("app/lib/agent/x.ts", "../project/replacement-reauthorization?raw")).toEqual(
      { kind: "module", module: "app/lib/project/replacement-reauthorization" });
  });

  it("15. resolution rejects traversal above the repository root and surfaces it", () => {
    expect(resolveSpecifier("app/lib/agent/deep.ts", "../../../../outside/module")).toEqual({ kind: "escapes-root" });
    expect(resolveSpecifier("app/lib/agent/deep.ts", "../project/replacement-reauthorization")).toEqual(
      { kind: "module", module: "app/lib/project/replacement-reauthorization" });
    expect(resolveSpecifier("app/lib/agent/deep.ts", "typescript")).toEqual({ kind: "bare" });
    expect(resolveSpecifier("app/x.ts", "./y.tsx")).toEqual({ kind: "module", module: "app/y" });
    const path = "app/lib/agent/evil-escape.ts";
    const escaping = inject(path, 'import "../../../../../outside";');
    expect(rootEscapingImports(escaping)).toEqual([{ file: path, specifier: "../../../../../outside" }]);
  });
});

// ─── §5 — the test-only factory identifier and the barrel ────────────────────

describe("B14.4 §5 — factory identifier forms and the engineering barrel", () => {
  it("16. every access form to the test-only factory is detected", { timeout: 60_000 }, () => {
    const cases: Array<[string, string, string]> = [
      ["aliased-named-import", "app/lib/agent/evil-alias.ts", 'import { __createTestReplacementReauthorizationChannel as makeChannel } from "../project/replacement-reauthorization";'],
      ["namespace-access", "app/lib/agent/evil-namespace.ts", 'import * as reauth from "../project/replacement-reauthorization";\nconst c = reauth.__createTestReplacementReauthorizationChannel;'],
      ["destructuring", "app/lib/agent/evil-destructure.ts", 'const { __createTestReplacementReauthorizationChannel: make } = await import("../project/replacement-reauthorization");'],
      ["element-access-string", "app/lib/agent/evil-element.ts", 'declare const mod: Record<string, unknown>;\nconst c = mod["__createTestReplacementReauthorizationChannel"];'],
      ["re-export", "app/lib/agent/evil-factory-reexport.ts", 'export { __createTestReplacementReauthorizationChannel } from "../project/replacement-reauthorization";'],
      // a unicode-escaped identifier decodes to the factory name in the AST
      // (a raw-text scan would miss this spelling):
      ["unicode-escaped-identifier", "app/lib/agent/evil-unicode-ident.ts", 'declare const mod: { __createTestReplacement\\u0052eauthorizationChannel: unknown };\nconst c = mod.__createTestReplacement\\u0052eauthorizationChannel;'],
    ];
    for (const [label, path, source] of cases) {
      expect(identifierReferences(inject(path, source), FACTORY, FACTORY_APPROVED), label).toEqual([path]);
    }
  });

  it("17. the engineering barrel exports NONE of the capability modules (AST re-export check + injected tripwire)", () => {
    const barrelPath = "app/lib/engineering/index.ts";
    const barrel = files.get(barrelPath) ?? "";
    for (const reference of moduleReferences(barrelPath, barrel)) {
      const resolution = resolveSpecifier(barrelPath, reference.specifier);
      if (resolution.kind !== "module") continue;
      expect([CHANNEL, CONTROLLER, INTENT, "app/lib/engineering/approved-replacement-mutations"],
        `barrel references ${resolution.module}`).not.toContain(resolution.module);
    }
    // Tripwire: a barrel that re-exports the intent module is an offender.
    const poisoned = inject(barrelPath, barrel + '\nexport * from "./replacement-approval.internal";');
    expect(moduleImportOffenders(poisoned, INTENT, INTENT_APPROVED)).toEqual([barrelPath]);
  });
});

// ─── §6 — the scan surface itself (B14.4 adversarial findings, closed) ───────

describe("B14.4 §6 — the walker enumerates every production location", () => {
  // A scratch repository root reproducing each adversarially proven
  // scan-surface bypass: the top-level components/ tree, repository-root
  // Next.js production files, and app-internal route segments whose
  // basenames collide with root-only exclusions.
  const scratchRoot = join(tmpdir(), `b14-4-scan-surface-${process.pid}`);
  const FORBIDDEN = 'import { createReplacementReauthorization } from "@/app/lib/project/replacement-reauthorization";\n';

  beforeAll(() => {
    rmSync(scratchRoot, { recursive: true, force: true });
    for (const dir of [
      "app/api/x", "app/data", "app/public", "app/vendor", "app/artifacts", "components/ui",
      "lib", "scripts", "data", "public", "vendor", "artifacts", "node_modules/pkg", "app/x/__tests__",
    ]) mkdirSync(join(scratchRoot, dir), { recursive: true });
    const plant = (path: string, source = FORBIDDEN): void => writeFileSync(join(scratchRoot, path), source);
    // MUST be enumerated (each was an adversarially proven blind spot):
    plant("components/ui/evil.tsx");
    plant("middleware.ts");
    plant("instrumentation.ts");
    plant("app/data/route.ts");
    plant("app/public/route.ts");
    plant("app/vendor/loader.ts");
    plant("app/artifacts/route.ts");
    plant("app/api/x/route.ts");
    plant("lib/helper.ts");
    plant("scripts/tool.mts");
    // MUST stay excluded (never production source / evidence / assets):
    plant("data/evil.ts");
    plant("public/evil.ts");
    plant("vendor/evil.ts");
    plant("artifacts/evil.ts");
    plant("node_modules/pkg/evil.ts");
    plant("app/x/__tests__/evil.test.ts");
  });
  afterAll(() => rmSync(scratchRoot, { recursive: true, force: true }));

  it("18. components/, repository-root files, and colliding route segments are ENUMERATED; root-only and every-depth exclusions hold", { timeout: 60_000 }, () => {
    const scanned = collectProductionFiles(scratchRoot);
    const keys = [...scanned.keys()].sort();
    expect(keys).toEqual([
      "app/api/x/route.ts",
      "app/artifacts/route.ts",
      "app/data/route.ts",
      "app/public/route.ts",
      "app/vendor/loader.ts",
      "components/ui/evil.tsx",
      "instrumentation.ts",
      "lib/helper.ts",
      "middleware.ts",
      "scripts/tool.mts",
    ]);
  });

  it("19. a forbidden importer in EACH formerly invisible location is now an OFFENDER end-to-end", { timeout: 60_000 }, () => {
    const scanned = collectProductionFiles(scratchRoot);
    const offenders = moduleImportOffenders(scanned, CHANNEL, CHANNEL_APPROVED).sort();
    expect(offenders).toEqual([
      "app/api/x/route.ts",
      "app/artifacts/route.ts",
      "app/data/route.ts",
      "app/public/route.ts",
      "app/vendor/loader.ts",
      "components/ui/evil.tsx",
      "instrumentation.ts",
      "lib/helper.ts",
      "middleware.ts",
      "scripts/tool.mts",
    ]);
  });

  it("20. the REAL tree's newly covered locations are clean (components/, root production files)", { timeout: 60_000 }, () => {
    const coveredComponents = [...files.keys()].filter((key) => key.startsWith("components/"));
    expect(coveredComponents.length).toBeGreaterThan(0); // the tree IS scanned now
    const rootFiles = [...files.keys()].filter((key) => !key.includes("/"));
    expect(rootFiles).toContain("next.config.ts"); // root production files ARE scanned now
    // …and test 1 (real-tree cleanliness) already ran over this widened
    // surface with zero offenders for every capability target.
  });
});
