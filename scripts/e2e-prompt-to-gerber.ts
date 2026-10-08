/**
 * R05-E2E01 acceptance driver: one natural-language prompt → verified Gerber ZIP.
 *
 * Exercises the exact production boundaries in order, server-side, with no
 * fixture, no prebuilt board and no manual edit:
 *   1. POST /api/schematic/build-multi   (live provider, real generation)
 *   2. deterministic validated auto-layout            (same code the UI runs)
 *   3. POST /api/physical-bindings bind_atomic_selection  (per instance)
 *   4. POST /api/pcb-sync publish_demo_snapshot
 *   5. POST /api/pcb-sync preflight → apply → authoritative board load
 *   6. POST /api/pcb/qualify   (placement + bundled FreeRouting + RC01/02/03)
 *   7. POST /api/pcb/release   (MFG01 verified release → deterministic ZIP)
 *
 * Usage: pnpm exec tsx scripts/e2e-prompt-to-gerber.ts --disposable-target [--project <id>] [--keep]   ([B24-A4] refused without it)
 */

import { loadEnvLocal } from "../app/lib/load-env-local";
loadEnvLocal();
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { request as httpRequest } from "node:http";
import { autoLayoutBuildValidated } from "../lib/build-auto-layout";
import { getFullPartsByIds } from "../app/lib/parts-search"; import { fixtureRuntimeEnabled } from "../app/lib/fixture-runtime/mode"; import { acceptanceDriverRefusal } from "../app/lib/db/qualification-target"; // [B24-A4] on this line so :29 stays
import { buildPcbSyncPublicationGraph, buildNetlist } from "../app/lib/pcb/netlist-bridge";
import type { CachedPart } from "../app/lib/parts-cache";
import type { BuildLogicalNetlist, SchematicState } from "../lib/schematic-types";

const BASE = process.env.SIRKIT_E2E_BASE_URL ?? "http://localhost:3000";
const PROMPT = "Design a hand-solderable 5 V LED blinker using a 555 timer in astable mode at approximately 1 to 1.5 Hz. Use an SOIC-8 timer, 0805 resistors and capacitors, an 0805 LED, and a two-pin 2.54 mm through-hole power header. Include supply decoupling and a control-pin bypass capacitor. Make a compact two-layer PCB suitable for JLCPCB fabrication. Use only parts with exact verified symbols, footprints, pin-to-pad mappings, and physical package authority. Do not use a ground plane, high-speed rules, hidden connections, or unspecified connector footprints.";

const args = process.argv.slice(2);
const projectId = args.includes("--project") ? args[args.indexOf("--project") + 1]! : `e2e-${Date.now().toString(36)}`;
const TENANT = "local", BRANCH = "main";
const designId = `design:${projectId}`, boardId = `board:${projectId}`;

const headers = {
  "content-type": "application/json",
  "x-sirkit-tenant-id": TENANT,
  "x-sirkit-project-id": projectId,
  "x-sirkit-branch-id": BRANCH,
  "x-sirkit-actor-id": "local-user",
  "x-sirkit-actor-kind": "human",
  "x-sirkit-role": "project_admin",
  "x-sirkit-session-id": "e2e-acceptance",
};

interface Evidence { step: string; ok: boolean; detail: Record<string, unknown> }
const evidence: Evidence[] = [];
function record(step: string, ok: boolean, detail: Record<string, unknown>): void {
  evidence.push({ step, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${step}  ${JSON.stringify(detail).slice(0, 240)}`);
}
function fail(step: string, detail: unknown): never {
  record(step, false, { detail: typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 800) });
  writeEvidence();
  process.exit(1);
}
function writeEvidence(): void {
  const dir = join(__dirname, "output");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `e2e-${projectId}.json`), JSON.stringify({ projectId, prompt: PROMPT, at: new Date().toISOString(), evidence }, null, 2));
}

/**
 * Minimal request helper over node:http.
 *
 * `fetch` (undici) enforces a 300 s headers timeout that cannot be raised from
 * plain Node, and real stages here legitimately exceed it: live multi-agent
 * generation and a bundled-FreeRouting qualification both run for minutes.
 * node:http has no such ceiling, so the driver waits for the real result
 * instead of aborting a healthy request.
 */
interface RawResponse { status: number; ok: boolean; text: string; headers: NodeJS.Dict<string | string[]>; body: Buffer }
function request(method: "GET" | "POST", path: string, body?: unknown, extra: Record<string, string> = {}): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const url = new URL(`${BASE}${path}`);
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const req = httpRequest(
      {
        protocol: url.protocol, hostname: url.hostname, port: url.port || 80,
        path: `${url.pathname}${url.search}`, method,
        headers: { ...headers, ...extra, ...(payload ? { "content-length": String(payload.byteLength) } : {}) },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          const status = res.statusCode ?? 0;
          resolve({ status, ok: status >= 200 && status < 300, text: buf.toString("utf8"), headers: res.headers, body: buf });
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(0);
    if (payload) req.write(payload);
    req.end();
  });
}

async function post(path: string, body: unknown, extra: Record<string, string> = {}): Promise<RawResponse> {
  return request("POST", path, body, extra);
}

async function main(): Promise<void> {
  const refusal = acceptanceDriverRefusal(args, BASE, { fixtureRuntime: fixtureRuntimeEnabled(), databaseUrl: process.env.DATABASE_URL }); // [B24-A4] D24-12; OD-201 narrowed (OD-226): only a disposable target, before the first request and the catalog read
  if (refusal) { console.error(`REFUSED ${refusal.code}: ${refusal.message}`); process.exit(2); }
  console.log(`R05-E2E01 acceptance run — project ${projectId}\n`);

  // ── 1. Live generation ────────────────────────────────────────────────────
  const started = Date.now();
  const genRes = await request("POST", "/api/schematic/build-multi", { provider: "anthropic", prompt: PROMPT });
  const genBody = (JSON.parse(genRes.text || "{}")) as { ok?: boolean; netlist?: BuildLogicalNetlist; explanation?: string; error?: string; reason?: string };
  if (!genRes.ok || !genBody.ok || !genBody.netlist) fail("1-live-generation", genBody);
  const netlist = genBody.netlist;
  record("1-live-generation", true, { provider: "anthropic", latencyMs: Date.now() - started, components: netlist.components.length, connections: netlist.connections.length, refs: netlist.components.map((c) => `${c.refDes}=${c.value ?? ""}`) });
  // Persist the exact generated netlist so electrical verification can analyse
  // the real circuit rather than a re-description of it.
  mkdirSync(join(__dirname, "output"), { recursive: true });
  writeFileSync(join(__dirname, "output", `netlist-${projectId}.json`), JSON.stringify(netlist, null, 2));

  // ── 2. Deterministic validated auto-layout (identical to the UI path) ─────
  const parts = await getFullPartsByIds(netlist.components.map((c) => c.partId));
  const partMap = new Map<string, CachedPart>(parts.map((p) => [p.id, p]));
  const layout = autoLayoutBuildValidated(netlist, partMap);
  const schematic = layout.state as SchematicState;
  const instances = schematic.kicadComponents ?? [];
  const withAuthority = instances.filter((k) => k.atomicPartRevisionId);
  record("2-auto-layout", withAuthority.length === instances.length && instances.length > 0, {
    instances: instances.length, withAtomicAuthority: withAuthority.length,
    validationOk: layout.validation.ok, validationIssues: layout.validation.violations.length,
    missing: instances.filter((k) => !k.atomicPartRevisionId).map((k) => `${k.refDes}=${k.value ?? ""}`),
  });
  if (withAuthority.length !== instances.length) fail("2-auto-layout", "Some instances lack published atomic authority.");

  // ── 3. Physical bindings through the ordinary Stage 1 lifecycle ──────────
  // Sequential by design: each binding is a durable multi-write transaction and
  // the pooler caps concurrent sessions.
  for (const instance of instances) {
    const res = await post("/api/physical-bindings", { operation: "bind_atomic_selection", componentInstanceId: instance.id, boardInstanceId: boardId, atomicPartRevisionId: instance.atomicPartRevisionId });
    if (!res.ok) fail("3-physical-bindings", { refDes: instance.refDes, status: res.status, body: res.text.slice(0, 400) });
  }
  record("3-physical-bindings", true, { bound: instances.length });

  // ── 4. Durable publication ────────────────────────────────────────────────
  const graph = buildPcbSyncPublicationGraph(schematic, (id) => partMap.get(id) ?? null);
  const token = graph.sourceDigest.replace(/^sha256:/, "").slice(0, 40);
  const now = new Date().toISOString();
  const pubRes = await post("/api/pcb-sync", {
    operation: "publish_demo_snapshot",
    request: {
    requestSchemaVersion: "sirkit.pcb-sync-demo-publication-request.v1",
    requestId: `publish:${token}`, designId, boardId, boardName: "Main Board",
    projectRevision: `project:${token}`, designRevision: `design:${token}`, schematicRevision: `schematic:${token}`,
    componentSetRevision: `components:${token}`, netGraphRevision: `netgraph:${token}`,
    assemblyVariantId: "variant-default", assemblyVariantRevision: "variant:default:1", librarySnapshotRevision: "library:current:1",
    expectedSnapshotRevision: 0, idempotencyKey: `publish:${token}`,
    components: graph.components, nets: graph.nets, prerequisiteIssues: graph.prerequisiteIssues, sourceDigest: graph.sourceDigest, requestedAt: now,
    },
  });
  const pub = (JSON.parse(pubRes.text || "{}")) as { ok?: boolean; result?: { snapshotRevision: number; snapshot: { schematicRevision: string } }; code?: string; error?: string };
  if (!pubRes.ok || !pub.ok || !pub.result) fail("4-publish-snapshot", pub);
  record("4-publish-snapshot", true, { snapshotRevision: pub.result.snapshotRevision, components: graph.components.length, nets: graph.nets.length, sourceDigest: graph.sourceDigest.slice(0, 24) });

  // ── 5. Preflight → apply → authoritative reload ──────────────────────────
  const preRes = await post("/api/pcb-sync", {
    operation: "preflight",
    request: {
    requestSchemaVersion: "sirkit.pcb-sync-preflight-request.v1", requestId: `preflight:${token}`, designId,
    schematicRevision: pub.result.snapshot.schematicRevision, assemblyVariantId: "variant-default",
    target: { kind: "new_board", boardId, boardName: "Main Board", boardFormatVersion: "sirkit-json-pcb/1" },
    resolutionPolicyId: "sirkit.default-footprint-resolution", resolutionPolicyVersion: "1.0.0",
    syncPolicyId: "sirkit.safe-pcb-sync", syncPolicyVersion: "1.0.0", requestedAt: now, mode: "prepare_apply",
    },
  });
  const pre = (JSON.parse(preRes.text || "{}")) as { ok?: boolean; result?: { status: string; plan?: { planId: string; planDigest: string; prerequisites: { code: string; blocking: boolean }[] }; blockers?: { code: string; message: string; displayRefs: string[] }[] }; code?: string };
  if (!preRes.ok || !pre.ok || !pre.result) fail("5a-preflight", pre);
  if (pre.result.status !== "ready_to_apply" || !pre.result.plan) fail("5a-preflight", { status: pre.result.status, blockers: pre.result.blockers?.map((b) => `${b.code}: ${b.message} ${b.displayRefs.join(",")}`) });
  record("5a-preflight", true, { status: pre.result.status, planId: pre.result.plan.planId.slice(0, 28) });

  const plan = pre.result.plan;
  const applyRes = await post("/api/pcb-sync", {
    operation: "apply",
    request: {
    requestSchemaVersion: "sirkit.pcb-sync-apply-request.v1", requestId: `apply:${plan.planId}`, designId, boardId,
    planId: plan.planId, planDigest: plan.planDigest, expectedPlanLifecycle: "applicable", confirmation: "apply_exact_plan",
    idempotencyKey: `apply:${plan.planId}`, warningAcknowledgements: plan.prerequisites.filter((p) => !p.blocking).map((p) => p.code), requestedAt: new Date().toISOString(),
    },
  }, { "x-sirkit-pcb-sync-opt-in": "true" });
  const applied = (JSON.parse(applyRes.text || "{}")) as { ok?: boolean; result?: { status: string; committedBoardRevision?: string; committedBoardDigest?: string }; code?: string };
  if (!applyRes.ok || !applied.ok || !applied.result?.committedBoardRevision) fail("5b-apply", applied);
  record("5b-apply", true, { status: applied.result.status, boardRevision: applied.result.committedBoardRevision });

  const loadRes = await request("GET", `/api/pcb-sync?boardId=${encodeURIComponent(boardId)}`);
  const loaded = (JSON.parse(loadRes.text || "{}")) as { ok?: boolean; result?: { status: string; record?: { revision: string; digest: string; board: { footprints: unknown[]; nets: unknown[] } } } };
  if (!loaded.ok || loaded.result?.status !== "found" || !loaded.result.record) fail("5c-authoritative-load", loaded);
  if (loaded.result.record.revision !== applied.result.committedBoardRevision || loaded.result.record.digest !== applied.result.committedBoardDigest) fail("5c-authoritative-load", "Reloaded board identity differs from the committed revision/digest.");
  record("5c-authoritative-load", true, { revision: loaded.result.record.revision, footprints: loaded.result.record.board.footprints.length, nets: loaded.result.record.board.nets.length });

  // ── 6. Autonomous qualification (placement + real FreeRouting + RC01/02/03) ─
  const qualStarted = Date.now();
  const qualRes = await post("/api/pcb/qualify", { designId, boardId });
  const qual = (JSON.parse(qualRes.text || "{}")) as Record<string, unknown>;
  if (!qualRes.ok || qual.ok !== true) fail("6-autonomous-qualification", qual);
  record("6-autonomous-qualification", true, { latencyMs: Date.now() - qualStarted, boardRevision: qual.boardRevision, rc02: qual.rc02, rc03: qual.rc03, selectedCandidateId: qual.selectedCandidateId });

  // ── 7. MFG01 verified release ────────────────────────────────────────────
  const relRes = await post("/api/pcb/release", { designId, boardId });
  if (!relRes.ok) fail("7-verified-release", relRes.text.slice(0, 600));
  const zip = relRes.body;
  const sha = createHash("sha256").update(zip).digest("hex");
  const header = (res: RawResponse, name: string): string => { const v = res.headers[name.toLowerCase()]; return Array.isArray(v) ? (v[0] ?? "") : (v ?? ""); };
  const releaseId = header(relRes, "X-Sirkit-Release-Id");
  if (header(relRes, "X-Sirkit-Archive-Sha256") !== sha) fail("7-verified-release", "Archive SHA-256 header does not match the delivered bytes.");
  const outDir = join(__dirname, "output");
  mkdirSync(outDir, { recursive: true });
  const zipPath = join(outDir, `sirkit-verified-release-${projectId}.zip`);
  writeFileSync(zipPath, zip);
  record("7-verified-release", true, { releaseId, bytes: zip.byteLength, sha256: sha, disposition: header(relRes, "X-Sirkit-Release-Disposition"), path: zipPath });

  // ── 8. Determinism A/B — same authority released twice ───────────────────
  const relRes2 = await post("/api/pcb/release", { designId, boardId });
  if (!relRes2.ok) fail("8-determinism", relRes2.text.slice(0, 600));
  const zip2 = relRes2.body;
  const sha2 = createHash("sha256").update(zip2).digest("hex");
  record("8-determinism", sha === sha2, { first: sha.slice(0, 16), second: sha2.slice(0, 16), identical: sha === sha2 });
  if (sha !== sha2) fail("8-determinism", "Two releases from the same immutable authority differ.");

  writeEvidence();
  console.log(`\nCOMPLETE — verified archive: ${zipPath}`);
  console.log(`project=${projectId} releaseId=${releaseId} sha256=${sha}`);
  process.exit(0);
}

main().catch((error) => { console.error("E2E ERROR:", error); writeEvidence(); process.exit(1); });
