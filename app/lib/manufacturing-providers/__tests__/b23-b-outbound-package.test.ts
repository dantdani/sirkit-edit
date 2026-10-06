/**
 * [B23-B1] Step 2, the exact disclosure (runbook :976; D23-6, OD-163). `buildOutboundPackage` is pure: it derives what would leave
 * Sirkit only from a LEDGERED release whose regenerated `archiveSha256` (recomputed from Sirkit's own built archive bytes, never a
 * re-read of the archive) and `releaseId` equal the ledger record. It carries the release's Gerber, Excellon and job files byte for
 * byte, each SHA-256 equal to its manifest record, plus a generated provider manifest naming `releaseId`, `archiveSha256`, the file
 * list and the capability-profile id and version. `release-manifest.json` (tenant, project, branch, design and board ids and the
 * actor) and `README.txt` are withheld; no BOM, CPL or distributor-observed value leaves; the package has its own
 * `outboundPackageDigest`, stable across two builds.
 *
 * Counterexample first (D23-6): the release's own manifest - what would leave if the archive were sent as it is - carries
 * `tenantId` and the qualifying human's `actor`. This suite drives the pinned 555 prompt-to-Gerber pipeline (the acceptance
 * suite's in-process seams: in-memory durable store, the committed catalog, a fake provider adapter and the recorded router,
 * replayed only) to the pinned release `mfg-release-45b3b7efbc85dc3a8ecd233c906384cd`, then builds its outbound package and
 * previews and commits it through `POST /api/pcb/provider-exchange`. Nothing is written to disk, no process is started and
 * nothing leaves the process: `fetch` is spied and never called.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { createHash } from "node:crypto";

const ROUTE_FIXTURE_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "workflow", "prompt-to-gerber", "__tests__", "fixtures", "blinker-route-fixture.json");

vi.mock("@/app/lib/durable-workflow/runtime", async () => {
  const { InMemoryDurableWorkflowRepository } = await import("@/app/lib/durable-workflow/repository");
  const repo = new InMemoryDurableWorkflowRepository();
  return { getDurableWorkflowRepository: () => repo };
});
vi.mock("@/app/lib/physical-binding/server-repository", async (orig) => {
  const actual = await orig() as object;
  const { InMemoryPhysicalBindingRepository } = await import("@/app/lib/physical-binding/repository");
  const shared = new InMemoryPhysicalBindingRepository();
  class SharedInMemoryPhysicalBindingRepository { constructor() { return shared; } }
  return { ...actual, PostgresPhysicalBindingRepository: SharedInMemoryPhysicalBindingRepository };
});
vi.mock("@/app/lib/atomic/server-catalog", async () => {
  const { blinkerCatalog } = await import("@/app/lib/workflow/prompt-to-gerber/__tests__/fixtures/blinker-catalog");
  const load = async (revisionId: string) => structuredClone(blinkerCatalog().snapshots.get(revisionId) ?? null);
  const loadAtomicRevisionStatus = async (ids: readonly string[]) => new Map(ids.flatMap((id) => { const snapshot = blinkerCatalog().snapshots.get(id); return snapshot ? [[id, { revisionId: id, logicalPartId: snapshot.atomicRevision.logicalPartId, state: "published", selectable: true, pinnable: true }] as const] : []; }));
  return { loadPublishedPortableSnapshot: load, loadSelectablePortableSnapshot: load, loadAtomicRevisionStatus };
});
vi.mock("@/app/lib/llm/router", async (orig) => ({ ...(await orig() as object), llmRouter: { generate: async () => ({ provider: "anthropic", model: "fake-provider", text: "", toolCalls: [] }), stream: () => { throw new Error("fake provider has no stream"); } } }));
vi.mock("@/app/lib/build-loop", async (orig) => {
  const { BLINKER_NETLIST } = await import("@/app/lib/workflow/prompt-to-gerber/__tests__/fixtures/blinker-catalog");
  return { ...(await orig() as object), runBuildToolLoop: async () => ({ ok: true, netlist: structuredClone(BLINKER_NETLIST), explanation: BLINKER_NETLIST.explanation }) };
});
vi.mock("@/app/lib/parts-search", async (orig) => ({ ...(await orig() as object), getPartsByIds: async () => [] }));
// The recorded FreeRouting run, REPLAYED only: no record or live path exists in this suite, so no router process can start.
vi.mock("@/app/lib/pcb/autonomous/production-router", async () => {
  const { loadRouteFixture, replayRouteExecutor } = await import("@/app/lib/pcb/autonomous/router-fixture");
  return {
    createAutonomousRouteExecutor: async () => {
      const fixture = loadRouteFixture(ROUTE_FIXTURE_PATH);
      if (!fixture) throw new Error(`ROUTE_FIXTURE_MISSING:${ROUTE_FIXTURE_PATH}`);
      return replayRouteExecutor(fixture, []);
    },
  };
});

import { POST as buildMulti } from "@/app/api/schematic/build-multi/route";
import { POST as physicalBindings } from "@/app/api/physical-bindings/route";
import { POST as pcbSyncPost } from "@/app/api/pcb-sync/route";
import { POST as qualify } from "@/app/api/pcb/qualify/route";
import { POST as release } from "@/app/api/pcb/release/route";
import { POST as exchange } from "@/app/api/pcb/provider-exchange/route";
import { getDurableWorkflowRepository } from "@/app/lib/durable-workflow/runtime";
import { DurableManufacturingAuthorityStore } from "@/app/lib/pcb/fab/authority-store";
import { DurableManufacturingReleaseLedger, type ManufacturingReleaseRecord } from "@/app/lib/pcb/fab/release-ledger";
import { releaseManufacturingPackage, type ManufacturingReleaseArtifact } from "@/app/lib/pcb/fab/release-gate";
import { loadExpectedIdentities } from "@/app/lib/workflow/prompt-to-gerber/__tests__/fixtures/expected-identities";
import { BLINKER_ACCEPTANCE_PROMPT, blinkerCatalog } from "@/app/lib/workflow/prompt-to-gerber/__tests__/fixtures/blinker-catalog";
import { applyRequest, BOARD_ID, DESIGN_ID, deterministicUuids, freezeClock, jsonRequest, layoutProposal, preflightRequest, publicationRequest, readJson, restoreIdentity, SCOPE, signInAs, USERS } from "@/app/lib/workflow/prompt-to-gerber/__tests__/fixtures/harness";
import type { BuildLogicalNetlist } from "@/lib/schematic-types";
import { buildOutboundPackage, OUTBOUND_FIELD_PATHS, OUTBOUND_FILE_KINDS, OUTBOUND_MANIFEST_FIELDS, OUTBOUND_MANIFEST_PATH, OUTBOUND_PACKAGE_REFUSALS, WITHHELD_SOURCE_FIELDS, type OutboundPackage } from "../outbound-package";
import { PROVIDER_EXCHANGE_COMMIT_HEADER, PROVIDER_EXCHANGE_COMMIT_OPT_IN } from "../provider-exchange";
import { syntheticLedgerRecord, syntheticRelease } from "./_b23-b-release-fixture";

const PINNED = loadExpectedIdentities()!;
const sha256 = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex");
const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);
/** The 555 release's outbound package digest and provider-manifest SHA-256 (CONFIRMED by this suite; outbound-disclosure.md). */
const PINNED_OUTBOUND_PACKAGE_DIGEST = "mfg-outbound-c81e46952d7069fe0d803a5ba9df1d3f13f3a3ee21d32a5bda5939ac03b61cae";
const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => { throw new Error("B23-B1: no fetch may happen"); }); // never a real request

interface Released { authorityRevision: number; authorityDigest: string; bytes: Uint8Array; record: ManufacturingReleaseRecord; locator: Parameters<typeof releaseManufacturingPackage>[0]["locator"] }
let released: Released;
const restore: Array<() => void> = [];
const authorityScope = { ...SCOPE, designId: DESIGN_ID, boardId: BOARD_ID };

/** Regenerate the current authority's release from the durable store, as the exchange does (no archive re-read). */
async function regenerate(): Promise<ManufacturingReleaseArtifact> {
  const store = new DurableManufacturingAuthorityStore(getDurableWorkflowRepository());
  return releaseManufacturingPackage({ locator: released.locator, loadAuthority: store.loader(released.locator) });
}
function built(result: ReturnType<typeof buildOutboundPackage>): OutboundPackage {
  if (!result.ok) throw new Error(`refused: ${result.refusal} ${result.detail}`);
  return result.package;
}

beforeAll(async () => {
  vi.stubEnv("SIRKIT_PCB_SYNC_STAGE3", "opt_in");
  restore.push(freezeClock(), deterministicUuids());
  // the acceptance suite's steps 1, 2, 4, 5, 7 and 10, compressed: prompt -> schematic -> bindings -> sync -> qualify -> release
  signInAs("editor");
  const proposal = (await readJson<{ netlist: BuildLogicalNetlist }>(await buildMulti(jsonRequest("/api/schematic/build-multi", { prompt: BLINKER_ACCEPTANCE_PROMPT })))).netlist;
  const schematic = layoutProposal(proposal, blinkerCatalog().cachedParts);
  const instances = schematic.state.kicadComponents ?? [];
  const requestIds = new Map<string, string>();
  for (const instance of instances) {
    const body = await readJson<{ request: { requestId: string } }>(await physicalBindings(jsonRequest("/api/physical-bindings", { operation: "request_atomic_review", componentInstanceId: instance.id, boardInstanceId: BOARD_ID, atomicPartRevisionId: instance.atomicPartRevisionId, reason: `B16.1C blinker: ${instance.refDes}` })));
    requestIds.set(instance.id, body.request.requestId);
  }
  signInAs("reviewer");
  for (const instance of instances) await physicalBindings(jsonRequest("/api/physical-bindings", { operation: "resolve_review_request", requestId: requestIds.get(instance.id), decision: "approve", reason: `verified candidate, footprint and pin map for ${instance.refDes}` }));
  signInAs("editor");
  const publication = publicationRequest(schematic, { expectedSnapshotRevision: 0 });
  await pcbSyncPost(jsonRequest("/api/pcb-sync", { operation: "publish_demo_snapshot", request: publication }));
  const preflight = await readJson<{ result: { plan: { planId: string; planDigest: string } } }>(await pcbSyncPost(jsonRequest("/api/pcb-sync", { operation: "preflight", request: preflightRequest({ schematicRevision: publication.schematicRevision }) })));
  await pcbSyncPost(jsonRequest("/api/pcb-sync", { operation: "apply", request: applyRequest(preflight.result.plan) }, { headers: { "x-sirkit-pcb-sync-opt-in": "true" } }));
  const qualified = await readJson<{ authorityRevision: number; authorityDigest: string; boardRevision: string; boardDigest: string }>(await qualify(jsonRequest("/api/pcb/qualify", { designId: DESIGN_ID, boardId: BOARD_ID })));
  signInAs("admin");
  const response = await release(jsonRequest("/api/pcb/release", { designId: DESIGN_ID, boardId: BOARD_ID, expectedAuthorityRevision: qualified.authorityRevision, expectedAuthorityDigest: qualified.authorityDigest }));
  if (response.status !== 200) throw new Error(`release failed: ${response.status} ${JSON.stringify(await readJson(response)).slice(0, 600)}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const records = await new DurableManufacturingReleaseLedger(getDurableWorkflowRepository()).list(authorityScope);
  released = { authorityRevision: qualified.authorityRevision, authorityDigest: qualified.authorityDigest, bytes, record: records.at(-1)!, locator: { ...authorityScope, expectedBoardRevision: qualified.boardRevision, expectedBoardDigest: qualified.boardDigest } };
}, 60_000);
afterAll(() => { restoreIdentity(); vi.unstubAllEnvs(); for (const fn of restore.reverse()) fn(); });

describe("[B23-B1] step 2: the exact outbound package of the pinned 555 release (OD-163, D23-6)", () => {
  it("1. counterexample (D23-6): the release's own manifest - what would leave if the archive were sent as it is - carries the tenant, project, branch, design and board ids and the qualifying human's actor", async () => {
    expect(released.record).toMatchObject({ releaseId: PINNED.release.releaseId, archiveSha256: PINNED.release.archiveSha256 });
    expect(sha256(released.bytes)).toBe(PINNED.release.archiveSha256);
    const zip = await JSZip.loadAsync(released.bytes);
    const manifest = JSON.parse(await zip.file("gerber/release-manifest.json")!.async("string")) as { source: Record<string, string>; actor: string };
    expect(manifest.source).toMatchObject({ tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, branchId: SCOPE.branchId, designId: DESIGN_ID, boardId: BOARD_ID });
    expect(manifest.actor).toBe(USERS.editor);
    expect(await zip.file("gerber/README.txt")!.async("string")).toContain("No manufacturer upload/order has been performed.");
  });

  it("2. the package derives from the LEDGERED release only: the regenerated releaseId, archiveSha256 and manifest digest equal the ledger record and the pinned identities, and the archive digest is recomputed from Sirkit's own built bytes", async () => {
    const artifact = await regenerate();
    expect(artifact.releaseId).toBe(PINNED.release.releaseId);
    expect(artifact.archiveSha256).toBe(PINNED.release.archiveSha256);
    expect(sha256(artifact.archiveBytes)).toBe(released.record.archiveSha256);
    const pkg = built(buildOutboundPackage({ release: artifact, ledger: released.record }));
    expect({ releaseId: pkg.releaseId, archiveSha256: pkg.archiveSha256 }).toEqual({ releaseId: released.record.releaseId, archiveSha256: released.record.archiveSha256 });
    expect(buildOutboundPackage({ release: artifact, ledger: null })).toMatchObject({ ok: false, refusal: "release_not_ledgered" });
  });

  it("3. exactly the Gerber, Excellon and job files leave, byte-identical to the release: each SHA-256 equals its manifest record and its archive member; README.txt and release-manifest.json are withheld", async () => {
    const artifact = await regenerate();
    const pkg = built(buildOutboundPackage({ release: artifact, ledger: released.record }));
    const pinned = PINNED.release.files.filter((entry) => entry.role !== "readme");
    expect(pkg.files.map(({ path, role, sha256: digest }) => ({ path, role, sha256: digest }))).toEqual(pinned);
    expect(pkg.files.map((entry) => entry.kind)).toEqual(["xnc", "gerber", "gerber", "gerber", "gerber", "gerber", "gerber", "job"]);
    const zip = await JSZip.loadAsync(released.bytes);
    for (const entry of pkg.files) {
      const member = await zip.file(entry.path)!.async("uint8array");
      expect(Buffer.compare(Buffer.from(member), Buffer.from(entry.content)), entry.path).toBe(0);
      expect(sha256(entry.content), entry.path).toBe(entry.sha256);
      expect(entry.bytes, entry.path).toBe(entry.content.byteLength);
      expect(artifact.manifest.files.find((record) => record.path === entry.path), entry.path).toMatchObject({ sha256: entry.sha256, bytes: entry.bytes, role: entry.role, kind: entry.kind });
    }
    expect(pkg.withheld.files).toEqual(["gerber/README.txt", "gerber/release-manifest.json"]);
    expect(pkg.files.some((entry) => /README|release-manifest/.test(entry.path))).toBe(false);
    expect(OUTBOUND_FILE_KINDS).toEqual(["gerber", "xnc", "job"]);
  });

  it("4. the generated provider manifest names exactly releaseId, archiveSha256, the file list and the capability profile (jlcpcb-2l v2): no tenant, project, branch, design or board id, no actor, no BOM, CPL or distributor value", async () => {
    const pkg = built(buildOutboundPackage({ release: await regenerate(), ledger: released.record }));
    const value = pkg.manifest.value as unknown as Record<string, unknown>;
    expect(Object.keys(value).sort()).toEqual([...OUTBOUND_MANIFEST_FIELDS].sort());
    expect(value).toMatchObject({ schema: "sirkit.provider-outbound-manifest.v1", releaseId: PINNED.release.releaseId, archiveSha256: PINNED.release.archiveSha256, capabilityProfile: { profileId: "jlcpcb-2l", version: 2 } });
    expect(pkg.manifest.path).toBe(OUTBOUND_MANIFEST_PATH);
    expect(text(pkg.manifest.content)).toBe(`${JSON.stringify(JSON.parse(text(pkg.manifest.content)), null, 2)}\n`);
    expect(sha256(pkg.manifest.content)).toBe(pkg.manifest.sha256);
    const keys = new Set<string>();
    const strings: string[] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) node.forEach(walk);
      else if (node && typeof node === "object") for (const [key, child] of Object.entries(node)) { keys.add(key); walk(child); }
      else if (typeof node === "string") strings.push(node);
    };
    walk(value);
    for (const field of [...WITHHELD_SOURCE_FIELDS, "source", "evidence", "componentAuthority", "sourceDate", "mpn", "price", "stock", "sku", "quantity", "currency", "bom", "placement"]) expect(keys.has(field), field).toBe(false);
    expect([...keys].sort()).toEqual(["archiveSha256", "bytes", "capabilityProfile", "files", "kind", "mediaType", "path", "profileId", "releaseId", "role", "schema", "sha256", "version"]);
    for (const identity of [SCOPE.tenantId, SCOPE.projectId, SCOPE.branchId, DESIGN_ID, BOARD_ID, USERS.editor, USERS.admin]) expect(strings, identity).not.toContain(identity);
    // the one place the board's name reaches the manifest is the file paths, which are the release's own (byte-identical) names
    expect(strings.filter((entry) => entry.includes(SCOPE.projectId))).toEqual(pkg.files.map((entry) => entry.path));
    expect(OUTBOUND_FIELD_PATHS).toEqual(["schema", "releaseId", "archiveSha256", "capabilityProfile.profileId", "capabilityProfile.version", "files[].path", "files[].role", "files[].kind", "files[].mediaType", "files[].bytes", "files[].sha256"]);
  });

  it("5. what the file bytes themselves carry is disclosed, never stripped (a byte change would move the pinned release): the board name in every path, the Gerber X2 project attribute and the job file; no tenant, branch, design id, raw board id or actor", async () => {
    const pkg = built(buildOutboundPackage({ release: await regenerate(), ledger: released.record }));
    const boardName = "board-b16-1c-blinker";
    for (const entry of pkg.files) {
      const content = text(entry.content);
      expect(entry.path.startsWith(`gerber/${boardName}`), entry.path).toBe(true);
      for (const identity of [USERS.editor, USERS.admin, DESIGN_ID, BOARD_ID, `${SCOPE.tenantId}/`, `/${SCOPE.branchId}/`]) expect(content.includes(identity), `${entry.path}: ${identity}`).toBe(false);
      if (entry.kind === "gerber") expect(content, entry.path).toMatch(new RegExp(`%TF\\.ProjectId,${boardName},`));
    }
    const job = JSON.parse(text(pkg.files.find((entry) => entry.kind === "job")!.content)) as { GeneralSpecs: { ProjectId: { Name: string } } };
    expect(job.GeneralSpecs.ProjectId.Name).toBe(boardName);
  });

  it("6. the package has its own digest, stable across two builds from two regenerations, and pinned for the 555 release", async () => {
    const first = built(buildOutboundPackage({ release: await regenerate(), ledger: released.record }));
    const second = built(buildOutboundPackage({ release: await regenerate(), ledger: released.record }));
    expect(second.outboundPackageDigest).toBe(first.outboundPackageDigest);
    expect(Buffer.compare(Buffer.from(second.manifest.content), Buffer.from(first.manifest.content))).toBe(0);
    expect(first.outboundPackageDigest).toBe(`mfg-outbound-${first.manifest.sha256}`);
    expect(first.outboundPackageDigest).toBe(PINNED_OUTBOUND_PACKAGE_DIGEST);
  });

  it("7. it refuses whatever disagrees with the ledger or the manifest: no ledger record, another archive digest, another release id, an edited manifest, a moved file byte, a missing file and an assembly file", async () => {
    expect([...OUTBOUND_PACKAGE_REFUSALS]).toEqual(["release_not_ledgered", "archive_digest_mismatch", "release_id_mismatch", "manifest_digest_invalid", "unexpected_kind", "file_missing", "file_digest_mismatch"]);
    const release0 = syntheticRelease();
    const record = syntheticLedgerRecord(release0);
    expect(buildOutboundPackage({ release: release0, ledger: record }).ok).toBe(true);
    expect(buildOutboundPackage({ release: release0, ledger: null })).toMatchObject({ ok: false, refusal: "release_not_ledgered" });
    expect(buildOutboundPackage({ release: release0, ledger: { ...record, archiveSha256: "f".repeat(64) } })).toMatchObject({ ok: false, refusal: "archive_digest_mismatch" });
    expect(buildOutboundPackage({ release: { ...release0, archiveBytes: new Uint8Array([1, 2, 3]) }, ledger: record })).toMatchObject({ ok: false, refusal: "archive_digest_mismatch" });
    expect(buildOutboundPackage({ release: release0, ledger: { ...record, releaseId: "mfg-release-ffffffffffffffffffffffffffffffff" } })).toMatchObject({ ok: false, refusal: "release_id_mismatch" });
    expect(buildOutboundPackage({ release: { ...release0, releaseId: "mfg-release-ffffffffffffffffffffffffffffffff" }, ledger: { ...record, releaseId: "mfg-release-ffffffffffffffffffffffffffffffff" } })).toMatchObject({ ok: false, refusal: "release_id_mismatch" });
    expect(buildOutboundPackage({ release: { ...release0, manifest: { ...release0.manifest, actor: "someone-else" } }, ledger: record })).toMatchObject({ ok: false, refusal: "manifest_digest_invalid" });
    const flipped = release0.files.map((entry) => (entry.path.endsWith(".GTL") ? { ...entry, bytes: new Uint8Array([...entry.bytes.slice(0, -1), 0x21]) } : entry));
    expect(buildOutboundPackage({ release: { ...release0, files: flipped }, ledger: record })).toMatchObject({ ok: false, refusal: "file_digest_mismatch" });
    expect(buildOutboundPackage({ release: { ...release0, files: release0.files.filter((entry) => !entry.path.endsWith(".GBL")) }, ledger: record })).toMatchObject({ ok: false, refusal: "file_missing" });
    const assembly = syntheticRelease({ extraRecords: [{ path: "gerber/board-proj-b23-bom.csv", role: "bom", kind: "bom", mediaType: "text/csv", bytes: 3, sha256: "0".repeat(64) }] });
    expect(buildOutboundPackage({ release: assembly, ledger: syntheticLedgerRecord(assembly) })).toMatchObject({ ok: false, refusal: "unexpected_kind" });
  });

  it("8. through the route, as the administrator: preview lists exactly these files and fields with the same digests; commit with the opt-in header ends refused provider_not_admitted after revalidation; nothing is fetched", async () => {
    signInAs("admin");
    const pkg = built(buildOutboundPackage({ release: await regenerate(), ledger: released.record }));
    const preview = await exchange(jsonRequest("/api/pcb/provider-exchange", { operation: "preview", designId: DESIGN_ID, boardId: BOARD_ID, expectedAuthorityRevision: released.authorityRevision, expectedAuthorityDigest: released.authorityDigest, providerId: "jlcpcb", operationId: "pcb-quote", purpose: "quote" }));
    const body = await readJson<{ ok: boolean; plan: { planId: string; planDigest: string; release: { releaseId: string; archiveSha256: string }; authority: { revision: number; recordDigest: string }; outbound: { files: Array<{ path: string; sha256: string; bytes: number }>; metadata: unknown; outboundPackageDigest: string } } }>(preview);
    expect(preview.status, JSON.stringify(body).slice(0, 600)).toBe(200);
    expect(body.plan.release).toMatchObject({ releaseId: PINNED.release.releaseId, archiveSha256: PINNED.release.archiveSha256 });
    expect(body.plan.authority).toMatchObject({ revision: released.authorityRevision, recordDigest: released.authorityDigest });
    expect(body.plan.outbound.files).toEqual(pkg.files.map(({ path, role, kind, mediaType, bytes, sha256: digest }) => ({ path, role, kind, mediaType, bytes, sha256: digest })));
    expect(body.plan.outbound.metadata).toEqual(pkg.manifest.value);
    expect(body.plan.outbound.outboundPackageDigest).toBe(pkg.outboundPackageDigest);
    const commit = await exchange(jsonRequest("/api/pcb/provider-exchange", { operation: "commit", planId: body.plan.planId, planDigest: body.plan.planDigest, idempotencyKey: "b23-b1-555" }, { headers: { [PROVIDER_EXCHANGE_COMMIT_HEADER]: PROVIDER_EXCHANGE_COMMIT_OPT_IN } }));
    expect(commit.status).toBe(409);
    expect(await readJson(commit)).toMatchObject({ ok: false, code: "PX_PROVIDER_NOT_ADMITTED", refusal: "provider_not_admitted", sent: false });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // [B23-B1 review, 2026-10-04] security-1 / coverage-1: the plan said projectId and boardId stay in Sirkit while their values leave in
  // every file name, each Gerber's TF.ProjectId, the job file and the provider manifest; and no in-file metadata was listed
  it("9. what leaves, said exactly: an id whose value (as is, or file-safe) is in an outbound name or byte is carried, with every place it is; no id said to stay occurs anywhere; every file attribute, comment and job field the bytes carry is listed verbatim", async () => {
    const pkg = built(buildOutboundPackage({ release: await regenerate(), ledger: released.record }));
    const values: Record<(typeof WITHHELD_SOURCE_FIELDS)[number], string> = { tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, branchId: SCOPE.branchId, designId: DESIGN_ID, boardId: BOARD_ID, actor: USERS.editor };
    const outbound = [...pkg.files.map((file) => ({ path: file.path, text: text(file.content) })), { path: pkg.manifest.path, text: text(pkg.manifest.content) }];
    const expected = WITHHELD_SOURCE_FIELDS.flatMap((field) => [...new Set([values[field], fileSafe(values[field])])].flatMap((value) => {
      const names = outbound.filter((entry) => occurs(entry.path, value)).map((entry) => entry.path);
      const bytes = outbound.filter((entry) => occurs(entry.text, value)).map((entry) => entry.path);
      return names.length + bytes.length > 0 ? [{ field, value, form: value === values[field] ? "as-is" : "file-safe", names, bytes }] : [];
    }));
    const paths = pkg.files.map((file) => file.path);
    const holders = [...paths.filter((path) => !path.endsWith(".xnc")), OUTBOUND_MANIFEST_PATH];
    expect(expected).toEqual([
      { field: "projectId", value: "b16-1c-blinker", form: "as-is", names: paths, bytes: holders },
      { field: "boardId", value: "board-b16-1c-blinker", form: "file-safe", names: paths, bytes: holders },
    ]);
    expect(pkg.disclosure.carried).toEqual(expected);
    expect(pkg.withheld.fields).toEqual(["tenantId", "branchId", "designId", "actor"]);
    for (const field of pkg.withheld.fields) for (const value of new Set([values[field], fileSafe(values[field])])) for (const entry of outbound) expect(occurs(entry.path, value) || occurs(entry.text, value), `${field} ${value} in ${entry.path}`).toBe(false);
    // an independent read of the metadata: every X2 attribute and G04 comment line of the Gerbers, every `#@!` attribute and other
    // comment of the Excellon file, and every leaf of the job file, each (field, value) with the files that carry it
    const triples = new Map<string, Set<string>>();
    const note = (field: string, value: string, path: string) => { const key = JSON.stringify([field, value]); triples.set(key, (triples.get(key) ?? new Set()).add(path)); };
    for (const file of pkg.files) {
      const body = text(file.content);
      if (file.kind === "job") {
        const walk = (node: unknown, at: string): void => {
          if (Array.isArray(node)) node.forEach((child) => walk(child, `${at}[]`));
          else if (node && typeof node === "object") for (const [key, child] of Object.entries(node)) walk(child, at ? `${at}.${key}` : key);
          else note(`job:${at}`, String(node), file.path);
        };
        walk(JSON.parse(body), "");
        continue;
      }
      for (const line of body.split(/\r?\n/)) {
        const gerber = /^%(T[FAO])\.([^,*]+),(.*)\*%$/.exec(line), comment = /^G04 (.*)\*$/.exec(line), drill = /^; #@! (T[FAO])\.([^,]+),(.*)$/.exec(line), drillComment = /^;(?! #@!)\s?(.*)$/.exec(line);
        if (gerber) note(`${gerber[1]}.${gerber[2]}`, gerber[3]!, file.path);
        else if (comment) note("G04", comment[1]!, file.path);
        else if (drill) note(`${drill[1]}.${drill[2]}`, drill[3]!, file.path);
        else if (drillComment && file.kind === "xnc") note(";", drillComment[1]!, file.path);
      }
    }
    const independent = [...triples].map(([key, holders]) => { const [field, value] = JSON.parse(key) as [string, string]; return { field, value, paths: paths.filter((path) => holders.has(path)) }; });
    const order = (left: { field: string; value: string }, right: { field: string; value: string }) => (left.field === right.field ? (left.value < right.value ? -1 : left.value > right.value ? 1 : 0) : left.field < right.field ? -1 : 1);
    expect(pkg.disclosure.embedded).toEqual(independent.sort(order));
    expect(pkg.disclosure.embedded).toHaveLength(84); // outbound-disclosure.md section 1
    const gerbers = paths.filter((path) => /\.G[A-Z]{2}$/.test(path));
    expect(pkg.disclosure.embedded).toContainEqual({ field: "TF.ProjectId", value: "board-b16-1c-blinker,d8e3b30e-31dc-58bc-b245-10b1541e5fd3,rev-d8e3b30e31dcb8bc", paths: gerbers });
    expect(pkg.disclosure.embedded).toContainEqual({ field: "TF.SameCoordinates", value: "d8e3b30e-31dc-58bc-b245-10b1541e5fd3", paths: gerbers });
    expect(pkg.disclosure.embedded).toContainEqual({ field: "TF.GenerationSoftware", value: "Sirkit,Sirkit Fab Compiler,0.1.0", paths: paths.filter((path) => !path.endsWith(".gbrjob")) });
    expect(pkg.disclosure.embedded).toContainEqual({ field: "job:GeneralSpecs.ProjectId.Name", value: "board-b16-1c-blinker", paths: ["gerber/board-b16-1c-blinker.gbrjob"] });
    expect(pkg.disclosure.embedded).toContainEqual({ field: "TO.N", value: "/root/GND", paths: ["gerber/board-b16-1c-blinker.GBL", "gerber/board-b16-1c-blinker.GTL"] });
  });
});

/** [B23-B1 review, 2026-10-04] Whether `value` occurs in `text` with no letter or digit beside it. */
function occurs(haystack: string, value: string): boolean {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`).test(haystack);
}
/** [B23-B1 review, 2026-10-04] The file-safe form of an id, restated (the release's file names use it). */
const fileSafe = (value: string): string => (value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "") || "sirkit-board").slice(0, 80);

describe("[B23-B1 lead, 2026-10-04] a project id the release's 80-character board name cuts short (low-3)", () => {
  it("10. the release built for a project id longer than 74 characters (the request selector admits up to 128) names every file, each Gerber's TF.ProjectId and the job file with board- and the id's first 74 file-safe characters, never the whole id; the package lists projectId as carried in that cut form, never as kept in Sirkit", async () => {
    const { safeFabName } = await import("@/app/lib/pcb/fab/native/stable");
    const { pcbBoardInstanceId, pcbDesignInstanceId } = await import("@/app/lib/pcb/board-identity");
    const { ID_PATTERN } = await import("@/app/lib/auth/trusted-request-context");
    const projectId = `b23-lead.long-project:${"0123456789abcdef".repeat(4)}`;
    expect(projectId.length).toBe(86);
    expect(ID_PATTERN.test(projectId)).toBe(true);
    const designId = pcbDesignInstanceId(projectId), boardId = pcbBoardInstanceId(projectId);
    // the 555's own head authority, rescoped to the long id, regenerated by the release gate itself (no ledger write, nothing on disk)
    const authority = await new DurableManufacturingAuthorityStore(getDurableWorkflowRepository()).loader(released.locator)();
    if (!authority) throw new Error("the 555 authority is not head");
    const locator = { ...released.locator, projectId, designId, boardId };
    const artifact = await releaseManufacturingPackage({ locator, loadAuthority: async () => ({ ...structuredClone(authority), projectId, designId, boardId }) });
    // what leaves of the id, derived here from the id itself: its ":" made "-", cut where the 80-character board name ends
    const kept = projectId.replace(":", "-").slice(0, 80 - "board-".length);
    const boardName = `board-${kept}`;
    expect(kept).toHaveLength(74);
    expect(safeFabName(boardId)).toBe(boardName);
    const pkg = built(buildOutboundPackage({ release: artifact, ledger: syntheticLedgerRecord(artifact) }));
    const paths = pkg.files.map((file) => file.path);
    const holders = [...paths.filter((path) => !path.endsWith(".xnc")), OUTBOUND_MANIFEST_PATH];
    expect(paths).toHaveLength(8);
    for (const file of pkg.files) {
      expect(file.path.startsWith(`gerber/${boardName}`), file.path).toBe(true);
      if (file.kind === "gerber") expect(text(file.content), file.path).toContain(`%TF.ProjectId,${boardName},`);
    }
    expect((JSON.parse(text(pkg.files.find((file) => file.kind === "job")!.content)) as { GeneralSpecs: { ProjectId: { Name: string } } }).GeneralSpecs.ProjectId.Name).toBe(boardName);
    const outbound = [...pkg.files.map((file) => ({ path: file.path, text: text(file.content) })), { path: pkg.manifest.path, text: text(pkg.manifest.content) }];
    for (const entry of outbound) for (const whole of [projectId, projectId.replace(":", "-")]) expect(entry.path.includes(whole) || entry.text.includes(whole), `${entry.path}: ${whole}`).toBe(false);
    expect(pkg.disclosure.carried).toEqual([
      { field: "projectId", value: kept, form: "file-safe-prefix", names: paths, bytes: holders },
      { field: "boardId", value: boardName, form: "file-safe", names: paths, bytes: holders },
    ]);
    expect(pkg.withheld.fields).toEqual(["tenantId", "branchId", "designId", "actor"]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
