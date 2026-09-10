/**
 * [B18-B] AST import boundary gates for the execution-grant authority, with
 * NEGATIVE tripwires — built on the proven B14.4/B14.5 engine
 * (`_import-gate-helpers`: TypeScript-parser extraction, resolved specifiers,
 * fail-closed opaque loads, whole-root production walk).
 *
 *  - the server authority (store / mint / consume / settle) is reachable ONLY
 *    from the `/api/chat` composition root and the two grant routes — never
 *    from app/lib/agent, app/lib/llm, model simulation, providers or the
 *    gateway (the agent layer sees a closure, never the minter module);
 *  - the browser ritual is reachable ONLY through the trusted controller,
 *    which only `PcbEditor` (the PCB composition root) imports;
 *  - the ritual never imports the B15.3 apply service (its importer set is
 *    pinned elsewhere) nor the commit gateway;
 *  - the confirmation surface never claims safety or manufacturability.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { collectProductionFiles, moduleImportOffenders } from "./_import-gate-helpers";

const files = collectProductionFiles();

const STORE = "app/lib/execution-grant/store";
const STORE_APPROVED = new Set([
  "app/lib/execution-grant/store.ts",
  "app/lib/execution-grant/mint.ts",
  "app/lib/execution-grant/consume.ts",
  "app/lib/execution-grant/settle.ts",
  "app/api/agent/execution-grant/route.ts",
  "app/api/agent/execution-grant/settle/route.ts",
]);
const MINT = "app/lib/execution-grant/mint";
const MINT_APPROVED = new Set(["app/lib/execution-grant/mint.ts", "app/api/chat/route.ts"]);
const CONSUME = "app/lib/execution-grant/consume";
const CONSUME_APPROVED = new Set(["app/lib/execution-grant/consume.ts", "app/api/agent/execution-grant/route.ts"]);
const SETTLE = "app/lib/execution-grant/settle";
const SETTLE_APPROVED = new Set(["app/lib/execution-grant/settle.ts", "app/api/agent/execution-grant/settle/route.ts"]);

const CONTROLLER = "app/lib/project/granted-execution-controller.internal";
const CONTROLLER_APPROVED = new Set(["app/lib/project/granted-execution-controller.internal.ts", "app/components/pcb/PcbEditor.tsx"]);
const RITUAL = "app/lib/engineering/granted-executions";
const RITUAL_APPROVED = new Set(["app/lib/engineering/granted-executions.ts", "app/lib/project/granted-execution-controller.internal.ts"]);
const CLIENT = "app/lib/project/execution-grant-client";
const CLIENT_APPROVED = new Set(["app/lib/project/execution-grant-client.ts", "app/lib/project/granted-execution-controller.internal.ts", "app/lib/engineering/granted-executions.ts"]);
const JOURNAL = "app/lib/engineering/agent-execution-journal";
const JOURNAL_APPROVED = new Set(["app/lib/engineering/agent-execution-journal.ts", "app/lib/engineering/agent-execution-journal-idb.ts", "app/lib/engineering/granted-executions.ts", "app/components/pcb/PcbEditor.tsx"]);

const importersOf = (map: Map<string, string>, target: string): string[] => [...map.keys()].filter((path) => moduleImportOffenders(new Map([[path, map.get(path)!]]), target, new Set()).length > 0);

describe("B18-B §7.4 — the server authority is reachable only from the composition roots", () => {
  it("store / mint / consume / settle each have their exact approved importer set", { timeout: 120_000 }, () => {
    expect(moduleImportOffenders(files, STORE, STORE_APPROVED)).toEqual([]);
    expect(moduleImportOffenders(files, MINT, MINT_APPROVED)).toEqual([]);
    expect(moduleImportOffenders(files, CONSUME, CONSUME_APPROVED)).toEqual([]);
    expect(moduleImportOffenders(files, SETTLE, SETTLE_APPROVED)).toEqual([]);
    // sanity: the walker sees the real importers
    expect(importersOf(files, MINT)).toContain("app/api/chat/route.ts");
    expect(importersOf(files, CONSUME)).toContain("app/api/agent/execution-grant/route.ts");
  });

  it("NOTHING under app/lib/agent, app/lib/llm, app/lib/model-simulation or a provider/gateway path imports the execution-grant authority", { timeout: 120_000 }, () => {
    const layered = [...files.keys()].filter((path) => path.startsWith("app/lib/agent/") || path.startsWith("app/lib/llm/") || path.startsWith("app/lib/model-simulation/") || /provider|gateway/.test(path));
    expect(layered.length).toBeGreaterThan(10);
    for (const target of [STORE, MINT, CONSUME, SETTLE]) {
      const offenders = layered.filter((path) => moduleImportOffenders(new Map([[path, files.get(path)!]]), target, new Set()).length > 0);
      expect(offenders, target).toEqual([]);
    }
  });

  it("NEGATIVE tripwires: an agent module, a provider module and an arbitrary route importing the authority ALL trip the gate", { timeout: 120_000 }, () => {
    const injected = new Map(files);
    injected.set("app/lib/agent/evil-mint.ts", 'import { createExecutionGrantMinter } from "../execution-grant/mint";');
    injected.set("app/lib/llm/providers/evil-store.ts", 'import { resolveExecutionGrantStore } from "@/app/lib/execution-grant/store";');
    injected.set("app/api/evil/route.ts", 'import { consumeExecutionGrant } from "@/app/lib/execution-grant/consume";');
    expect(moduleImportOffenders(injected, MINT, MINT_APPROVED)).toEqual(["app/lib/agent/evil-mint.ts"]);
    expect(moduleImportOffenders(injected, STORE, STORE_APPROVED)).toEqual(["app/lib/llm/providers/evil-store.ts"]);
    expect(moduleImportOffenders(injected, CONSUME, CONSUME_APPROVED)).toEqual(["app/api/evil/route.ts"]);
  });
});

describe("B18-B §7.4 — the browser ritual is reachable only through the trusted controller", () => {
  it("controller ← PcbEditor only; ritual ← controller only; transport ← controller + ritual; journal ← ritual, its store and PcbEditor", { timeout: 120_000 }, () => {
    expect(moduleImportOffenders(files, CONTROLLER, CONTROLLER_APPROVED)).toEqual([]);
    expect(moduleImportOffenders(files, RITUAL, RITUAL_APPROVED)).toEqual([]);
    expect(moduleImportOffenders(files, CLIENT, CLIENT_APPROVED)).toEqual([]);
    expect(moduleImportOffenders(files, JOURNAL, JOURNAL_APPROVED)).toEqual([]);
    expect(importersOf(files, CONTROLLER)).toContain("app/components/pcb/PcbEditor.tsx");
  });

  it("the ritual never imports the B15.3 apply service or the PCB commit gateway (their importer sets are pinned elsewhere)", () => {
    // Import SPECIFIERS only (the module's header prose names the B15.3 service it deliberately does not import).
    const source = readFileSync(resolve(process.cwd(), "app/lib/engineering/granted-executions.ts"), "utf8");
    const specifiers = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]!);
    expect(specifiers.some((specifier) => specifier.includes("approved-pcb-mutations"))).toBe(false);
    expect(specifiers.some((specifier) => specifier.includes("pcb-commit-gateway"))).toBe(false);
    expect(specifiers.some((specifier) => specifier.includes("pcb-edit-approval"))).toBe(false);
    expect(importersOf(files, "app/lib/engineering/approved-pcb-mutations")).not.toContain("app/lib/engineering/granted-executions.ts");
  });

  it("NEGATIVE tripwires: an API route, an agent module and an arbitrary component importing the controller / ritual / transport ALL trip the gate", { timeout: 120_000 }, () => {
    const injected = new Map(files);
    injected.set("app/api/evil/route.ts", 'import { tenderExplicitExecution } from "@/app/lib/project/granted-execution-controller.internal";');
    injected.set("app/lib/agent/evil-ritual.ts", 'import { executeGrantedOperation } from "../engineering/granted-executions";');
    injected.set("app/components/EvilPanel.tsx", 'import { createExecutionGrantTransport } from "@/app/lib/project/execution-grant-client";');
    expect(moduleImportOffenders(injected, CONTROLLER, CONTROLLER_APPROVED)).toEqual(["app/api/evil/route.ts"]);
    expect(moduleImportOffenders(injected, RITUAL, RITUAL_APPROVED)).toEqual(["app/lib/agent/evil-ritual.ts"]);
    expect(moduleImportOffenders(injected, CLIENT, CLIENT_APPROVED)).toEqual(["app/components/EvilPanel.tsx"]);
  });
});

describe("B18-B — the confirmation surface never claims safety or manufacturability", () => {
  it("the dialog states that nothing has changed and carries no prohibited claim", () => {
    const source = readFileSync(resolve(process.cwd(), "app/components/pcb/GrantedExecutionDialog.tsx"), "utf8");
    expect(source).toContain("Nothing has been changed yet");
    expect(source).toContain("exactly ONE canonical PCB transaction");
    expect(source).not.toMatch(/production[- ]ready/i);
    expect(source).not.toMatch(/ready for (manufactur|production|fabrication)/i);
    expect(source).not.toMatch(/\bmanufacturable\b/i);
    expect(source).not.toMatch(/\bis safe\b|\bsafe to\b/i);
  });
});
