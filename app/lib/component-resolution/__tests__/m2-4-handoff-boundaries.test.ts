/**
 * [PR-M, 2026-10-18] Section M2 (design M2.4): the boundaries of the review handoff and the publication of ACQUIRED references.
 *
 *  - the handoff is a HUMAN member's act, in the configured governance scope of the same tenant; it carries no project id; it copies
 *    only redistributable, indefinitely retained objects (a forged private-licence object is refused);
 *  - the publication of an acquired reference keeps every existing rule: an AI actor is refused at submit, resolve and publish; the
 *    approver cannot publish; an approval against a changed digest is refused; a spec naming an object the handoff does not hold reads
 *    the asset as missing; the pin table enters as its OWN source class (a fixture table is never a manufacturer datasheet);
 *  - VENDOR_REACH: the handoff, the object store and the task service's publication-facing modules reach no egress, distributor or live
 *    search code (b19-e-publication-boundaries.test.ts carries the same walk for the publication modules).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryDurableWorkflowRepository } from "@/app/lib/durable-workflow/repository";
import { createFixtureCadTransport } from "@/app/lib/fixture-runtime/cad-source/transport";
import { createFixtureCadAdapter } from "@/app/lib/acquisition/cad-adapters/network";
import { DurableAcquiredObjectStore, CAD_OBJECT_AGGREGATE } from "@/app/lib/acquisition/cad-object-store";
import { resetAdmissionControl } from "@/app/lib/acquisition/admission-control";
import { DurableAcquisitionCandidateStore } from "@/app/lib/component-resolution/acquisition/candidate";
import { runAcquisitionPipeline } from "@/app/lib/component-resolution/acquisition/pipeline";
import { acquiredAssetsLoader, createAcquisitionHandoff, handoffRegisteredCandidates, loadAcquisitionHandoff, type HandoffDeps } from "@/app/lib/component-resolution/acquisition/handoff";
import { publishAtomicPublicationRequest, resolveAtomicPublicationRequest, submitAtomicPublicationRequest } from "@/app/lib/atomic/publication-review";
import { fixtureDeps, GOVERNANCE, human, USERS } from "@/app/lib/atomic/__tests__/_publication-fixtures";
import type { EngineeringActor } from "@/app/lib/engineering/types";
import { target1N4148 } from "./_m2-fixtures";

const SOURCE = { tenantId: GOVERNANCE.tenantId, projectId: "p-m2-handoff", branchId: "main" };
const NOW = Date.parse("2026-10-18T10:00:00.000Z");
const ai: EngineeringActor = { actorId: "agent:assistant", actorKind: "ai", sessionId: "s", role: "pcb_editor" };
const ROOT = process.cwd();

async function validatedCandidate(repository = new InMemoryDurableWorkflowRepository()) {
  const transport = createFixtureCadTransport();
  const outcome = await runAcquisitionPipeline({ scope: SOURCE, target: target1N4148(), assetKinds: ["datasheet", "footprint", "symbol"], ports: { adapters: [createFixtureCadAdapter({ fetch: transport.fetch, resolve: transport.resolve, fixtureAllowed: true, clock: () => NOW })], skipped: [], objects: new DurableAcquiredObjectStore(repository), candidates: new DurableAcquisitionCandidateStore(repository), clock: () => NOW } });
  if (outcome.kind !== "candidate") throw new Error(JSON.stringify(outcome));
  const deps: HandoffDeps = { repository, governance: { tenantId: GOVERNANCE.tenantId, projectId: GOVERNANCE.projectId }, clock: () => NOW };
  return { repository, candidate: outcome.candidate, deps };
}

beforeEach(() => resetAdmissionControl());

describe("[PR-M M2.4] the handoff", () => {
  it("is a human member's act in the same tenant's configured governance scope, idempotent, and carries no project id", async () => {
    const { candidate, deps } = await validatedCandidate();
    const input = { sourceScope: SOURCE, taskId: "cr-task:0123456789abcdef0123456789abcdef", candidateId: candidate.candidateId, membershipRevision: null };
    await expect(createAcquisitionHandoff(deps, { ...input, actor: ai })).rejects.toMatchObject({ code: "ACQUISITION_HANDOFF_HUMAN_REQUIRED" });
    await expect(createAcquisitionHandoff(deps, { ...input, actor: human("u-viewer", "viewer") })).rejects.toMatchObject({ code: "ACQUISITION_HANDOFF_FORBIDDEN" });
    await expect(createAcquisitionHandoff({ ...deps, governance: { tenantId: null, projectId: null } }, { ...input, actor: human(USERS.editor, "pcb_editor") })).rejects.toMatchObject({ code: "ACQUISITION_HANDOFF_GOVERNANCE_UNCONFIGURED" });
    await expect(createAcquisitionHandoff(deps, { ...input, sourceScope: { ...SOURCE, tenantId: "tenant-other" }, actor: human(USERS.editor, "pcb_editor") })).rejects.toMatchObject({ code: "ACQUISITION_HANDOFF_CROSS_TENANT" });
    const first = await createAcquisitionHandoff(deps, { ...input, actor: human(USERS.editor, "pcb_editor") });
    const second = await createAcquisitionHandoff(deps, { ...input, actor: human(USERS.editor, "pcb_editor") });
    expect(second).toMatchObject({ created: false, handoff: { handoffId: first.handoff.handoffId } });
    expect(JSON.stringify(first.handoff)).not.toContain(SOURCE.projectId);
    // the objects now live in the governance scope too, re-hashable there
    const store = new DurableAcquiredObjectStore(deps.repository);
    for (const hash of [first.handoff.symbolObject, first.handoff.footprintObject!, first.handoff.datasheetObject!]) expect((await store.get(GOVERNANCE, hash)).sha256).toBe(hash);
    expect(await loadAcquisitionHandoff(deps, first.handoff.handoffId)).toMatchObject({ candidateId: candidate.candidateId });
    expect(await loadAcquisitionHandoff(deps, "acquisition-handoff:ffffffffffffffffffffffffffffffff")).toBeNull();
  });

  it("refuses an object whose stored licence is not redistributable (a forged record), and a candidate that is not validated", async () => {
    const { candidate, deps, repository } = await validatedCandidate();
    const head = await repository.loadHead<Record<string, unknown>>({ scope: SOURCE, aggregateType: CAD_OBJECT_AGGREGATE, aggregateKey: `acquired-object:${candidate.footprintObject}` });
    await repository.commit({ scope: SOURCE, scopeKey: "forge", idempotencyKey: "forge-licence", operations: [{ aggregateType: CAD_OBJECT_AGGREGATE, aggregateKey: `acquired-object:${candidate.footprintObject}`, expectedRevision: head!.revision, payload: { ...head!.payload, license: { ...(head!.payload.license as object), exportDisposition: "private_review_only" } } }], outbox: [], result: {}, committedAt: new Date(NOW).toISOString() });
    await expect(createAcquisitionHandoff(deps, { sourceScope: SOURCE, taskId: "cr-task:0123456789abcdef0123456789abcdee", candidateId: candidate.candidateId, actor: human(USERS.editor, "pcb_editor"), membershipRevision: null })).rejects.toMatchObject({ code: "ACQUISITION_HANDOFF_LICENCE_REFUSED" });
    await expect(createAcquisitionHandoff(deps, { sourceScope: SOURCE, taskId: "cr-task:0123456789abcdef0123456789abcdee", candidateId: "acquisition-candidate:00000000000000000000000000000000", actor: human(USERS.editor, "pcb_editor"), membershipRevision: null })).rejects.toMatchObject({ code: "ACQUISITION_CANDIDATE_NOT_FOUND" });
  });
});

describe("[PR-M M2.4] publishing acquired references keeps every two-person rule", () => {
  async function prepared() {
    const { candidate, deps: handoffDeps } = await validatedCandidate();
    const { handoff } = await createAcquisitionHandoff(handoffDeps, { sourceScope: SOURCE, taskId: "cr-task:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", candidateId: candidate.candidateId, actor: human(USERS.editor, "pcb_editor"), membershipRevision: null });
    const deps = fixtureDeps({ workflow: handoffDeps.repository, acquired: acquiredAssetsLoader(handoffDeps), registeredCandidates: handoffRegisteredCandidates(handoffDeps) });
    const spec = { ...handoff.package.spec, manufacturer: { canonicalName: "Nexperia", officialDomains: [] }, datasheet: { url: null, locator: "1N4148 datasheet, pinning" } };
    return { handoff, deps, spec };
  }

  it("an AI actor is refused at submit, resolve and publish; the approver cannot publish; a changed digest is refused", async () => {
    const { deps, spec } = await prepared();
    await expect(submitAtomicPublicationRequest(deps, { scope: GOVERNANCE, actor: ai, membershipRevision: null, spec, links: [], reason: "agent" })).rejects.toMatchObject({ code: "ATOMIC_PUBLICATION_HUMAN_REQUIRED" });
    const { stored } = await submitAtomicPublicationRequest(deps, { scope: GOVERNANCE, actor: human(USERS.editor, "pcb_editor"), membershipRevision: null, spec, links: [], reason: "acquired part" });
    // the acquired assets are engineering candidates of their OWN source; the fixture pin table is organization-authored, never a manufacturer datasheet
    const classes = new Set(stored.request.evidence.facts.map((fact) => `${fact.property}:${fact.sourceClass}:${fact.sourceId}`));
    expect(classes.has("symbol:official_kicad_library:source_cad_fixture_kicad")).toBe(true);
    expect(classes.has("footprint:official_kicad_library:source_cad_fixture_kicad")).toBe(true);
    expect(classes.has("pin_mapping:organization_authored:source_cad_fixture_pin_tables")).toBe(true);
    expect(JSON.stringify(stored.request.evidence)).not.toContain("manufacturer_datasheet");
    expect(stored.request.evidence.missing).toEqual([]);
    const manufacturer = stored.request.evidence.facts.find((fact) => fact.property === "manufacturer")!;
    const resolution = { resolutions: [{ property: "manufacturer", factId: manufacturer.factId, reason: "datasheet" }], factDispositions: [] };
    await expect(resolveAtomicPublicationRequest(deps, { scope: GOVERNANCE, actor: { ...ai, role: "reviewer" }, requestId: stored.request.requestId, decision: "approve", reason: "x", reviewEvidenceDigest: stored.request.evidence.reviewEvidenceDigest, ...resolution })).rejects.toMatchObject({ code: "ATOMIC_PUBLICATION_HUMAN_REQUIRED" });
    await expect(resolveAtomicPublicationRequest(deps, { scope: GOVERNANCE, actor: human(USERS.reviewer, "reviewer"), requestId: stored.request.requestId, decision: "approve", reason: "x", reviewEvidenceDigest: "sha256:changed", ...resolution })).rejects.toMatchObject({ code: "ATOMIC_PUBLICATION_EVIDENCE_CHANGED" });
    const approved = await resolveAtomicPublicationRequest(deps, { scope: GOVERNANCE, actor: human(USERS.admin, "project_admin"), requestId: stored.request.requestId, decision: "approve", reason: "reviewed", reviewEvidenceDigest: stored.request.evidence.reviewEvidenceDigest, ...resolution });
    await expect(publishAtomicPublicationRequest(deps, { scope: GOVERNANCE, actor: { ...ai, role: "project_admin" }, requestId: approved.request.requestId, reason: "x" })).rejects.toMatchObject({ code: "ATOMIC_PUBLICATION_HUMAN_REQUIRED" });
    await expect(publishAtomicPublicationRequest(deps, { scope: GOVERNANCE, actor: human(USERS.admin, "project_admin"), requestId: approved.request.requestId, reason: "x" })).rejects.toMatchObject({ code: "ATOMIC_PUBLICATION_SAME_PERSON" });
    const published = await publishAtomicPublicationRequest(deps, { scope: GOVERNANCE, actor: human(USERS.admin2, "project_admin"), requestId: approved.request.requestId, reason: "a different administrator" });
    expect(published.request.status).toBe("published");
    expect(deps.published).toHaveLength(1);
  });

  it("a spec naming an object the handoff does not hold reads the asset as missing (never another file); bytes in a body are refused", async () => {
    const { deps, spec, handoff } = await prepared();
    const forged = { ...spec, symbol: { ...spec.symbol!, acquired: { handoffId: handoff.handoffId, objectHash: "a".repeat(64) } } };
    const { stored } = await submitAtomicPublicationRequest(deps, { scope: GOVERNANCE, actor: human(USERS.editor, "pcb_editor"), membershipRevision: null, spec: forged, links: [], reason: "forged" });
    expect(stored.request.evidence.missing).toContain("symbol");
    expect(stored.request.evidence.authoringDiagnostics.join(" ")).toContain("is not among the stored objects");
    await expect(submitAtomicPublicationRequest(deps, { scope: GOVERNANCE, actor: human(USERS.editor2, "pcb_editor"), membershipRevision: null, spec: { ...spec, exactMpn: "1N4148X", symbol: { ...spec.symbol!, acquired: { handoffId: handoff.handoffId, objectHash: handoff.symbolObject, content: "(kicad_symbol_lib)" } } }, links: [], reason: "bytes" })).rejects.toMatchObject({ code: "ATOMIC_PUBLICATION_INPUT_INVALID" });
  });
});

// ─── VENDOR_REACH over the new publication-facing modules (the b19-e walker's rule) ────────────────────────────────────────────

const VENDOR_REACH = /^app\/lib\/distributors\/(?!types\.ts$|shared\.ts$|lifecycle-sql\.ts$)|^app\/lib\/net\/outbound-fetch\.ts$|^app\/lib\/acquisition\/(external-search|admission-control|cad-egress)\.ts$|^app\/lib\/acquisition\/cad-adapters\//;
function resolveImport(from: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? path.join(ROOT, spec.slice(2)) : spec.startsWith(".") ? path.resolve(path.dirname(from), spec) : null;
  if (!base) return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) if (existsSync(candidate) && /\.(ts|tsx)$/.test(candidate)) return candidate;
  return null;
}
function vendorReach(entry: string): string[] {
  const seen = new Set<string>(), offenders: string[] = [], queue = [path.join(ROOT, entry)];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const relative = path.relative(ROOT, file).split(path.sep).join("/");
    if (VENDOR_REACH.test(relative)) { offenders.push(relative); continue; }
    const source = readFileSync(file, "utf8");
    const specs = [...source.matchAll(/^\s*(import|export)\s+(?!type\s)([^;]*?)\s+from\s+["']([^"']+)["']|^\s*import\s+["']([^"']+)["']/gm)].map((match) => match[3] ?? match[4]!);
    for (const match of source.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) specs.push(match[1]!);
    for (const spec of specs) { const resolved = resolveImport(file, spec); if (resolved && !/__tests__/.test(resolved)) queue.push(resolved); }
  }
  return offenders;
}

describe("[PR-M M2.4] the publication path reads acquired bytes from storage, never through egress", () => {
  it.each(["app/lib/component-resolution/acquisition/handoff.ts", "app/lib/acquisition/cad-object-store.ts", "app/lib/atomic/authoring.ts", "app/lib/atomic/publication-review.ts", "app/api/components/atomic/publication/route.ts", "app/lib/component-resolution/task/service.ts", "app/lib/component-resolution/task/runtime.ts"])("%s reaches no egress, distributor or live search", (entry) => {
    expect(existsSync(path.join(ROOT, entry)), entry).toBe(true);
    expect(vendorReach(entry)).toEqual([]);
  });
  it("the walker bites: the worker runtime (which composes the CAD adapters) reaches the egress", () => {
    expect(vendorReach("app/lib/component-resolution/task/worker-runtime.ts")).toEqual(expect.arrayContaining(["app/lib/acquisition/cad-adapters/network.ts"]));
  });
});
