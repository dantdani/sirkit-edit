// @vitest-environment jsdom
/**
 * [B19-E E4 j] The atomic publication review panel and its mounts.
 *
 *  - the banner says "A bundle proves nothing; only a published atomic revision controls schematic/PCB";
 *  - Approve stays disabled, with a visible reason, until the manufacturer, every conflict and every quarantined fact are
 *    decided and nothing is missing; what it sends is the reviewer's choices only (never a reviewer stamp or a source class);
 *  - Publish is disabled, with a visible reason, for the person who approved;
 *  - no control reads as buying anything;
 *  - the Build Library mounts the panel from an exact external hit ("Request evidence review").
 *
 * Reproduced on the unchanged code: the panel, its hook and the Build Library mount did not exist.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AtomicPublicationReviewPanel } from "../AtomicPublicationReviewPanel";
import { useAtomicPublicationReview } from "../hooks/useAtomicPublicationReview";
import { ATOMIC_PUBLICATION_BANNER, type AtomicPublicationRequest, type AtomicPublicationViewer } from "@/app/lib/atomic/publication-review-contract";
import { BuildLibraryPanel } from "@/app/components/editor/BuildLibraryPanel";
import { EXTERNAL_OBSERVATION_AUTHORITY } from "@/app/lib/acquisition/external-search-contract";

const PURCHASE_WORDING = /add to cart|checkout|\bbuy\b|place (an )?order|purchase order|order now|project cart|populate your cart/i;
const SCOPE = { tenantId: "local", projectId: "sirkit-catalog-governance", branchId: "main" };
const REVIEWER: AtomicPublicationViewer = { actorId: "u-reviewer", role: "reviewer", actorKind: "human", canSubmit: true, canResolve: true, canPublish: false };
const ADMIN: AtomicPublicationViewer = { actorId: "u-admin", role: "project_admin", actorKind: "human", canSubmit: true, canResolve: true, canPublish: true };
const HASH = (c: string) => c.repeat(64);

function fact(factId: string, property: string, extra: Partial<AtomicPublicationRequest["evidence"]["facts"][number]> = {}): AtomicPublicationRequest["evidence"]["facts"][number] {
  return { factId, property, facet: "identity", establishes: "engineering_candidate", sourceId: "source_org_authored_x", sourceClass: "organization_authored", method: "manual", parserVersion: "sirkit.atomic-authoring/1", observationId: `document_${HASH("1")}`, valueHash: HASH("2"), value: "Texas Instruments", locator: "datasheet p.1", reason: null, superseded: false, stale: false, distributor: null, ...extra };
}

function request(status: AtomicPublicationRequest["status"], extra: Partial<AtomicPublicationRequest> = {}): AtomicPublicationRequest & { revision: number; effectiveStatus: AtomicPublicationRequest["status"] } {
  return {
    schemaVersion: "sirkit.atomic-publication-request.v1", requestId: "atomic-publication:r1", tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, branchId: SCOPE.branchId, identityKey: "NE555DR", exactMpn: "NE555DR", profile: "pcb_assignable",
    status, requestedBy: { actorId: "u-editor", actorKind: "human", role: "pcb_editor", sessionId: "s" }, requestedAt: "2026-09-13T12:00:00.000Z", requestReason: "publish the timer", requesterMembershipRevision: "m1",
    spec: { exactMpn: "NE555DR", profile: "pcb_assignable", symbol: { library: "Timer", name: "NE555D" }, footprint: { library: "Package_SO", name: "SOIC-8_3.9x4.9mm_P1.27mm" }, terminals: [{ number: "1", function: "GND", pads: ["1"] }], package: { code: "SOIC-8", mounting: "smd" }, datasheet: { url: null, locator: "Table 1" }, manufacturer: { canonicalName: "Texas Instruments", officialDomains: [] } },
    links: [],
    evidence: {
      schemaVersion: "sirkit.import-review-evidence.v1", identityKey: "NE555DR", exactMpns: ["NE555DR"], profile: "pcb_assignable", registryVersion: "1.1.0", bundleId: `evidence_bundle_${HASH("3")}`, proven: false,
      facts: [
        fact("fact_manufacturer", "manufacturer"),
        fact("fact_symbol", "symbol", { facet: "terminal", sourceClass: "official_kicad_library", sourceId: "source_kicad_official_libraries", method: "kicad_parser", value: "Timer:NE555D" }),
        fact("fact_digikey_mpn", "mpn", { establishes: "identity_hint", sourceId: "digikey", sourceClass: "distributor_catalog", method: "structured_api", value: null, locator: null, distributor: { displayName: "DigiKey", freshnessLabel: "DigiKey keyword search", retrievedAt: "2026-09-13T11:30:00.000Z", expiresAt: "2026-09-13T12:30:00.000Z", basis: "cached", rawContentHash: null, registryVersion: "1.1.0" } }),
        fact("fact_llm_pins", "pin_mapping", { facet: "terminal", establishes: "quarantined", sourceId: "src_ds", sourceClass: "manufacturer_datasheet", method: "llm", value: "1=VCC@1", locator: "p.3", reason: "extracted by a model or OCR" }),
      ],
      conflicts: [], quarantinedDisagreements: [], missing: [], supersededObservationIds: [], staleObservationIds: [], authoringDiagnostics: [], links: [],
      reviewEvidenceDigest: `sha256:${HASH("4")}`,
    },
    requestDigest: `sha256:${HASH("5")}`, revision: 1, effectiveStatus: status, ...extra,
  } as AtomicPublicationRequest & { revision: number; effectiveStatus: AtomicPublicationRequest["status"] };
}

function fakeServer(initial: { viewer: AtomicPublicationViewer; requests: Array<ReturnType<typeof request>> }) {
  const state = { ...initial, posts: [] as Array<Record<string, unknown>> };
  const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    if (!init?.method || init.method === "GET") return new Response(JSON.stringify({ ok: true, viewer: state.viewer, membershipVerified: true, requests: state.requests }), { status: 200 });
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    state.posts.push(body);
    return new Response(JSON.stringify({ ok: true, request: state.requests[0] }), { status: 200 });
  }) as unknown as typeof fetch;
  return { state, fetchImpl };
}

function Harness({ fetchImpl, prefill }: { fetchImpl: typeof fetch; prefill?: { exactMpn?: string } }) {
  const review = useAtomicPublicationReview({ enabled: true, scopeHeaders: () => ({ "x-sirkit-project-id": SCOPE.projectId }), fetchImpl });
  return <AtomicPublicationReviewPanel review={review} prefill={prefill} />;
}

const controlTexts = (root: HTMLElement): string[] => [...root.querySelectorAll("button, a, input, select, textarea, option, label")].flatMap((element) => [element.textContent ?? "", element.getAttribute("aria-label") ?? "", element.getAttribute("title") ?? "", element.getAttribute("placeholder") ?? ""]).filter(Boolean);
const keysDeep = (value: unknown): string[] => (Array.isArray(value) ? value.flatMap(keysDeep) : value && typeof value === "object" ? Object.entries(value).flatMap(([key, inner]) => [key, ...keysDeep(inner)]) : []);

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

describe("[B19-E E4 j] the review panel", () => {
  it("shows the banner, and keeps Approve disabled with a visible reason until every decision is made", async () => {
    const server = fakeServer({ viewer: REVIEWER, requests: [request("pending")] });
    render(<Harness fetchImpl={server.fetchImpl} />);
    expect(screen.getByTestId("atomic-publication-banner").textContent).toBe(ATOMIC_PUBLICATION_BANNER);
    expect(ATOMIC_PUBLICATION_BANNER).toBe("A bundle proves nothing; only a published atomic revision controls schematic/PCB");
    const row = await screen.findByTestId("atomic-publication-request-atomic-publication:r1");
    fireEvent.click(within(row).getByTestId("atomic-expand-atomic-publication:r1"));
    const approve = screen.getByTestId("atomic-approve-atomic-publication:r1") as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    const reasons = screen.getByTestId("atomic-approve-blockers-atomic-publication:r1").textContent ?? "";
    expect(reasons).toMatch(/manufacturer/i);
    expect(reasons).toMatch(/1 quarantined fact/);
    // the distributor fact is shown by its labels only
    expect(screen.getByTestId("atomic-fact-fact_digikey_mpn").textContent).toMatch(/DigiKey · cached · observed 2026-09-13 11:30 UTC/);

    // [B19-E E4 review] tests-j: the reason is written FIRST, so only the undecided manufacturer and fact can keep Approve disabled
    fireEvent.change(screen.getByTestId("atomic-approve-reason-atomic-publication:r1"), { target: { value: "verified against the datasheet" } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(approve.disabled).toBe(true);
    expect(screen.getByTestId("atomic-approve-blockers-atomic-publication:r1").textContent).toMatch(/manufacturer/i);
    fireEvent.change(screen.getByTestId("atomic-manufacturer-atomic-publication:r1"), { target: { value: "fact_manufacturer" } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(approve.disabled).toBe(true);
    expect(screen.getByTestId("atomic-approve-blockers-atomic-publication:r1").textContent).toMatch(/1 quarantined fact/);
    fireEvent.change(screen.getByTestId("atomic-disposition-fact_llm_pins"), { target: { value: "rejected" } });
    await waitFor(() => expect(approve.disabled).toBe(false));
    expect(screen.queryByTestId("atomic-approve-blockers-atomic-publication:r1")).toBeNull();
    await act(async () => { fireEvent.click(approve); });
    await waitFor(() => expect(server.state.posts).toHaveLength(1));
    const sent = server.state.posts[0]!;
    expect(sent).toMatchObject({ operation: "resolve_request", requestId: "atomic-publication:r1", decision: "approve", reviewEvidenceDigest: `sha256:${HASH("4")}`, resolutions: [{ property: "manufacturer", factId: "fact_manufacturer" }], factDispositions: [{ factId: "fact_llm_pins", disposition: "rejected" }] });
    expect(keysDeep(sent).filter((key) => ["reviewerId", "reviewedAt", "sourceClass", "evidence", "facts", "values", "snapshot"].includes(key))).toEqual([]);
  });

  it("Publish is disabled, with a visible reason, for the person who approved; no control reads as buying", async () => {
    const approved = request("approved", { decision: { decision: "approve", decidedBy: { actorId: "u-admin", actorKind: "human", role: "project_admin", sessionId: "s" }, decidedAt: "2026-09-13T12:05:00.000Z", reason: "ok", resolutions: [], factDispositions: [], reviewEvidenceDigest: `sha256:${HASH("4")}`, approval: { profile: "pcb_assignable", eligible: true, blockers: [], warnings: [], validatorVersion: "v" } } });
    const server = fakeServer({ viewer: ADMIN, requests: [approved] });
    const { container } = render(<Harness fetchImpl={server.fetchImpl} prefill={{ exactMpn: "NE555DR" }} />);
    const row = await screen.findByTestId("atomic-publication-request-atomic-publication:r1");
    fireEvent.click(within(row).getByTestId("atomic-expand-atomic-publication:r1"));
    const publish = screen.getByTestId("atomic-publish-atomic-publication:r1") as HTMLButtonElement;
    expect(publish.disabled).toBe(true);
    // [B19-E E4 review] tests-j: with the publication reason written, only the same-person rule keeps Publish disabled
    fireEvent.change(screen.getByTestId("atomic-publish-reason-atomic-publication:r1"), { target: { value: "publish the reviewed revision" } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(publish.disabled).toBe(true);
    expect(screen.getByTestId("atomic-publish-blockers-atomic-publication:r1").textContent).toMatch(/you approved this request; a different person must publish it/i);
    const texts = controlTexts(container);
    expect(texts.length).toBeGreaterThan(5);
    expect(texts.filter((text) => PURCHASE_WORDING.test(text))).toEqual([]);
    expect((container.textContent ?? "").match(PURCHASE_WORDING)).toBeNull();
  });

  it("a refusal outside the governance project is shown as the reason, not as an empty list", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: false, code: "ATOMIC_PUBLICATION_GOVERNANCE_FORBIDDEN", error: "x" }), { status: 403 })) as unknown as typeof fetch;
    render(<Harness fetchImpl={fetchImpl} />);
    expect(await screen.findByText(/only in the catalog governance project/i)).toBeTruthy();
  });

  const LINKED = [{ partId: "11111111-1111-4111-8111-111111111111", valueKey: "", partMpn: "NE555DR", partSymbol: "Timer:NE555D" }];

  it("[B19-E E4 review] security-unreviewed-links: the reviewer sees every link, with its part's symbol and MPN, in the evidence", async () => {
    const pending = request("pending", { links: [{ partId: LINKED[0]!.partId, valueKey: "" }] });
    pending.evidence = { ...pending.evidence, links: LINKED };
    const server = fakeServer({ viewer: REVIEWER, requests: [pending] });
    render(<Harness fetchImpl={server.fetchImpl} />);
    fireEvent.click(within(await screen.findByTestId("atomic-publication-request-atomic-publication:r1")).getByTestId("atomic-expand-atomic-publication:r1"));
    const links = screen.getByTestId("atomic-links-atomic-publication:r1").textContent ?? "";
    expect(links).toMatch(/Timer:NE555D/);
    expect(links).toMatch(/NE555DR/);
    expect(links).toMatch(/default value/i);
  });

  it("[B19-E E4 review] security-unreviewed-links: the publisher sees the links the publication will write beside Publish", async () => {
    const approved = request("approved", { links: [{ partId: LINKED[0]!.partId, valueKey: "" }], decision: { decision: "approve", decidedBy: { actorId: "u-reviewer", actorKind: "human", role: "reviewer", sessionId: "s" }, decidedAt: "2026-09-13T12:05:00.000Z", reason: "ok", resolutions: [], factDispositions: [], reviewEvidenceDigest: `sha256:${HASH("4")}`, approval: { profile: "pcb_assignable", eligible: true, blockers: [], warnings: [], validatorVersion: "v" } } });
    approved.evidence = { ...approved.evidence, links: LINKED };
    const server = fakeServer({ viewer: ADMIN, requests: [approved] });
    render(<Harness fetchImpl={server.fetchImpl} />);
    fireEvent.click(within(await screen.findByTestId("atomic-publication-request-atomic-publication:r1")).getByTestId("atomic-expand-atomic-publication:r1"));
    const beside = screen.getByTestId("atomic-publish-links-atomic-publication:r1").textContent ?? "";
    expect(beside).toMatch(/writes 1 link/i);
    expect(beside).toMatch(/Timer:NE555D/);
    expect(beside).toMatch(/NE555DR/);
  });

  it("[B19-E E4 review] correctness-submit-silently-returns-old-request: a request for a part that already has an open request says so", async () => {
    const server = fakeServer({ viewer: REVIEWER, requests: [] });
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST") return new Response(JSON.stringify({ ok: true, created: false, request: request("pending") }), { status: 200 });
      return server.fetchImpl(url, init);
    }) as unknown as typeof fetch;
    render(<Harness fetchImpl={fetchImpl} prefill={{ exactMpn: "NE555DR" }} />);
    const submitButton = await screen.findByTestId("atomic-submit");
    await act(async () => { fireEvent.click(submitButton); });
    expect((await screen.findByTestId("atomic-publication-notice")).textContent).toMatch(/already open/i);
  });

  it("[B19-E E4 review] correctness-link-to-already-linked-part-unpublishable: an already-linked part is not offered as a link", async () => {
    const server = fakeServer({ viewer: REVIEWER, requests: [] });
    const { unmount } = render(<AtomicPublicationReviewPanelHarness fetchImpl={server.fetchImpl} prefill={{ exactMpn: "NE555DR", partId: LINKED[0]!.partId, alreadyLinked: false }} />);
    expect(await screen.findByLabelText(/link this catalog part/i)).toBeTruthy();
    unmount();
    render(<AtomicPublicationReviewPanelHarness fetchImpl={server.fetchImpl} prefill={{ exactMpn: "NE555DR", partId: LINKED[0]!.partId, alreadyLinked: true }} />);
    await screen.findByTestId("atomic-submit");
    expect(screen.queryByLabelText(/link this catalog part/i)).toBeNull();
    expect(screen.getByTestId("atomic-submit-form").textContent).toMatch(/already linked/i);
  });
});

function AtomicPublicationReviewPanelHarness({ fetchImpl, prefill }: { fetchImpl: typeof fetch; prefill: Record<string, unknown> }) {
  const review = useAtomicPublicationReview({ enabled: true, scopeHeaders: () => ({ "x-sirkit-project-id": SCOPE.projectId }), fetchImpl });
  return <AtomicPublicationReviewPanel review={review} prefill={prefill} />;
}

describe("[B19-E E4 j] the Build Library mounts the panel from an exact external hit", () => {
  it("Request evidence review opens the panel with the exact MPN, and never offers a buy control", async () => {
    const hit = { sourceId: "digikey", sourceDisplayName: "DigiKey", attribution: "Credit DigiKey", mpn: "NE555DR", exactMatch: true, manufacturer: "Texas Instruments", description: "timer", packaging: null, lifecycle: "active", stock: 5, minimumOrderQuantity: 1, priceBreaks: [], datasheetUrl: null, productUrl: null, attributionLink: null, servedFrom: "live", observedAt: Date.UTC(2026, 8, 13, 12), expiresAt: Date.UTC(2026, 8, 13, 13), authority: EXTERNAL_OBSERVATION_AUTHORITY, observationId: `observation_${HASH("a")}`, candidateId: `candidate_${HASH("b")}` };
    const result = { ok: true, query: "NE555DR", mode: "exact", limit: 5, live: true, registryVersion: "1.1.0", authority: EXTERNAL_OBSERVATION_AUTHORITY, generatedAt: 0, sources: [], hits: [hit, { ...hit, mpn: "NE555DRG4", exactMatch: false, observationId: `observation_${HASH("c")}` }] };
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/parts/categories") return new Response(JSON.stringify({ ok: true, categories: [] }), { status: 200 });
      if (url === "/api/parts/external-search") return new Response(JSON.stringify(result), { status: 200 });
      if (url === "/api/components/atomic/publication") return new Response(JSON.stringify({ ok: true, viewer: REVIEWER, membershipVerified: true, requests: [] }), { status: 200 });
      throw new Error(`unexpected request ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(<BuildLibraryPanel projectScope={SCOPE} />);
    fireEvent.click(screen.getByText("Search distributors"));
    fireEvent.change(screen.getByLabelText("Distributor search query"), { target: { value: "NE555DR" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Search" })); });
    const hits = await screen.findAllByTestId("external-hit");
    expect(within(hits[0]!).getByRole("button", { name: "Request evidence review" })).toBeTruthy();
    expect(within(hits[1]!).queryByRole("button", { name: "Request evidence review" })).toBeNull(); // not the exact part
    await act(async () => { fireEvent.click(within(hits[0]!).getByRole("button", { name: "Request evidence review" })); });
    const panel = await screen.findByTestId("atomic-publication-panel");
    expect(within(panel).getByTestId("atomic-publication-banner").textContent).toBe(ATOMIC_PUBLICATION_BANNER);
    // [B19-E E4 review] correctness-review-section-outside-scroll-area: the section scrolls within a bounded height and never
    // squeezes the part list away (jsdom has no layout: the classes that bound it are what can be checked here)
    const section = screen.getByTestId("build-library-evidence-review");
    expect(section.className.split(/\s+/)).toEqual(expect.arrayContaining(["overflow-y-auto", "shrink-0"]));
    expect(section.className).toMatch(/(^|\s)max-h-\S+/);
    // the request form appears once the server's viewer block says this person may request
    expect(((await within(panel).findByTestId("atomic-submit-exact-mpn")) as HTMLInputElement).value).toBe("NE555DR");
    expect(controlTexts(container).filter((text) => PURCHASE_WORDING.test(text))).toEqual([]);
  });

  // [B19-E E4 review follow-up] correctness-already-linked-withdrawn-default: a part whose '' link points at a withdrawn revision
  // is reported by /api/parts/[id] in withdrawnValueKeys only (it is no selectable assignment); the preview must still treat the
  // part as linked, since a publication never repoints a link and the server refuses LINK_ALREADY_LINKED
  const PART_ID = "11111111-1111-4111-8111-111111111111";
  it.each([
    ["no link", {}, false],
    ["a selectable default link", { atomicAssignments: { "": { revisionId: "atomic_selectable", approved: true } } }, true],
    ["a default link whose revision was withdrawn", { withdrawnValueKeys: [""] }, true],
    ["only a withdrawn value link (no default)", { withdrawnValueKeys: ["10k"] }, false],
  ] as const)("a catalog part preview with %s offers the default link only when the part has no default link", async (_label, links, alreadyLinked) => {
    const part = { id: PART_ID, name: "NE555D", description: null, keywords: null, mpn: "NE555DR", manufacturer: "Texas Instruments", datasheet: null, footprintHint: "Package_SO:SOIC-8_3.9x4.9mm_P1.27mm", mainCategory: "Timer", libraryName: "Timer", pins: [], symbolRaw: "", properties: {}, ...links };
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/parts/categories") return new Response(JSON.stringify({ ok: true, categories: [{ mainCategory: "Timer", partCount: 1 }] }), { status: 200 });
      if (url === "/api/parts/search") return new Response(JSON.stringify({ ok: true, results: [{ id: PART_ID, name: "NE555D", description: null, mpn: "NE555DR", manufacturer: "Texas Instruments", datasheet: null, mainCategory: "Timer", libraryName: "Timer", pinCount: 8, score: 1 }], pagination: { total: 1, offset: 0, limit: 30 } }), { status: 200 });
      if (url === `/api/parts/${PART_ID}`) return new Response(JSON.stringify({ ok: true, part }), { status: 200 });
      if (url === "/api/components/atomic/publication") return new Response(JSON.stringify({ ok: true, viewer: REVIEWER, membershipVerified: true, requests: [] }), { status: 200 });
      throw new Error(`unexpected request ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<BuildLibraryPanel projectScope={SCOPE} />);
    const category = await screen.findByRole("button", { name: /Timer/ });
    await act(async () => { fireEvent.click(category); });
    const row = await screen.findByRole("button", { name: /NE555DR/ });
    await act(async () => { fireEvent.click(row); });
    const request = await screen.findByRole("button", { name: "Request evidence review" });
    await act(async () => { fireEvent.click(request); });
    const panel = await screen.findByTestId("atomic-publication-panel");
    const form = await within(panel).findByTestId("atomic-submit-form");
    if (alreadyLinked) {
      expect(within(form).queryByLabelText(/link this catalog part/i)).toBeNull();
      expect(form.textContent).toMatch(/already linked/i);
    } else {
      expect(within(form).getByLabelText(/link this catalog part/i)).toBeTruthy();
      expect(form.textContent).not.toMatch(/already linked/i);
    }
  });
});
