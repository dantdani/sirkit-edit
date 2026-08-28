/**
 * B15 §1 — the bounded operation contract, the shared compiler, and the
 * sealed PCB proposal.
 *
 * Every allowed operation compiles into an isolated candidate that the
 * canonical B08 delta layer accepts; every excluded operation, hostile
 * input, bound violation, unknown/locked/invalid reference, and safety
 * regression refuses with a specific code; compiling mutates NOTHING.
 */

import { describe, expect, it } from "vitest";
import { createEmptyBoard } from "../../types";
import type { PcbBoard } from "../../types";
import { getPreset, DEFAULT_PRESET_ID } from "../../drc/presets";
import { pcbRevisionId } from "../../revision";
import {
  BOUNDED_EDIT_LIMITS,
  EXCLUDED_EDIT_INTENTS,
  parseBoundedEditRequest,
} from "../bounded-edit-operations";
import { compileBoundedPcbEdit, mintObjectId } from "../bounded-edit-compiler";
import { createSealedPcbEditProposal } from "../pcb-edit-proposal-service";
import {
  PCB_EDIT_PROPOSAL_SCHEMA,
  isPcbEditProposalExpired,
  verifySealedPcbEditProposalIntegrity,
} from "../sealed-pcb-edit-proposal";
import { isSealedPcbEditProposal, receivePcbProposalEvent } from "../../../project/pcb-proposal-events";

const RULES = getPreset(DEFAULT_PRESET_ID).rules;

function board(): PcbBoard {
  const base = createEmptyBoard();
  base.outline = { kind: "rect", width: 100_000_000, height: 80_000_000, origin: { x: 0, y: 0 } };
  base.nets.push({ id: 1, name: "NET1" }, { id: 2, name: "NET2" }, { id: 3, name: "BARE" });
  base.tracks = [
    { id: "t1", layer: "copperTop", width: 250_000, start: { x: 10_000_000, y: 10_000_000 }, end: { x: 20_000_000, y: 10_000_000 }, netId: 1 },
    { id: "t-locked", layer: "copperTop", width: 250_000, start: { x: 10_000_000, y: 40_000_000 }, end: { x: 20_000_000, y: 40_000_000 }, netId: 2, locked: true },
  ];
  base.vias = [
    { id: "v1", at: { x: 30_000_000, y: 30_000_000 }, size: 600_000, drill: 300_000, netId: 1, layers: ["copperTop", "copperBottom"] },
  ];
  base.dimensions = [
    { id: "d1", kind: "horizontal", a: { x: 5_000_000, y: 5_000_000 }, b: { x: 15_000_000, y: 5_000_000 }, offsetNm: 2_000_000, layer: "fabTop", unit: "mm", precision: 2, textHeightNm: 1_000_000, strokeWidthNm: 150_000 } as never,
  ];
  base.routingKeepouts = [
    { id: "k1", polygon: [{ x: 50_000_000, y: 50_000_000 }, { x: 60_000_000, y: 50_000_000 }, { x: 60_000_000, y: 60_000_000 }], layers: ["copperTop"], forbidTracks: true, forbidVias: true },
  ];
  return base;
}

function compile(payload: unknown, source = board()) {
  return compileBoundedPcbEdit({ board: source, rules: RULES, baseIdentity: pcbRevisionId(source), payload });
}

const ok = (payload: unknown, source?: PcbBoard) => {
  const result = compile(payload, source);
  if (!result.ok) throw new Error(`expected success, got ${result.code}: ${result.detail}`);
  return result;
};

// ─── §1 allowed operations ───────────────────────────────────────────────────

describe("B15 §1 — every allowed bounded operation compiles canonically", () => {
  const cases: Array<[string, unknown]> = [
    ["move a footprint (no footprints on the fixture → covered separately)", null],
  ];
  void cases;

  it("1. add_track compiles, mints a deterministic id, and leaves the base board untouched", () => {
    const source = board();
    const snapshot = structuredClone(source);
    const result = ok({
      intent: "Add a short NET1 track",
      operations: [{ kind: "add_track", layer: "copperTop", netId: 1, widthNm: 250_000, start: { x: 25_000_000, y: 20_000_000 }, end: { x: 30_000_000, y: 20_000_000 } }],
    }, source);
    expect(source).toEqual(snapshot); // the caller's board never mutates
    expect(result.candidate.tracks).toHaveLength(3);
    expect(result.mintedObjectIds).toEqual([mintObjectId(pcbRevisionId(source), "track", 0)]);
    expect(result.impact.affectedNetIds).toEqual([1]);
    expect(result.impact.candidateBoardDigest).toBe(pcbRevisionId(result.candidate));
  });

  it("2. update_track geometry, add_via, update_via, dimensions, keepouts, preferences, and rules all compile", () => {
    const payloads: Array<[string, unknown]> = [
      ["update_track", { kind: "update_track", trackId: "t1", widthNm: 300_000 }],
      ["add_via", { kind: "add_via", at: { x: 40_000_000, y: 20_000_000 }, netId: 1, sizeNm: 600_000, drillNm: 300_000, layers: ["copperTop", "copperBottom"] }],
      ["update_via", { kind: "update_via", viaId: "v1", sizeNm: 700_000 }],
      ["update_dimension", { kind: "update_dimension", dimensionId: "d1", precision: 3 }],
      ["remove_dimension", { kind: "remove_dimension", dimensionId: "d1" }],
      ["add_dimension", { kind: "add_dimension", dimensionKind: "aligned", a: { x: 5_000_000, y: 20_000_000 }, b: { x: 25_000_000, y: 20_000_000 }, offsetNm: 1_000_000, layer: "fabTop", unit: "mm", precision: 2, textHeightNm: 1_000_000, strokeWidthNm: 150_000 }],
      ["add_keepout", { kind: "add_keepout", polygon: [{ x: 70_000_000, y: 10_000_000 }, { x: 80_000_000, y: 10_000_000 }, { x: 80_000_000, y: 20_000_000 }], layers: ["copperTop"], forbidTracks: true, forbidVias: false }],
      ["update_keepout", { kind: "update_keepout", keepoutId: "k1", forbidVias: false }],
      ["set_routing_preference", { kind: "set_routing_preference", customTrackWidthNm: 300_000 }],
      // 200k is at/above the active minimum AND satisfied by the existing 250k
      // copper, so the rule takes effect without invalidating the board.
      ["set_net_class_rule", { kind: "set_net_class_rule", netIds: [3], trackWidthNm: 200_000 }],
    ];
    for (const [label, operation] of payloads) {
      const result = compile({ intent: `bounded ${label}`, operations: [operation] });
      expect(result.ok, `${label}: ${result.ok ? "" : result.detail}`).toBe(true);
    }
  });

  it("3. a multi-operation proposal compiles as ONE candidate with a per-operation summary", () => {
    const result = ok({
      intent: "Widen and add copper",
      operations: [
        { kind: "update_track", trackId: "t1", widthNm: 300_000 },
        { kind: "add_track", layer: "copperTop", netId: 1, widthNm: 300_000, start: { x: 25_000_000, y: 25_000_000 }, end: { x: 35_000_000, y: 25_000_000 } },
      ],
    });
    expect(result.impact.operationSummaries).toHaveLength(2);
    expect(result.impact.changedObjectIds.length).toBe(2);
  });
});

// ─── §2 refusals ─────────────────────────────────────────────────────────────

describe("B15 §2 — excluded, hostile, and unsafe inputs refuse", () => {
  it("4. EVERY excluded operation intent refuses with `excluded-operation`", () => {
    for (const intent of EXCLUDED_EDIT_INTENTS) {
      const result = compile({ intent: "try it", operations: [{ kind: intent }] });
      expect(result.ok, intent).toBe(false);
      if (!result.ok) expect(result.code, intent).toBe("excluded-operation");
    }
  });

  it("5. hostile inputs refuse: functions, symbols, accessors, exotic prototypes, prototype pollution", () => {
    const accessor = { intent: "x", operations: [{}] };
    Object.defineProperty(accessor.operations[0]!, "kind", { get: () => "add_track", enumerable: true, configurable: true });
    const hostile: Array<[string, unknown]> = [
      ["function", { intent: "x", operations: [{ kind: "update_track", trackId: "t1", widthNm: () => 1 }] }],
      ["symbol value", { intent: "x", operations: [{ kind: "update_track", trackId: "t1", widthNm: Symbol("x") }] }],
      ["accessor", accessor],
      ["exotic prototype", { intent: "x", operations: [Object.assign(Object.create({ evil: true }), { kind: "update_track", trackId: "t1", widthNm: 300_000 })] }],
      ["prototype pollution", { intent: "x", operations: [{ kind: "update_track", trackId: "t1", widthNm: 300_000, __proto__: { polluted: true } }] }],
      ["symbol key", { intent: "x", operations: [{ kind: "update_track", trackId: "t1", widthNm: 300_000, [Symbol("k")]: 1 }] }],
    ];
    for (const [label, payload] of hostile) {
      const result = compile(payload);
      expect(result.ok, label).toBe(false);
      if (!result.ok) expect(["hostile-input", "invalid-value", "unknown-field", "malformed"], label).toContain(result.code);
    }
    // Object.prototype is NOT polluted by any of the above.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("6. bounds are enforced: operation count, unknown fields, string/array/depth/coordinate limits", () => {
    const many = Array.from({ length: BOUNDED_EDIT_LIMITS.maxOperations + 1 }, () => ({ kind: "update_track", trackId: "t1", widthNm: 300_000 }));
    expect(compile({ intent: "x", operations: many })).toMatchObject({ ok: false, code: "too-many-operations" });
    expect(compile({ intent: "x", operations: [{ kind: "update_track", trackId: "t1", widthNm: 300_000, extra: 1 }] })).toMatchObject({ ok: false, code: "unknown-field" });
    expect(compile({ intent: "x", operations: [{ kind: "update_track", trackId: "t1", widthNm: 300_000 }], extra: 1 })).toMatchObject({ ok: false, code: "unknown-field" });
    expect(compile({ intent: "x", operations: [{ kind: "add_track", layer: "copperTop", netId: 1, widthNm: 250_000, start: { x: 1.5, y: 0 }, end: { x: 5_000_000, y: 0 } }] })).toMatchObject({ ok: false, code: "invalid-value" });
    expect(compile({ intent: "x", operations: [{ kind: "add_track", layer: "copperTop", netId: 1, widthNm: 250_000, start: { x: Number.POSITIVE_INFINITY, y: 0 }, end: { x: 5_000_000, y: 0 } }] })).toMatchObject({ ok: false, code: "invalid-value" });
    expect(compile({ intent: "x", operations: [{ kind: "add_track", layer: "copperTop", netId: 1, widthNm: 250_000, start: { x: 99_000_000_000, y: 0 }, end: { x: 5_000_000, y: 0 } }] })).toMatchObject({ ok: false, code: "invalid-value" });
    expect(compile({ intent: "y".repeat(BOUNDED_EDIT_LIMITS.maxIntentLength + 1), operations: [{ kind: "update_track", trackId: "t1", widthNm: 300_000 }] })).toMatchObject({ ok: false, code: "invalid-value" });
    expect(parseBoundedEditRequest({ intent: "x", operations: [{ kind: "add_keepout", polygon: Array.from({ length: BOUNDED_EDIT_LIMITS.maxArrayLength + 1 }, () => ({ x: 0, y: 0 })), layers: ["copperTop"], forbidTracks: true, forbidVias: true }] })).toMatchObject({ ok: false });
  });

  it("7. unknown, locked, and invalid references refuse", () => {
    expect(compile({ intent: "x", operations: [{ kind: "update_track", trackId: "nope", widthNm: 300_000 }] })).toMatchObject({ ok: false, code: "unknown-object" });
    expect(compile({ intent: "x", operations: [{ kind: "update_via", viaId: "nope", sizeNm: 700_000 }] })).toMatchObject({ ok: false, code: "unknown-object" });
    expect(compile({ intent: "x", operations: [{ kind: "update_dimension", dimensionId: "nope", precision: 1 }] })).toMatchObject({ ok: false, code: "unknown-object" });
    expect(compile({ intent: "x", operations: [{ kind: "update_keepout", keepoutId: "nope", forbidVias: false }] })).toMatchObject({ ok: false, code: "unknown-object" });
    expect(compile({ intent: "x", operations: [{ kind: "update_track", trackId: "t-locked", widthNm: 300_000 }] })).toMatchObject({ ok: false, code: "locked-object" });
    expect(compile({ intent: "x", operations: [{ kind: "add_track", layer: "notALayer", netId: 1, widthNm: 250_000, start: { x: 1_000_000, y: 1_000_000 }, end: { x: 2_000_000, y: 1_000_000 } }] })).toMatchObject({ ok: false, code: "invalid-layer" });
    expect(compile({ intent: "x", operations: [{ kind: "add_track", layer: "copperTop", netId: 99, widthNm: 250_000, start: { x: 1_000_000, y: 1_000_000 }, end: { x: 2_000_000, y: 1_000_000 } }] })).toMatchObject({ ok: false, code: "invalid-net" });
    expect(compile({ intent: "x", operations: [{ kind: "add_via", at: { x: 5_000_000, y: 5_000_000 }, netId: 1, sizeNm: 600_000, drillNm: 300_000, layers: ["copperTop", "copperBottom"], padstackId: "nope" }] })).toMatchObject({ ok: false, code: "invalid-padstack" });
  });

  it("8. escaping the board outline refuses", () => {
    expect(compile({ intent: "x", operations: [{ kind: "add_track", layer: "copperTop", netId: 1, widthNm: 250_000, start: { x: 500_000_000, y: 0 }, end: { x: 510_000_000, y: 0 } }] })).toMatchObject({ ok: false, code: "escapes-board" });
  });

  it("9. weakening an enforced minimum refuses", () => {
    expect(compile({ intent: "x", operations: [{ kind: "set_net_class_rule", netIds: [1], trackWidthNm: 100_000 }] })).toMatchObject({ ok: false, code: "weakened-minimum" });
  });

  it("10. a no-op proposal refuses with `no-effective-change`", () => {
    expect(compile({ intent: "x", operations: [{ kind: "update_track", trackId: "t1", widthNm: 250_000 }] })).toMatchObject({ ok: false, code: "no-effective-change" });
  });

  it("11. a new short refuses (two nets bridged by proposed copper)", () => {
    const source = board();
    // Existing NET2 copper sits at y=40mm; propose NET1 copper crossing it.
    const result = compile({
      intent: "bridge",
      operations: [{ kind: "add_track", layer: "copperTop", netId: 1, widthNm: 250_000, start: { x: 15_000_000, y: 35_000_000 }, end: { x: 15_000_000, y: 45_000_000 } }],
    }, source);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(["new-short", "drc-regression", "connectivity-regression"]).toContain(result.code);
  });
});

// ─── §3 sealing ──────────────────────────────────────────────────────────────

describe("B15 §3 — the sealed PCB proposal binds its full identity", () => {
  function seal(now = 1_000_000) {
    const source = board();
    const result = createSealedPcbEditProposal({
      payload: { intent: "Widen NET1", operations: [{ kind: "update_track", trackId: "t1", widthNm: 300_000 }] },
      board: source, validationPolicy: { presetId: DEFAULT_PRESET_ID },
      scope: { tenantId: "t", projectId: "p", branchId: "main", boardInstanceId: "board-1" },
      base: { canonicalResource: { resourceId: "res-1", contentDigest: "digest-1" }, historyHead: { sequence: 0, label: null }, lineageId: "lin-1" },
      actor: { actorId: "agent", kind: "ai" },
      effectiveActor: { actorId: "user-1", kind: "human" },
      discovery: { digest: "disc", contextDigest: "ctx" },
      provenance: { provider: "openai", model: "scripted", runId: "run-1" },
      nonce: "abcdef0123456789", now,
    });
    if (!result.ok) throw new Error(`seal must succeed: ${result.code} ${result.detail}`);
    return result.proposal;
  }

  it("12. a freshly sealed proposal verifies, carries no schematic identity, and is a PCB schema", () => {
    const proposal = seal();
    expect(proposal.schema).toBe(PCB_EDIT_PROPOSAL_SCHEMA);
    expect(proposal.proposalId.startsWith("pprop-")).toBe(true);
    expect(Object.keys(proposal)).not.toContain("baseSchematicDigest");
    expect(verifySealedPcbEditProposalIntegrity(proposal)).toEqual({ ok: true });
    expect(isSealedPcbEditProposal(proposal)).toBe(true);
    expect(receivePcbProposalEvent({ proposal })).toBe(proposal);
  });

  it("13. ANY tampering breaks the seal", () => {
    const proposal = seal();
    const mutations: Array<[string, Record<string, unknown>]> = [
      ["operations", { ...proposal, operations: [{ ...proposal.operations[0], widthNm: 900_000 }] }],
      ["candidateDigest", { ...proposal, candidateDigest: "forged" }],
      ["impactDigest", { ...proposal, impactDigest: "forged" }],
      ["scope", { ...proposal, scope: { ...proposal.scope, projectId: "other" } }],
      ["base", { ...proposal, base: { ...proposal.base, pcbRevisionId: "other" } }],
      ["expiry", { ...proposal, expiresAt: proposal.expiresAt + 1 }],
      ["tier", { ...proposal, approvalTier: "none" }],
    ];
    for (const [label, altered] of mutations) {
      const verdict = verifySealedPcbEditProposalIntegrity(altered);
      expect(verdict.ok, label).toBe(false);
    }
    expect(verifySealedPcbEditProposalIntegrity({ ...proposal, extra: 1 })).toMatchObject({ ok: false, code: "malformed" });
    const missing = { ...(proposal as unknown as Record<string, unknown>) };
    delete missing.impact;
    expect(verifySealedPcbEditProposalIntegrity(missing)).toMatchObject({ ok: false, code: "malformed" });
    expect(verifySealedPcbEditProposalIntegrity({ ...proposal, schema: "sirkit.schematic-replacement-proposal.v1" })).toMatchObject({ ok: false, code: "wrong-version" });
  });

  it("14. expiry is explicit and the discriminator refuses foreign artifacts", () => {
    const proposal = seal(1_000_000);
    expect(isPcbEditProposalExpired(proposal, 1_000_000)).toBe(false);
    expect(isPcbEditProposalExpired(proposal, proposal.expiresAt)).toBe(true);
    expect(isSealedPcbEditProposal({ schema: "sirkit.schematic-replacement-proposal.v1" })).toBe(false);
    expect(receivePcbProposalEvent(null)).toBeNull();
    expect(receivePcbProposalEvent({ proposal: { schema: "other" } })).toBeNull();
  });

  it("15. sealing is DETERMINISTIC for identical inputs (same id) and unique per nonce", () => {
    expect(seal(1_000_000).proposalId).toBe(seal(1_000_000).proposalId);
    expect(seal(1_000_000).proposalId).not.toBe(seal(2_000_000).proposalId);
  });
});
