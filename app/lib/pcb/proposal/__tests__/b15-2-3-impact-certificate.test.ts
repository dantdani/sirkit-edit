/**
 * B15.2.3 — CLOSED impact-certificate validation (R24).
 *
 * Before this stage, `validateImpactShape` checked only that impact.schema
 * was "a string", accepted unknown nested keys, accepted ANY JavaScript
 * number (NaN, ±Infinity, fractions, negatives), and never bounded arrays or
 * strings or checked the producer's canonical order/arithmetic — so a
 * mutated impact certificate with recomputed public checksums verified
 * `ok:true` (R24a/b/c, reproduced pre-edit). These are permanent fail-closed
 * regressions for the closed contract, aligned with the ONE authoritative
 * producer (`compileBoundedPcbEdit`).
 */

import { describe, expect, it } from "vitest";
import { createEmptyBoard } from "../../types";
import type { PcbBoard } from "../../types";
import { getPreset, DEFAULT_PRESET_ID } from "../../drc/presets";
import { BOUNDED_EDIT_IMPACT_LIMITS } from "../bounded-edit-compiler";
import { createSealedPcbEditProposal } from "../pcb-edit-proposal-service";
import { verifySealedPcbEditProposalIntegrity } from "../sealed-pcb-edit-proposal";
import { engineeringDigest } from "../../../engineering/stable";

const RULES = getPreset(DEFAULT_PRESET_ID).rules;
// B16.0.1: the identity digest schema moved .v1 → .v2 with the proposal schema.
const IDENTITY_DIGEST_SCHEMA = "sirkit.pcb-bounded-edit-proposal-id.v2";
const IMPACT_DIGEST_SCHEMA = "sirkit.pcb-bounded-edit-impact.v1";

function baseBoard(): PcbBoard {
  const source = createEmptyBoard();
  source.outline = { kind: "rect", width: 100_000_000, height: 80_000_000, origin: { x: 0, y: 0 } };
  source.nets.push({ id: 1, name: "NET1" });
  source.tracks = [{ id: "t1", layer: "copperTop", width: 400_000, start: { x: 10_000_000, y: 10_000_000 }, end: { x: 20_000_000, y: 10_000_000 }, netId: 1 }];
  return source;
}

function seal(payload: unknown): Record<string, unknown> {
  const created = createSealedPcbEditProposal({
    payload, board: baseBoard(), validationPolicy: { presetId: DEFAULT_PRESET_ID },
    scope: { tenantId: "t", projectId: "p", branchId: "main", boardInstanceId: "b" },
    base: { canonicalResource: { resourceId: "r", contentDigest: "d" }, historyHead: { sequence: 0, label: null }, lineageId: "lin" },
    actor: { actorId: "a", kind: "ai" }, effectiveActor: { actorId: "u", kind: "human" },
    discovery: { digest: "x", contextDigest: "y" }, provenance: { provider: "p", model: "m", runId: null },
    nonce: "n0n6e0000000000a", now: 1_000_000,
  });
  if (!created.ok) throw new Error(`fixture must seal: ${created.code} ${created.detail}`);
  return created.proposal as unknown as Record<string, unknown>;
}

const genuine = () => seal({ intent: "widen", operations: [{ kind: "update_track", trackId: "t1", widthNm: 500_000 }] });

/** Mutate the impact, then recompute impactDigest AND proposalId with the
 *  PUBLIC checksum algorithms — exactly what R24 proved used to verify. */
function resealImpact(body: Record<string, unknown>, impact: unknown): Record<string, unknown> {
  const next: Record<string, unknown> = { ...body, impact, impactDigest: engineeringDigest({ schema: IMPACT_DIGEST_SCHEMA, impact }) };
  const rest = { ...next };
  delete rest.proposalId;
  return { ...next, proposalId: `pprop-${engineeringDigest({ schema: IDENTITY_DIGEST_SCHEMA, body: rest }).slice(5, 21)}` };
}

function impactOf(body: Record<string, unknown>): Record<string, unknown> {
  return body.impact as Record<string, unknown>;
}

/** Reseal with a patch applied to the impact certificate. */
function patched(body: Record<string, unknown>, patch: (impact: Record<string, unknown>) => Record<string, unknown>): Record<string, unknown> {
  return resealImpact(body, patch(structuredClone(impactOf(body))));
}

const expectMalformed = (candidate: unknown, label: string) => {
  const verdict = verifySealedPcbEditProposalIntegrity(candidate);
  expect(verdict.ok, label).toBe(false);
  if (!verdict.ok) expect(verdict.code, label).toBe("malformed");
};

// ─── §A — the three mandated R24 artifacts refuse ────────────────────────────

describe("B15.2.3 §A — the exact R24 counterexamples fail closed", () => {
  it("R24a: a foreign impact schema refuses even with recomputed checksums", () => {
    expectMalformed(patched(genuine(), (impact) => ({ ...impact, schema: "sirkit.evil-impact.v999" })), "R24a");
  });

  it("R24b: unknown nested impact fields refuse even with recomputed checksums", () => {
    expectMalformed(patched(genuine(), (impact) => ({
      ...impact,
      untrustedAuthority: { allow: true },
      drc: { ...(impact.drc as Record<string, unknown>), untrusted: "accepted" },
      readiness: { ...(impact.readiness as Record<string, unknown>), extra: "accepted" },
    })), "R24b");
  });

  it("R24c: invalid numeric semantics refuse even with recomputed checksums", () => {
    expectMalformed(patched(genuine(), (impact) => ({
      ...impact,
      affectedNetIds: [1.5, -2, Number.MAX_VALUE],
      routingCompletion: { ...(impact.routingCompletion as Record<string, unknown>), beforePercent: Infinity },
    })), "R24c");
  });
});

// ─── §B — exact key sets at EVERY impact nested boundary ─────────────────────

describe("B15.2.3 §B — closed key sets", () => {
  it("an extra key at each nested boundary refuses", () => {
    const good = genuine();
    const boundaries: Array<[string, (impact: Record<string, unknown>) => Record<string, unknown>]> = [
      ["impact", (impact) => ({ ...impact, extra: 1 })],
      ["impact.drc", (impact) => ({ ...impact, drc: { ...(impact.drc as Record<string, unknown>), extra: 1 } })],
      ["impact.connectivity", (impact) => ({ ...impact, connectivity: { ...(impact.connectivity as Record<string, unknown>), extra: 1 } })],
      ["impact.routingCompletion", (impact) => ({ ...impact, routingCompletion: { ...(impact.routingCompletion as Record<string, unknown>), extra: 1 } })],
      ["impact.readiness", (impact) => ({ ...impact, readiness: { ...(impact.readiness as Record<string, unknown>), extra: 1 } })],
    ];
    for (const [label, patch] of boundaries) expectMalformed(patched(good, patch), label);
  });

  it("a missing key at each nested boundary refuses", () => {
    const good = genuine();
    const drop = (record: Record<string, unknown>, key: string): Record<string, unknown> => {
      const next = { ...record };
      delete next[key];
      return next;
    };
    const boundaries: Array<[string, (impact: Record<string, unknown>) => Record<string, unknown>]> = [
      ["impact.warnings", (impact) => drop(impact, "warnings")],
      ["impact.connectivity (whole)", (impact) => drop(impact, "connectivity")],
      ["impact.drc.newViolationIds", (impact) => ({ ...impact, drc: drop(impact.drc as Record<string, unknown>, "newViolationIds") })],
      ["impact.connectivity.afterShorts", (impact) => ({ ...impact, connectivity: drop(impact.connectivity as Record<string, unknown>, "afterShorts") })],
      ["impact.routingCompletion.delta", (impact) => ({ ...impact, routingCompletion: drop(impact.routingCompletion as Record<string, unknown>, "delta") })],
      ["impact.readiness.reason", (impact) => ({ ...impact, readiness: drop(impact.readiness as Record<string, unknown>, "reason") })],
    ];
    for (const [label, patch] of boundaries) expectMalformed(patched(good, patch), label);
  });
});

// ─── §C — numeric contracts and producer arithmetic ──────────────────────────

describe("B15.2.3 §C — numeric semantics", () => {
  it("NaN, ±Infinity, negative and fractional counts refuse", () => {
    const good = genuine();
    const cases: Array<[string, (impact: Record<string, unknown>) => Record<string, unknown>]> = [
      ["NaN beforeErrors", (impact) => ({ ...impact, drc: { ...(impact.drc as Record<string, unknown>), beforeErrors: NaN } })],
      ["Infinity afterPercent", (impact) => ({ ...impact, routingCompletion: { ...(impact.routingCompletion as Record<string, unknown>), afterPercent: Infinity } })],
      ["-Infinity delta", (impact) => ({ ...impact, routingCompletion: { ...(impact.routingCompletion as Record<string, unknown>), delta: -Infinity } })],
      ["negative beforeShorts", (impact) => ({ ...impact, connectivity: { ...(impact.connectivity as Record<string, unknown>), beforeShorts: -1 } })],
      ["fractional afterTotalNets", (impact) => ({ ...impact, connectivity: { ...(impact.connectivity as Record<string, unknown>), afterTotalNets: 1.5 } })],
      ["percent above 100", (impact) => ({ ...impact, routingCompletion: { beforePercent: 120, afterPercent: 120, delta: 0 } })],
      ["negative percent", (impact) => ({ ...impact, routingCompletion: { beforePercent: -5, afterPercent: 0, delta: 5 } })],
    ];
    for (const [label, patch] of cases) expectMalformed(patched(good, patch), label);
  });

  it("affectedNetIds must be finite, safe, nonnegative integers", () => {
    const good = genuine();
    for (const [label, ids] of [
      ["fractional", [1.5]], ["negative", [-2]], ["unsafe magnitude", [Number.MAX_VALUE]],
      ["NaN", [NaN]], ["Infinity", [Infinity]], ["string entry", ["1"]],
    ] as Array<[string, unknown[]]>) {
      expectMalformed(patched(good, (impact) => ({ ...impact, affectedNetIds: ids })), label);
    }
  });

  it("inconsistent routed/total/unrouted arithmetic refuses", () => {
    const good = genuine();
    const connectivity = impactOf(good).connectivity as Record<string, unknown>;
    const cases: Array<[string, Record<string, unknown>]> = [
      ["routed exceeds total", { ...connectivity, beforeRoutedNets: (connectivity.beforeTotalNets as number) + 1 }],
      ["beforeUnrouted mismatch", { ...connectivity, beforeUnrouted: (connectivity.beforeUnrouted as number) + 1 }],
      ["afterUnrouted mismatch", { ...connectivity, afterUnrouted: (connectivity.afterUnrouted as number) + 1 }],
    ];
    for (const [label, next] of cases) {
      expectMalformed(patched(good, (impact) => ({ ...impact, connectivity: next })), label);
    }
  });

  it("a completion delta that is not exactly afterPercent − beforePercent refuses", () => {
    const good = genuine();
    const routing = impactOf(good).routingCompletion as Record<string, unknown>;
    expectMalformed(patched(good, (impact) => ({ ...impact, routingCompletion: { ...routing, delta: (routing.delta as number) + 0.1 } })), "delta drift");
    expectMalformed(patched(good, (impact) => ({ ...impact, routingCompletion: { beforePercent: 100, afterPercent: 0, delta: -150 } })), "delta out of range");
  });
});

// ─── §D — bounds from the PRODUCER-exported limits ───────────────────────────

describe("B15.2.3 §D — bounded arrays and strings", () => {
  it("the ceilings are the producer's: 16 ops × 64 nets × 4 rule fields, 1024-char text", () => {
    expect(BOUNDED_EDIT_IMPACT_LIMITS.maxArrayEntries).toBe(4096);
    expect(BOUNDED_EDIT_IMPACT_LIMITS.maxTextLength).toBe(1024);
  });

  it("an oversized impact array refuses", () => {
    const good = genuine();
    const oversized = Array.from({ length: BOUNDED_EDIT_IMPACT_LIMITS.maxArrayEntries + 1 }, () => "x");
    expectMalformed(patched(good, (impact) => ({ ...impact, ruleChanges: oversized })), "ruleChanges oversized");
    expectMalformed(patched(good, (impact) => ({ ...impact, warnings: oversized })), "warnings oversized");
  });

  it("an oversized impact string refuses", () => {
    const good = genuine();
    const oversized = "x".repeat(BOUNDED_EDIT_IMPACT_LIMITS.maxTextLength + 1);
    expectMalformed(patched(good, (impact) => ({ ...impact, operationSummaries: [oversized] })), "summary oversized");
    expectMalformed(patched(good, (impact) => ({ ...impact, readiness: { state: "unavailable", reason: oversized } })), "reason oversized");
  });
});

// ─── §E — producer-canonical order, and NO invented order ────────────────────

describe("B15.2.3 §E — canonical uniqueness and order", () => {
  it("duplicate or unsorted set-produced ID arrays refuse", () => {
    const good = genuine();
    const minted = (good.mintedObjectIds as string[]) ?? [];
    const changed = impactOf(good).changedObjectIds as string[];
    const cases: Array<[string, (impact: Record<string, unknown>) => Record<string, unknown>]> = [
      ["changedObjectIds duplicate", (impact) => ({ ...impact, changedObjectIds: [...changed, ...changed] })],
      ["changedObjectIds unsorted", (impact) => ({ ...impact, changedObjectIds: [...changed, "a0"] })],
      ["resolvedViolationIds duplicate", (impact) => ({ ...impact, drc: { ...(impact.drc as Record<string, unknown>), resolvedViolationIds: ["drc_1", "drc_1"] } })],
      ["newViolationIds unsorted", (impact) => ({ ...impact, drc: { ...(impact.drc as Record<string, unknown>), newViolationIds: ["drc_2", "drc_1"] } })],
      ["affectedNetIds duplicate", (impact) => ({ ...impact, affectedNetIds: [1, 1] })],
      ["affectedNetIds unsorted", (impact) => ({ ...impact, affectedNetIds: [2, 1] })],
      ["affectedLayers unsorted", (impact) => ({ ...impact, affectedLayers: ["copperTop", "copperBottom"] })],
    ];
    expect(minted.length).toBe(0); // update_track mints nothing — mutations stay shape-only
    for (const [label, patch] of cases) expectMalformed(patched(good, patch), label);
  });

  it("operationSummaries keeps SUBMITTED order (never sort-checked) but must be one line per operation", () => {
    // Two ops whose summaries are lexically DESCENDING ("Update…" then
    // "Add…"): a genuine proposal in submitted order must still verify.
    const twoOps = seal({ intent: "two", operations: [
      { kind: "update_track", trackId: "t1", widthNm: 500_000 },
      { kind: "add_keepout", polygon: [
        { x: 60_000_000, y: 60_000_000 }, { x: 70_000_000, y: 60_000_000 }, { x: 70_000_000, y: 70_000_000 },
      ], layers: ["copperTop"], forbidTracks: true, forbidVias: true },
    ] });
    const summaries = impactOf(twoOps).operationSummaries as string[];
    expect(summaries).toHaveLength(2);
    expect(summaries[0] > summaries[1]).toBe(true); // genuinely out of lexical order
    expect(verifySealedPcbEditProposalIntegrity(twoOps)).toEqual({ ok: true });
    // …but the COUNT is the producer's: one line per operation.
    expectMalformed(patched(twoOps, (impact) => ({ ...impact, operationSummaries: [...(impact.operationSummaries as string[]), "forged extra line"] })), "extra summary");
    expectMalformed(patched(twoOps, (impact) => ({ ...impact, operationSummaries: (impact.operationSummaries as string[]).slice(0, 1) })), "missing summary");
  });
});

// ─── §F — totality against hostile values ────────────────────────────────────

describe("B15.2.3 §F — hostile impact values refuse without throwing or hanging", () => {
  it("a proxy-backed impact array with a lying huge length refuses fast", () => {
    const good = genuine();
    const lying = new Proxy([], {
      get(target, key, receiver) {
        if (key === "length") return 2 ** 40; // would be a spin loop if iterated
        return Reflect.get(target, key, receiver);
      },
    });
    const body = { ...good, impact: { ...impactOf(good), changedObjectIds: lying } };
    const started = Date.now();
    const verdict = verifySealedPcbEditProposalIntegrity(body);
    expect(verdict.ok).toBe(false);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("throwing getters, revoked proxies, cycles and sparse arrays refuse, never throw", () => {
    const good = genuine();
    const throwingDrc = new Proxy({}, { get() { throw new Error("trap"); }, ownKeys() { throw new Error("trap"); } });
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const cyclic = structuredClone(impactOf(good));
    (cyclic as Record<string, unknown>).drc = cyclic; // cycle at a closed boundary
    const sparse = new Array(3);
    sparse[0] = "a1";
    sparse[2] = "c1"; // hole at index 1
    const bodies: Array<[string, unknown]> = [
      ["throwing drc", { ...good, impact: { ...impactOf(good), drc: throwingDrc } }],
      ["revoked impact", { ...good, impact: revoked.proxy }],
      ["cyclic impact", { ...good, impact: cyclic }],
      ["sparse changedObjectIds", { ...good, impact: { ...impactOf(good), changedObjectIds: sparse } }],
      ["proxy impact object", { ...good, impact: new Proxy(impactOf(good), { getPrototypeOf() { throw new Error("trap"); } }) }],
    ];
    for (const [label, body] of bodies) {
      expect(() => verifySealedPcbEditProposalIntegrity(body), label).not.toThrow();
      expect(verifySealedPcbEditProposalIntegrity(body).ok, label).toBe(false);
    }
  });
});

// ─── §G — genuine producer output still verifies ─────────────────────────────

describe("B15.2.3 §G — the validator is aligned with the real producer", () => {
  it("a genuine single-op proposal verifies", () => {
    expect(verifySealedPcbEditProposalIntegrity(genuine())).toEqual({ ok: true });
  });

  it("a genuine net-class rule proposal — nonempty ruleChanges, affectedNetIds and a minted rule id — verifies", () => {
    const rule = seal({ intent: "class", operations: [{ kind: "set_net_class_rule", netIds: [1], trackWidthNm: 200_000 }] });
    const impact = impactOf(rule);
    expect((impact.ruleChanges as string[]).length).toBeGreaterThan(0);
    expect(impact.affectedNetIds).toEqual([1]);
    expect((rule.mintedObjectIds as string[]).length).toBe(1);
    expect(verifySealedPcbEditProposalIntegrity(rule)).toEqual({ ok: true });
  });
});
