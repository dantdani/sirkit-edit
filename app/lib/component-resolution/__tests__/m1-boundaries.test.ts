/**
 * [PR-M, 2026-10-17] Section M increment 1 - the capability boundaries of the resolution apply, AST-proven with the B14.4 gate
 * helpers (comments, formatting, escaped or concatenated specifiers cannot hide an import; opaque loads fail closed elsewhere).
 *
 *  - the one-shot human approval intent (resolution-approval.internal.ts) and the one-shot fresh-facts channel
 *    (resolution-reauthorization.ts) are reached in production ONLY by the approved-resolution service and - [PR-M, 2026-10-18]
 *    reviewed move of both sets: the page intake landed - the page's review controller (app/lib/project/resolution-approval-
 *    controller.internal.ts), which mints the intent on the human's Approve and builds the PRODUCTION channel;
 *  - the apply service itself is imported ONLY by that controller ([PR-M, 2026-10-18] reviewed move: was "by no production module
 *    yet"), and the controller ONLY by the trusted UI composition root (app/page.tsx); the production channel factory is named only by
 *    the controller (no provider-, route- or registry-side path to any of them exists);
 *  - the test-only channel factory is referenced by no production file;
 *  - the agent layer and the API routes never reach any of the three, and the internal authority module is reached in this
 *    directory only by the resolution assembler (B06.1's approved set names it).
 */
import { describe, expect, it } from "vitest";
import { collectProductionFiles, identifierReferences, moduleImportOffenders } from "@/app/lib/project/__tests__/_import-gate-helpers";

const files = collectProductionFiles();
const INTENT = "app/lib/component-resolution/resolution-approval.internal";
const CHANNEL = "app/lib/component-resolution/resolution-reauthorization";
const SERVICE = "app/lib/component-resolution/approved-resolution-mutations";
const AUTHORITY = "app/lib/engineering/schematic-authority.internal";
const CONTROLLER = "app/lib/project/resolution-approval-controller.internal";
const CONTROLLER_FILE = `${CONTROLLER}.ts`;

describe("[PR-M] the resolution apply's capability boundaries", () => {
  it("1. the approval intent and the fresh-facts channel are reached only by the approved-resolution service", { timeout: 120_000 }, async () => {
    expect(moduleImportOffenders(files, INTENT, new Set(["app/lib/component-resolution/resolution-approval.internal.ts", "app/lib/component-resolution/approved-resolution-mutations.ts", CONTROLLER_FILE]))).toEqual([]); // [PR-M, 2026-10-18] reviewed move: + the page's review controller (it mints the intent on the human's Approve)
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(moduleImportOffenders(files, CHANNEL, new Set(["app/lib/component-resolution/resolution-reauthorization.ts", "app/lib/component-resolution/approved-resolution-mutations.ts", CONTROLLER_FILE]))).toEqual([]); // [PR-M, 2026-10-18] reviewed move: + the page's review controller (it builds the production channel)
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(identifierReferences(files, "__createTestResolutionReauthorizationChannel", new Set(["app/lib/component-resolution/resolution-reauthorization.ts"]))).toEqual([]);
  });

  it("2. only the page's controller imports the apply service and only the page imports the controller; no agent or API module reaches the intent, the channel, the service or the controller", { timeout: 120_000 }, async () => {
    expect(moduleImportOffenders(files, SERVICE, new Set(["app/lib/component-resolution/approved-resolution-mutations.ts", CONTROLLER_FILE]))).toEqual([]); // [PR-M, 2026-10-18] reviewed move: was the service alone ("no production module imports it yet"); the page intake's controller is its one caller
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(moduleImportOffenders(files, CONTROLLER, new Set([CONTROLLER_FILE, "app/page.tsx"]))).toEqual([]); // [PR-M, 2026-10-18] the trusted UI composition root only (the B14.2 section D rule for the replacement controller)
    expect(identifierReferences(files, "createResolutionReauthorization", new Set(["app/lib/component-resolution/resolution-reauthorization.ts", CONTROLLER_FILE]))).toEqual([]); // [PR-M, 2026-10-18] the production channel factory: the controller only
    await new Promise<void>((resolve) => setImmediate(resolve));
    const agentOrApi = new Map([...files].filter(([path]) => path.startsWith("app/lib/agent/") || path.startsWith("app/api/") || path === "app/lib/engineering/tool-catalog.ts" || path === "app/lib/engineering/tool-registry.ts"));
    for (const target of [INTENT, CHANNEL, SERVICE, CONTROLLER]) expect(moduleImportOffenders(agentOrApi, target, new Set()), target).toEqual([]);
  });

  it("3. inside the resolution modules only the assembler reaches the internal authority module (it consumes catalog resolution authority)", () => {
    const resolution = new Map([...files].filter(([path]) => path.startsWith("app/lib/component-resolution/")));
    expect(moduleImportOffenders(resolution, AUTHORITY, new Set(["app/lib/component-resolution/resolution-assembler.ts"]))).toEqual([]);
    expect(resolution.get("app/lib/component-resolution/resolution-assembler.ts")).toContain("consumeCatalogResolutionAuthority");
  });
});
