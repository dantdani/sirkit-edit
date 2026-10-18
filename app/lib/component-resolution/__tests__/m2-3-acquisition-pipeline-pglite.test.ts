/**
 * [PR-M, 2026-10-18] Section M2 (runbook M.3 items 2-5, design M2.3): RETRIEVE -> HASH -> STORE -> PARSE -> VALIDATE -> DURABLE
 * CANDIDATE over a real, migrated PostgreSQL (PGlite, in process) behind the production durable repository, with the fixture source's
 * real committed bytes through the production egress path - and the `kicad-bundled` source (zero network) over a pinned checkout laid out
 * in a temporary directory from the committed upstream copies (the git blobs of the pinned commits, app/lib/fixture-runtime/cad-source),
 * so it runs on every host whether or not the operator's checkout is under data/. The hostile corpus goes through the same pipeline and
 * nothing valid is stored.
 */
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@/app/lib/db/schema";
import { loadMigrationManifest } from "@/app/lib/db/migrations/manifest";
import { migrateDatabase } from "@/app/lib/db/migrations/runner";
import { disposablePostgres, type DisposablePostgres } from "@/app/lib/db/disposable-postgres";

let pg: DisposablePostgres;
let orm: ReturnType<typeof drizzle<typeof schema>>;
vi.mock("@/app/lib/db/client", () => ({ getDb: () => orm }));

import { PostgresDurableWorkflowRepository } from "@/app/lib/durable-workflow/server-repository";
import { resetAdmissionControl } from "@/app/lib/acquisition/admission-control";
import { DurableAcquiredObjectStore } from "@/app/lib/acquisition/cad-object-store";
import { createFixtureCadAdapter } from "@/app/lib/acquisition/cad-adapters/network";
import { createBundledCadAdapter, libraryHeadCommit } from "@/app/lib/acquisition/cad-adapters/bundled";
import { createFixtureCadTransport } from "@/app/lib/fixture-runtime/cad-source/transport";
import { DurableAcquisitionCandidateStore } from "@/app/lib/component-resolution/acquisition/candidate";
import { runAcquisitionPipeline, type AcquisitionPipelinePorts } from "@/app/lib/component-resolution/acquisition/pipeline";
import { KICAD_LIBRARY_PINS } from "@/app/lib/kicad/pinned-checkout";
import { sha256 } from "@/app/lib/atomic/stable";
import { HOSTILE_SYMBOLS, SYMBOL_1N4148, target1N4148 } from "./_m2-fixtures";

const SCOPE = { tenantId: "local", projectId: "p-m2-pipeline", branchId: "main" };
const NOW = Date.parse("2026-10-18T10:00:00.000Z");
const clock = (): number => NOW;
/** A pinned checkout laid out from the committed upstream copies: detached HEADs at the reviewed pins and the files at their library paths. */
function pinnedCheckoutFromCommittedCopies(): string {
  const root = mkdtempSync(join(tmpdir(), "sirkit-m2-bundled-"));
  const cad = join(process.cwd(), "app", "lib", "fixture-runtime", "cad-source");
  for (const [which, pin] of [["kicad-symbols", KICAD_LIBRARY_PINS.symbols.commit], ["kicad-footprints", KICAD_LIBRARY_PINS.footprints.commit]] as const) {
    mkdirSync(join(root, "data", which, ".git"), { recursive: true });
    writeFileSync(join(root, "data", which, ".git", "HEAD"), pin);
  }
  mkdirSync(join(root, "data", "kicad-symbols", "Diode.kicad_symdir"), { recursive: true });
  mkdirSync(join(root, "data", "kicad-footprints", "Diode_THT.pretty"), { recursive: true });
  for (const name of ["1N4148", "1N4001"]) copyFileSync(join(cad, "kicad-symbols", "Diode.kicad_symdir", `${name}.kicad_sym`), join(root, "data", "kicad-symbols", "Diode.kicad_symdir", `${name}.kicad_sym`));
  for (const name of ["D_DO-35_SOD27_P7.62mm_Horizontal", "D_DO-41_SOD81_P10.16mm_Horizontal"]) copyFileSync(join(cad, "kicad-footprints", "Diode_THT.pretty", `${name}.kicad_mod`), join(root, "data", "kicad-footprints", "Diode_THT.pretty", `${name}.kicad_mod`));
  return root;
}

beforeAll(async () => {
  pg = await disposablePostgres();
  await migrateDatabase(pg, { manifest: loadMigrationManifest() });
  orm = drizzle(pg.db, { schema });
}, 240_000);
afterAll(async () => { await pg?.close(); });
beforeEach(() => resetAdmissionControl());

function ports(adapters: AcquisitionPipelinePorts["adapters"], skipped: AcquisitionPipelinePorts["skipped"] = []): AcquisitionPipelinePorts {
  const repository = new PostgresDurableWorkflowRepository();
  return { adapters, skipped, objects: new DurableAcquiredObjectStore(repository), candidates: new DurableAcquisitionCandidateStore(repository), clock };
}

describe("[PR-M M.5-4] the fixture source: real bytes to a durable validated candidate", { timeout: 120_000 }, () => {
  it("retrieves the symbol, its parent, the footprint and the pin table; stores each re-hashable; parses, validates and keeps the candidate", async () => {
    const transport = createFixtureCadTransport();
    const pipelinePorts = ports([createFixtureCadAdapter({ fetch: transport.fetch, resolve: transport.resolve, fixtureAllowed: true, clock })], [{ sourceId: "kicad-gitlab", code: "blocked", detail: "blocked (OD-M2-3)" }]);
    const outcome = await runAcquisitionPipeline({ scope: SCOPE, target: target1N4148(), assetKinds: ["datasheet", "footprint", "symbol"], ports: pipelinePorts });
    expect(outcome.kind, JSON.stringify(outcome).slice(0, 600)).toBe("candidate");
    if (outcome.kind !== "candidate") return;
    const candidate = outcome.candidate;
    expect(transport.requests.map((url) => url.replace("https://cad-fixture.sirkit.test", ""))).toEqual([
      "/kicad-symbols/Diode.kicad_symdir/1N4148.kicad_sym", "/kicad-symbols/Diode.kicad_symdir/1N4001.kicad_sym", "/kicad-footprints/Diode_THT.pretty/D_DO-35_SOD27_P7.62mm_Horizontal.kicad_mod", "/datasheets/1N4148.pin-table.txt",
    ]);
    expect(candidate.objects.map((object) => object.role)).toEqual(["symbol-file", "symbol-parent", "footprint", "datasheet", "symbol-library"]);
    expect(candidate.objects.find((object) => object.role === "symbol-file")!.sha256).toBe(sha256(SYMBOL_1N4148));
    // every object is really in the store and re-hashes
    const store = new DurableAcquiredObjectStore(new PostgresDurableWorkflowRepository());
    for (const object of candidate.objects) expect((await store.get(SCOPE, object.sha256)).sha256).toBe(object.sha256);
    expect(candidate.report.verdict).toBe("validated");
    expect(candidate.report.mapping.map((row) => `${row.number}=${row.function}@${row.pads.join("+")}`)).toEqual(["1=K@1", "2=A@2"]);
    expect(candidate.symbol).toMatchObject({ name: "1N4148", validationState: "valid", pins: [{ number: "1", name: "K" }, { number: "2", name: "A" }] });
    expect(candidate.footprint).toMatchObject({ name: "D_DO-35_SOD27_P7.62mm_Horizontal", mountingTechnology: "through_hole", electricalPads: ["1", "2"] });
    expect(candidate).toMatchObject({ state: "validated", fixtureEvidence: true, sourceId: "fixture-kicad", licence: { record: { id: "license_kicad_cc_by_sa_4" }, retention: "indefinite" } });
    expect(outcome.attempts.map((attempt) => [attempt.sourceId, attempt.outcome])).toEqual([["kicad-gitlab", "skipped"], ["fixture-kicad", "used"]]);
    // durable: a fresh store reads the same candidate
    expect(await new DurableAcquisitionCandidateStore(new PostgresDurableWorkflowRepository()).get(SCOPE, candidate.candidateId)).toMatchObject({ candidateId: candidate.candidateId, state: "validated" });
    // the same retrieval again is the same candidate and the same objects (deduplicated by bytes)
    const again = await runAcquisitionPipeline({ scope: SCOPE, target: target1N4148(), assetKinds: ["datasheet", "footprint", "symbol"], ports: pipelinePorts });
    expect(again.kind === "candidate" && again.candidate.candidateId).toBe(candidate.candidateId);
  });

  it("a source without the part is a failed attempt and the next source is tried; none left is no_matching_asset with every attempt kept", async () => {
    const transport = createFixtureCadTransport();
    const outcome = await runAcquisitionPipeline({ scope: SCOPE, target: target1N4148({ symbol: { library: "Diode", name: "NoSuchDiode" } }), assetKinds: ["footprint", "symbol"], ports: ports([createFixtureCadAdapter({ fetch: transport.fetch, resolve: transport.resolve, fixtureAllowed: true, clock })]) });
    expect(outcome).toMatchObject({ kind: "blocked", code: "no_matching_asset" });
    expect(outcome.attempts.map((attempt) => [attempt.sourceId, attempt.outcome, attempt.code])).toEqual([["fixture-kicad", "failed", "not_found"]]);
  });

  it("no admitted source: source_terms when the only source is blocked, source_unavailable otherwise - nothing called", async () => {
    expect(await runAcquisitionPipeline({ scope: SCOPE, target: target1N4148(), assetKinds: ["symbol"], ports: ports([], [{ sourceId: "kicad-gitlab", code: "blocked", detail: "x" }]) })).toMatchObject({ kind: "blocked", code: "source_terms" });
    expect(await runAcquisitionPipeline({ scope: SCOPE, target: target1N4148(), assetKinds: ["symbol"], ports: ports([], [{ sourceId: "fixture-kicad", code: "fixture_only", detail: "x" }]) })).toMatchObject({ kind: "blocked", code: "source_unavailable" });
  });

  it("a 429 is a WAIT with the real retry time (the task schedules it), never a hot retry", async () => {
    const transport = createFixtureCadTransport();
    transport.overrides.set("/kicad-symbols/Diode.kicad_symdir/1N4148.kicad_sym", { status: 429, headers: { "retry-after": "30" } });
    const outcome = await runAcquisitionPipeline({ scope: SCOPE, target: target1N4148(), assetKinds: ["symbol"], ports: ports([createFixtureCadAdapter({ fetch: transport.fetch, resolve: transport.resolve, fixtureAllowed: true, clock })]) });
    expect(outcome).toMatchObject({ kind: "wait", code: "rate_limited", retryAtMs: NOW + 30_000 });
    expect(transport.requests).toHaveLength(1);
  });

  it.each(HOSTILE_SYMBOLS)("the hostile corpus (%s) is refused or unsupported - nothing valid is stored", async (_name, hostile) => {
    const transport = createFixtureCadTransport();
    transport.overrides.set("/kicad-symbols/Diode.kicad_symdir/1N4148.kicad_sym", { status: 200, body: hostile, headers: { "content-type": "application/x-kicad-symbol" } });
    const outcome = await runAcquisitionPipeline({ scope: SCOPE, target: target1N4148(), assetKinds: ["footprint", "symbol"], ports: ports([createFixtureCadAdapter({ fetch: transport.fetch, resolve: transport.resolve, fixtureAllowed: true, clock })]) });
    if (outcome.kind === "blocked") expect(outcome.code).toMatch(/parser_refused|no_matching_asset/);
    else {
      expect(outcome.kind).toBe("candidate");
      if (outcome.kind !== "candidate") return;
      // the bounded bytes may be kept as evidence, but no VALID asset or candidate exists, and the handoff refuses anything not validated
      expect(outcome.candidate.report.verdict).toBe("unsupported");
      expect(outcome.candidate.state).toBe("unsupported");
      expect(outcome.candidate.symbol?.validationState ?? "absent").not.toBe("valid");
    }
  });
});

describe("[PR-M M.5-4] the bundled pinned KiCad checkout (zero network)", { timeout: 120_000 }, () => {
  let checkout = "";
  beforeAll(() => { checkout = pinnedCheckoutFromCommittedCopies(); });
  afterAll(() => { if (checkout) rmSync(checkout, { recursive: true, force: true }); });

  it("reads Diode:1N4148 (+ its parent) and the DO-35 footprint at the pinned commits; no datasheet, so the terminal table stays for a person", async () => {
    expect(libraryHeadCommit(join(checkout, "data", "kicad-symbols"))).toBe(KICAD_LIBRARY_PINS.symbols.commit);
    const outcome = await runAcquisitionPipeline({ scope: { ...SCOPE, projectId: "p-m2-bundled" }, target: target1N4148(), assetKinds: ["datasheet", "footprint", "symbol"], ports: ports([createBundledCadAdapter({ clock, root: checkout })]) });
    expect(outcome.kind, JSON.stringify(outcome).slice(0, 400)).toBe("candidate");
    if (outcome.kind !== "candidate") return;
    expect(outcome.candidate.objects.filter((object) => object.role !== "symbol-library").every((object) => object.ref === KICAD_LIBRARY_PINS.symbols.commit || object.ref === KICAD_LIBRARY_PINS.footprints.commit)).toBe(true);
    expect(outcome.candidate.objects.find((object) => object.role === "symbol-file")!.locator).toBe("data/kicad-symbols/Diode.kicad_symdir/1N4148.kicad_sym");
    expect(outcome.candidate.report.verdict).toBe("validated");
    expect(outcome.candidate.report.checks.find((check) => check.id === "terminal-table")).toMatchObject({ status: "unresolved" });
    expect(outcome.candidate.missing.join(" ")).toContain("carries none");
    expect(outcome.candidate.fixtureEvidence).toBe(false);
  });

  it("a checkout not at the pinned commit is refused before anything is read", async () => {
    const outcome = await runAcquisitionPipeline({ scope: { ...SCOPE, projectId: "p-m2-bundled-2" }, target: target1N4148(), assetKinds: ["symbol"], ports: ports([createBundledCadAdapter({ clock, root: checkout, head: () => "f".repeat(40) })]) });
    expect(outcome).toMatchObject({ kind: "blocked", code: "source_unavailable" });
    expect(outcome.attempts[0]).toMatchObject({ outcome: "skipped", code: "checkout_not_pinned" });
  });
});
