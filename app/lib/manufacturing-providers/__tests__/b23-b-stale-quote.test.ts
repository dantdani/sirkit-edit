/**
 * [B23-B3] Step 7 of B23-B, "Detect stale quotes and changed release inputs." (runbook :981; D23-17, D23-5's staleness half; OD-168),
 * read through GET /api/pcb-sync's core as the route composes it:
 *  1. D23-17: the summary's `current` flag compares the authority's board revision AND its digest, recomputed from the loaded board
 *     (`authoritativeBoardDigest`), never `current.digest` (a pcbSyncDigest): two boards with one revision and one pcbSyncDigest
 *     but two authoritative digests are told apart (on 0cd3f59 they were not);
 *  2. an observation is stale 24 hours after `retrievedAt` when the provider states no validity,
 *  3. or at the provider's stated validity (`validUntil`), whichever it states;
 *  4-8. and at once when the authority head moves, the release ledger head moves, the board revision OR digest moves, the registry
 *     row or the reviewed transfer descriptor moves, or the rule-profile evidence is invalid, expired or older than 366 days (or the
 *     profile itself moves);
 *  9. a superseded board, an absent authority, release or board stale it too; a stale observation stays listed, labelled, never
 *     current; the list is bounded and counts the rest;
 *  10. a corrupt exchange record makes the observation block corrupt with its bounded code (the summary's one read policy), never
 *     absent and never thrown, and leaves the other subjects as they are.
 * Nothing is written to disk and nothing leaves the process.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDurableWorkflowRepository } from "@/app/lib/durable-workflow/repository";
import { durableWorkflowDigest } from "@/app/lib/durable-workflow/stable";
import type { DurableAggregateRecord, DurableWorkflowRepository } from "@/app/lib/durable-workflow/types";
import { authoritativeBoardDigest } from "@/app/lib/pcb/fab/release-gate";
import { createProviderExchangeLedger } from "../exchange-ledger";
import { PROVIDER_TRANSFER_DESCRIPTORS } from "../provider-egress";
import { evaluateObservationStaleness, normalizeManufacturingObservation, OBSERVATION_DEFAULT_FRESHNESS_MS, OBSERVATION_PROFILE_EVIDENCE_MAX_AGE_MS, OBSERVATION_STALE_REASONS, REVIEWED_TRANSFER_VERSIONS, type ObservationCurrent } from "../provider-observation";
import { PROVIDER_ROWS } from "../provider-registry";
import { aggregateFor, BOARD, currentWorld, HOUR, JLCPCB_ROW, MOVED, NEXT_RELEASE, NOW, PROFILE, readSummary, recordAnswer, recordRelease, REORDERED, RETRIEVED_AT, saveAuthority } from "./_b23-b3-observation-fixture";
// [B23-B3 review, 2026-10-04] cases 11-14: the summary's digest without the release generator, withdrawn providers, several providers, both sides of the profile bounds
import ts from "typescript";
import { collectProductionFiles, resolveSpecifier } from "@/app/lib/project/__tests__/_import-gate-helpers";
import { fileOf, importClosure, runtimeDeclarationSpecifiers } from "@/app/lib/mcp/server/__tests__/_import-closure";
import { OBSERVATION_PROVIDER_IDS, OBSERVATION_UNLISTED_PROVIDER_NAME, OBSERVATION_WITHDRAWN_PROVIDER_IDS } from "../provider-observation";
import { TRANSFER } from "./_b23-b3-observation-fixture";

const ROOT = process.cwd();
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");
const T0 = Date.parse(RETRIEVED_AT);
const reasonsOf = async (workflow: DurableWorkflowRepository, record: typeof BOARD | null = BOARD, options: Parameters<typeof readSummary>[2] = {}) => {
  const { summary } = await readSummary(workflow, record, options);
  return summary.observations!.items.map((item) => ({ stale: item.stale, reasons: item.staleReasons }));
};

beforeEach(() => { vi.spyOn(console, "warn").mockImplementation(() => undefined); vi.spyOn(console, "error").mockImplementation(() => undefined); });

describe("[B23-B3] step 7: when an observation is stale (OD-168), and the summary's current flag (D23-17)", () => {
  it("1. D23-17: two boards with one revision and one pcbSyncDigest but two authoritative digests are told apart: the authority and its release are current only for the board the authority describes; the flag recomputes authoritativeBoardDigest from the loaded board, never current.digest", async () => {
    expect(REORDERED.revision).toBe(BOARD.revision);
    expect(REORDERED.digest).toBe(BOARD.digest);
    expect(authoritativeBoardDigest(REORDERED.board)).not.toBe(authoritativeBoardDigest(BOARD.board));
    const { workflow } = await currentWorld();
    const same = await readSummary(workflow, BOARD);
    expect({ authority: same.summary.authority?.current, release: same.summary.latestRelease?.current }).toEqual({ authority: true, release: true });
    const reordered = await readSummary(workflow, REORDERED);
    expect({ authority: reordered.summary.authority?.current, release: reordered.summary.latestRelease?.current }).toEqual({ authority: false, release: false });
    // the source: the flag recomputes the authoritative digest, as the release route does (release/route.ts, revalidateReleaseAuthority)
    const summarySource = read("app/api/pcb-sync/manufacturing-summary.ts");
    const flag = summarySource.split("\n").find((line) => line.includes("const authorityCurrent ="))!.split("//")[0]!; // the code, not its comment
    expect(flag).toContain("authoritativeBoardDigest(current.board)");
    expect(flag).not.toContain("current.digest");
    expect(read("app/api/pcb/release/route.ts")).toContain("authoritativeBoardDigest(head.record.board) !== stored.authority.boardDigest");
    // the stale header line is corrected in place with a dated note, never rewritten
    const header = summarySource.split("\n")[7]!;
    expect(header).toContain("board revision/digest the same request just loaded");
    expect(header).toContain("[B23-B3, 2026-10-04]");
    expect(header).toContain("D23-17");
  });

  it("2. without a stated validity an observation is current until 24 hours after retrievedAt and stale (expired) from then on, still listed with its label", async () => {
    expect(OBSERVATION_DEFAULT_FRESHNESS_MS).toBe(24 * HOUR);
    const { workflow } = await currentWorld({ normalized: { status: "received" } });
    expect(await reasonsOf(workflow, BOARD, { now: T0 + 24 * HOUR - 1 })).toEqual([{ stale: false, reasons: [] }]);
    expect(await reasonsOf(workflow, BOARD, { now: T0 + 24 * HOUR })).toEqual([{ stale: true, reasons: ["expired"] }]);
    const { summary } = await readSummary(workflow, BOARD, { now: T0 + 48 * HOUR });
    expect(summary.observations!.items[0]).toMatchObject({ label: "external observation, not Sirkit proof", stale: true, freshness: { basis: "default_24h", staleAt: new Date(T0 + 24 * HOUR).toISOString() } });
  });

  it("3. at the provider's stated validity (validUntil): earlier or later than 24 hours, it decides; a validity that is no instant is ignored (24 hours); one at or before retrievedAt is stale at once", async () => {
    const short = (await currentWorld({ normalized: { validUntil: new Date(T0 + 2 * HOUR).toISOString() } })).workflow;
    expect(await reasonsOf(short, BOARD, { now: T0 + 2 * HOUR - 1 })).toEqual([{ stale: false, reasons: [] }]);
    expect(await reasonsOf(short, BOARD, { now: T0 + 2 * HOUR })).toEqual([{ stale: true, reasons: ["expired"] }]);
    const long = (await currentWorld({ normalized: { validUntil: new Date(T0 + 72 * HOUR).toISOString() } })).workflow;
    expect(await reasonsOf(long, BOARD, { now: T0 + 25 * HOUR })).toEqual([{ stale: false, reasons: [] }]);
    expect(await reasonsOf(long, BOARD, { now: T0 + 72 * HOUR })).toEqual([{ stale: true, reasons: ["expired"] }]);
    const prose = (await currentWorld({ normalized: { validUntil: "until next Tuesday" } })).workflow;
    const { summary } = await readSummary(prose, BOARD, { now: T0 + 25 * HOUR });
    expect(summary.observations!.items[0]).toMatchObject({ stale: true, staleReasons: ["expired"], freshness: { basis: "default_24h", providerValidUntil: null } });
    const past = (await currentWorld({ normalized: { validUntil: new Date(T0 - HOUR).toISOString() } })).workflow;
    expect(await reasonsOf(past, BOARD, { now: T0 + 60_000 })).toEqual([{ stale: true, reasons: ["expired"] }]);
  });

  it("4. stale at once when the authority head moves (a re-qualification); once its release is recorded, the ledger head has moved too", async () => {
    const { workflow } = await currentWorld();
    expect(await reasonsOf(workflow)).toEqual([{ stale: false, reasons: [] }]);
    const requalified = await saveAuthority(workflow, BOARD.board, "qualify-b3-2", { schematic: "schematic-b3-r2" });
    expect(requalified.revision).toBe(2);
    expect(await reasonsOf(workflow)).toEqual([{ stale: true, reasons: ["authority_moved"] }]);
    await recordRelease(workflow, requalified, BOARD.board, NEXT_RELEASE);
    expect(await reasonsOf(workflow)).toEqual([{ stale: true, reasons: ["ledger_head_moved"] }]);
  });

  it("5. stale at once when the release ledger head moves (another release of the board is recorded)", async () => {
    const { workflow, saved } = await currentWorld();
    await recordRelease(workflow, saved, BOARD.board, NEXT_RELEASE);
    expect(await reasonsOf(workflow)).toEqual([{ stale: true, reasons: ["ledger_head_moved"] }]);
  });

  it("6. stale at once when the board revision moves, and when ONLY its digest moves (the same revision, another board JSON): compared with the recomputed authoritative digest, never current.digest", async () => {
    const { workflow } = await currentWorld();
    expect(await reasonsOf(workflow, MOVED)).toEqual([{ stale: true, reasons: ["board_revision_moved", "board_digest_moved"] }]);
    expect(await reasonsOf(workflow, REORDERED)).toEqual([{ stale: true, reasons: ["board_digest_moved"] }]);
  });

  it("7. stale at once when the descriptor moves: the reviewed transfer descriptor's version (none is reviewed in B23, so in production no observation is current today), the registry row, or the registry version", async () => {
    expect([...REVIEWED_TRANSFER_VERSIONS]).toEqual(PROVIDER_TRANSFER_DESCRIPTORS.map((descriptor) => ({ providerId: descriptor.providerId, operationId: descriptor.operationId, version: descriptor.version })));
    expect(REVIEWED_TRANSFER_VERSIONS).toEqual([]);
    const { workflow } = await currentWorld();
    expect(await reasonsOf(workflow, BOARD, { transferVersions: REVIEWED_TRANSFER_VERSIONS })).toEqual([{ stale: true, reasons: ["descriptor_moved"] }]);
    expect(await reasonsOf(workflow, BOARD, { transferVersions: [{ providerId: "jlcpcb", operationId: "pcb-quote", version: "0.0.2" }] })).toEqual([{ stale: true, reasons: ["descriptor_moved"] }]);
    const revised = PROVIDER_ROWS.map((row) => (row.id === "jlcpcb" ? { ...row, notes: [...row.notes, "a revised row (tests only)"] } : row));
    expect(await reasonsOf(workflow, BOARD, { registry: revised })).toEqual([{ stale: true, reasons: ["descriptor_moved"] }]);
    const attempt = (await createProviderExchangeLedger(workflow).load(aggregateFor()))!.attempts[0]!;
    const normalized = normalizeManufacturingObservation({ aggregate: aggregateFor(), attempt });
    if (!normalized.ok) throw new Error("not an observation");
    const current: ObservationCurrent = { now: new Date(NOW).toISOString(), authority: null, latestRelease: null, board: null };
    const olderRegistry = { ...normalized.observation, source: { ...normalized.observation.source, registryVersion: "0.9.0" } };
    expect(evaluateObservationStaleness(olderRegistry, current, { transferVersions: [{ providerId: "jlcpcb", operationId: "pcb-quote", version: "0.0.1" }] }).reasons).toContain("descriptor_moved");
    expect(evaluateObservationStaleness(normalized.observation, current, { transferVersions: [{ providerId: "jlcpcb", operationId: "pcb-quote", version: "0.0.1" }] }).reasons).not.toContain("descriptor_moved");
    expect(durableWorkflowDigest(JLCPCB_ROW)).toBe(normalized.observation.source.registryDigest);
  });

  it("8. stale at once when the rule-profile evidence expires (2027-09-09 for jlcpcb-2l), is older than RELEASE_PROFILE_EVIDENCE_MAX_AGE_MS, or is not a v2 profile, and when the profile itself moves; the observation's bound is the release route's", async () => {
    expect(read("app/api/pcb/release/route.ts")).toContain("export const RELEASE_PROFILE_EVIDENCE_MAX_AGE_MS = 366 * 24 * 60 * 60 * 1000;");
    expect(OBSERVATION_PROFILE_EVIDENCE_MAX_AGE_MS).toBe(366 * 24 * 60 * 60 * 1000);
    expect(PROFILE.evidence.expiresAt).toBe("2027-09-09");
    const lasting = { validUntil: "2027-12-31T00:00:00.000Z" };
    const { workflow } = await currentWorld({ normalized: lasting });
    expect(await reasonsOf(workflow, BOARD, { now: Date.parse("2027-09-09T23:59:59.999Z") })).toEqual([{ stale: false, reasons: [] }]);
    expect(await reasonsOf(workflow, BOARD, { now: Date.parse("2027-09-10T00:00:00.000Z") })).toEqual([{ stale: true, reasons: ["profile_evidence_expired"] }]);
    const evidence = { ...PROFILE.evidence, retrievedAt: "2026-01-01", expiresAt: "2027-01-02" };
    for (const [profile, now, reasons] of [
      [{ ...PROFILE, evidence }, Date.parse("2027-01-02T00:00:00.001Z"), ["profile_evidence_too_old"]],
      [{ ...PROFILE, version: PROFILE.version + 1 }, NOW, ["profile_moved"]],
      [{ ...PROFILE, schemaVersion: "sirkit.manufacturing-rule-profile.v1" }, NOW, ["profile_evidence_invalid"]],
      [{ ...PROFILE, evidence: { ...PROFILE.evidence, sourceRefs: [] } }, NOW, ["profile_evidence_invalid"]],
    ] as const) {
      const world = new InMemoryDurableWorkflowRepository();
      const saved = await saveAuthority(world, BOARD.board, "qualify-b3-profile", { profile });
      await recordRelease(world, saved, BOARD.board);
      await recordAnswer(world, { normalized: lasting });
      expect(await reasonsOf(world, BOARD, { now }), JSON.stringify(reasons)).toEqual([{ stale: true, reasons }]);
    }
  });

  it("9. a superseded board, an absent authority, release or board stale an observation too; a stale observation stays listed and labelled, never current; at most 32 are listed, newest first, and the rest are counted", async () => {
    const { workflow } = await currentWorld();
    expect(await reasonsOf(workflow, BOARD, { lineageState: "superseded" })).toEqual([{ stale: true, reasons: ["board_superseded"] }]);
    expect(await reasonsOf(workflow, BOARD, { lineageState: "current" })).toEqual([{ stale: false, reasons: [] }]);
    expect(await reasonsOf(workflow, null)).toEqual([{ stale: true, reasons: ["board_unavailable"] }]);
    const noAuthority = new InMemoryDurableWorkflowRepository();
    await recordAnswer(noAuthority);
    expect(await reasonsOf(noAuthority)).toEqual([{ stale: true, reasons: ["authority_unavailable", "release_unavailable"] }]);
    const noRelease = new InMemoryDurableWorkflowRepository();
    await saveAuthority(noRelease, BOARD.board);
    await recordAnswer(noRelease);
    expect(await reasonsOf(noRelease)).toEqual([{ stale: true, reasons: ["release_unavailable"] }]);
    expect([...OBSERVATION_STALE_REASONS]).toEqual(["expired", "authority_unavailable", "authority_moved", "release_unavailable", "ledger_head_moved", "board_unavailable", "board_superseded", "board_revision_moved", "board_digest_moved", "descriptor_moved", "profile_moved", "profile_evidence_invalid", "profile_evidence_expired", "profile_evidence_too_old"]);
    // bounded: 33 answers to 33 releases' packages; the 32 newest are listed, newest first, the oldest is counted
    const many = new InMemoryDurableWorkflowRepository();
    for (let index = 0; index < 33; index += 1) await recordAnswer(many, { key: `key-b3-many-${String(index).padStart(2, "0")}`, retrievedAt: new Date(T0 + index * 60_000).toISOString(), release: { releaseId: `mfg-release-b3-many-${index}`, archiveSha256: index.toString(16).padStart(64, "0") } });
    const { summary } = await readSummary(many, BOARD, { now: T0 + 40 * 60_000 });
    expect(summary.observations!.items).toHaveLength(32);
    expect(summary.observations!.omitted).toBe(1);
    expect(summary.observations!.items[0]!.retrievedAt).toBe(new Date(T0 + 32 * 60_000).toISOString());
    expect(summary.observations!.items.every((item) => item.stale && item.label === "external observation, not Sirkit proof")).toBe(true);
  });

  it("10. a corrupt exchange record makes the observation block corrupt with its bounded code - never absent, never thrown, nothing of it shown - while the authority, release, snapshot and integrity verdicts are unaffected", async () => {
    const { workflow } = await currentWorld();
    const tamper = (record: DurableAggregateRecord | null): DurableAggregateRecord | null => (record && record.aggregateType === "mfg.provider-exchange.v1" ? { ...record, payload: { ...(record.payload as object), at: "2026-10-04T12:00:01.000Z" } } : record);
    const tampered: DurableWorkflowRepository = {
      loadHead: async (identity) => tamper(await workflow.loadHead(identity)) as never,
      listHeads: (input) => workflow.listHeads(input),
      loadRecord: async (scope, recordId) => tamper(await workflow.loadRecord(scope, recordId)) as never,
      history: async (identity) => (await workflow.history(identity)).map((record) => tamper(record)!) as never,
      getReplay: (scope, scopeKey, key) => workflow.getReplay(scope, scopeKey, key),
      commit: (request) => workflow.commit(request),
      claimOutbox: (input) => workflow.claimOutbox(input),
      completeOutbox: (input) => workflow.completeOutbox(input),
      failOutbox: (input) => workflow.failOutbox(input),
      listOutbox: (input) => workflow.listOutbox(input),
    };
    const { status, summary } = await readSummary(tampered, BOARD);
    expect(status).toBe(200);
    expect(summary.observations).toEqual({ state: "corrupt", codes: ["PX_LEDGER_DIGEST_MISMATCH"], items: [], omitted: 0 });
    expect(summary.integrity).toEqual({ authority: "ok", snapshot: "absent", latestRelease: "ok", codes: [] });
    expect({ authority: summary.authority?.current, release: summary.latestRelease?.current }).toEqual({ authority: true, release: true });
    // and no record at all is absent: no block, the summary keeps its earlier shape (OD-185), never corrupt
    const empty = new InMemoryDurableWorkflowRepository();
    expect((await readSummary(empty, BOARD)).summary.observations).toBeUndefined();
  });

  // [B23-B3 review, 2026-10-04] regressions-1
  it("11. the summary's authoritative digest is the release gate's formula over native/stable, declared in the summary, so GET /api/pcb-sync never loads the release generator: the two printed declarations are equal, both take sha256 and stableJson from native/stable, the summary has no runtime import of release-gate.ts, and the route's runtime closure holds neither release-gate.ts nor a module importing jszip (case 1 shows the flag telling the reordered board apart)", { timeout: 120_000 }, () => {
    const files = collectProductionFiles(ROOT);
    const SUMMARY = "app/api/pcb-sync/manufacturing-summary.ts";
    const GATE = "app/lib/pcb/fab/release-gate.ts";
    const STABLE = "app/lib/pcb/fab/native/stable.ts";
    const parsed = (path: string) => ts.createSourceFile(path, files.get(path)!, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const printed = (path: string): string | null => {
      const source = parsed(path);
      const declaration = source.statements.find((statement): statement is ts.FunctionDeclaration => ts.isFunctionDeclaration(statement) && statement.name?.text === "authoritativeBoardDigest");
      return declaration ? ts.createPrinter({ removeComments: true }).printNode(ts.EmitHint.Unspecified, declaration, source).replace(/^export /, "") : null;
    };
    expect(printed(GATE)).toContain("pcb-authority-");
    expect(printed(SUMMARY)).toBe(printed(GATE));
    for (const path of [SUMMARY, GATE]) {
      const helpers = parsed(path).statements.filter(ts.isImportDeclaration).filter((statement) => {
        const bindings = statement.importClause?.namedBindings;
        return bindings !== undefined && ts.isNamedImports(bindings) && ["sha256", "stableJson"].every((name) => bindings.elements.some((element) => element.name.text === name && !element.isTypeOnly));
      }).map((statement) => { const resolved = resolveSpecifier(path, (statement.moduleSpecifier as ts.StringLiteral).text); return resolved.kind === "module" ? fileOf(files, resolved.module) : null; });
      expect(helpers, path).toEqual([STABLE]);
    }
    expect([...runtimeDeclarationSpecifiers(SUMMARY, files.get(SUMMARY)!)].filter((specifier) => specifier.endsWith("release-gate"))).toEqual([]);
    const closure = importClosure(files, ["app/api/pcb-sync/route.ts"]);
    expect(closure.has(SUMMARY)).toBe(true);
    expect(closure.get(GATE) ?? null).toBeNull();
    expect([...closure.keys()].filter((file) => /from "jszip"/.test(files.get(file)!))).toEqual([]);
  });

  // [B23-B3 review, 2026-10-04] coverage-2, tests-6
  it("12. an answer whose provider row is withdrawn from the registry stays listed and stale (descriptor_moved), named by the record's provider id with its terms UNKNOWN; the reader loads every registry row's record whatever its operations' tiers, and every withdrawn id (an append-only list)", async () => {
    const { workflow } = await currentWorld();
    const withdrawn = PROVIDER_ROWS.filter((row) => row.id !== "jlcpcb");
    const { summary } = await readSummary(workflow, BOARD, { registry: withdrawn });
    expect(summary.observations!.items).toHaveLength(1);
    const [item] = summary.observations!.items;
    expect(item).toMatchObject({ label: "external observation, not Sirkit proof", sirkitVerdict: "none", stale: true, staleReasons: ["descriptor_moved"], source: { providerId: "jlcpcb", displayName: OBSERVATION_UNLISTED_PROVIDER_NAME } });
    expect([item!.terms.providerRetention, item!.terms.providerConfidentiality].every((term) => term.startsWith("UNKNOWN: "))).toBe(true);
    const attempt = (await createProviderExchangeLedger(workflow).load(aggregateFor()))!.attempts[0]!;
    const direct = normalizeManufacturingObservation({ aggregate: aggregateFor(), attempt, registry: withdrawn });
    expect(direct.ok && evaluateObservationStaleness(direct.observation, { now: new Date(NOW).toISOString(), authority: null, latestRelease: null, board: null }, { registry: withdrawn, transferVersions: TRANSFER }).reasons).toContain("descriptor_moved");
    // the ids the reader loads: every registry row, any tier (a re-tiered operation leaves its answers readable), and every withdrawn id.
    // This literal list is append-only: a reviewed registry revision that removes a row appends its id to OBSERVATION_WITHDRAWN_PROVIDER_IDS
    expect([...OBSERVATION_PROVIDER_IDS]).toEqual(["jlcpcb", "pcbway", "oshpark", "macrofab", "eurocircuits", "digikey", "mouser", "nexar", "lcsc"]);
    expect(PROVIDER_ROWS.map((row) => row.id).filter((id) => !OBSERVATION_PROVIDER_IDS.includes(id))).toEqual([]);
    expect([...OBSERVATION_WITHDRAWN_PROVIDER_IDS]).toEqual([]);
  });

  // [B23-B3 review, 2026-10-04] tests-7
  it("13. several providers: every provider's answers are listed, newest first across providers", async () => {
    const { workflow } = await currentWorld();
    const PCBWAY = PROVIDER_ROWS.find((row) => row.id === "pcbway")!;
    const later = new Date(T0 + 60_000).toISOString();
    await recordAnswer(workflow, { providerId: "pcbway", row: PCBWAY, operationId: "pcb-quotation", key: "key-b3-pcbway", retrievedAt: later });
    const { summary } = await readSummary(workflow, BOARD, { now: T0 + 2 * 60_000, transferVersions: [...TRANSFER, { providerId: "pcbway", operationId: "pcb-quotation", version: "0.0.1" }] });
    expect(summary.observations!.items.map((item) => [item.source.providerId, item.source.operationId, item.retrievedAt, item.stale])).toEqual([["pcbway", "pcb-quotation", later, false], ["jlcpcb", "pcb-quote", RETRIEVED_AT, false]]);
  });

  // [B23-B3 review, 2026-10-04] tests-9
  it("14. both sides of the profile bounds: at exactly 366 days the evidence is not too old (the release route refuses only past it), 1 ms later it is; another profile id is profile_moved", async () => {
    expect(read("app/api/pcb/release/route.ts")).toContain("if (Date.now() - retrievedAt > RELEASE_PROFILE_EVIDENCE_MAX_AGE_MS)");
    const lasting = { validUntil: "2027-12-31T00:00:00.000Z" };
    const evidence = { ...PROFILE.evidence, retrievedAt: "2026-01-01", expiresAt: "2027-01-02" };
    expect(Date.parse("2026-01-01T00:00:00.000Z") + OBSERVATION_PROFILE_EVIDENCE_MAX_AGE_MS).toBe(Date.parse("2027-01-02T00:00:00.000Z"));
    for (const [profile, now, reasons] of [
      [{ ...PROFILE, evidence }, Date.parse("2027-01-02T00:00:00.000Z"), []],
      [{ ...PROFILE, evidence }, Date.parse("2027-01-02T00:00:00.001Z"), ["profile_evidence_too_old"]],
      [{ ...PROFILE, profileId: "jlcpcb-4l" }, NOW, ["profile_moved"]],
    ] as const) {
      const world = new InMemoryDurableWorkflowRepository();
      const saved = await saveAuthority(world, BOARD.board, "qualify-b3-bound", { profile });
      await recordRelease(world, saved, BOARD.board);
      await recordAnswer(world, { normalized: lasting });
      expect(await reasonsOf(world, BOARD, { now }), JSON.stringify(reasons)).toEqual([{ stale: reasons.length > 0, reasons }]);
    }
  });
});
