/**
 * [B21 A] The orchestration import gate (AST, through the B14.4 helpers and the B20-D3 prefix-family pattern): no module under
 * `app/lib/agent/orchestration/` reaches, through its whole runtime import closure, the grant tree, membership reauthorization,
 * an approval controller or journal, `app/lib/pcb/fab/`, the executor, the build-multi route, the build loop, a provider SDK or
 * anything under `app/api/`; the nine B11-scanned files import nothing under orchestration and carry no orchestration
 * identifier (D21-27, OD-113). A type-only import is erased at run time and is deliberately NOT caught. Every probe of the
 * tripwire cases is an injected in-memory file, never a file on disk.
 */
import { describe, expect, it } from "vitest";
import { collectProductionFiles, moduleReferences, opaqueModuleLoads, requireShadowDeclarations, resolveSpecifier, rootEscapingImports, sourceParseDiagnostics, type FileMap } from "@/app/lib/project/__tests__/_import-gate-helpers";
import { importClosure, runtimeDeclarationSpecifiers } from "@/app/lib/mcp/server/__tests__/_import-closure";
import { B11_SCANNED_FILES, ORCHESTRATION_IDENTIFIER_PATTERN, ORCHESTRATION_MODULE_PREFIX } from "../tripwires";

const ROOT = process.cwd();
const production = collectProductionFiles(ROOT);
const entriesOf = (files: FileMap): string[] => [...files.keys()].filter((path) => path.startsWith(ORCHESTRATION_MODULE_PREFIX)).sort();

/** every family by PREFIX (B20-D3's reason: an exact list is complete only today); the two single files by exact path */
const GRANTS_PREFIX = "app/lib/execution-grant/";
const REAUTH_PREFIX = "app/lib/project/membership-reauthorization";
const APPROVAL_PREFIXES = ["app/lib/engineering/approved-", "app/lib/engineering/agent-execution-journal"];
const RELEASE_PREFIX = "app/lib/pcb/fab/";
const EXECUTOR = "app/lib/engineering/executor.ts";
const BUILD_MULTI_PREFIX = "app/api/schematic/build-multi/";
const BUILD_LOOP = "app/lib/build-loop.ts";
const API_PREFIX = "app/api/";
/** [B20 A5] the provider SDK specifiers, matched on the bare specifier the closure walk never follows */
const SDK_SPECIFIER = /^(?:openai|@anthropic-ai\/sdk)(?:\/.*)?$/;

type Family = "GRANTS" | "REAUTH" | "APPROVALS" | "RELEASE" | "EXECUTOR" | "BUILD_MULTI" | "BUILD_LOOP" | "API";
function familyOf(path: string): Family | null {
  if (path.startsWith(GRANTS_PREFIX) && !path.includes("/__tests__/")) return "GRANTS";
  if (path.startsWith(REAUTH_PREFIX)) return "REAUTH";
  if (APPROVAL_PREFIXES.some((prefix) => path.startsWith(prefix))) return "APPROVALS";
  if (path.startsWith(RELEASE_PREFIX)) return "RELEASE"; // no preset exemption: no orchestration module consumes a fab preset
  if (path === EXECUTOR) return "EXECUTOR";
  if (path.startsWith(BUILD_MULTI_PREFIX)) return "BUILD_MULTI"; // before API: the build-multi route is under app/api/ (OD-106)
  if (path === BUILD_LOOP) return "BUILD_LOOP";
  if (path.startsWith(API_PREFIX)) return "API";
  return null;
}
/** every closure member of a forbidden family, as its family and the chain that reaches it */
function familiesReached(closure: ReadonlyMap<string, readonly string[]>): string[] {
  return [...closure].flatMap(([file, chain]) => { const family = familyOf(file); return family === null ? [] : [`${family}: ${chain.join(" -> ")}`]; });
}
/** every provider-SDK specifier a closure member imports for its VALUE (a type-only declaration is erased at run time) */
function sdkReached(files: FileMap, closure: ReadonlyMap<string, readonly string[]>): string[] {
  const found: string[] = [];
  for (const [file, chain] of closure) {
    const source = files.get(file)!;
    const runtime = runtimeDeclarationSpecifiers(file, source);
    for (const reference of moduleReferences(file, source)) {
      if (reference.kind === "import-type") continue;
      if ((reference.kind === "static-import" || reference.kind === "re-export") && !runtime.has(reference.specifier)) continue;
      if (SDK_SPECIFIER.test(reference.specifier)) found.push(`SDK: ${chain.join(" -> ")} -> ${reference.specifier}`);
    }
  }
  return found;
}
const walk = (files: FileMap, entries: readonly string[]): string[] => { const closure = importClosure(files, entries); return [...familiesReached(closure), ...sdkReached(files, closure)]; };
/** the orchestration modules a scanned file references, by any reference kind - a type-only import counts here */
function orchestrationReferences(path: string, source: string): string[] {
  return moduleReferences(path, source).flatMap((reference) => { const resolution = resolveSpecifier(path, reference.specifier); return resolution.kind === "module" && `${resolution.module}.ts`.startsWith(ORCHESTRATION_MODULE_PREFIX) ? [`${reference.kind} ${reference.specifier}`] : []; });
}

describe("[B21 A] the orchestration import gate", () => {
  it("1. the entry set is DERIVED from the tree and pinned to the modules of the chapter (A's three, B's router and scheduler); every forbidden family resolves to real files today, so no case below is vacuous; the nine scanned files exist; the provider SDK importers of the whole tree are the five recorded ones", { timeout: 180_000 }, () => {
    // [B21 B] + router.ts and scheduler.ts; app/api/chat/orchestration-runtime.ts lives OUTSIDE the prefix by design (it binds the durable runtime)
    expect(entriesOf(production)).toEqual(["app/lib/agent/orchestration/contracts.ts", "app/lib/agent/orchestration/router.ts", "app/lib/agent/orchestration/scheduler.ts", "app/lib/agent/orchestration/store.ts", "app/lib/agent/orchestration/tripwires.ts"]);
    expect(production.has("app/api/chat/orchestration-runtime.ts")).toBe(true);
    const members = (family: Family): string[] => [...production.keys()].filter((path) => familyOf(path) === family).sort();
    expect(members("GRANTS")).toEqual(["app/lib/execution-grant/consume.ts", "app/lib/execution-grant/mint.ts", "app/lib/execution-grant/route-contract.ts", "app/lib/execution-grant/settle.ts", "app/lib/execution-grant/store.ts"]);
    expect(members("REAUTH")).toEqual(["app/lib/project/membership-reauthorization.ts"]);
    expect(members("APPROVALS")).toHaveLength(9);
    expect(members("RELEASE").length).toBeGreaterThanOrEqual(5);
    expect(members("RELEASE")).toContain("app/lib/pcb/fab/presets/index.ts");
    expect(members("EXECUTOR")).toEqual([EXECUTOR]);
    expect(members("BUILD_MULTI")).toEqual(["app/api/schematic/build-multi/route.ts"]);
    expect(members("BUILD_LOOP")).toEqual([BUILD_LOOP]);
    expect(members("API").length).toBeGreaterThan(100);
    expect(members("API")).toContain("app/api/chat/route.ts");
    expect(B11_SCANNED_FILES).toHaveLength(9);
    for (const file of B11_SCANNED_FILES) { expect(file.startsWith("app/lib/agent/")).toBe(true); expect(production.has(file), file).toBe(true); }
    expect(B11_SCANNED_FILES.some((file) => file.startsWith(ORCHESTRATION_MODULE_PREFIX))).toBe(false);
    // RECORDED for this base: where a provider SDK is imported at all (the D21-32 chain runs through app/lib/embeddings.ts)
    const importers = [...production].filter(([path, source]) => moduleReferences(path, source).some((reference) => SDK_SPECIFIER.test(reference.specifier))).map(([path]) => path).sort();
    expect(importers).toEqual(["app/lib/agent/adapters.ts", "app/lib/embeddings.ts", "app/lib/llm/anthropic-provider.ts", "app/lib/llm/openai-provider.ts", "app/lib/parts-search.ts"]);
  });

  it("2. the whole runtime import closure of every orchestration module reaches no forbidden family and imports no provider SDK; the walk is not vacuous (it holds the digest, capture, redaction, exposure and durable-stable modules) and never enters the durable runtime, the database client or the schema", { timeout: 180_000 }, () => {
    const entries = entriesOf(production);
    const closure = importClosure(production, entries);
    expect(closure.size).toBeGreaterThan(8);
    for (const member of ["app/lib/engineering/stable.ts", "app/lib/agent/plain-capture.ts", "app/lib/agent/redaction.ts", "app/lib/engineering/agent-exposure.ts", "app/lib/engineering/granted-execution-families.ts", "app/lib/durable-workflow/stable.ts"]) expect(closure.has(member), member).toBe(true);
    expect(walk(production, entries)).toEqual([]);
    for (const never of ["app/lib/durable-workflow/runtime.ts", "app/lib/durable-workflow/server-repository.ts", "app/lib/durable-workflow/repository.ts", "app/lib/db/client.ts", "app/lib/db/schema.ts", "app/lib/embeddings.ts", "app/lib/agent/loop.ts", "app/lib/agent/gateway.ts", "app/lib/agent/adapters.ts"]) expect(closure.has(never), never).toBe(false);
    // the contracts alone touch no durable module at all
    const contracts = importClosure(production, ["app/lib/agent/orchestration/contracts.ts"]);
    expect([...contracts.keys()].filter((path) => path.startsWith("app/lib/durable-workflow/"))).toEqual([]);
  });

  it("3. negative tripwires, each caught with its family and chain from an INJECTED in-memory probe: a grant module (one that exists and one the prefix catches before it is written), reauthorization, an approval controller and an -idb journal, the fab PRESET data (no exemption here), the executor, the build-multi route (its own family, not merely app/api), the build loop, a chat route module, a provider SDK by static import, dynamic import, require and re-export, the durable RUNTIME (whose production path reaches the OpenAI SDK through the database schema - D21-32), a two-hop bridge, a re-export, a case-variant specifier and a bare side-effect import - and a TYPE-ONLY import is not caught", { timeout: 180_000 }, () => {
    const injected = new Map(production);
    const at = (name: string): string => `${ORCHESTRATION_MODULE_PREFIX}${name}.ts`;
    injected.set("app/lib/execution-grant/authorize.ts", 'export const authorize = (): string => "b21-probe";');
    const probes: Record<string, [source: string, expected: string | null]> = {
      "evil-grant": ['import * as mint from "../../execution-grant/mint";\nexport const x = mint;', "GRANTS: {self} -> app/lib/execution-grant/mint.ts"],
      "evil-grant-new": ['import { authorize } from "../../execution-grant/authorize";\nexport const x = authorize;', "GRANTS: {self} -> app/lib/execution-grant/authorize.ts"],
      "evil-reauth": ['import * as reauth from "@/app/lib/project/membership-reauthorization";\nexport const x = reauth;', "REAUTH: {self} -> app/lib/project/membership-reauthorization.ts"],
      "evil-approval": ['import { approvedPcbMutations } from "../../engineering/approved-pcb-mutations";\nexport const x = approvedPcbMutations;', "APPROVALS: {self} -> app/lib/engineering/approved-pcb-mutations.ts"],
      "evil-idb": ['import * as journal from "../../engineering/agent-execution-journal-idb";\nexport const x = journal;', "APPROVALS: {self} -> app/lib/engineering/agent-execution-journal-idb.ts"],
      "evil-preset": ['import * as presets from "../../pcb/fab/presets";\nexport const x = presets;', "RELEASE: {self} -> app/lib/pcb/fab/presets/index.ts"],
      "evil-executor": ['import * as executor from "../../engineering/executor";\nexport const x = executor;', "EXECUTOR: {self} -> app/lib/engineering/executor.ts"],
      "evil-build-multi": ['import * as multi from "@/app/api/schematic/build-multi/route";\nexport const x = multi;', "BUILD_MULTI: {self} -> app/api/schematic/build-multi/route.ts"],
      "evil-build-loop": ['import { runBuildToolLoop } from "../../build-loop";\nexport const x = runBuildToolLoop;', "BUILD_LOOP: {self} -> app/lib/build-loop.ts"],
      "evil-api": ['import * as chat from "@/app/api/chat/route";\nexport const x = chat;', "API: {self} -> app/api/chat/route.ts"],
      "evil-sdk-static": ['import OpenAI from "openai";\nexport const x = OpenAI;', "SDK: {self} -> openai"],
      "evil-sdk-dynamic": ['export const load = () => import("@anthropic-ai/sdk");', "SDK: {self} -> @anthropic-ai/sdk"],
      "evil-sdk-require": ['const sdk = require("openai/resources");\nexport const x = sdk;', "SDK: {self} -> openai/resources"],
      "evil-sdk-reexport": ['export { default } from "@anthropic-ai/sdk";', "SDK: {self} -> @anthropic-ai/sdk"],
      "evil-hop": ['import { bridge } from "./evil-bridge-b21-fixture";\nexport const x = bridge;', "APPROVALS: {self} -> app/lib/agent/orchestration/evil-bridge-b21-fixture.ts -> app/lib/engineering/approved-replacement-mutations.ts"],
      "evil-bridge-b21-fixture": ['export * from "../../engineering/approved-replacement-mutations";', null],
      "evil-reexport": ['export * from "../../execution-grant/settle";', "GRANTS: {self} -> app/lib/execution-grant/settle.ts"],
      "evil-case": ['import * as approvals from "../../engineering/Approved-Pcb-Mutations";\nexport const x = approvals;', "APPROVALS: {self} -> app/lib/engineering/approved-pcb-mutations.ts"],
      "evil-side-effect": ['import "@/app/lib/execution-grant/settle";', "GRANTS: {self} -> app/lib/execution-grant/settle.ts"],
    };
    for (const [name, [source]] of Object.entries(probes)) injected.set(at(name), source);
    for (const [name, [, expected]] of Object.entries(probes)) {
      if (expected === null) continue;
      const caught = walk(injected, [at(name)]);
      expect(caught[0], name).toBe(expected.replaceAll("{self}", at(name)));
    }
    // the durable runtime: a REAL module, caught by the SDK check with the chain that explains why store.ts injects its repository
    injected.set(at("evil-runtime"), 'import { getDurableWorkflowRepository } from "../../durable-workflow/runtime";\nexport const x = getDurableWorkflowRepository;');
    const runtime = walk(injected, [at("evil-runtime")]);
    expect(runtime).toContain(`SDK: ${at("evil-runtime")} -> app/lib/durable-workflow/runtime.ts -> app/lib/durable-workflow/server-repository.ts -> app/lib/db/schema.ts -> app/lib/embeddings.ts -> openai`);
    // a type-only import is erased at run time and is deliberately NOT caught (a value import of the same module is, above)
    injected.set(at("types-only"), 'import type { ExecutionGrantStore } from "../../execution-grant/store";\nimport { type Response } from "openai/resources/responses/responses";\nexport type T = [ExecutionGrantStore, Response];');
    expect(walk(injected, [at("types-only")])).toEqual([]);
    // [B21 B] the loop's own closure reaches the fab presets (RELEASE, no exemption here) through the read bindings, so an
    // orchestration module may never import `runAgentLoop` / `buildRunToolset`: the scheduler takes both by INJECTION from the
    // composition root (app/api/chat/orchestration-runtime.ts, outside the prefix). A type-only import of the loop's types is erased.
    injected.set(at("evil-loop"), 'import { runAgentLoop } from "../loop";\nexport const x = runAgentLoop;');
    // [review] the INVARIANT is pinned (a value import of the loop is caught, through the loop, by a family), never the exact
    // hops below the loop: an unrelated refactor of the read bindings or the snapshot must not fail the orchestration gate.
    // The chain as measured today is recorded on the page (D21-33), not here.
    // [B21 B lead] neither the count of caught members nor the reachability itself is pinned (the loop may stop reaching a family,
    // or reach two files of one, without any orchestration module changing): every caught line runs through the loop, by a family
    const loopCaught = walk(injected, [at("evil-loop")]);
    const throughLoop = new RegExp(`^(?:RELEASE|GRANTS|REAUTH|APPROVALS|EXECUTOR|BUILD_MULTI|BUILD_LOOP|API|SDK): ${at("evil-loop").replaceAll(".", "\\.")} -> app/lib/agent/loop\\.ts -> `);
    for (const line of loopCaught) expect(line).toMatch(throughLoop);
    injected.set(at("loop-types-only"), 'import type { AgentLoopDeps } from "../loop";\nexport type T = AgentLoopDeps;');
    expect(walk(injected, [at("loop-types-only")])).toEqual([]);
    // [B21 B] the runtime file is outside the prefix and DOES bind the durable runtime (the D21-32 chain), which is its job
    const runtimeClosure = importClosure(production, ["app/api/chat/orchestration-runtime.ts"]);
    expect(runtimeClosure.has("app/lib/durable-workflow/runtime.ts")).toBe(true);
    expect(runtimeClosure.has("app/lib/agent/orchestration/scheduler.ts")).toBe(true);
    expect(runtimeClosure.has("app/lib/agent/orchestration/router.ts")).toBe(true);
    expect(runtimeClosure.has("app/lib/agent/orchestration/store.ts")).toBe(true);
    // the injected probes never touched the disk: the production entry set is unchanged
    expect(entriesOf(production)).toHaveLength(5);
  });

  it("4. the nine B11-scanned files import nothing under app/lib/agent/orchestration/ by ANY reference kind (a type-only import counts here) and carry no orchestration identifier; an injected copy with an orchestration value import, a type-only import or the identifier text appended is caught; tripwires.ts is the only orchestration module that names those files", { timeout: 180_000 }, () => {
    for (const file of B11_SCANNED_FILES) {
      const source = production.get(file)!;
      expect(orchestrationReferences(file, source), file).toEqual([]);
      expect(source, file).not.toMatch(ORCHESTRATION_IDENTIFIER_PATTERN);
    }
    const trace = "app/lib/agent/trace.ts";
    const base = production.get(trace)!;
    expect(orchestrationReferences(trace, `${base}\nimport { SPECIALIST_ROLES } from "./orchestration/contracts";\nexport const probe = SPECIALIST_ROLES;\n`)).toEqual(["static-import ./orchestration/contracts"]);
    expect(orchestrationReferences(trace, `${base}\nimport type { SpecialistRole } from "./orchestration/contracts";\nexport type Probe = SpecialistRole;\n`)).toEqual(["static-import ./orchestration/contracts"]);
    expect(orchestrationReferences(trace, `${base}\nexport const load = () => import("@/app/lib/agent/orchestration/store");\n`)).toEqual(["dynamic-import @/app/lib/agent/orchestration/store"]);
    expect(orchestrationReferences(trace, `${base}\nexport type Probe = import("./orchestration/contracts").SpecialistRole;\n`)).toEqual(["import-type ./orchestration/contracts"]);
    for (const text of ["specialistRole", "Orchestration plan", "the coordinator", "spawnAgent(", "multiAgent"]) expect(`${base}\n// ${text}\n`).toMatch(ORCHESTRATION_IDENTIFIER_PATTERN);
    const basenames = B11_SCANNED_FILES.map((file) => file.slice(file.lastIndexOf("/") + 1));
    for (const orchestrationModule of entriesOf(production).filter((path) => path !== `${ORCHESTRATION_MODULE_PREFIX}tripwires.ts`)) {
      for (const basename of basenames) expect(production.get(orchestrationModule)!.includes(basename), `${orchestrationModule} names ${basename}`).toBe(false);
    }
    expect(B11_SCANNED_FILES.every((file) => production.get(`${ORCHESTRATION_MODULE_PREFIX}tripwires.ts`)!.includes(file))).toBe(true);
  });

  it("5. hygiene over the orchestration modules: no opaque module load, no declaration shadowing the loader, no root-escaping import, zero parse diagnostics, and every import is a static string the gate can resolve", { timeout: 180_000 }, () => {
    const scoped = new Map([...production].filter(([path]) => path.startsWith(ORCHESTRATION_MODULE_PREFIX)));
    expect(scoped.size).toBe(5); // [B21 B] + router.ts, scheduler.ts
    expect(opaqueModuleLoads(scoped)).toEqual([]);
    expect(requireShadowDeclarations(scoped)).toEqual([]);
    expect(rootEscapingImports(scoped)).toEqual([]);
    expect(sourceParseDiagnostics(scoped)).toEqual([]);
    for (const [path, source] of scoped) for (const reference of moduleReferences(path, source)) expect(["static-import", "re-export"], `${path}: ${reference.kind}`).toContain(reference.kind);
  });
});
