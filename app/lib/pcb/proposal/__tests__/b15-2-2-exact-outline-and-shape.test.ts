/**
 * B15.2.2 — true roundrect containment and complete proposal-shape
 * validation. R22 and R23 are permanent fail-closed regressions, plus the
 * standing seal-import-allowlist assertion.
 */

import { describe, expect, it } from "vitest";
import { createEmptyBoard } from "../../types";
import type { PcbBoard } from "../../types";
import { getPreset, DEFAULT_PRESET_ID } from "../../drc/presets";
import { pointInOutline } from "../../autoplace/geometry";
import {
  pointInExactOutline,
  segmentInExactOutline,
  type ExactOutline,
} from "../../geometry-exact";
import { compileBoundedPcbEdit } from "../bounded-edit-compiler";
import { createSealedPcbEditProposal } from "../pcb-edit-proposal-service";
import { PCB_EDIT_PROPOSAL_SCHEMA, verifySealedPcbEditProposalIntegrity } from "../sealed-pcb-edit-proposal";
import { engineeringDigest } from "../../../engineering/stable";
import { collectProductionFiles, moduleImportOffenders } from "../../../project/__tests__/_import-gate-helpers";
import { INTENTIONAL_AGENT_EXPOSED_TOOL_IDS } from "@/app/lib/engineering/agent-exposure"; // [B17-F] the ONE reviewed exposure set — never a hard-coded count

const RULES = getPreset(DEFAULT_PRESET_ID).rules;
// B16.0.1: the identity digest schema moved .v1 → .v2 with the proposal schema.
const IDENTITY_DIGEST_SCHEMA = "sirkit.pcb-bounded-edit-proposal-id.v2";
const OPS_DIGEST_SCHEMA = "sirkit.pcb-bounded-edit-operations.v1";

function roundBoard(): PcbBoard {
  const base = createEmptyBoard();
  base.outline = { kind: "roundrect", width: 80_000_000, height: 80_000_000, cornerRadius: 20_000_000, origin: { x: 0, y: 0 } };
  base.nets.push({ id: 1, name: "NET1" });
  return base;
}

const compile = (payload: unknown, source: PcbBoard) =>
  compileBoundedPcbEdit({ board: source, rules: RULES, payload });

// ─── §A R22 — TRUE roundrect containment ─────────────────────────────────────

describe("B15.2.2 §A — exact roundrect containment", () => {
  it("R22: the EXACT coordinates that the chord polygon wrongly accepted now refuse", () => {
    const source = roundBoard();
    const vertex = { x: 96_305, y: 18_039_657 };
    // The existing true authority and the new exact authority AGREE: outside.
    expect(pointInOutline(vertex, source.outline)).toBe(false);
    expect(pointInExactOutline(vertex, source.outline as ExactOutline)).toBe(false);
    // …and the compiler refuses a keepout containing it.
    expect(compile({ intent: "x", operations: [{ kind: "add_keepout", polygon: [
      vertex, { x: vertex.x + 100_000, y: vertex.y }, { x: vertex.x + 100_000, y: vertex.y + 100_000 },
    ], layers: ["copperTop"], forbidTracks: true, forbidVias: true }] }, source))
      .toMatchObject({ ok: false, code: "escapes-board" });
  });

  it("R22b: the exact authority NEVER disagrees with the true outline authority (fuzz across corners/radii/origins)", () => {
    const outlines: ExactOutline[] = [
      { kind: "roundrect", width: 80_000_000, height: 80_000_000, cornerRadius: 20_000_000, origin: { x: 0, y: 0 } },
      { kind: "roundrect", width: 80_000_000, height: 80_000_000, cornerRadius: 20_000_000, origin: { x: 7_000_000, y: -3_000_000 } },
      { kind: "roundrect", width: 20_000_000, height: 12_000_000, cornerRadius: 500_000, origin: { x: 0, y: 0 } },
      { kind: "roundrect", width: 40_000_000, height: 40_000_000, cornerRadius: 20_000_000, origin: { x: 0, y: 0 } }, // r = w/2 = h/2
      { kind: "roundrect", width: 30_000_000, height: 30_000_000, cornerRadius: 0, origin: { x: 0, y: 0 } },
      { kind: "rect", width: 50_000_000, height: 30_000_000, origin: { x: -5_000_000, y: 2_000_000 } },
    ];
    let checked = 0;
    for (const outline of outlines) {
      const ox = "origin" in outline ? outline.origin.x : 0;
      const oy = "origin" in outline ? outline.origin.y : 0;
      const w = "width" in outline ? outline.width : 0;
      const h = "height" in outline ? outline.height : 0;
      for (let i = 0; i <= 40; i += 1) {
        for (let j = 0; j <= 40; j += 1) {
          const point = { x: Math.round(ox - w * 0.05 + (w * 1.1 * i) / 40), y: Math.round(oy - h * 0.05 + (h * 1.1 * j) / 40) };
          expect(pointInExactOutline(point, outline), `${JSON.stringify({ outline, point })}`)
            .toBe(pointInOutline(point, outline as never));
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(9_000);
  });

  it("R22c: points exactly ON, just inside, and just outside the true arc are classified exactly", () => {
    const outline: ExactOutline = { kind: "roundrect", width: 80_000_000, height: 80_000_000, cornerRadius: 20_000_000, origin: { x: 0, y: 0 } };
    const r = 20_000_000;
    // Bottom-left corner circle centre (r, r). A 3-4-5 triple scaled by r/5
    // gives an EXACT on-arc integer point: (r - 4r/5, r - 3r/5).
    const onArc = { x: r - (4 * r) / 5, y: r - (3 * r) / 5 };
    expect(pointInExactOutline(onArc, outline)).toBe(true); // closed containment
    const justInside = { x: onArc.x + 1, y: onArc.y + 1 };
    const justOutside = { x: onArc.x - 1, y: onArc.y - 1 };
    expect(pointInExactOutline(justInside, outline)).toBe(true);
    expect(pointInExactOutline(justOutside, outline)).toBe(false);
    // all four corners
    for (const corner of [
      { x: r - (4 * r) / 5, y: r - (3 * r) / 5 },
      { x: 80_000_000 - (r - (4 * r) / 5), y: r - (3 * r) / 5 },
      { x: 80_000_000 - (r - (4 * r) / 5), y: 80_000_000 - (r - (3 * r) / 5) },
      { x: r - (4 * r) / 5, y: 80_000_000 - (r - (3 * r) / 5) },
    ]) {
      expect(pointInExactOutline(corner, outline)).toBe(true);
    }
  });

  it("R22d: convexity invariant — a segment near a corner is inside iff both endpoints are", () => {
    const outline: ExactOutline = { kind: "roundrect", width: 80_000_000, height: 80_000_000, cornerRadius: 20_000_000, origin: { x: 0, y: 0 } };
    // Both endpoints inside ⇒ segment inside (convexity).
    expect(segmentInExactOutline({ x: 2_000_000, y: 20_000_000 }, { x: 20_000_000, y: 2_000_000 }, outline)).toBe(true);
    // One endpoint off-board ⇒ refuse.
    expect(segmentInExactOutline({ x: 2_000_000, y: 20_000_000 }, { x: 96_305, y: 18_039_657 }, outline)).toBe(false);
    expect(segmentInExactOutline({ x: 96_305, y: 18_039_657 }, { x: 40_000_000, y: 40_000_000 }, outline)).toBe(false);
  });

  it("R22e: a keepout wholly inside a roundrect still compiles", () => {
    expect(compile({ intent: "x", operations: [{ kind: "add_keepout", polygon: [
      { x: 30_000_000, y: 30_000_000 }, { x: 50_000_000, y: 30_000_000 }, { x: 50_000_000, y: 50_000_000 },
    ], layers: ["copperTop"], forbidTracks: true, forbidVias: true }] }, roundBoard()).ok).toBe(true);
  });
});

// ─── §B R23 — complete closed proposal-shape validation ──────────────────────

describe("B15.2.2 §B — complete nested proposal validation", () => {
  function genuine() {
    const source = createEmptyBoard();
    source.outline = { kind: "rect", width: 100_000_000, height: 80_000_000, origin: { x: 0, y: 0 } };
    source.nets.push({ id: 1, name: "NET1" });
    source.tracks = [{ id: "t1", layer: "copperTop", width: 400_000, start: { x: 10_000_000, y: 10_000_000 }, end: { x: 20_000_000, y: 10_000_000 }, netId: 1 }];
    const created = createSealedPcbEditProposal({
      payload: { intent: "widen", operations: [{ kind: "update_track", trackId: "t1", widthNm: 500_000 }] },
      board: source, validationPolicy: { presetId: DEFAULT_PRESET_ID },
      scope: { tenantId: "t", projectId: "p", branchId: "main", boardInstanceId: "b" },
      base: { canonicalResource: { resourceId: "r", contentDigest: "d" }, historyHead: { sequence: 0, label: null }, lineageId: "lin" },
      actor: { actorId: "a", kind: "ai" }, effectiveActor: { actorId: "u", kind: "human" },
      discovery: { digest: "x", contextDigest: "y" }, provenance: { provider: "p", model: "m", runId: null },
      nonce: "n0n6e0000000000a", now: 1_000_000,
    });
    if (!created.ok) throw new Error(`fixture must seal: ${created.code} ${created.detail}`);
    return created.proposal as unknown as Record<string, unknown>;
  }

  /** Recompute the public proposalId exactly as the sealer does. */
  function reseal(body: Record<string, unknown>): Record<string, unknown> {
    const rest = { ...body };
    delete rest.proposalId;
    return { ...body, proposalId: `pprop-${engineeringDigest({ schema: IDENTITY_DIGEST_SCHEMA, body: rest }).slice(5, 21)}` };
  }

  it("R23a: a malformed scope refuses even with a recomputed checksum", () => {
    const forged = reseal({ ...genuine(), scope: { tenantId: 7, projectId: null, branchId: [], boardInstanceId: {} } });
    expect(verifySealedPcbEditProposalIntegrity(forged)).toMatchObject({ ok: false, code: "malformed" });
  });

  it("R23b: wrong-typed actor/discovery/provenance/base values refuse", () => {
    const good = genuine();
    const cases: Array<[string, Record<string, unknown>]> = [
      ["actor", { ...good, actor: { actorId: 1, kind: null } }],
      ["discovery", { ...good, discovery: { digest: [], contextDigest: 3 } }],
      ["provenance", { ...good, provenance: { provider: {}, model: 9, runId: 5 } }],
      ["base.historyHead", { ...good, base: { ...(good.base as Record<string, unknown>), historyHead: { sequence: "x", label: 3 } } }],
      ["base.canonicalResource", { ...good, base: { ...(good.base as Record<string, unknown>), canonicalResource: { resourceId: null, contentDigest: 7 } } }],
      ["effectiveActor", { ...good, effectiveActor: { actorId: [], kind: {} } }],
    ];
    for (const [label, body] of cases) {
      const verdict = verifySealedPcbEditProposalIntegrity(reseal(body));
      expect(verdict.ok, label).toBe(false);
      if (!verdict.ok) expect(verdict.code, label).toBe("malformed");
    }
  });

  it("R23c: evil operations refuse — every sealed operation goes through the canonical parser", () => {
    const good = genuine();
    const evilOps = [{ kind: "evil_operation", payload: { arbitrary: true } }];
    const forged = reseal({
      ...good,
      operations: evilOps,
      operationsDigest: engineeringDigest({ schema: OPS_DIGEST_SCHEMA, base: (good.base as Record<string, unknown>).pcbRevisionId, operations: evilOps }),
    });
    expect(verifySealedPcbEditProposalIntegrity(forged)).toMatchObject({ ok: false, code: "malformed" });
    // An EXCLUDED but recognized intent is refused just as firmly.
    const deleteOps = [{ kind: "delete_track", trackId: "t1" }];
    const forgedDelete = reseal({
      ...good, operations: deleteOps,
      operationsDigest: engineeringDigest({ schema: OPS_DIGEST_SCHEMA, base: (good.base as Record<string, unknown>).pcbRevisionId, operations: deleteOps }),
    });
    expect(verifySealedPcbEditProposalIntegrity(forgedDelete)).toMatchObject({ ok: false, code: "malformed" });
  });

  it("R23d: unknown keys at nested boundaries, and out-of-range numbers, refuse", () => {
    const good = genuine();
    const cases: Array<[string, Record<string, unknown>]> = [
      ["extra scope key", { ...good, scope: { ...(good.scope as Record<string, unknown>), extra: 1 } }],
      ["extra tool key", { ...good, tool: { ...(good.tool as Record<string, unknown>), extra: 1 } }],
      ["negative createdAt", { ...good, createdAt: -1 }],
      ["non-integer expiresAt", { ...good, expiresAt: 1.5 }],
      ["duplicate minted ids", { ...good, mintedObjectIds: ["b15-track-a", "b15-track-a"] }],
    ];
    for (const [label, body] of cases) {
      const verdict = verifySealedPcbEditProposalIntegrity(reseal(body));
      expect(verdict.ok, label).toBe(false);
    }
  });

  it("R23e: validation is TOTAL — revoked proxies, throwing getters, cycles, hostile arrays", () => {
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    // B16.0.1: the CURRENT schema — a v1 body now refuses early as
    // legacy-authorization-missing without traversing the hostile structure.
    const throwing = new Proxy({ schema: PCB_EDIT_PROPOSAL_SCHEMA }, { get() { throw new Error("trap"); } });
    const cyclic: Record<string, unknown> = { schema: PCB_EDIT_PROPOSAL_SCHEMA };
    cyclic.self = cyclic;
    const hostileArray = { ...genuine(), operations: new Proxy([], { get(t, k, r) { if (k === "length") throw new Error("trap"); return Reflect.get(t, k, r); } }) };
    for (const [label, value] of [["revoked", revoked.proxy], ["throwing", throwing], ["cyclic", cyclic], ["hostileArray", hostileArray]] as Array<[string, unknown]>) {
      expect(() => verifySealedPcbEditProposalIntegrity(value), label).not.toThrow();
      expect(verifySealedPcbEditProposalIntegrity(value).ok, label).toBe(false);
    }
  });

  it("R23f: the genuine proposal still verifies (validation is not over-strict)", () => {
    expect(verifySealedPcbEditProposalIntegrity(genuine())).toEqual({ ok: true });
  });
});

// ─── §C the raw-sealer allowlist must NOT grow ───────────────────────────────

describe("B15.2.2 §C — the seal import boundary is fixed", () => {
  const files = collectProductionFiles();
  const SEALER = "app/lib/pcb/proposal/pcb-edit-proposal-sealer.internal";
  /**
   * [B15.2.2 §C] This allowlist is NOT expected to grow when B15.3 lands.
   * The future tool handler must import and call `createSealedPcbEditProposal`
   * only — never the raw sealer. If a B15.3 change needs this set extended,
   * that is a design error in the handler, not a gate update.
   */
  const APPROVED = new Set([
    "app/lib/pcb/proposal/pcb-edit-proposal-sealer.internal.ts",
    "app/lib/pcb/proposal/pcb-edit-proposal-service.ts",
  ]);

  it("the approved importer set is exactly two modules and the tree is clean", { timeout: 60_000 }, () => {
    expect([...APPROVED].sort()).toEqual([
      "app/lib/pcb/proposal/pcb-edit-proposal-sealer.internal.ts",
      "app/lib/pcb/proposal/pcb-edit-proposal-service.ts",
    ]);
    expect(moduleImportOffenders(files, SEALER, APPROVED)).toEqual([]);
  });

  it("NEGATIVE tripwire: a future handler importing the raw sealer trips the gate", { timeout: 60_000 }, () => {
    const injected = new Map(files);
    injected.set("app/lib/pcb/proposal/pcb-propose-tool-handler.ts",
      'import { rawSealPcbEditProposal } from "./pcb-edit-proposal-sealer.internal";');
    expect(moduleImportOffenders(injected, SEALER, APPROVED)).toEqual(["app/lib/pcb/proposal/pcb-propose-tool-handler.ts"]);
  });

  it("exposure is exactly the intentional agent-exposed set (12 at B15.3, the supersession of the B15.2.2 11-tool pin; the set has since grown by reviewed moves, B22-B's three named computation reads among them, and the assertion counts the set itself) with exactly ONE PCB propose tool", async () => { // [B22 closeout, 2026-10-02] retitled (D22-16): the derived count, 36 since B22-B (OD-139); assertions unchanged
    const { sirkitToolRegistry } = await import("../../../engineering/tool-catalog");
    const exposed = sirkitToolRegistry().list().filter((descriptor) => descriptor.agentExposed);
    expect(exposed).toHaveLength(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS.length);
    const pcbPropose = exposed.filter((d) => /pcb/i.test(d.toolId) && d.operationClass === "propose");
    expect(pcbPropose.map((d) => d.toolId)).toEqual(["sirkit.pcb.propose-bounded-edit"]);
  });
});
