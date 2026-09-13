/**
 * [B19-E E4] c, d — the atomic publication request aggregate (`atomic.publication-request.v1`): approval refusals and roles.
 *
 * In the catalog governance project an editor requests publication of an exact MPN; the server assembles the evidence itself
 * (offer cache labels, the bundled KiCad library, the person-entered terminal table, package and citation as
 * organization_authored under that person); a reviewer resolves every conflict, the manufacturer, the missing evidence and
 * each quarantined fact; a DIFFERENT person publishes. The AI takes no part. These suites use the in-memory durable
 * repository; the database-backed publication transaction is `b19-e-publication-review-durable.test.ts`.
 *
 * Reproduced on the unchanged code: none of this existed (no aggregate, no approval gate, no two-person publication path
 * from a request), so every case failed to import.
 */
import { describe, expect, it } from "vitest";
import { candidateFromExtraction, observationFromPricing, type ExternalObservation } from "../../acquisition/quarantine";
import type { PartPricing } from "../../distributors/types";
import { membershipRevisionOf } from "../../auth/project-membership";
import type { EngineeringActor } from "../../engineering/types";
import {
  ATOMIC_PUBLICATION_AGGREGATE,
  AtomicPublicationError,
  listAtomicPublicationRequests,
  publishAtomicPublicationRequest,
  PUBLISH_MARKER_LEASE_MS,
  resolveAtomicPublicationRequest,
  submitAtomicPublicationRequest,
  withdrawAtomicPublicationRequest,
  type AtomicPublicationDeps,
  type StoredAtomicPublication,
} from "../publication-review";
import { REVIEW_AUTHORITY_SOURCE_CLASSES, resolvableFact, type AtomicPublicationRequest, type AtomicPublicationSpec, type ImportReviewFact } from "../publication-review-contract";
import { terminalTableText } from "../authoring";
import { ENGINEERING_AUTHORITY_SOURCE_CLASSES } from "../validation";
import { fixtureDeps, GOVERNANCE, human, ne555Spec, NE555_TERMINALS, PARTS, T_SUBMIT, USERS, type FixtureDeps } from "./_publication-fixtures";

const LATER = (minutes: number) => new Date(T_SUBMIT.getTime() + minutes * 60_000);
const editor = human(USERS.editor, "pcb_editor");
const reviewer = human(USERS.reviewer, "reviewer");
const admin = human(USERS.admin, "project_admin");
const admin2 = human(USERS.admin2, "project_admin");

function distributor(name: "digikey" | "octopart-aggregated", manufacturer: string): ExternalObservation {
  const pricing: PartPricing = { distributor: name, mpn: "NE555DR", manufacturer, description: "timer", datasheet: null, inStock: 10, minOrderQty: 1, priceBreaks: [], bestUnitPrice: null, productUrl: null, package: null, lifecycleStatus: "active", lifecycleRaw: "Active", fetchedAt: T_SUBMIT.getTime() };
  return observationFromPricing(pricing, { rawContentHash: null, retrievedAt: T_SUBMIT });
}

async function refusal(attempt: Promise<unknown>): Promise<AtomicPublicationError> {
  const error = await attempt.then(() => null, (caught: unknown) => caught);
  expect(error, "the attempt was refused").toBeInstanceOf(AtomicPublicationError);
  return error as AtomicPublicationError;
}

async function submit(deps: FixtureDeps, spec = ne555Spec(), actor = editor): Promise<StoredAtomicPublication> {
  deps.setNow(T_SUBMIT);
  const { stored } = await submitAtomicPublicationRequest(deps, { scope: GOVERNANCE, actor, membershipRevision: null, spec, links: [], reason: "publish the exact timer" });
  return stored;
}

/** The complete, valid resolution a reviewer would send for a request. */
function fullResolution(request: AtomicPublicationRequest) {
  const manufacturer = request.evidence.facts.find((fact) => fact.property === "manufacturer" && fact.sourceClass === "organization_authored")!;
  const resolutions = [{ property: "manufacturer", factId: manufacturer.factId, reason: "the datasheet names Texas Instruments" }];
  for (const conflict of request.evidence.conflicts.filter((item) => item.kind !== "lifecycle" && item.property !== "manufacturer")) {
    const draftFact = request.evidence.facts.find((fact) => fact.property === conflict.property && fact.sourceClass === "organization_authored") ?? request.evidence.facts.find((fact) => fact.property === conflict.property && fact.sourceClass === "official_kicad_library")!;
    resolutions.push({ property: conflict.property, factId: draftFact.factId, reason: "the assembled draft's value, checked against the datasheet" });
  }
  const factDispositions = request.evidence.facts.filter((fact) => fact.establishes === "quarantined").map((fact) => ({ factId: fact.factId, disposition: "rejected" as const, note: "model extraction contradicts the datasheet" }));
  return { reviewEvidenceDigest: request.evidence.reviewEvidenceDigest, resolutions, factDispositions };
}

async function approve(deps: FixtureDeps, stored: StoredAtomicPublication, actor = reviewer, patch: Partial<ReturnType<typeof fullResolution>> & { membershipRevision?: string | null } = {}) {
  deps.setNow(LATER(5));
  return resolveAtomicPublicationRequest(deps, { scope: GOVERNANCE, actor, requestId: stored.request.requestId, decision: "approve", reason: "symbol, footprint and pin map verified against the datasheet", ...fullResolution(stored.request), ...patch });
}

describe("[B19-E E4] the request assembles its own evidence (baseline)", () => {
  it("an editor's request is pending, its evidence proves nothing, and the person-entered table is organization_authored under the requester", async () => {
    const deps = fixtureDeps();
    const stored = await submit(deps);
    expect(stored.request.status).toBe("pending");
    expect(stored.request.evidence.proven).toBe(false);
    expect(stored.request.evidence.missing).toEqual([]);
    const table = stored.request.evidence.facts.find((fact) => fact.property === "pin_mapping")!;
    expect(table).toMatchObject({ sourceClass: "organization_authored", establishes: "engineering_candidate", method: "manual" });
    expect(table.sourceId).toContain("org");
    expect(stored.request.evidence.facts.some((fact) => fact.sourceClass === "manufacturer_datasheet")).toBe(false);
    expect(stored.request.evidence.facts.find((fact) => fact.property === "symbol")).toMatchObject({ sourceClass: "official_kicad_library", value: "Timer:NE555D" });
    // the KiCad bytes were read server-side from the bundled library, never from the request
    expect((deps.library as unknown as { reads: string[] }).reads).toEqual(expect.arrayContaining(["symbol:Timer/NE555D", "footprint:Package_SO/SOIC-8_3.9x4.9mm_P1.27mm"]));
  });

  it("a complete review approves, a different administrator publishes, and the published revision has two different humans", async () => {
    const deps = fixtureDeps();
    const approved = await approve(deps, await submit(deps));
    expect(approved.request.status).toBe("approved");
    expect(approved.request.decision).toMatchObject({ decidedBy: { actorId: USERS.reviewer }, decision: "approve", approval: { eligible: true, blockers: [] } });
    deps.setNow(LATER(10));
    const published = await publishAtomicPublicationRequest(deps, { scope: GOVERNANCE, actor: admin, requestId: approved.request.requestId, reason: "publish the reviewed revision" });
    expect(published.request.status).toBe("published");
    expect(deps.published).toHaveLength(1);
    const history = deps.published[0]!.snapshot.atomicRevision.reviewHistory;
    expect(history.map((event) => [event.action, event.actorId])).toEqual([["submit", USERS.editor], ["approve", USERS.reviewer], ["publish", USERS.admin]]);
    expect(deps.published[0]).toMatchObject({ actorId: USERS.admin, actorRole: "publisher", requiredProfile: "pcb_assignable" });
    expect(published.request.publication).toMatchObject({ revisionId: deps.published[0]!.snapshot.atomicRevision.id, publishedBy: { actorId: USERS.admin } });
  });

  it("the in-memory catalog starts at the logical part's latest revision number", async () => {
    const deps = fixtureDeps({ loadIdentity: async () => ({ manufacturerId: "manufacturer_ti", exactPartId: "exact_manufacturer_ti_ne555dr", logicalPartId: "logical_manufacturer_ti_ne555dr", latestRevision: 7 }) });
    const approved = await approve(deps, await submit(deps));
    deps.setNow(LATER(10));
    await publishAtomicPublicationRequest(deps, { scope: GOVERNANCE, actor: admin, requestId: approved.request.requestId, reason: "publish" });
    const revision = deps.published[0]!.snapshot.atomicRevision;
    expect(revision.logicalPartId).toBe("logical_manufacturer_ti_ne555dr");
    expect(revision.exactPartId).toBe("exact_manufacturer_ti_ne555dr");
    expect(deps.published[0]!.snapshot.manufacturer?.id).toBe("manufacturer_ti");
    expect(revision.revision).toBeGreaterThan(7);
  });
});

describe("[B19-E E4 c] approval is refused (409) unless every condition holds", () => {
  it("a manufacturer conflict (same MPN, two manufacturers) with no authoritative manufacturer fact cannot be approved", async () => {
    const deps = fixtureDeps();
    deps.observations = [distributor("digikey", "Texas Instruments"), distributor("octopart-aggregated", "Acme Semiconductor")];
    const stored = await submit(deps, ne555Spec({ manufacturer: null }));
    expect(stored.request.evidence.conflicts.map((conflict) => [conflict.property, conflict.kind])).toEqual([["manufacturer", "identity"]]);
    deps.setNow(LATER(5));
    const base = { scope: GOVERNANCE, actor: reviewer, requestId: stored.request.requestId, decision: "approve" as const, reason: "ok", reviewEvidenceDigest: stored.request.evidence.reviewEvidenceDigest, factDispositions: [] };
    const unresolved = await refusal(resolveAtomicPublicationRequest(deps, { ...base, resolutions: [] }));
    expect([unresolved.code, unresolved.status]).toEqual(["ATOMIC_PUBLICATION_MANUFACTURER_UNRESOLVED", 409]);
    const hint = stored.request.evidence.facts.find((fact) => fact.property === "manufacturer" && fact.sourceId === "digikey")!;
    const byHint = await refusal(resolveAtomicPublicationRequest(deps, { ...base, resolutions: [{ property: "manufacturer", factId: hint.factId, reason: "DigiKey says so" }] }));
    expect([byHint.code, byHint.status]).toEqual(["ATOMIC_PUBLICATION_RESOLUTION_REFUSED", 409]);
    expect((await deps.store.get(GOVERNANCE, stored.key))!.request.status).toBe("pending");
  });

  it("the manufacturer must be resolved explicitly even with no conflict (OD-34: the bundle identity is the MPN only)", async () => {
    const deps = fixtureDeps();
    const stored = await submit(deps);
    const error = await refusal(approve(deps, stored, reviewer, { resolutions: [] }));
    expect([error.code, error.status]).toEqual(["ATOMIC_PUBLICATION_MANUFACTURER_UNRESOLVED", 409]);
  });

  it("an unresolved engineering conflict is refused", async () => {
    const deps = fixtureDeps();
    deps.candidates = [candidateFromExtraction({ exactMpn: "NE555DR", sourceId: "src_mfr_cad", sourceClass: "manufacturer_cad", method: "kicad_parser", parserVersion: "p/1", documentHash: "7".repeat(64), facts: [{ property: "pin_mapping", facet: "terminal", value: "1=VCC@1", locator: "NE555.kicad_sym" }] })];
    const stored = await submit(deps);
    expect(stored.request.evidence.conflicts.map((conflict) => conflict.property)).toEqual(["pin_mapping"]);
    const manufacturer = stored.request.evidence.facts.find((fact) => fact.property === "manufacturer")!;
    const error = await refusal(approve(deps, stored, reviewer, { resolutions: [{ property: "manufacturer", factId: manufacturer.factId, reason: "datasheet" }] }));
    expect([error.code, error.status]).toEqual(["ATOMIC_PUBLICATION_RESOLUTION_REQUIRED", 409]);
    expect(error.detail).toEqual(["pin_mapping"]);
    // resolving with the value the draft is assembled from approves
    expect((await approve(deps, stored)).request.status).toBe("approved");
  });

  it("a resolution picking a quarantined, distributor or identity_hint value for an engineering property is refused", async () => {
    const deps = fixtureDeps();
    deps.observations = [distributor("digikey", "Texas Instruments")];
    deps.candidates = [
      candidateFromExtraction({ exactMpn: "NE555DR", sourceId: "src_mfr_cad", sourceClass: "manufacturer_cad", method: "kicad_parser", parserVersion: "p/1", documentHash: "7".repeat(64), facts: [{ property: "pin_mapping", facet: "terminal", value: "1=VCC@1", locator: "NE555.kicad_sym" }] }),
      candidateFromExtraction({ exactMpn: "NE555DR", sourceId: "src_ds", sourceClass: "manufacturer_datasheet", method: "llm", parserVersion: "model/1", documentHash: "8".repeat(64), facts: [{ property: "pin_mapping", facet: "terminal", value: "1=OUT@1", locator: "p.3" }] }),
    ];
    const stored = await submit(deps);
    const facts = stored.request.evidence.facts;
    const valid = fullResolution(stored.request);
    const others = valid.resolutions.filter((item) => item.property !== "pin_mapping");
    const quarantined = facts.find((fact) => fact.establishes === "quarantined" && fact.property === "pin_mapping")!;
    const distributorHint = facts.find((fact) => fact.sourceId === "digikey" && fact.property === "mpn")!;
    for (const factId of [quarantined.factId, distributorHint.factId]) {
      const error = await refusal(approve(deps, stored, reviewer, { resolutions: [...others, { property: "pin_mapping", factId, reason: "pick it" }] }));
      expect([error.code, error.status], factId).toEqual(["ATOMIC_PUBLICATION_RESOLUTION_REFUSED", 409]);
    }
    const manufacturerHint = facts.find((fact) => fact.sourceId === "digikey" && fact.property === "manufacturer")!;
    const byHint = await refusal(approve(deps, stored, reviewer, { resolutions: [...valid.resolutions.filter((item) => item.property !== "manufacturer"), { property: "manufacturer", factId: manufacturerHint.factId, reason: "DigiKey" }] }));
    expect(byHint.code).toBe("ATOMIC_PUBLICATION_RESOLUTION_REFUSED");
    // a manufacturer-CAD pin map is authoritative, but the draft is assembled from the requested table: publishing another value needs a new request
    const cad = facts.find((fact) => fact.sourceId === "src_mfr_cad")!;
    const byOtherValue = await refusal(approve(deps, stored, reviewer, { resolutions: [...others, { property: "pin_mapping", factId: cad.factId, reason: "the CAD" }] }));
    expect(byOtherValue.code).toBe("ATOMIC_PUBLICATION_RESOLUTION_REFUSED");
    expect((await approve(deps, stored)).request.status).toBe("approved");
  });

  it("a non-empty missing list is refused", async () => {
    const deps = fixtureDeps();
    const stored = await submit(deps, ne555Spec({ footprint: null }));
    expect(stored.request.evidence.missing).toEqual(["footprint"]);
    const error = await refusal(approve(deps, stored));
    expect([error.code, error.status]).toEqual(["ATOMIC_PUBLICATION_EVIDENCE_MISSING", 409]);
    expect(error.detail).toEqual(["footprint"]);
  });

  it("an undispositioned quarantined fact is refused; dispositions are stamped from the trusted reviewer and clock", async () => {
    const deps = fixtureDeps();
    deps.candidates = [candidateFromExtraction({ exactMpn: "NE555DR", sourceId: "src_ds", sourceClass: "manufacturer_datasheet", method: "llm", parserVersion: "model/1", documentHash: "8".repeat(64), facts: [{ property: "pin_mapping", facet: "terminal", value: "1=VCC@1,8=GND@8", locator: "p.3" }] })];
    const stored = await submit(deps);
    expect(stored.request.evidence.quarantinedDisagreements.map((item) => item.property)).toEqual(["pin_mapping"]);
    const error = await refusal(approve(deps, stored, reviewer, { factDispositions: [] }));
    expect([error.code, error.status]).toEqual(["ATOMIC_PUBLICATION_FACT_UNDISPOSITIONED", 409]);
    const approved = await approve(deps, stored, reviewer);
    const disposition = approved.request.decision!.factDispositions[0]!;
    expect(disposition).toMatchObject({ disposition: "rejected", reviewerId: USERS.reviewer, reviewedAt: LATER(5).toISOString() });
  });

  it("digest drift is a 409: the evidence changed since the request, or the reviewer approved a different digest", async () => {
    const deps = fixtureDeps();
    const stored = await submit(deps);
    const stale = await refusal(approve(deps, stored, reviewer, { reviewEvidenceDigest: `sha256:${"0".repeat(64)}` }));
    expect([stale.code, stale.status]).toEqual(["ATOMIC_PUBLICATION_EVIDENCE_CHANGED", 409]);
    deps.candidates = [candidateFromExtraction({ exactMpn: "NE555DR", sourceId: "src_new_cad", sourceClass: "manufacturer_cad", method: "kicad_parser", parserVersion: "p/2", documentHash: "9".repeat(64), facts: [{ property: "symbol", facet: "terminal", value: "Timer:NE555D", locator: "new.kicad_sym" }] })];
    const drift = await refusal(approve(deps, stored));
    expect([drift.code, drift.status]).toEqual(["ATOMIC_PUBLICATION_EVIDENCE_CHANGED", 409]);
    expect((await deps.store.get(GOVERNANCE, stored.key))!.request.status).toBe("pending");
  });

  it("an ineligible draft is refused by evaluateApproval (a terminal table that does not cover the symbol's pins)", async () => {
    const deps = fixtureDeps();
    const stored = await submit(deps, ne555Spec({ terminals: ne555Spec().terminals.slice(0, 7) }));
    const error = await refusal(approve(deps, stored));
    expect([error.code, error.status]).toEqual(["ATOMIC_PUBLICATION_APPROVAL_BLOCKED", 409]);
    expect(error.detail!.join(" ")).toMatch(/mapping certificate/);
  });

  it("a rejection needs no resolutions, names its reason, and is final", async () => {
    const deps = fixtureDeps();
    const stored = await submit(deps);
    const rejected = await resolveAtomicPublicationRequest(deps, { scope: GOVERNANCE, actor: reviewer, requestId: stored.request.requestId, decision: "reject", reason: "wrong package" });
    expect(rejected.request).toMatchObject({ status: "rejected", decision: { decision: "reject", reason: "wrong package" } });
    expect((await refusal(approve(deps, rejected))).code).toBe("ATOMIC_PUBLICATION_STATE_CONFLICT");
  });
});

describe("[B19-E E4 d] roles, two people, humans only, retirement", () => {
  it("an editor cannot resolve; a reviewer cannot publish", async () => {
    const deps = fixtureDeps();
    const stored = await submit(deps);
    expect(await refusal(approve(deps, stored, editor))).toMatchObject({ code: "ATOMIC_PUBLICATION_FORBIDDEN", status: 403 });
    const approved = await approve(deps, stored);
    expect(await refusal(publishAtomicPublicationRequest(deps, { scope: GOVERNANCE, actor: reviewer, requestId: approved.request.requestId, reason: "publish" }))).toMatchObject({ code: "ATOMIC_PUBLICATION_FORBIDDEN", status: 403 });
    expect(deps.published).toHaveLength(0);
  });

  it("the approver cannot publish their own approval — an administrator included; another administrator can", async () => {
    const deps = fixtureDeps();
    const approved = await approve(deps, await submit(deps), admin);
    deps.setNow(LATER(10));
    expect(await refusal(publishAtomicPublicationRequest(deps, { scope: GOVERNANCE, actor: admin, requestId: approved.request.requestId, reason: "publish" }))).toMatchObject({ code: "ATOMIC_PUBLICATION_SAME_PERSON", status: 403 });
    expect(deps.published).toHaveLength(0);
    const published = await publishAtomicPublicationRequest(deps, { scope: GOVERNANCE, actor: admin2, requestId: approved.request.requestId, reason: "publish" });
    expect(published.request.status).toBe("published");
  });

  it("publishing before approval is refused", async () => {
    const deps = fixtureDeps();
    const stored = await submit(deps);
    expect(await refusal(publishAtomicPublicationRequest(deps, { scope: GOVERNANCE, actor: admin, requestId: stored.request.requestId, reason: "publish" }))).toMatchObject({ code: "ATOMIC_PUBLICATION_NOT_APPROVED", status: 409 });
    expect(deps.published).toHaveLength(0);
  });

  const AUTOMATED = [
    ["an ai actorKind", { ...editor, actorKind: "ai" as const }],
    ["an llm: id", human("llm:claude", "project_admin")],
    ["an ocr: id", human(" OCR:scanner", "reviewer")],
    ["an agent: id", human("agent:catalog-bot", "project_admin")],
  ] as const;

  it.each(AUTOMATED)("%s is refused for every operation", async (_label, automated) => {
    const deps = fixtureDeps();
    const code = "ATOMIC_PUBLICATION_HUMAN_REQUIRED";
    expect(await refusal(submitAtomicPublicationRequest(deps, { scope: GOVERNANCE, actor: automated, membershipRevision: null, spec: ne555Spec(), links: [], reason: "x" }))).toMatchObject({ code, status: 403 });
    const stored = await submit(deps);
    expect(await refusal(approve(deps, stored, automated))).toMatchObject({ code, status: 403 });
    expect(await refusal(withdrawAtomicPublicationRequest(deps, { scope: GOVERNANCE, actor: automated, requestId: stored.request.requestId, reason: "x" }))).toMatchObject({ code, status: 403 });
    const approved = await approve(deps, stored);
    expect(await refusal(publishAtomicPublicationRequest(deps, { scope: GOVERNANCE, actor: automated, requestId: approved.request.requestId, reason: "x" }))).toMatchObject({ code, status: 403 });
    expect(deps.published).toHaveLength(0);
  });

  it("every operation is refused outside the governance project, and when no governance project is configured", async () => {
    for (const [label, deps, scope] of [
      ["another project", fixtureDeps(), { ...GOVERNANCE, projectId: "some-design-project" }],
      ["no governance project", fixtureDeps({ governanceProjectId: null }), GOVERNANCE],
      ["another branch", fixtureDeps(), { ...GOVERNANCE, branchId: "feature" }],
    ] as const) {
      const d = deps as AtomicPublicationDeps;
      expect(await refusal(submitAtomicPublicationRequest(d, { scope, actor: editor, membershipRevision: null, spec: ne555Spec(), links: [], reason: "x" })), label).toMatchObject({ status: 403 });
      expect(await refusal(resolveAtomicPublicationRequest(d, { scope, actor: reviewer, requestId: "r", decision: "reject", reason: "x" })), label).toMatchObject({ status: 403 });
      expect(await refusal(publishAtomicPublicationRequest(d, { scope, actor: admin, requestId: "r", reason: "x" })), label).toMatchObject({ status: 403 });
      expect(await refusal(withdrawAtomicPublicationRequest(d, { scope, actor: editor, requestId: "r", reason: "x" })), label).toMatchObject({ status: 403 });
    }
  });

  it("revoking the requester's membership retires the pending request: the list shows it and a resolution is a 409", async () => {
    const deps = fixtureDeps();
    const stored = await submit(deps);
    const current = await deps.memberships.loadActiveMembership({ tenantId: GOVERNANCE.tenantId, projectId: GOVERNANCE.projectId, userId: USERS.editor });
    deps.memberships.set({ ...current!, state: "revoked", version: 2 });
    const listed = await listAtomicPublicationRequests(deps, { scope: GOVERNANCE });
    expect(listed.requests.find((item) => item.request.requestId === stored.request.requestId)!.effectiveStatus).toBe("retired");
    const error = await refusal(approve(deps, stored));
    expect([error.code, error.status]).toEqual(["ATOMIC_PUBLICATION_RETIRED", 409]);
    const after = await deps.store.get(GOVERNANCE, stored.key);
    expect(after!.request).toMatchObject({ status: "retired", retirement: { reasonCode: "REQUESTER_MEMBERSHIP_REVOKED" } });
  });

  it("a non-requester cannot withdraw (an administrator included); the requester can", async () => {
    const deps = fixtureDeps();
    const stored = await submit(deps);
    for (const other of [human(USERS.editor2, "pcb_editor"), admin]) {
      expect(await refusal(withdrawAtomicPublicationRequest(deps, { scope: GOVERNANCE, actor: other, requestId: stored.request.requestId, reason: "not mine" }))).toMatchObject({ code: "ATOMIC_PUBLICATION_FORBIDDEN", status: 403 });
    }
    const withdrawn = await withdrawAtomicPublicationRequest(deps, { scope: GOVERNANCE, actor: editor, requestId: stored.request.requestId, reason: "wrong part" });
    expect(withdrawn.request).toMatchObject({ status: "withdrawn", withdrawal: { withdrawnBy: { actorId: USERS.editor }, reason: "wrong part" } });
  });

  it("a new request after a publication is a new request, even in the same millisecond (found by the durable suite: the submit replayed the first request)", async () => {
    const deps = fixtureDeps();
    const approved = await approve(deps, await submit(deps));
    deps.setNow(LATER(10));
    const published = await publishAtomicPublicationRequest(deps, { scope: GOVERNANCE, actor: admin, requestId: approved.request.requestId, reason: "publish" });
    const again = await submit(deps);
    expect(again.request.status).toBe("pending");
    expect(again.request.requestId).not.toBe(published.request.requestId);
    expect((await deps.store.get(GOVERNANCE, again.key))!.request.requestId).toBe(again.request.requestId);
  });

  it("a failed publication that rolled back clears its marker: the request stays approved and is withdrawable at once", async () => {
    const rolledBack = fixtureDeps({ publish: async () => { throw new Error("B19E_E4_TRANSACTION_ROLLED_BACK"); } });
    const approvedA = await approve(rolledBack, await submit(rolledBack));
    rolledBack.setNow(LATER(10));
    expect(await refusal(publishAtomicPublicationRequest(rolledBack, { scope: GOVERNANCE, actor: admin, requestId: approvedA.request.requestId, reason: "publish" }))).toMatchObject({ code: "ATOMIC_PUBLICATION_PUBLISH_REFUSED", status: 409 });
    const afterFailure = await rolledBack.store.get(GOVERNANCE, approvedA.key);
    // [B19-E E4 review] the attempt stays in the append-only history; the head holds no marker that would block for the lease
    expect(afterFailure!.request.status).toBe("approved");
    expect(afterFailure!.request.publishing).toBeUndefined();
    expect((await withdrawAtomicPublicationRequest(rolledBack, { scope: GOVERNANCE, actor: editor, requestId: approvedA.request.requestId, reason: "not now" })).request.status).toBe("withdrawn");
  });

  it("a publication whose transaction committed but whose answer was lost is recorded at once, never refused as unwritten", async () => {
    const deps = fixtureDeps();
    const realPublish = deps.publish;
    deps.publish = async (input) => { await realPublish(input); throw new Error("B19E_E4_ANSWER_LOST"); };
    const approved = await approve(deps, await submit(deps));
    deps.setNow(LATER(10));
    const recorded = await publishAtomicPublicationRequest(deps, { scope: GOVERNANCE, actor: admin, requestId: approved.request.requestId, reason: "publish" });
    expect(recorded.request).toMatchObject({ status: "published", publication: { revisionId: deps.published[0]!.snapshot.atomicRevision.id, publishedBy: { actorId: USERS.admin } } });
    expect((await deps.store.get(GOVERNANCE, approved.key))!.request.status).toBe("published");
    expect(deps.published).toHaveLength(1);
  });

  it("a publication that committed before its final write was lost is recorded by a retry, never re-published; a withdrawal records it too", async () => {
    // the transaction committed, then the final aggregate write was lost
    const lostWrite = () => {
      const deps = fixtureDeps();
      const put = deps.store.put.bind(deps.store);
      let lost = false;
      deps.store.put = async (request, input) => {
        if (request.status === "published" && !lost) { lost = true; throw new Error("B19E_E4_FINAL_WRITE_LOST"); }
        return put(request, input);
      };
      return deps;
    };
    const retried = lostWrite();
    const approvedB = await approve(retried, await submit(retried));
    retried.setNow(LATER(10));
    await expect(publishAtomicPublicationRequest(retried, { scope: GOVERNANCE, actor: admin, requestId: approvedB.request.requestId, reason: "publish" })).rejects.toThrow("B19E_E4_FINAL_WRITE_LOST");
    expect(retried.published).toHaveLength(1);
    const recovered = await publishAtomicPublicationRequest(retried, { scope: GOVERNANCE, actor: admin2, requestId: approvedB.request.requestId, reason: "again" });
    expect(recovered.request).toMatchObject({ status: "published", publication: { revisionId: retried.published[0]!.snapshot.atomicRevision.id, publishedBy: { actorId: USERS.admin } } });
    expect(retried.published).toHaveLength(1);

    const withdrawn = lostWrite();
    const approvedC = await approve(withdrawn, await submit(withdrawn));
    withdrawn.setNow(LATER(10));
    await expect(publishAtomicPublicationRequest(withdrawn, { scope: GOVERNANCE, actor: admin, requestId: approvedC.request.requestId, reason: "publish" })).rejects.toThrow("B19E_E4_FINAL_WRITE_LOST");
    expect(await refusal(withdrawAtomicPublicationRequest(withdrawn, { scope: GOVERNANCE, actor: editor, requestId: approvedC.request.requestId, reason: "too late" }))).toMatchObject({ code: "ATOMIC_PUBLICATION_STATE_CONFLICT", detail: ["published"] });
    expect((await withdrawn.store.get(GOVERNANCE, approvedC.key))!.request).toMatchObject({ status: "published", publication: { revisionId: withdrawn.published[0]!.snapshot.atomicRevision.id } });
    expect(withdrawn.published).toHaveLength(1);
  });

  it("a viewer cannot request, and a repeated request while pending is idempotent", async () => {
    const deps = fixtureDeps();
    expect(await refusal(submitAtomicPublicationRequest(deps, { scope: GOVERNANCE, actor: human(USERS.viewer, "viewer"), membershipRevision: null, spec: ne555Spec(), links: [], reason: "x" }))).toMatchObject({ code: "ATOMIC_PUBLICATION_FORBIDDEN", status: 403 });
    const first = await submit(deps);
    const again = await submitAtomicPublicationRequest(deps, { scope: GOVERNANCE, actor: editor, membershipRevision: null, spec: ne555Spec(), links: [], reason: "again" });
    expect(again.created).toBe(false);
    expect(again.stored.request.requestId).toBe(first.request.requestId);
  });
});

// ── [B19-E E4 review] the confirmed review findings, each reproduced on the unfixed code first ─────────────────────────

async function submitWith(deps: FixtureDeps, input: { spec?: AtomicPublicationSpec; links?: unknown; actor?: EngineeringActor; idempotencyKey?: string } = {}) {
  deps.setNow(T_SUBMIT);
  return submitAtomicPublicationRequest(deps, { scope: GOVERNANCE, actor: input.actor ?? editor, membershipRevision: null, spec: input.spec ?? ne555Spec(), links: input.links ?? [], reason: "publish the exact timer", ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}) });
}

const publishAs = (deps: FixtureDeps, actor: EngineeringActor, requestId: string, extra: { idempotencyKey?: string } = {}) =>
  publishAtomicPublicationRequest(deps, { scope: GOVERNANCE, actor, requestId, reason: "publish the reviewed revision", ...extra });

/** A gate a fixture `publish` waits on, so a test can act while the publication transaction is in flight. */
function publicationGate() {
  let release!: () => void;
  let enter!: () => void;
  const released = new Promise<void>((resolve) => { release = resolve; });
  const entered = new Promise<void>((resolve) => { enter = resolve; });
  return { release, enter, released, entered };
}

/** Fails (instead of hanging) when an attempt is still waiting after `ms`. */
function within<T>(attempt: Promise<T>, ms = 3_000): Promise<T> {
  return Promise.race([attempt, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`still waiting after ${ms} ms`)), ms))]);
}

describe("[B19-E E4 review] security-unreviewed-links: a link must name the exact part, and both people see it", () => {
  it("a link to a catalog part with another MPN is refused at submit (409 LINK_MPN_MISMATCH), whatever its value key", async () => {
    for (const valueKey of ["", "10k"]) {
      const deps = fixtureDeps();
      const error = await refusal(submitWith(deps, { links: [{ partId: PARTS.lm7805, valueKey }] }));
      expect([error.code, error.status, error.detail], valueKey).toEqual(["ATOMIC_PUBLICATION_LINK_REFUSED", 409, ["LINK_MPN_MISMATCH"]]);
      expect(await deps.store.list(GOVERNANCE)).toEqual([]);
    }
  });

  it("a link to a part with another KiCad symbol (a generic part with no MPN) or to no catalog part is refused", async () => {
    const deps = fixtureDeps();
    expect((await refusal(submitWith(deps, { links: [{ partId: PARTS.resistor, valueKey: "10k" }] }))).detail).toEqual(["LINK_SYMBOL_MISMATCH"]);
    expect((await refusal(submitWith(deps, { links: [{ partId: PARTS.missing, valueKey: "" }] }))).detail).toEqual(["LINK_PART_NOT_FOUND"]);
    expect(await deps.store.list(GOVERNANCE)).toEqual([]);
  });

  it("the links, with each part's MPN and symbol, are in the evidence and in the digest the approver pins", async () => {
    const withLink = (await submitWith(fixtureDeps(), { links: [{ partId: PARTS.ne555, valueKey: "" }] })).stored.request;
    const without = (await submitWith(fixtureDeps())).stored.request;
    expect(withLink.evidence.links).toEqual([{ partId: PARTS.ne555, valueKey: "", partMpn: "NE555DR", partSymbol: "Timer:NE555D" }]);
    expect(without.evidence.links).toEqual([]);
    expect(withLink.evidence.reviewEvidenceDigest).not.toBe(without.evidence.reviewEvidenceDigest);
    // the exact part's MPN in another case is the same exact part (OD-34)
    const caseOnly = fixtureDeps();
    caseOnly.linkTargets.get(PARTS.ne555)!.mpn = "ne555dr";
    expect((await submitWith(caseOnly, { links: [{ partId: PARTS.ne555, valueKey: "" }] })).created).toBe(true);
  });

  it("a linked part that changed after the request voids the review (409 EVIDENCE_CHANGED)", async () => {
    const deps = fixtureDeps();
    const { stored } = await submitWith(deps, { links: [{ partId: PARTS.ne555, valueKey: "" }] });
    deps.linkTargets.get(PARTS.ne555)!.mpn = "LM7805";
    const error = await refusal(approve(deps, stored));
    expect([error.code, error.status]).toEqual(["ATOMIC_PUBLICATION_EVIDENCE_CHANGED", 409]);
    expect((await deps.store.get(GOVERNANCE, stored.key))!.request.status).toBe("pending");
  });
});

describe("[B19-E E4 review] correctness-link-to-already-linked-part-unpublishable", () => {
  it("a link whose part and value already have a link is refused at submit, at approval and at publication, with a closed detail", async () => {
    const deps = fixtureDeps();
    const target = deps.linkTargets.get(PARTS.ne555)!;
    target.linkedValueKeys = [""];
    const atSubmit = await refusal(submitWith(deps, { links: [{ partId: PARTS.ne555, valueKey: "" }] }));
    expect([atSubmit.code, atSubmit.status, atSubmit.detail]).toEqual(["ATOMIC_PUBLICATION_LINK_REFUSED", 409, ["LINK_ALREADY_LINKED"]]);

    target.linkedValueKeys = [];
    const { stored } = await submitWith(deps, { links: [{ partId: PARTS.ne555, valueKey: "" }] });
    target.linkedValueKeys = [""];
    const atApproval = await refusal(approve(deps, stored));
    expect([atApproval.code, atApproval.detail]).toEqual(["ATOMIC_PUBLICATION_LINK_REFUSED", ["LINK_ALREADY_LINKED"]]);

    target.linkedValueKeys = [];
    const approved = await approve(deps, stored);
    target.linkedValueKeys = [""];
    deps.setNow(LATER(10));
    const atPublication = await refusal(publishAs(deps, admin, approved.request.requestId));
    expect([atPublication.code, atPublication.detail]).toEqual(["ATOMIC_PUBLICATION_LINK_REFUSED", ["LINK_ALREADY_LINKED"]]);
    expect(deps.published).toHaveLength(0);
  });

  it("the transaction's own link-repoint refusal reaches the person as a closed detail, and the request stays approved with no marker", async () => {
    const deps = fixtureDeps({ publish: async () => { throw new Error(`Atomic part link for value "" already points at another revision; a publication never repoints a link`); } });
    const approved = await approve(deps, (await submitWith(deps, { links: [{ partId: PARTS.ne555, valueKey: "" }] })).stored);
    deps.setNow(LATER(10));
    const error = await refusal(publishAs(deps, admin, approved.request.requestId));
    expect([error.code, error.detail]).toEqual(["ATOMIC_PUBLICATION_PUBLISH_REFUSED", ["LINK_ALREADY_LINKED"]]);
    expect((await deps.store.get(GOVERNANCE, approved.key))!.request).toMatchObject({ status: "approved" });
  });
});

describe("[B19-E E4 review] security-idempotency-key-poisoning, correctness-client-idempotency-key-false-success", () => {
  it("a caller's idempotency key can never be a server-derived key: planted keys do not turn approval, publication or withdrawal into no-ops", async () => {
    const deps = fixtureDeps();
    const target = await submit(deps);
    const plant = (exactMpn: string, idempotencyKey: string) => submitWith(deps, { spec: ne555Spec({ exactMpn }), idempotencyKey });

    await plant("NE555P", `atomic-publication-resolve:${target.request.requestId}:${target.revision}`);
    const approved = await approve(deps, target);
    expect((await deps.store.get(GOVERNANCE, target.key))!.request.status).toBe(approved.request.status);
    expect(approved.request.status).toBe("approved");

    await plant("NE555N", `atomic-publication-publishing:${target.request.requestId}:${approved.revision}`);
    await plant("NE555S", `atomic-publication-published:${target.request.requestId}:${approved.revision + 1}`);
    deps.setNow(LATER(10));
    const published = await publishAs(deps, admin, target.request.requestId);
    expect(published.request.status).toBe("published");
    expect((await deps.store.get(GOVERNANCE, target.key))!.request.status).toBe("published");
    expect((await publishAs(deps, admin2, target.request.requestId)).request.status).toBe("published");
    expect(deps.published).toHaveLength(1);

    const other = (await submitWith(deps, { spec: ne555Spec({ exactMpn: "NE555DRG4" }) })).stored;
    await plant("NE556", `atomic-publication-withdraw:${other.request.requestId}:${other.revision}`);
    const withdrawn = await withdrawAtomicPublicationRequest(deps, { scope: GOVERNANCE, actor: editor, requestId: other.request.requestId, reason: "wrong part" });
    expect(withdrawn.request.status).toBe("withdrawn");
    expect((await deps.store.get(GOVERNANCE, other.key))!.request.status).toBe("withdrawn");
  });

  it("a client key reused for another request or operation never answers success for a write that was not made", async () => {
    const deps = fixtureDeps();
    const a = (await submitWith(deps, { spec: ne555Spec({ exactMpn: "NE555P" }), idempotencyKey: "k2" })).stored;
    const reused = await submitWith(deps, { spec: ne555Spec({ exactMpn: "NE556" }), idempotencyKey: "k2" });
    expect(reused.created).toBe(true);
    expect((await deps.store.get(GOVERNANCE, reused.stored.key))!.request.requestId).toBe(reused.stored.request.requestId);
    const b = await submit(deps);
    deps.setNow(LATER(5));
    expect((await resolveAtomicPublicationRequest(deps, { scope: GOVERNANCE, actor: reviewer, requestId: a.request.requestId, decision: "reject", reason: "wrong", idempotencyKey: "k1" })).request.status).toBe("rejected");
    const withdrawn = await withdrawAtomicPublicationRequest(deps, { scope: GOVERNANCE, actor: editor, requestId: b.request.requestId, reason: "not now", idempotencyKey: "k1" });
    expect(withdrawn.request.status).toBe("withdrawn");
    expect((await deps.store.get(GOVERNANCE, b.key))!.request.status).toBe("withdrawn");
  });

  it("the store never answers a replayed key with the unsaved request: another aggregate's or another record's replay is a concurrent change", async () => {
    const deps = fixtureDeps();
    const a = (await submitWith(deps, { spec: ne555Spec({ exactMpn: "NE555P" }) })).stored;
    const b = await submit(deps);
    const at = LATER(1).toISOString();
    const first = { ...a.request, status: "withdrawn" as const, requestDigest: `sha256:${"a".repeat(64)}` };
    expect((await deps.store.put(first, { expectedRevision: a.revision, idempotencyKey: "store-key", committedAt: at })).revision).toBe(a.revision + 1);
    // the identical commit replays
    expect((await deps.store.put(first, { expectedRevision: a.revision, idempotencyKey: "store-key", committedAt: at })).request.requestDigest).toBe(first.requestDigest);
    expect((await refusal(deps.store.put({ ...b.request, status: "withdrawn", requestDigest: `sha256:${"b".repeat(64)}` }, { expectedRevision: b.revision, idempotencyKey: "store-key", committedAt: at }))).code).toBe("ATOMIC_PUBLICATION_CONCURRENT_CHANGE");
    expect((await refusal(deps.store.put({ ...first, requestDigest: `sha256:${"c".repeat(64)}` }, { expectedRevision: a.revision, idempotencyKey: "store-key", committedAt: at }))).code).toBe("ATOMIC_PUBLICATION_CONCURRENT_CHANGE");
    expect((await deps.store.get(GOVERNANCE, b.key))!.request.status).toBe("pending");
  });
});

describe("[B19-E E4 review] security-publishing-marker-race, correctness-withdraw-during-inflight-publish, correctness-concurrent-publish-shares-marker-key", () => {
  async function inFlight(deps: FixtureDeps) {
    const approved = await approve(deps, await submit(deps));
    const gate = publicationGate();
    const realPublish = deps.publish;
    deps.publish = async (input) => { gate.enter(); await gate.released; return realPublish(input); };
    deps.setNow(LATER(10));
    const publishing = publishAs(deps, admin, approved.request.requestId);
    const outcome = publishing.then((stored) => stored, (error: unknown) => error);
    await within(gate.entered);
    return { approved, gate, outcome };
  }

  it("a withdrawal while the publication transaction is in flight is refused (409 PUBLISH_IN_PROGRESS); the publication then records", async () => {
    const deps = fixtureDeps();
    const { approved, gate, outcome } = await inFlight(deps);
    try {
      deps.setNow(LATER(10.5));
      const error = await refusal(within(withdrawAtomicPublicationRequest(deps, { scope: GOVERNANCE, actor: editor, requestId: approved.request.requestId, reason: "stop" })));
      expect([error.code, error.status]).toEqual(["ATOMIC_PUBLICATION_PUBLISH_IN_PROGRESS", 409]);
    } finally {
      gate.release();
    }
    const done = await within(outcome);
    expect((done as StoredAtomicPublication).request?.status).toBe("published");
    expect((await deps.store.get(GOVERNANCE, approved.key))!.request).toMatchObject({ status: "published", publication: { revisionId: deps.published[0]!.snapshot.atomicRevision.id } });
  });

  it("a second publisher while the transaction is in flight is refused; one approval publishes once", async () => {
    const deps = fixtureDeps();
    const { approved, gate, outcome } = await inFlight(deps);
    try {
      const error = await refusal(within(publishAs(deps, admin2, approved.request.requestId)));
      expect([error.code, error.status]).toEqual(["ATOMIC_PUBLICATION_PUBLISH_IN_PROGRESS", 409]);
    } finally {
      gate.release();
    }
    expect(((await within(outcome)) as StoredAtomicPublication).request?.status).toBe("published");
    expect(deps.published).toHaveLength(1);
  });

  it("two publishers who read the same approved request at once: exactly one publishes, the other is a concurrent change", async () => {
    const deps = fixtureDeps();
    const approved = await approve(deps, await submit(deps));
    const list = deps.store.list.bind(deps.store);
    const waiting: Array<() => void> = [];
    let armed = true;
    deps.store.list = async (scope) => {
      const heads = await list(scope);
      if (armed) await new Promise<void>((resolve) => { waiting.push(resolve); if (waiting.length === 2) { armed = false; waiting.forEach((go) => go()); } });
      return heads;
    };
    // [B19-E E4 review follow-up] tests-4: the interleaving is pinned on the store. Both publishers read the same head (above), and
    // both marker writes — each naming its own attempt's revision — are held until both are made, then committed one after the
    // other. The losing write must reach the aggregate revision check: under the old marker key (no attempt revision id) both
    // writes shared one idempotency key, so the second was answered from the first write's replay and never met CAS.
    type MarkerWrite = { idempotencyKey: string; revisionId: string; outcome: "held" | "committed" | "replayed" | "revision_conflict" | "failed" };
    const markerWrites: MarkerWrite[] = [];
    const held: Array<{ release: () => void; settled: Promise<unknown> }> = [];
    let bothHeld!: () => void;
    const bothMarkersHeld = new Promise<void>((resolve) => { bothHeld = resolve; });
    const commit = deps.workflow.commit.bind(deps.workflow);
    deps.workflow.commit = (async (request: Parameters<typeof commit>[0]) => {
      const payload = request.operations[0]?.payload as AtomicPublicationRequest | undefined;
      if (request.operations.length !== 1 || payload?.status !== "approved" || !payload.publishing) return commit(request);
      const write: MarkerWrite = { idempotencyKey: request.idempotencyKey, revisionId: payload.publishing.revisionId, outcome: "held" };
      markerWrites.push(write);
      let release!: () => void;
      const settled = new Promise<void>((resolve) => { release = resolve; }).then(() => commit(request));
      held.push({ release, settled });
      if (held.length === 2) bothHeld();
      try {
        const result = await settled;
        write.outcome = result.idempotent ? "replayed" : "committed";
        return result;
      } catch (error) {
        write.outcome = error instanceof Error && error.message === "DW_OPTIMISTIC_REVISION_CONFLICT" ? "revision_conflict" : "failed";
        throw error;
      }
    }) as typeof deps.workflow.commit;
    deps.setNow(LATER(10));
    const attempts = Promise.allSettled([publishAs(deps, admin, approved.request.requestId), publishAs(deps, admin2, approved.request.requestId)]);
    await within(bothMarkersHeld);
    held[0]!.release();
    await held[0]!.settled.catch(() => undefined);
    held[1]!.release();
    const results = await within(attempts);
    expect(markerWrites.map((write) => write.revisionId).filter((id, index, all) => all.indexOf(id) === index), "each publisher's marker names its own revision").toHaveLength(2);
    expect(markerWrites[0]!.idempotencyKey, "each attempt's marker write has its own idempotency key").not.toBe(markerWrites[1]!.idempotencyKey);
    expect(markerWrites.map((write) => write.outcome), "the losing marker write is refused by the revision check, never replayed").toEqual(["committed", "revision_conflict"]);
    expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    const refused = results.find((result): result is PromiseRejectedResult => result.status === "rejected")!;
    expect((refused.reason as AtomicPublicationError).code).toBe("ATOMIC_PUBLICATION_CONCURRENT_CHANGE");
    expect(deps.published).toHaveLength(1);
    const winner = results.find((result): result is PromiseFulfilledResult<StoredAtomicPublication> => result.status === "fulfilled")!.value;
    expect([winner.request.publication?.revisionId, deps.published[0]!.snapshot.atomicRevision.id]).toEqual([markerWrites[0]!.revisionId, markerWrites[0]!.revisionId]);
  });

  it("a marker whose revision never committed blocks withdrawal and publication for the lease only", async () => {
    expect(PUBLISH_MARKER_LEASE_MS).toBe(120_000);
    const deps = fixtureDeps();
    const approved = await approve(deps, await submit(deps));
    // a publisher's process stopped after writing its marker, before its transaction ran
    const markedAt = LATER(10);
    await deps.store.put({ ...approved.request, publishing: { by: admin, at: markedAt.toISOString(), revisionId: "atomic_revision_never_committed" }, requestDigest: `sha256:${"d".repeat(64)}` }, { expectedRevision: approved.revision, idempotencyKey: "crashed-marker", committedAt: markedAt.toISOString() });
    deps.setNow(LATER(11));
    expect((await refusal(withdrawAtomicPublicationRequest(deps, { scope: GOVERNANCE, actor: editor, requestId: approved.request.requestId, reason: "stop" }))).code).toBe("ATOMIC_PUBLICATION_PUBLISH_IN_PROGRESS");
    expect((await refusal(publishAs(deps, admin2, approved.request.requestId))).code).toBe("ATOMIC_PUBLICATION_PUBLISH_IN_PROGRESS");
    deps.setNow(new Date(markedAt.getTime() + PUBLISH_MARKER_LEASE_MS + 1_000));
    expect((await publishAs(deps, admin2, approved.request.requestId)).request.status).toBe("published");
    expect(deps.published).toHaveLength(1);
  });

  it("when a change slipped past the lease before the final write, the committed revision is still recorded", async () => {
    const deps = fixtureDeps();
    const approved = await approve(deps, await submit(deps));
    const realPublish = deps.publish;
    deps.publish = async (input) => {
      const result = await realPublish(input);
      const head = (await deps.store.get(GOVERNANCE, approved.key))!;
      await deps.store.put({ ...head.request, status: "withdrawn", withdrawal: { withdrawnBy: editor, withdrawnAt: LATER(13).toISOString(), reason: "slipped past the lease" }, requestDigest: `sha256:${"e".repeat(64)}` }, { expectedRevision: head.revision, idempotencyKey: "slipped-withdrawal", committedAt: LATER(13).toISOString() });
      return result;
    };
    deps.setNow(LATER(10));
    const recorded = await publishAs(deps, admin, approved.request.requestId);
    expect(recorded.request).toMatchObject({ status: "published", publication: { revisionId: deps.published[0]!.snapshot.atomicRevision.id } });
    expect((await deps.store.get(GOVERNANCE, approved.key))!.request.status).toBe("published");
  });
});

describe("[B19-E E4 review] security-approved-request-authority-not-rechecked", () => {
  async function approvedWithRecordedMembership(deps: FixtureDeps) {
    const stored = await submit(deps);
    const record = await deps.memberships.loadActiveMembership({ tenantId: GOVERNANCE.tenantId, projectId: GOVERNANCE.projectId, userId: USERS.reviewer });
    return { approved: await approve(deps, stored, reviewer, { membershipRevision: membershipRevisionOf(record!) }), record: record! };
  }

  it.each([
    ["revoked", (record: NonNullable<Awaited<ReturnType<FixtureDeps["memberships"]["loadActiveMembership"]>>>) => ({ ...record, state: "revoked" as const, version: 2 }), "APPROVER_MEMBERSHIP_REVOKED"],
    ["downgraded to viewer", (record: NonNullable<Awaited<ReturnType<FixtureDeps["memberships"]["loadActiveMembership"]>>>) => ({ ...record, role: "viewer" as const, version: 2 }), "APPROVER_ROLE_CHANGED"],
    ["changed since the decision (same role, new version)", (record: NonNullable<Awaited<ReturnType<FixtureDeps["memberships"]["loadActiveMembership"]>>>) => ({ ...record, version: 2 }), "APPROVER_ROLE_CHANGED"],
  ] as const)("an approval whose approver's membership was %s retires the request at publication (409); nothing is published", async (_label, change, reasonCode) => {
    const deps = fixtureDeps();
    const { approved, record } = await approvedWithRecordedMembership(deps);
    deps.memberships.set(change(record));
    deps.setNow(LATER(10));
    const listed = await listAtomicPublicationRequests(deps, { scope: GOVERNANCE });
    expect(listed.requests.find((item) => item.request.requestId === approved.request.requestId)!.effectiveStatus).toBe("retired");
    const error = await refusal(publishAs(deps, admin, approved.request.requestId));
    expect([error.code, error.status, error.detail]).toEqual(["ATOMIC_PUBLICATION_RETIRED", 409, [reasonCode]]);
    expect(deps.published).toHaveLength(0);
    expect((await deps.store.get(GOVERNANCE, approved.key))!.request).toMatchObject({ status: "retired", retirement: { reasonCode } });
  });

  it("an approved request whose requester lost membership is retired at publication (409); nothing is published", async () => {
    const deps = fixtureDeps();
    const { approved } = await approvedWithRecordedMembership(deps);
    const requester = await deps.memberships.loadActiveMembership({ tenantId: GOVERNANCE.tenantId, projectId: GOVERNANCE.projectId, userId: USERS.editor });
    deps.memberships.set({ ...requester!, state: "revoked", version: 2 });
    deps.setNow(LATER(10));
    const error = await refusal(publishAs(deps, admin, approved.request.requestId));
    expect([error.code, error.detail]).toEqual(["ATOMIC_PUBLICATION_RETIRED", ["REQUESTER_MEMBERSHIP_REVOKED"]]);
    expect(deps.published).toHaveLength(0);
  });
});

describe("[B19-E E4 review] correctness-submit-silently-returns-old-request", () => {
  it("a different spec or links while a request for the exact part is open is a 409 naming the open request; the same request is idempotent", async () => {
    const deps = fixtureDeps();
    const first = await submit(deps, ne555Spec({ footprint: null }));
    const corrected = await refusal(submitWith(deps, { spec: ne555Spec() }));
    expect([corrected.code, corrected.status, corrected.detail]).toEqual(["ATOMIC_PUBLICATION_REQUEST_OPEN", 409, [first.request.requestId]]);
    const linked = await refusal(submitWith(deps, { spec: ne555Spec({ footprint: null }), links: [{ partId: PARTS.ne555, valueKey: "" }] }));
    expect(linked.code).toBe("ATOMIC_PUBLICATION_REQUEST_OPEN");
    const same = await submitWith(deps, { spec: ne555Spec({ footprint: null }) });
    expect([same.created, same.stored.request.requestId]).toEqual([false, first.request.requestId]);
  });
});

describe("[B19-E E4 review] correctness-pin-map-fact-truncated", () => {
  it("a large terminal table is kept whole in the evidence, and a pin_mapping resolution matches the draft's table", async () => {
    const terminals = Array.from({ length: 176 }, (_, index) => ({ number: String(index + 1), function: `PE${index}_ALTERNATE_FN`, pads: [String(index + 1)] }));
    const table = terminalTableText(terminals);
    expect(table.length).toBeGreaterThan(2_000);
    const deps = fixtureDeps();
    deps.candidates = [candidateFromExtraction({ exactMpn: "NE555DR", sourceId: "src_mfr_cad", sourceClass: "manufacturer_cad", method: "kicad_parser", parserVersion: "p/1", documentHash: "7".repeat(64), facts: [{ property: "pin_mapping", facet: "terminal", value: "1=VCC@1", locator: "mcu.kicad_sym" }] })];
    const stored = await submit(deps, ne555Spec({ terminals }));
    const fact = stored.request.evidence.facts.find((item) => item.property === "pin_mapping" && item.sourceClass === "organization_authored")!;
    expect(fact.value).toBe(table);
    // the resolution picks the draft's own table and is accepted; the draft is then refused by evaluateApproval (the fixture symbol has 8 pins)
    expect((await refusal(approve(deps, stored))).code).toBe("ATOMIC_PUBLICATION_APPROVAL_BLOCKED");
  });
});

describe("[B19-E E4 review] gates-1: the governance scope is a tenant and a project", () => {
  it("every operation is refused for another tenant's project with the governance project's id, and when no governance tenant is configured", async () => {
    for (const [label, deps, scope, code] of [
      ["another tenant", fixtureDeps(), { ...GOVERNANCE, tenantId: "another-tenant" }, "ATOMIC_PUBLICATION_GOVERNANCE_FORBIDDEN"],
      ["no governance tenant", fixtureDeps({ governanceTenantId: null } as Partial<AtomicPublicationDeps>), GOVERNANCE, "ATOMIC_PUBLICATION_GOVERNANCE_UNCONFIGURED"],
    ] as const) {
      const d = deps as AtomicPublicationDeps;
      expect(await refusal(submitAtomicPublicationRequest(d, { scope, actor: editor, membershipRevision: null, spec: ne555Spec(), links: [], reason: "x" })), label).toMatchObject({ code, status: 403 });
      expect(await refusal(listAtomicPublicationRequests(d, { scope })), label).toMatchObject({ code, status: 403 });
      expect(await refusal(resolveAtomicPublicationRequest(d, { scope, actor: reviewer, requestId: "r", decision: "reject", reason: "x" })), label).toMatchObject({ code, status: 403 });
      expect(await refusal(publishAtomicPublicationRequest(d, { scope, actor: admin, requestId: "r", reason: "x" })), label).toMatchObject({ code, status: 403 });
      expect(await refusal(withdrawAtomicPublicationRequest(d, { scope, actor: editor, requestId: "r", reason: "x" })), label).toMatchObject({ code, status: 403 });
    }
  });
});

describe("[B19-E E4 review] tests-c: each resolution guard refuses on its own", () => {
  const DRAFT_TABLE = terminalTableText(NE555_TERMINALS);
  const cadPinMap = (hash: string, value: string, extra: { supersededBy?: string } = {}) =>
    candidateFromExtraction({ exactMpn: "NE555DR", sourceId: `src_mfr_cad_${hash}`, sourceClass: "manufacturer_cad", method: "kicad_parser", parserVersion: "p/1", documentHash: hash.repeat(64), facts: [{ property: "pin_mapping", facet: "terminal", value, locator: "NE555.kicad_sym" }], ...(extra.supersededBy ? { sourceRevision: "A", supersededBy: extra.supersededBy } : {}) });

  async function refusedResolution(deps: FixtureDeps, property: string, pick: (fact: ImportReviewFact) => boolean) {
    const stored = await submit(deps);
    const chosen = stored.request.evidence.facts.find(pick)!;
    expect(chosen, "the fact to pick exists").toBeTruthy();
    const valid = fullResolution(stored.request);
    const resolutions = [...valid.resolutions.filter((item) => item.property !== property), { property, factId: chosen.factId, reason: "pick it" }];
    return { chosen, error: await refusal(approve(deps, stored, reviewer, { resolutions })) };
  }

  it("a quarantined fact carrying the draft's own value is refused for an engineering property (only the quarantine guard can refuse it)", async () => {
    const deps = fixtureDeps();
    deps.candidates = [cadPinMap("7", "1=VCC@1"), candidateFromExtraction({ exactMpn: "NE555DR", sourceId: "src_ds", sourceClass: "manufacturer_datasheet", method: "llm", parserVersion: "model/1", documentHash: "8".repeat(64), facts: [{ property: "pin_mapping", facet: "terminal", value: DRAFT_TABLE, locator: "p.3" }] })];
    const { chosen, error } = await refusedResolution(deps, "pin_mapping", (fact) => fact.establishes === "quarantined" && fact.property === "pin_mapping");
    expect([chosen.value, chosen.sourceClass, chosen.distributor, chosen.superseded]).toEqual([DRAFT_TABLE, "manufacturer_datasheet", null, false]);
    expect(error.code).toBe("ATOMIC_PUBLICATION_RESOLUTION_REFUSED");
  });

  it("a superseded authoritative fact carrying the draft's value is refused (only the supersession guard can refuse it)", async () => {
    const deps = fixtureDeps();
    deps.candidates = [cadPinMap("7", "1=VCC@1"), cadPinMap("6", DRAFT_TABLE, { supersededBy: "B" })];
    const { chosen, error } = await refusedResolution(deps, "pin_mapping", (fact) => fact.superseded && fact.property === "pin_mapping");
    expect([chosen.value, chosen.establishes, chosen.sourceClass]).toEqual([DRAFT_TABLE, "engineering_candidate", "manufacturer_cad"]);
    expect(error.code).toBe("ATOMIC_PUBLICATION_RESOLUTION_REFUSED");
  });

  it("a quarantined manufacturer fact is refused as the manufacturer (not draft-bound: only the quarantine guard stands between it and the published name)", async () => {
    const deps = fixtureDeps();
    deps.candidates = [candidateFromExtraction({ exactMpn: "NE555DR", sourceId: "src_ds", sourceClass: "manufacturer_datasheet", method: "llm", parserVersion: "model/1", documentHash: "8".repeat(64), facts: [{ property: "manufacturer", facet: "identity", value: "Acme Semiconductor", locator: "p.1" }] })];
    const { chosen, error } = await refusedResolution(deps, "manufacturer", (fact) => fact.establishes === "quarantined" && fact.property === "manufacturer");
    expect(chosen.value).toBe("Acme Semiconductor");
    expect(error.code).toBe("ATOMIC_PUBLICATION_RESOLUTION_REFUSED");
  });

  it("resolvableFact: every guard refuses on its own", () => {
    const base: ImportReviewFact = { factId: "fact_x", property: "pin_mapping", facet: "terminal", establishes: "engineering_candidate", sourceId: "src", sourceClass: "manufacturer_cad", method: "kicad_parser", parserVersion: "p/1", observationId: "document_x", valueHash: "0".repeat(64), value: "1=GND@1", locator: "x", reason: null, superseded: false, stale: false, distributor: null };
    expect(resolvableFact(base, "pin_mapping")).toBe(true);
    expect(resolvableFact(undefined, "pin_mapping")).toBe(false);
    expect(resolvableFact(base, "footprint")).toBe(false);
    for (const establishes of ["quarantined", "identity_hint", "sourcing"] as const) expect(resolvableFact({ ...base, establishes }, "pin_mapping"), establishes).toBe(false);
    for (const sourceClass of ["distributor_catalog", "third_party_cad", "cad_geometry_inference", "ocr_extraction", "llm_suggestion"] as const) expect(resolvableFact({ ...base, sourceClass }, "pin_mapping"), sourceClass).toBe(false);
    expect(resolvableFact({ ...base, distributor: { displayName: "DigiKey", freshnessLabel: "x", retrievedAt: T_SUBMIT.toISOString(), expiresAt: T_SUBMIT.toISOString(), basis: "cached", rawContentHash: null, registryVersion: "1.1.0" } }, "pin_mapping")).toBe(false);
    expect(resolvableFact({ ...base, superseded: true }, "pin_mapping")).toBe(false);
  });

  it("the review's authority classes are exactly the validator's", () => {
    expect([...REVIEW_AUTHORITY_SOURCE_CLASSES].sort()).toEqual([...ENGINEERING_AUTHORITY_SOURCE_CLASSES].sort());
  });
});

// ── [B19-E E4 review follow-up] the independent checker's items, each reproduced on the unfixed code first ─────────────

const editor2 = human(USERS.editor2, "pcb_editor");

describe("[B19-E E4 review follow-up] correctness-record-publication-onto-replaced-request", () => {
  it("a publication whose request was withdrawn and replaced under the same key before its final write records nothing onto the new request (409 REQUEST_REPLACED); its revision stays in the catalog", async () => {
    const deps = fixtureDeps();
    const approved = await approve(deps, await submit(deps));
    const markedAt = LATER(10);
    const realPublish = deps.publish;
    let replacement: StoredAtomicPublication | null = null;
    deps.publish = async (input) => {
      // the publication transaction stays uncommitted past the lease (its revision is invisible), the requester withdraws, and an
      // editor asks again for the same exact MPN and profile (the same aggregate key); only then does the transaction commit
      deps.setNow(new Date(markedAt.getTime() + PUBLISH_MARKER_LEASE_MS + 60_000));
      expect((await withdrawAtomicPublicationRequest(deps, { scope: GOVERNANCE, actor: editor, requestId: approved.request.requestId, reason: "the lease ran out" })).request.status).toBe("withdrawn");
      replacement = (await submitAtomicPublicationRequest(deps, { scope: GOVERNANCE, actor: editor2, membershipRevision: null, spec: ne555Spec(), links: [], reason: "ask again" })).stored;
      return realPublish(input);
    };
    deps.setNow(markedAt);
    const error = await refusal(publishAs(deps, admin, approved.request.requestId));
    expect(replacement, "the replacing request was made").not.toBeNull();
    const replacingId = replacement!.request.requestId;
    expect(replacingId).not.toBe(approved.request.requestId);
    expect([error.code, error.status, error.detail]).toEqual(["ATOMIC_PUBLICATION_REQUEST_REPLACED", 409, [approved.request.requestId, replacingId]]);
    // nothing was written to the replacing request: it is still pending, with no publication, and no record says published
    const head = (await deps.store.get(GOVERNANCE, approved.key))!;
    expect([head.request.requestId, head.request.status, head.request.publication, head.request.publishing]).toEqual([replacingId, "pending", undefined, undefined]);
    const history = await deps.workflow.history({ scope: GOVERNANCE, aggregateType: ATOMIC_PUBLICATION_AGGREGATE, aggregateKey: approved.key });
    expect(history.map((record) => [(record.payload as AtomicPublicationRequest).requestId === replacingId ? "replacing" : "published", (record.payload as AtomicPublicationRequest).status])).toEqual([["published", "pending"], ["published", "approved"], ["published", "approved"], ["published", "withdrawn"], ["replacing", "pending"]]);
    // the committed revision stays visible through the catalog status read
    expect(deps.published).toHaveLength(1);
    const revisionId = deps.published[0]!.snapshot.atomicRevision.id;
    expect((await deps.loadRevisionStatus([revisionId])).get(revisionId)).toMatchObject({ state: "published" });
    // a retry of the replaced request finds no request under its id, and never touches the replacing one
    deps.setNow(new Date(markedAt.getTime() + PUBLISH_MARKER_LEASE_MS + 120_000));
    expect((await refusal(publishAs(deps, admin2, approved.request.requestId))).code).toBe("ATOMIC_PUBLICATION_NOT_FOUND");
    expect((await deps.store.get(GOVERNANCE, approved.key))!.request).toMatchObject({ requestId: replacingId, status: "pending" });
  });
});

describe("[B19-E E4 review follow-up] correctness-ambiguous-publish-failure-clears-marker", () => {
  /** A fixture whose status read fails while `down` is set. */
  function withStatusRead(deps: FixtureDeps) {
    const realStatus = deps.loadRevisionStatus;
    const read = { down: false, calls: 0 };
    deps.loadRevisionStatus = async (ids) => {
      read.calls += 1;
      if (read.down) throw new Error("B19E_E4_STATUS_READ_FAILED");
      return realStatus(ids);
    };
    return read;
  }

  it("branch 1: a rollback the status read confirms (the read succeeds, the revision is absent) clears the marker and is 409 PUBLISH_REFUSED", async () => {
    const deps = fixtureDeps({ publish: async () => { throw new Error("B19E_E4_TRANSACTION_ROLLED_BACK"); } });
    const read = withStatusRead(deps);
    const approved = await approve(deps, await submit(deps));
    deps.setNow(LATER(10));
    expect(await refusal(publishAs(deps, admin, approved.request.requestId))).toMatchObject({ code: "ATOMIC_PUBLICATION_PUBLISH_REFUSED", status: 409 });
    expect(read.calls, "the status read decided").toBe(1);
    const head = (await deps.store.get(GOVERNANCE, approved.key))!;
    expect([head.request.status, head.request.publishing]).toEqual(["approved", undefined]);
  });

  it("branch 2: when the status read fails after a failed publish, the marker is kept (409 PUBLISH_OUTCOME_UNKNOWN); a later publish records the committed revision once", async () => {
    const deps = fixtureDeps();
    const read = withStatusRead(deps);
    const approved = await approve(deps, await submit(deps));
    const realPublish = deps.publish;
    // COMMIT reached the server, the answer was lost, and the status read that should decide fails too
    deps.publish = async (input) => { await realPublish(input); read.down = true; throw new Error("B19E_E4_ANSWER_LOST_AFTER_COMMIT"); };
    deps.setNow(LATER(10));
    const error = await refusal(publishAs(deps, admin, approved.request.requestId));
    expect([error.code, error.status]).toEqual(["ATOMIC_PUBLICATION_PUBLISH_OUTCOME_UNKNOWN", 409]);
    const revisionId = deps.published[0]!.snapshot.atomicRevision.id;
    const kept = (await deps.store.get(GOVERNANCE, approved.key))!;
    expect(kept.request).toMatchObject({ status: "approved", publishing: { revisionId, by: { actorId: USERS.admin } } });
    // while the outcome still cannot be read, neither a withdrawal nor another publication goes ahead, even after the lease
    deps.setNow(new Date(LATER(10).getTime() + PUBLISH_MARKER_LEASE_MS + 1_000));
    expect((await refusal(withdrawAtomicPublicationRequest(deps, { scope: GOVERNANCE, actor: editor, requestId: approved.request.requestId, reason: "stop" }))).code).toBe("ATOMIC_PUBLICATION_PUBLISH_OUTCOME_UNKNOWN");
    deps.publish = realPublish;
    expect((await refusal(publishAs(deps, admin2, approved.request.requestId))).code).toBe("ATOMIC_PUBLICATION_PUBLISH_OUTCOME_UNKNOWN");
    expect(deps.published).toHaveLength(1);
    // once the read answers, a later publish re-checks and records the revision that committed, never publishing a second
    read.down = false;
    const recorded = await publishAs(deps, admin2, approved.request.requestId);
    expect(recorded.request).toMatchObject({ status: "published", publication: { revisionId, publishedBy: { actorId: USERS.admin } } });
    expect(deps.published).toHaveLength(1);
  });

  it("branch 2: a withdrawal after an unreadable outcome re-checks and records the committed revision (409 STATE_CONFLICT published)", async () => {
    const deps = fixtureDeps();
    const read = withStatusRead(deps);
    const approved = await approve(deps, await submit(deps));
    const realPublish = deps.publish;
    deps.publish = async (input) => { await realPublish(input); read.down = true; throw new Error("B19E_E4_ANSWER_LOST_AFTER_COMMIT"); };
    deps.setNow(LATER(10));
    expect((await refusal(publishAs(deps, admin, approved.request.requestId))).code).toBe("ATOMIC_PUBLICATION_PUBLISH_OUTCOME_UNKNOWN");
    read.down = false;
    deps.setNow(LATER(11));
    expect(await refusal(withdrawAtomicPublicationRequest(deps, { scope: GOVERNANCE, actor: editor, requestId: approved.request.requestId, reason: "stop" }))).toMatchObject({ code: "ATOMIC_PUBLICATION_STATE_CONFLICT", detail: ["published"] });
    expect((await deps.store.get(GOVERNANCE, approved.key))!.request).toMatchObject({ status: "published", publication: { revisionId: deps.published[0]!.snapshot.atomicRevision.id } });
    expect(deps.published).toHaveLength(1);
  });

  it("branch 2: a failure at COMMIT whose revision is not visible yet is undecided too (the read runs before the commit lands): the marker is kept, and the commit that lands is recorded once", async () => {
    const deps = fixtureDeps();
    const read = withStatusRead(deps);
    const approved = await approve(deps, await submit(deps));
    const realPublish = deps.publish;
    let land: (() => Promise<unknown>) | null = null;
    // the publication transaction reports a COMMIT whose outcome it cannot know; the server applies that COMMIT only later
    deps.publish = async (input) => {
      land = () => realPublish(input);
      throw Object.assign(new Error("B19E_E4_COMMIT_ANSWER_LOST"), { commitOutcomeUnknown: true });
    };
    deps.setNow(LATER(10));
    const error = await refusal(publishAs(deps, admin, approved.request.requestId));
    expect([error.code, error.status]).toEqual(["ATOMIC_PUBLICATION_PUBLISH_OUTCOME_UNKNOWN", 409]);
    expect(read.calls, "the status read ran and found nothing yet").toBe(1);
    expect(deps.published).toHaveLength(0);
    const kept = (await deps.store.get(GOVERNANCE, approved.key))!;
    expect(kept.request.publishing?.by.actorId).toBe(USERS.admin);
    // inside the lease the request is held: no withdrawal can orphan the revision, no retry publishes another
    deps.setNow(LATER(11));
    expect((await refusal(withdrawAtomicPublicationRequest(deps, { scope: GOVERNANCE, actor: editor, requestId: approved.request.requestId, reason: "stop" }))).code).toBe("ATOMIC_PUBLICATION_PUBLISH_IN_PROGRESS");
    deps.publish = realPublish;
    expect((await refusal(publishAs(deps, admin2, approved.request.requestId))).code).toBe("ATOMIC_PUBLICATION_PUBLISH_IN_PROGRESS");
    // the COMMIT lands: the next publish records it under the first publisher, and nothing is published twice
    await land!();
    expect(deps.published.map((call) => call.snapshot.atomicRevision.id)).toEqual([kept.request.publishing!.revisionId]);
    const recorded = await publishAs(deps, admin2, approved.request.requestId);
    expect(recorded.request).toMatchObject({ status: "published", publication: { revisionId: kept.request.publishing!.revisionId, publishedBy: { actorId: USERS.admin } } });
    expect(deps.published).toHaveLength(1);
  });
});

// [B19-E E4 review follow-up] the status dependency is typed ReadonlyMap: any object with has() is an answer, not "unknown"
describe("[B19-E E4 review follow-up] a ReadonlyMap-shaped status answer is read, not treated as unknown", () => {
  it("publicationOutcome accepts a non-Map object that implements has()", async () => {
    const { publicationOutcomeFor } = await import("../publication-review");
    const answer = { has: (id: string) => id === "atomic_committed", get: () => undefined, size: 1 } as unknown as ReadonlyMap<string, unknown>;
    expect(await publicationOutcomeFor({ loadRevisionStatus: async () => answer as never }, "atomic_committed")).toBe("committed");
    expect(await publicationOutcomeFor({ loadRevisionStatus: async () => answer as never }, "atomic_other")).toBe("absent");
    expect(await publicationOutcomeFor({ loadRevisionStatus: async () => { throw new Error("read down"); } }, "atomic_committed")).toBe("unknown");
  });
});

