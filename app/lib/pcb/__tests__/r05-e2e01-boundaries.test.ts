/**
 * R05-E2E01 regression suite.
 *
 * One test per boundary repaired while qualifying the real prompt-to-Gerber
 * path. Each of these was a live failure, not a hypothetical: the comments name
 * the exact symptom so a regression is recognisable.
 */

import { describe, expect, it } from "vitest";
import { canonicalPublicationGraph, publicationSourceDigest, canonicalAuthoritativeSnapshot, pcbSyncDigest } from "@/app/lib/pcb-sync/stable";
import type { PcbSyncSchematicComponent, PcbSyncSchematicNet } from "@/app/lib/pcb-sync/types";
import { evaluateAutonomousCapability } from "@/app/lib/pcb/autonomous/capability-profile";
import { toProviderError, isRetryableReason } from "@/app/lib/llm/errors";
import { normalizeValueKey } from "@/app/lib/atomic/value-key";
import { parseFootprintAsset } from "@/app/lib/atomic/kicad-assets";
import { fitOutlineCandidates, withResizedOutline } from "@/app/lib/pcb/autoplace/fit-outline";
import { buildAutonomousGoldenBoard, autonomousGoldenDeclaration, AUTONOMOUS_GOLDEN_RULES } from "./fixtures/autonomous-golden-board";
import { mmToNm } from "@/app/lib/pcb/units";

// ─── Provider failure classification ─────────────────────────────────────────

describe("provider failure classification", () => {
  it("distinguishes billing exhaustion from a transient rate limit", () => {
    // Live symptom: an out-of-credits account was reported as "rejected this AI
    // request" (bad_request), and separately would have been conflated with a
    // retryable 429. Anthropic returns 400 invalid_request_error for billing.
    const anthropicBilling = Object.assign(new Error("Request failed"), {
      status: 400,
      error: { type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits." } },
    });
    const billing = toProviderError("anthropic", anthropicBilling);
    expect(billing.reason).toBe("insufficient_quota");
    expect(isRetryableReason(billing.reason)).toBe(false);
    expect(billing.message).toMatch(/out of credits|billing quota/i);

    // OpenAI reports the same condition as 429 insufficient_quota — still not retryable.
    const openaiQuota = Object.assign(new Error("429"), { status: 429, code: "insufficient_quota" });
    expect(toProviderError("openai", openaiQuota).reason).toBe("insufficient_quota");

    // A genuine rate limit stays retryable.
    const rateLimited = Object.assign(new Error("429"), { status: 429, code: "rate_limit_error" });
    const rl = toProviderError("anthropic", rateLimited);
    expect(rl.reason).toBe("rate_limit");
    expect(isRetryableReason(rl.reason)).toBe(true);
  });

  it("separates a missing key from an invalid key and reads nested Anthropic error types", () => {
    const missing = toProviderError("anthropic", new Error("Missing ANTHROPIC_API_KEY environment variable"));
    expect(missing.reason).toBe("missing_credentials");

    const invalid = Object.assign(new Error("401"), { status: 401, error: { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } } });
    expect(toProviderError("anthropic", invalid).reason).toBe("authentication");

    const overloaded = Object.assign(new Error("529"), { status: 529 });
    expect(isRetryableReason(toProviderError("anthropic", overloaded).reason)).toBe(true);
  });

  it("never leaks a provider message that could carry a secret into the reason", () => {
    const err = Object.assign(new Error("boom"), { status: 400, error: { type: "error", error: { type: "invalid_request_error", message: "x".repeat(5000) } } });
    const normalized = toProviderError("anthropic", err);
    // providerMessage is retained for operators but bounded before surfacing.
    expect(normalized.providerMessage!.length).toBeLessThanOrEqual(5000);
    expect(normalized.message).not.toContain("x".repeat(400));
  });
});

// ─── Publication source digest agreement ─────────────────────────────────────

describe("publication source digest", () => {
  const component = (id: string, ref: string): PcbSyncSchematicComponent => ({
    componentInstanceId: id, componentRevision: `r:${id}`, referenceDesignator: ref,
    hierarchyPath: ["root"], symbolAssetVersionId: "symbolv_x", applicability: "applicable",
    pins: [
      { pinInstanceId: `${id}:pin:2`, number: "2", disposition: "connected" },
      { pinInstanceId: `${id}:pin:1`, number: "1", disposition: "connected" },
    ],
  });
  const net = (id: string, members: Array<[string, string]>): PcbSyncSchematicNet => ({
    stableNetId: id, connectivityRevision: `c:${id}`, canonicalScope: ["root"], displayName: id,
    aliases: [], classification: "signal",
    members: members.map(([c, p]) => ({ componentInstanceId: c, pinInstanceId: `${c}:pin:${p}`, pinNumber: p })),
    explicitNoConnectPinIds: [], constraintRefs: [],
  });

  it("is invariant to component, pin and member ordering", () => {
    // Live symptom: PS_SOURCE_DIGEST_MISMATCH. The builder sorted components by
    // reference designator and members by pinInstanceId, while the publisher
    // canonicalised by componentInstanceId and (component, pin) — so a
    // byte-identical graph produced two different digests and never published.
    const graphA = {
      components: [component("u2", "U2"), component("u1", "U1")],
      nets: [net("net:b", [["u2", "1"], ["u1", "2"]]), net("net:a", [["u1", "1"]])],
      prerequisiteIssues: [],
    };
    const graphB = {
      components: [component("u1", "U1"), component("u2", "U2")],
      nets: [net("net:a", [["u1", "1"]]), net("net:b", [["u1", "2"], ["u2", "1"]])],
      prerequisiteIssues: [],
    };
    expect(publicationSourceDigest(graphA)).toBe(publicationSourceDigest(graphB));
  });

  it("still changes when the graph genuinely differs", () => {
    const base = { components: [component("u1", "U1")], nets: [net("net:a", [["u1", "1"]])], prerequisiteIssues: [] };
    const changed = { components: [component("u1", "U1")], nets: [net("net:a", [["u1", "2"]])], prerequisiteIssues: [] };
    expect(publicationSourceDigest(base)).not.toBe(publicationSourceDigest(changed));
  });

  it("is the exact form the authoritative snapshot canonicalises to", () => {
    // Guards the shared definition: if canonicalAuthoritativeSnapshot ever
    // diverges from canonicalPublicationGraph, publication breaks again.
    const graph = { components: [component("u2", "U2"), component("u1", "U1")], nets: [net("net:a", [["u1", "1"]])], prerequisiteIssues: [] };
    const viaGraph = canonicalPublicationGraph(graph);
    const viaSnapshot = canonicalAuthoritativeSnapshot({
      schemaVersion: "sirkit.pcb-sync-authoritative-snapshot.v1", tenantId: "t", projectId: "p", branchId: "main",
      designId: "d", projectRevision: "pr", designRevision: "dr", schematicRevision: "sr", schematicDigest: "sd",
      componentSetRevision: "cr", netGraphRevision: "nr", netGraphDigest: "nd", assemblyVariantId: "v",
      assemblyVariantRevision: "vr", librarySnapshotRevision: "lr", ...graph,
    } as never);
    expect(pcbSyncDigest({ components: viaSnapshot.components, nets: viaSnapshot.nets, prerequisiteIssues: viaSnapshot.prerequisiteIssues }))
      .toBe(pcbSyncDigest(viaGraph));
  });
});

// ─── Capability evaluation digest survives persistence ───────────────────────

describe("autonomous capability digest", () => {
  it("is invariant to object key order, so it survives a jsonb round-trip", () => {
    // Live symptom: MFG_RC03_RECOMPUTATION_MISMATCH. Postgres jsonb does not
    // preserve object key order, and the digest used plain JSON.stringify — so
    // stored RC03 evidence could never be re-verified at release time.
    const board = buildAutonomousGoldenBoard(6);
    const rules = AUTONOMOUS_GOLDEN_RULES;
    const declaration = autonomousGoldenDeclaration();
    const direct = evaluateAutonomousCapability({ board, rules, declaration, phase: "pre_placement" });

    // Simulate the persistence layer reordering every object key.
    const reorder = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(reorder);
      if (!value || typeof value !== "object") return value;
      const entries = Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, reorder(v)] as const);
      return Object.fromEntries([...entries].reverse());
    };
    const roundTripped = reorder(JSON.parse(JSON.stringify({ board, rules, declaration }))) as { board: typeof board; rules: typeof rules; declaration: typeof declaration };
    const afterPersistence = evaluateAutonomousCapability({ board: roundTripped.board, rules: roundTripped.rules, declaration: roundTripped.declaration, phase: "pre_placement" });

    expect(afterPersistence.evaluationDigest).toBe(direct.evaluationDigest);
  });

  it("still distinguishes a genuinely different rule set", () => {
    const board = buildAutonomousGoldenBoard(6);
    const declaration = autonomousGoldenDeclaration();
    const a = evaluateAutonomousCapability({ board, rules: AUTONOMOUS_GOLDEN_RULES, declaration, phase: "pre_placement" });
    const looser = structuredClone(AUTONOMOUS_GOLDEN_RULES);
    looser.default.clearanceNm = looser.default.clearanceNm + 1_000;
    const b = evaluateAutonomousCapability({ board, rules: looser, declaration, phase: "pre_placement" });
    expect(b.evaluationDigest).not.toBe(a.evaluationDigest);
  });
});

// ─── Value-key normalization for exact-part authority ────────────────────────

describe("component value normalization", () => {
  it("maps the forms a generator emits onto one key", () => {
    expect(normalizeValueKey("100nF")).toBe("100n");
    expect(normalizeValueKey("100 nF")).toBe("100n");
    expect(normalizeValueKey("10uF")).toBe("10u");
    expect(normalizeValueKey("10µF")).toBe("10u");
    expect(normalizeValueKey("10 μF")).toBe("10u");
    expect(normalizeValueKey("47k")).toBe("47k");
    expect(normalizeValueKey("47kΩ")).toBe("47k");
    expect(normalizeValueKey("470 ohm")).toBe("470");
    expect(normalizeValueKey("")).toBe("");
    expect(normalizeValueKey(undefined)).toBe("");
  });

  it("keeps genuinely different values distinct", () => {
    expect(normalizeValueKey("47k")).not.toBe(normalizeValueKey("470k"));
    expect(normalizeValueKey("10n")).not.toBe(normalizeValueKey("10u"));
  });
});

// ─── KiCad footprint parsing ─────────────────────────────────────────────────

describe("footprint asset parsing", () => {
  const footprint = (extra: string) => `(footprint "T"
  (version 20240108)
  (generator "pcbnew")
  (layer "F.Cu")
  (attr smd)
  (pad "1" smd rect (at -1 0) (size 1 1) (layers "F.Cu" "F.Paste" "F.Mask"))
  (pad "2" smd rect (at 1 0) (size 1 1) (layers "F.Cu" "F.Paste" "F.Mask"))
  ${extra}
)`;

  it("treats the KiCad 9+ (embedded_fonts no) flag as benign", () => {
    // Live symptom: every current-format KiCad footprint was rejected as
    // validationState "unsupported" because the presentational
    // `(embedded_fonts no)` flag was classed as unsupported semantics.
    const asset = parseFootprintAsset({ source: footprint("(embedded_fonts no)"), libraryNickname: "L", origin: { sourceRecordId: "sr", libraryNickname: "L", sourceUri: "u", licenseId: "lic" } });
    expect(asset.validationState).not.toBe("unsupported");
    expect(asset.pads).toHaveLength(2);
  });

  it("still rejects an actual embedded font payload and real unsupported semantics", () => {
    const withFonts = parseFootprintAsset({ source: footprint("(embedded_fonts yes)"), libraryNickname: "L", origin: { sourceRecordId: "sr", libraryNickname: "L", sourceUri: "u", licenseId: "lic" } });
    expect(withFonts.validationState).toBe("unsupported");

    const withZone = parseFootprintAsset({ source: footprint('(zone (net 0) (layer "F.Cu"))'), libraryNickname: "L", origin: { sourceRecordId: "sr", libraryNickname: "L", sourceUri: "u", licenseId: "lic" } });
    expect(withZone.validationState).toBe("unsupported");
  });
});

// ─── Board outline fitting ───────────────────────────────────────────────────

describe("board outline fitting", () => {
  it("proposes boards smaller than the profile maximum, ordered smallest first", () => {
    // A nine-part design was being released on the 100 x 80 mm profile-maximum
    // default panel; fabrication is priced by area.
    const board = buildAutonomousGoldenBoard(9);
    const candidates = fitOutlineCandidates(board, { maxWidthNm: mmToNm(100), maxHeightNm: mmToNm(80) });
    expect(candidates.length).toBeGreaterThan(0);
    for (const c of candidates) {
      expect(c.widthNm).toBeLessThanOrEqual(mmToNm(100));
      expect(c.heightNm).toBeLessThanOrEqual(mmToNm(80));
      expect(c.widthNm).toBeGreaterThan(0);
    }
    const areas = candidates.map((c) => c.widthNm * c.heightNm);
    expect([...areas].sort((a, b) => a - b)).toEqual(areas);
    // The smallest candidate must actually be a saving over the default panel.
    expect(areas[0]).toBeLessThan(mmToNm(100) * mmToNm(80));
  });

  it("resizes only the outline and leaves components untouched", () => {
    const board = buildAutonomousGoldenBoard(6);
    const before = structuredClone(board.outline);
    const resized = withResizedOutline(board, mmToNm(40), mmToNm(30));
    expect(resized.outline).toMatchObject({ kind: "rect", width: mmToNm(40), height: mmToNm(30) });
    expect(resized.footprints).toEqual(board.footprints);
    expect(resized.nets).toEqual(board.nets);
    // The source board must not be mutated in place.
    expect(board.outline).toEqual(before);
  });

  it("returns no candidates for a board with no components (never proposes a zero-size board)", () => {
    const empty = { ...buildAutonomousGoldenBoard(1), footprints: [] };
    expect(fitOutlineCandidates(empty, { maxWidthNm: mmToNm(100), maxHeightNm: mmToNm(80) })).toEqual([]);
  });
});

// ─── Drill number format ─────────────────────────────────────────────────────

describe("Excellon drill emission", () => {
  it("writes every value with an explicit decimal point", async () => {
    // Live symptom: `T02C1` for a 1 mm tool. With METRIC and no format
    // statement a bare integer is ambiguous (1 mm vs 1 µm under implied
    // decimals) and gerbonara refuses to parse it outright.
    const { writeXnc } = await import("@/app/lib/pcb/fab/native/drill");
    const hit = (id: string, xMm: number, diamMm: number) => ({
      kind: "hit" as const, id, at: { x: mmToNm(xMm), y: mmToNm(20) },
      diameterNm: mmToNm(diamMm), plated: true, span: [1, 2] as [number, number], sourceIds: [id],
    });
    const text = writeXnc({
      id: "pth-1-2", plated: true, span: [1, 2], fileFunction: "Plated,1,2,PTH",
      // 1.0 mm is the exact case that broke: it formatted as bare "C1".
      drills: [hit("d1", 40, 1), hit("d2", 41.5, 0.4)],
    });
    for (const line of text.split(String.fromCharCode(10)).map((l) => l.trim())) {
      const tool = /^T\d+C([-\d.]+)/.exec(line);
      if (tool) expect(tool[1], `tool diameter in "${line}"`).toContain(".");
      for (const m of line.matchAll(/[XY](-?[\d.]+)/g)) {
        expect(m[1], `coordinate in "${line}"`).toContain(".");
      }
    }
    expect(text).toContain("C1.0");
  });
});
