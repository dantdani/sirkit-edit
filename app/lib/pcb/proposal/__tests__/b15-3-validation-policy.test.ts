/**
 * B15.3 pre-exposure gate — the sealed VALIDATION POLICY.
 *
 * Reproduced before the closure: the same board + payload sealed under two
 * DIFFERENT DRC presets (jlcpcb-2l vs oshpark-4l) produced BYTE-IDENTICAL
 * sealed bodies, both verifying ok:true — the validation policy was provably
 * unpinned, so an apply path could never prove which rules the impact
 * evidence was computed under. Exposure was gated on closing this.
 *
 * Closed: the caller names a preset; the service resolves the canonical
 * in-repo registry, compiles under EXACTLY those rules, and seals
 * { presetId, presetVersion, rulesDigest, compileSchema } inside the
 * identity-digested body. Verification recomputes the rules digest from the
 * registry — stale or foreign policy refuses.
 */

import { describe, expect, it } from "vitest";
import { createEmptyBoard } from "../../types";
import type { PcbBoard } from "../../types";
import { getPreset, DEFAULT_PRESET_ID } from "../../drc/presets";
import { BOUNDED_EDIT_COMPILE_SCHEMA } from "../bounded-edit-compiler";
import { createSealedPcbEditProposal } from "../pcb-edit-proposal-service";
import {
  resolvePcbValidationPolicy,
  verifySealedPcbEditProposalIntegrity,
} from "../sealed-pcb-edit-proposal";
import { engineeringDigest } from "../../../engineering/stable";

// B16.0.1: the identity digest schema moved .v1 → .v2 with the proposal schema.
const IDENTITY_DIGEST_SCHEMA = "sirkit.pcb-bounded-edit-proposal-id.v2";

function board(): PcbBoard {
  const source = createEmptyBoard();
  source.outline = { kind: "rect", width: 100_000_000, height: 80_000_000, origin: { x: 0, y: 0 } };
  source.nets.push({ id: 1, name: "NET1" });
  source.tracks = [{ id: "t1", layer: "copperTop", width: 400_000, start: { x: 10_000_000, y: 10_000_000 }, end: { x: 20_000_000, y: 10_000_000 }, netId: 1 }];
  return source;
}

const CONTEXT = {
  scope: { tenantId: "t", projectId: "p", branchId: "main", boardInstanceId: "b" },
  base: { canonicalResource: { resourceId: "r", contentDigest: "d" }, historyHead: { sequence: 0, label: null }, lineageId: "lin" },
  actor: { actorId: "a", kind: "ai" }, effectiveActor: { actorId: "u", kind: "human" },
  discovery: { digest: "x", contextDigest: "y" }, provenance: { provider: "p", model: "m", runId: null },
  nonce: "n0n6e0000000000a", now: 1_000_000,
} as const;

const PAYLOAD = { intent: "widen", operations: [{ kind: "update_track", trackId: "t1", widthNm: 500_000 }] };

function seal(presetId: string): Record<string, unknown> {
  const created = createSealedPcbEditProposal({ payload: PAYLOAD, board: board(), validationPolicy: { presetId }, ...CONTEXT });
  if (!created.ok) throw new Error(`fixture must seal: ${created.code} ${created.detail}`);
  return created.proposal as unknown as Record<string, unknown>;
}

function reseal(body: Record<string, unknown>): Record<string, unknown> {
  const rest = { ...body };
  delete rest.proposalId;
  return { ...body, proposalId: `pprop-${engineeringDigest({ schema: IDENTITY_DIGEST_SCHEMA, body: rest }).slice(5, 21)}` };
}

describe("B15.3 — the validation policy is sealed and integrity-pinned", () => {
  it("a genuine proposal pins the exact preset identity, version, canonical rules digest, and compile schema", () => {
    const sealed = seal(DEFAULT_PRESET_ID);
    const resolved = resolvePcbValidationPolicy(DEFAULT_PRESET_ID);
    expect(resolved).not.toBeNull();
    expect(sealed.validationPolicy).toEqual({
      presetId: DEFAULT_PRESET_ID,
      presetVersion: getPreset(DEFAULT_PRESET_ID).version,
      rulesDigest: resolved!.policy.rulesDigest,
      compileSchema: BOUNDED_EDIT_COMPILE_SCHEMA,
    });
    expect(verifySealedPcbEditProposalIntegrity(sealed)).toEqual({ ok: true });
  });

  it("THE REPRODUCTION CLOSES: different presets no longer produce identical sealed bodies", () => {
    const a = seal("jlcpcb-2l");
    const b = seal("oshpark-4l");
    // Before B15.3 these were byte-identical and both verified.
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
    expect((a.validationPolicy as Record<string, unknown>).presetId).toBe("jlcpcb-2l");
    expect((b.validationPolicy as Record<string, unknown>).presetId).toBe("oshpark-4l");
    expect((a.validationPolicy as Record<string, unknown>).rulesDigest)
      .not.toBe((b.validationPolicy as Record<string, unknown>).rulesDigest);
    expect(verifySealedPcbEditProposalIntegrity(a)).toEqual({ ok: true });
    expect(verifySealedPcbEditProposalIntegrity(b)).toEqual({ ok: true });
  });

  it("a tampered policy refuses even with a recomputed whole-body checksum", () => {
    const good = seal(DEFAULT_PRESET_ID);
    const policy = good.validationPolicy as Record<string, unknown>;
    const cases: Array<[string, Record<string, unknown>]> = [
      ["forged rulesDigest", { ...policy, rulesDigest: "eng1-0000000000000000000000000000000000000000000000000000000000000000" }],
      ["unknown preset", { ...policy, presetId: "evil-fab-9000" }],
      ["wrong preset version", { ...policy, presetVersion: (policy.presetVersion as number) + 1 }],
      ["foreign compile schema", { ...policy, compileSchema: "sirkit.evil-compile.v999" }],
      ["cross-preset digest swap", { ...policy, presetId: "oshpark-4l", presetVersion: getPreset("oshpark-4l").version }],
    ];
    for (const [label, tampered] of cases) {
      const verdict = verifySealedPcbEditProposalIntegrity(reseal({ ...good, validationPolicy: tampered }));
      expect(verdict.ok, label).toBe(false);
      if (!verdict.ok) expect(verdict.code, label).toBe("malformed");
    }
  });

  it("a missing policy, and unknown keys inside it, refuse", () => {
    const good = seal(DEFAULT_PRESET_ID);
    const missing = { ...good };
    delete missing.validationPolicy;
    expect(verifySealedPcbEditProposalIntegrity(reseal(missing))).toMatchObject({ ok: false, code: "malformed" });
    const extra = { ...good, validationPolicy: { ...(good.validationPolicy as Record<string, unknown>), extra: 1 } };
    expect(verifySealedPcbEditProposalIntegrity(reseal(extra))).toMatchObject({ ok: false, code: "malformed" });
  });

  it("the service refuses an unknown preset and never fabricates a policy", () => {
    const refused = createSealedPcbEditProposal({ payload: PAYLOAD, board: board(), validationPolicy: { presetId: "evil-fab-9000" }, ...CONTEXT });
    expect(refused).toMatchObject({ ok: false, code: "invalid-validation-policy" });
  });

  it("a caller-smuggled rules object has NO effect — the sealed policy is registry-derived", () => {
    const hostileRules = { default: { clearanceNm: 1, minTrackWidthNm: 1, minViaOuterNm: 1, minViaDrillNm: 1, minAnnularRingNm: 1, minPthAnnularRingNm: 1, minHoleToHoleNm: 1, minEdgeClearanceNm: 1, minSilkPadClearanceNm: 1, minCourtyardClearanceNm: 1 }, perClass: {} };
    const smuggled = createSealedPcbEditProposal({
      payload: PAYLOAD, board: board(), validationPolicy: { presetId: DEFAULT_PRESET_ID },
      ...CONTEXT,
      // a removed legacy parameter, smuggled back in — must be inert
      ...( { rules: hostileRules } as Record<string, unknown>),
    } as never);
    expect(smuggled.ok).toBe(true);
    if (!smuggled.ok) return;
    expect((smuggled.proposal.validationPolicy as { rulesDigest: string }).rulesDigest)
      .toBe(resolvePcbValidationPolicy(DEFAULT_PRESET_ID)!.policy.rulesDigest);
    expect(verifySealedPcbEditProposalIntegrity(smuggled.proposal)).toEqual({ ok: true });
  });
});
