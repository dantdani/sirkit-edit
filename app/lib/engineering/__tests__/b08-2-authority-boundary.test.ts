/**
 * B08.2 §1 — UNFORGEABLE PCB composition authority.
 *
 * Independent B08.1 verification confirmed that `authorizeBarePcbHistory`
 * was a public export (editor-adapter → gateway re-export → engineering
 * barrel `export *`): ANY module could mint legacy whole-board mutation
 * authority for an unbound history. B08.2 moves the capability into
 * `pcb-bare-authority.internal.ts` (test-only; no production runtime
 * grantor exists — the repair-agent route is a pure planning pass), splits
 * the refusal taxonomy (`session_retired` vs `canonical_authority_missing`),
 * and pins the import boundary exactly like the B03.2 channel gate.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { produce } from "immer";
import { createEmptyBoard, type PcbBoard } from "../../pcb/types";
import { createHistory } from "../../pcb/history";
import { pcbRevisionId } from "../../pcb/revision";
import * as engineeringBarrel from "../index";
import * as gatewayModule from "../pcb-commit-gateway";
import { commitPcbCandidate } from "../pcb-commit-gateway";
import { applyEditsCanonical, bindCanonicalEditorSession } from "../editor-adapter";
import { authorizeBarePcbHistory, isBareHistoryAuthorized } from "../pcb-bare-authority.internal";
import { PCBToolService } from "../../pcb/ai/pcb-tool-service";
import { getPreset } from "../../pcb/drc/presets";

function boardFixture(): PcbBoard {
  const board = createEmptyBoard();
  board.nets.push({ id: 1, name: "NET1" });
  board.zones = [{ id: "z-b082", layer: "copperTop", netId: 1, polygon: [{ x: 0, y: 0 }, { x: 1_000_000, y: 0 }, { x: 0, y: 1_000_000 }], appearance: "solid", connection: "thermal", fill: [], dirty: true }];
  return board;
}

async function openBound(board = boardFixture()) {
  const history = createHistory(board);
  const bound = bindCanonicalEditorSession(history, { tenantId: "t", projectId: "b082", branchId: "main" }, {});
  await bound.session.whenIdle();
  return { history: bound.history, session: bound.session };
}

describe("B08.2 §1 — no public surface can mint bare-history authority", () => {
  it("1. the engineering barrel and the commit gateway export NO authorization capability (name-scan + exact absence)", () => {
    expect((engineeringBarrel as Record<string, unknown>).authorizeBarePcbHistory).toBeUndefined();
    expect((engineeringBarrel as Record<string, unknown>).isBareHistoryAuthorized).toBeUndefined();
    expect((gatewayModule as Record<string, unknown>).authorizeBarePcbHistory).toBeUndefined();
    // (`authorizeOperations` — the operation-kind authorization CHECK — is
    // a legitimate export; only BARE-history capability names are banned.)
    const grantLike = /bare/i;
    for (const [name] of [...Object.entries(engineeringBarrel), ...Object.entries(gatewayModule)]) {
      expect(grantLike.test(name), `export "${name}" looks like a bare-authority capability`).toBe(false);
    }
  });

  it("2. a bare history stays powerless through everything the public surface offers: gateway and edit funnel refuse with canonical_authority_missing and EXACT zero mutation", async () => {
    const bare = createHistory(boardFixture());
    const before = bare.present;
    const digestBefore = pcbRevisionId(before);
    const refused = await commitPcbCandidate(bare, {
      commandId: "pcb.zone", label: "Forged", buildCandidate: (b) => produce(b, (d) => { d.zones[0].priority = 9; }),
    });
    expect(refused).toMatchObject({ ok: false, status: "rejected", reasonCode: "canonical_authority_missing" });
    if (refused.ok) throw new Error("unreachable");
    expect(refused.diagnostics).toContain("HISTORY_UNAUTHORIZED_BARE");
    const edit = await applyEditsCanonical(bare, [{ op: "set-zone-props" as const, id: "z-b082", patch: { clearanceNm: 250_000 } }]);
    expect(edit.ok).toBe(false);
    expect(edit.errors[0]).toContain("no bare-history capability");
    expect(bare.present).toBe(before);
    expect(pcbRevisionId(bare.present)).toBe(digestBefore);
    expect(bare.entries.length).toBe(0);
    expect(isBareHistoryAuthorized(bare)).toBe(false);
  });

  it("3. the taxonomy is exact: retired (was canonical) ≠ never-bound (no authority) — different reasonCodes, different diagnostics, both zero-mutation", async () => {
    const bound = await openBound();
    bound.session.dispose();
    const before = bound.history.present;
    const retired = await commitPcbCandidate(bound.history, {
      commandId: "pcb.zone", label: "After retirement", buildCandidate: (b) => produce(b, (d) => { d.zones[0].priority = 3; }),
    });
    expect(retired).toMatchObject({ ok: false, status: "rejected", reasonCode: "session_retired" });
    if (retired.ok) throw new Error("unreachable");
    expect(retired.diagnostics).toContain("HISTORY_RETIRED");
    expect(bound.history.present).toBe(before);
    expect(bound.history.entries.length).toBe(0);
    // Retired histories can never be granted bare authority either.
    expect(authorizeBarePcbHistory(bound.history)).toBe(false);
    const retiredEdit = await applyEditsCanonical(bound.history, [{ op: "set-zone-props" as const, id: "z-b082", patch: { clearanceNm: 250_000 } }]);
    expect(retiredEdit.ok).toBe(false);
    expect(retiredEdit.errors[0]).toContain("retired");
    expect(retiredEdit.errors[0]).not.toContain("no bare-history capability");
  });

  it("4. the repair-agent planning composition needs NO mutation authority: planRepairs works on a plain unauthorized bare history and the board stays untouched", async () => {
    const board = createEmptyBoard();
    const history = createHistory(board);
    const service = new PCBToolService({ history, rules: getPreset("jlcpcb-2l").rules });
    const plan = await service.planRepairs("safe_fixes_automatically");
    expect(plan.id).toBeTruthy();
    expect(Array.isArray(plan.fixes)).toBe(true);
    expect(history.present).toBe(board);
    expect(history.entries.length).toBe(0);
    expect(isBareHistoryAuthorized(history)).toBe(false);
    // And the route module itself imports no bare-authority capability.
    const routeSource = readFileSync(join(process.cwd(), "app/api/pcb/repair/agent/route.ts"), "utf8");
    expect(routeSource).not.toContain("authorizeBarePcbHistory(");
    expect(routeSource).not.toContain("pcb-bare-authority.internal");
  });

  it("5. import-boundary gate: no production file outside the approved composition boundary touches pcb-bare-authority.internal", () => {
    // Approved importers (production code): the adapter + gateway CHECK the
    // capability; select-move's legacy branches check it; the internal
    // module defines it. NOTHING in production GRANTS it.
    const approved = new Set([
      "app/lib/engineering/editor-adapter.ts",
      "app/lib/engineering/pcb-commit-gateway.ts",
      "app/lib/engineering/pcb-bare-authority.internal.ts",
      "app/lib/pcb/tools/select-move.ts",
    ]);
    const roots = ["app", "lib", "components"];
    const cwd = process.cwd();
    const offenders: string[] = [];
    const granters: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name === "__tests__" || entry.name === ".next") continue;
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) continue;
        const rel = relative(cwd, full).split(sep).join("/");
        const source = readFileSync(full, "utf8");
        if (source.includes("pcb-bare-authority.internal") && !approved.has(rel)) offenders.push(rel);
        // The GRANT call itself is test-only: no production module may call
        // it (the internal module merely defines it).
        if (rel !== "app/lib/engineering/pcb-bare-authority.internal.ts" && source.includes("authorizeBarePcbHistory(")) granters.push(rel);
      }
    };
    for (const root of roots) {
      try { walk(join(cwd, root)); } catch { /* root may not exist */ }
    }
    expect(offenders, `unapproved capability imports: ${offenders.join(", ")}`).toEqual([]);
    expect(granters, `production grant calls: ${granters.join(", ")}`).toEqual([]);
  });
});
