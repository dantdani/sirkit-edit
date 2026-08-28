/**
 * B15.3 §K42 — AST import/export boundary gates for the PCB approval/apply
 * authority, with NEGATIVE tripwires proving that an agent module, an API
 * route, a gateway, or an arbitrary component can never gain approval or
 * commit authority.
 *
 * Built on the proven B14.4/B14.5 AST engine (`_import-gate-helpers`):
 * TypeScript-parser extraction, resolved specifiers, fail-closed opaque
 * loads, whole-root production walk.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { collectProductionFiles, moduleImportOffenders } from "./_import-gate-helpers";

const files = collectProductionFiles();

const CONTROLLER = "app/lib/project/pcb-edit-approval-controller.internal";
const CONTROLLER_APPROVED = new Set([
  "app/lib/project/pcb-edit-approval-controller.internal.ts",
  "app/components/pcb/PcbEditor.tsx", // the PCB composition root — ONLY UI importer
]);

const INTENT = "app/lib/engineering/pcb-edit-approval.internal";
const INTENT_APPROVED = new Set([
  "app/lib/engineering/pcb-edit-approval.internal.ts",
  "app/lib/engineering/approved-pcb-mutations.ts",
  "app/lib/project/pcb-edit-approval-controller.internal.ts",
]);

const APPLY_SERVICE = "app/lib/engineering/approved-pcb-mutations";
const APPLY_APPROVED = new Set([
  "app/lib/engineering/approved-pcb-mutations.ts",
  "app/lib/project/pcb-edit-approval-controller.internal.ts",
]);

describe("B15.3 §K42 — approval/apply import boundaries", () => {
  it("the controller is importable ONLY by itself and PcbEditor (the PCB composition root)", { timeout: 120_000 }, () => {
    expect(moduleImportOffenders(files, CONTROLLER, CONTROLLER_APPROVED)).toEqual([]);
  });

  it("the one-shot intent module is importable ONLY by itself, the apply service, and the controller", { timeout: 120_000 }, () => {
    expect(moduleImportOffenders(files, INTENT, INTENT_APPROVED)).toEqual([]);
  });

  it("the apply service is importable ONLY by itself and the controller", { timeout: 120_000 }, () => {
    expect(moduleImportOffenders(files, APPLY_SERVICE, APPLY_APPROVED)).toEqual([]);
  });

  it("NEGATIVE tripwires: an API route, an agent module, and an arbitrary component importing the controller/intent/apply ALL trip the gate", { timeout: 120_000 }, () => {
    const injected = new Map(files);
    injected.set("app/api/evil/route.ts", 'import { approveAndApplyPcbEdit } from "@/app/lib/project/pcb-edit-approval-controller.internal";');
    injected.set("app/lib/agent/evil.ts", 'import { applyApprovedPcbProposal } from "../engineering/approved-pcb-mutations";');
    injected.set("app/components/EvilPanel.tsx", 'import { issuePcbEditApprovalIntent } from "@/app/lib/engineering/pcb-edit-approval.internal";');
    expect(moduleImportOffenders(injected, CONTROLLER, CONTROLLER_APPROVED)).toEqual(["app/api/evil/route.ts"]);
    expect(moduleImportOffenders(injected, APPLY_SERVICE, APPLY_APPROVED)).toEqual(["app/lib/agent/evil.ts"]);
    expect(moduleImportOffenders(injected, INTENT, INTENT_APPROVED)).toEqual(["app/components/EvilPanel.tsx"]);
  });
});

describe("B15.3 — commitPcbCandidate is unreachable from providers, routes, gateway, and loop", () => {
  const COMMIT_GATEWAY = "app/lib/engineering/pcb-commit-gateway";

  it("NO module under app/api/ or app/lib/agent/ imports the PCB commit gateway", { timeout: 120_000 }, () => {
    // Approved = every current importer; the assertion is that none of them
    // lives in a provider- or API-reachable layer.
    const importers = [...files.keys()].filter((path) => moduleImportOffenders(new Map([[path, files.get(path)!]]), COMMIT_GATEWAY, new Set()).length > 0);
    expect(importers.length).toBeGreaterThan(0); // sanity: the walker sees the real importers
    const forbidden = importers.filter((path) => path.startsWith("app/api/") || path.startsWith("app/lib/agent/") || path.includes("provider"));
    expect(forbidden).toEqual([]);
  });

  it("NEGATIVE tripwire: an agent-layer commit importer is detected", { timeout: 120_000 }, () => {
    const injected = new Map(files);
    injected.set("app/lib/agent/evil-commit.ts", 'import { commitPcbCandidate } from "../engineering/pcb-commit-gateway";');
    const importers = [...injected.keys()].filter((path) => moduleImportOffenders(new Map([[path, injected.get(path)!]]), COMMIT_GATEWAY, new Set()).length > 0);
    expect(importers).toContain("app/lib/agent/evil-commit.ts");
  });
});

describe("B15.3 §K16 — the review surface never claims safety or manufacturability", () => {
  it("the dialog carries BOTH mandated limitation statements and no prohibited claim", () => {
    const source = readFileSync(resolve(process.cwd(), "app/components/pcb/PcbProposalReviewDialog.tsx"), "utf8");
    expect(source).toContain("Manufacturing readiness is unavailable");
    expect(source).toContain("NOT a guarantee of safety or manufacturability");
    expect(source).not.toMatch(/production[- ]ready/i);
    expect(source).not.toMatch(/ready for (manufactur|production|fabrication)/i);
    expect(source).not.toMatch(/\bmanufacturable\b/i);
    expect(source).not.toMatch(/\bis safe\b|\bsafe to\b/i);
  });

  it("the raw-sealer allowlist did NOT grow: the B15.3 handler calls the service only", () => {
    const handler = readFileSync(resolve(process.cwd(), "app/lib/pcb/proposal/pcb-propose-tool-handler.ts"), "utf8");
    expect(handler).toContain("createSealedPcbEditProposal");
    expect(handler).not.toContain("pcb-edit-proposal-sealer.internal");
    expect(handler).not.toContain("rawSealPcbEditProposal");
  });
});
