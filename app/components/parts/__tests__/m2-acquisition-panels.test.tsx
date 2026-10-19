// @vitest-environment jsdom
/**
 * [PR-L/M integration, 2026-10-18] The page's M2 acquisition surfaces, rendered:
 *
 *  - the candidate identity line names its kind ONCE ("GENERIC KiCad candidate" was printed before a basis that already opens with "a
 *    GENERIC KiCad library candidate") - in the Missing parts panel and in the component review inbox (one shared line,
 *    cadCandidateIdentityLine);
 *  - a stage that waits for a PERSON shows "awaiting", never "running" (the handoff waits for a person to send the package; the
 *    publication waits for a reviewer and a different administrator);
 *  - M2-SEC-5: the inbox's discovery package opens the publication review with `discovery: true`, and the submit posts `discovery: true` -
 *    the one shape submit_request accepts (it refused the old `{ valueKey }` with ATOMIC_PUBLICATION_INPUT_INVALID [discovery]);
 *  - M2-SEC-2 (the page half): a stopped or ended task is never sent a receipt.
 *
 * Reproduced on the unchanged code: the identity line repeated the label, the handoff stage read "running", the discovery submit posted
 * `{ valueKey: "" }`, and a cancelled task with an offered replacement was sent the receipt.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CadAcquisitionPanel } from "../CadAcquisitionPanel";
import { ComponentReviewInbox, handoffPrefill } from "../ComponentReviewInbox";
import { AtomicPublicationReviewPanel } from "../AtomicPublicationReviewPanel";
import { useAtomicPublicationReview } from "../hooks/useAtomicPublicationReview";
import { cadCandidateIdentityLine, type CadAcquisitionTaskView } from "@/app/lib/acquisition/cad-acquisition-contract";
import { tasksAppliedBy } from "@/app/lib/project/cad-acquisition-client";
import type { AtomicPublicationViewer } from "@/app/lib/atomic/publication-review-contract";

const SCOPE = { tenantId: "local", projectId: "m2-panels", branchId: "main" };
const PART = "m2-acquisition-part";
const GENERIC_BASIS = "a GENERIC KiCad library candidate (Diode:1N4001): no manufacturer datasheet or distributor exact-MPN observation establishes a manufacturer part number; the fixture pin table names a part but is not manufacturer evidence";
const HASH = (c: string) => c.repeat(64);
const occurrences = (text: string, needle: string): number => text.split(needle).length - 1;

function task(overrides: Partial<CadAcquisitionTaskView> = {}): CadAcquisitionTaskView {
  const stages: CadAcquisitionTaskView["stages"] = [
    { stage: "local-search", status: "done", at: "2026-10-18T10:00:00.000Z", evidence: "no eligible local revision of this exact part" },
    { stage: "source-selection", status: "done", at: "2026-10-18T10:00:01.000Z", evidence: "Fixture KiCad source (FIXTURE evidence)" },
    { stage: "retrieve", status: "done", at: "2026-10-18T10:00:01.000Z", evidence: "symbol-file aaaaaaaaaaaa (900 B)" },
    { stage: "validate", status: "done", at: "2026-10-18T10:00:01.000Z", evidence: "validated; a GENERIC KiCad candidate; unresolved: 1" },
    { stage: "handoff", status: "awaiting", at: "2026-10-18T10:00:01.000Z", evidence: "waiting for a person to send the package for component review" },
    { stage: "awaiting-publication", status: "pending", at: null, evidence: null },
    { stage: "proposal", status: "pending", at: null, evidence: null },
    { stage: "applied", status: "pending", at: null, evidence: null },
    { stage: "preflight", status: "pending", at: null, evidence: null },
  ];
  return {
    schema: "sirkit.component-resolution-task.v1", taskId: "cr-task:0123456789abcdef0123456789abcdef", state: "awaiting-review", stage: "handoff", stages,
    targets: [{ componentId: "kc-d1", refDes: "D1", value: "1N4001", catalogPartId: PART, symbol: "Diode:1N4001", footprint: "Diode_THT:D_DO-41_SOD81_P10.16mm_Horizontal", exactMpn: "1N4001" }],
    requirement: {}, attempts: [{ sourceId: "fixture-kicad", outcome: "used", code: null, detail: "used", at: "2026-10-18T10:00:01.000Z" }],
    candidate: { candidateId: "acquisition-candidate:00000000000000000000000000000001", sourceId: "fixture-kicad", verdict: "validated", identity: { kind: "generic", exactMpn: null, basis: GENERIC_BASIS }, reportDigest: `sha256:${HASH("1")}`, objects: [{ role: "symbol-file", sha256: HASH("a"), byteLength: 900, locator: "https://cad-fixture.sirkit.test/kicad-symbols/Diode.kicad_symdir/1N4001.kicad_sym", ref: null, retrievedAt: "2026-10-18T10:00:01.000Z" }], unresolved: ["the exact manufacturer and MPN"], conflicts: [], licence: { id: "kicad", spdx: "CC-BY-SA-4.0", attribution: "KiCad libraries", link: null }, fixtureEvidence: true },
    handoff: null, publication: null, proposal: null, applied: null, preflight: null, blocker: null, nextAction: "send-for-review", events: [], createdAt: "2026-10-18T10:00:00.000Z", updatedAt: "2026-10-18T10:00:01.000Z",
    ...overrides,
  };
}

function handoff(discovery: boolean) {
  return {
    handoffId: "acquisition-handoff:0123456789abcdef0123456789abcdef", createdAt: "2026-10-18T10:00:02.000Z", requester: { principalId: "u-editor" }, sourceId: "fixture-kicad", fixtureEvidence: true,
    target: { catalogPartId: PART, catalogMpn: "1N4148", symbol: { library: "Diode", name: "1N4148" }, footprint: { library: "Diode_THT", name: "D_DO-35_SOD27_P7.62mm_Horizontal" }, exactMpn: "1N4148TR", valueKey: "" },
    objects: [{ role: "symbol-file", sha256: HASH("a"), byteLength: 900 }],
    report: { verdict: "validated", identity: { kind: "generic" as const, exactMpn: null, basis: GENERIC_BASIS } },
    licence: { attribution: "KiCad libraries", record: { id: "kicad", spdxId: "CC-BY-SA-4.0" } },
    package: {
      spec: { exactMpn: "1N4148TR", profile: "pcb_assignable" as const, symbol: { library: "Diode", name: "1N4148", acquired: { handoffId: "acquisition-handoff:0123456789abcdef0123456789abcdef", objectHash: HASH("a") } }, footprint: { library: "Diode_THT", name: "D_DO-35_SOD27_P7.62mm_Horizontal", acquired: { handoffId: "acquisition-handoff:0123456789abcdef0123456789abcdef", objectHash: HASH("b") } }, terminals: [{ number: "1", function: "K", pads: ["1"] }, { number: "2", function: "A", pads: ["2"] }], package: null, datasheet: null, manufacturer: null },
      links: [], discovery, missing: [], conflicts: [], notes: [],
    },
  };
}

const elementPrototype = Element.prototype as unknown as { getAnimations?: () => unknown[] };
const hadGetAnimations = typeof elementPrototype.getAnimations === "function";
beforeEach(() => {
  if (typeof globalThis.ResizeObserver === "undefined") vi.stubGlobal("ResizeObserver", class { observe(): void {} unobserve(): void {} disconnect(): void {} });
  if (!hadGetAnimations) elementPrototype.getAnimations = () => [];
});
afterEach(async () => {
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 0));
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("[PR-L/M integration] the candidate identity names its kind once", () => {
  it("cadCandidateIdentityLine: the generic label once, then the basis without its own restatement; an exact MPN with its evidence", () => {
    const generic = cadCandidateIdentityLine({ kind: "generic", exactMpn: null, basis: GENERIC_BASIS });
    expect(occurrences(generic, "GENERIC KiCad")).toBe(1);
    expect(generic).toBe("GENERIC KiCad candidate (Diode:1N4001): no manufacturer datasheet or distributor exact-MPN observation establishes a manufacturer part number; the fixture pin table names a part but is not manufacturer evidence");
    expect(cadCandidateIdentityLine({ kind: "generic", exactMpn: null, basis: "a person must confirm the part" })).toBe("GENERIC KiCad candidate - a person must confirm the part");
    expect(cadCandidateIdentityLine({ kind: "exact", exactMpn: "1N4148", basis: "a manufacturer datasheet names the exact part" })).toBe("exact MPN 1N4148 (a manufacturer datasheet names the exact part)");
  });

  it("the Missing parts panel: one 'GENERIC KiCad' in the candidate line, and the handoff stage reads 'awaiting' (a person sends it), not 'running'", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, tasks: [task()] }), { status: 200 })));
    render(<CadAcquisitionPanel instances={[{ componentId: "kc-d1", refDes: "D1", partId: PART }]} schematic={{ components: [], wires: [], netLabels: [], kicadComponents: [], pageSize: "A4" }} projectScope={SCOPE} />);
    const candidate = await screen.findByTestId(`missing-acquisition-candidate-${PART}`);
    expect(occurrences(candidate.textContent ?? "", "GENERIC KiCad")).toBe(1);
    expect(candidate.textContent).toContain("GENERIC KiCad candidate (Diode:1N4001)");
    const stage = screen.getByTestId(`missing-acquisition-stage-${PART}-handoff`);
    expect(stage.getAttribute("data-status")).toBe("awaiting");
    expect(stage.textContent).toContain("awaiting");
    expect(stage.textContent).not.toContain("running");
    expect(within(stage).getByText("awaiting").className).toContain("text-violet-300");
  });

  it("the component review inbox: one 'GENERIC KiCad' in the identity line", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, handoffs: [handoff(false)] }), { status: 200 })));
    render(<ComponentReviewInbox projectScope={SCOPE} onOpen={() => undefined} />);
    const identity = await screen.findByTestId("component-review-identity");
    expect(occurrences(identity.textContent ?? "", "GENERIC KiCad")).toBe(1);
    expect(occurrences(screen.getByTestId("component-review-inbox").textContent ?? "", "GENERIC KiCad")).toBe(1);
  });
});

const EDITOR: AtomicPublicationViewer = { actorId: "u-gov-editor", role: "pcb_editor", actorKind: "human", canSubmit: true, canResolve: false, canPublish: false };
function Harness({ fetchImpl, prefill }: { fetchImpl: typeof fetch; prefill: ReturnType<typeof handoffPrefill> }) {
  const review = useAtomicPublicationReview({ enabled: true, scopeHeaders: () => ({ "x-sirkit-project-id": SCOPE.projectId }), fetchImpl });
  return <AtomicPublicationReviewPanel review={review} prefill={prefill} />;
}

describe("[PR-L/M integration] M2-SEC-5: the discovery package is submitted in the shape the server accepts", () => {
  it("the inbox's prefill carries discovery: true (a flag), and the submit posts discovery: true - never { valueKey }", async () => {
    const prefill = handoffPrefill(handoff(true));
    expect(prefill.acquisition?.discovery).toBe(true);
    const posts: Array<Record<string, unknown>> = [];
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (!init?.method || init.method === "GET") return new Response(JSON.stringify({ ok: true, viewer: EDITOR, membershipVerified: true, requests: [] }), { status: 200 });
      posts.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({ ok: false, code: "ATOMIC_PUBLICATION_INPUT_INVALID", error: "stub" }), { status: 400 });
    }) as unknown as typeof fetch;
    render(<Harness fetchImpl={fetchImpl} prefill={prefill} />);
    await screen.findByTestId("atomic-submit-acquired");
    fireEvent.change(screen.getByLabelText("Manufacturer"), { target: { value: "onsemi" } });
    fireEvent.change(screen.getByLabelText("Request reason"), { target: { value: "acquired from the fixture source" } });
    await act(async () => { fireEvent.click(screen.getByTestId("atomic-submit")); });
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ operation: "submit_request", exactMpn: "1N4148TR", discovery: true, links: [] });
    expect(posts[0]!.discovery).toBe(true);
  });

  it("a package with no discovery row posts no discovery key", async () => {
    const posts: Array<Record<string, unknown>> = [];
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (!init?.method || init.method === "GET") return new Response(JSON.stringify({ ok: true, viewer: EDITOR, membershipVerified: true, requests: [] }), { status: 200 });
      posts.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({ ok: false, code: "ATOMIC_PUBLICATION_INPUT_INVALID", error: "stub" }), { status: 400 });
    }) as unknown as typeof fetch;
    render(<Harness fetchImpl={fetchImpl} prefill={handoffPrefill(handoff(false))} />);
    await screen.findByTestId("atomic-submit-acquired");
    await act(async () => { fireEvent.click(screen.getByTestId("atomic-submit")); });
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(Object.keys(posts[0]!)).not.toContain("discovery");
  });
});

describe("[PR-L/M integration] M2-SEC-2, the page half: a stopped or ended task is never sent a receipt", () => {
  it("tasksAppliedBy completes only live tasks whose offered revision the batch bound", () => {
    const offered = task({ proposal: { componentIds: ["kc-d1"], candidatePartId: PART, atomicPartRevisionId: "rev-1", exactMpn: "1N4001", footprint: null, origin: "own-part", foundAt: "2026-10-18T10:05:00.000Z", reused: false }, nextAction: "offer-replacement" });
    const receipt = { receiptId: "r-1", schematicDigestAfter: "eng1-x", items: [{ componentInstanceId: "kc-d1", target: { atomicPartRevisionId: "rev-1" } }] };
    expect(tasksAppliedBy([offered], receipt).map((item) => item.taskId)).toEqual([offered.taskId]);
    for (const state of ["cancelled", "failed", "stale", "succeeded"] as const) expect(tasksAppliedBy([{ ...offered, state }], receipt), state).toEqual([]);
  });
});
