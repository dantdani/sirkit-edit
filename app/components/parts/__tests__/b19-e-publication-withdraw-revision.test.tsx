// @vitest-environment jsdom
/**
 * [B19-E E5 h] Withdrawing a published revision from the publication review panel.
 *
 * A project administrator (the server's viewer block says so) sees, on a published request, a Withdraw revision form: the state
 * (deprecate, supersede, revoke), the successor revision (required to supersede) and a reason. The button stays disabled, with
 * the reason shown, until the form is complete; what it sends is the `withdraw_revision` operation and those fields only.
 * Anyone else, and any unpublished request, sees no form. The server enforces every rule again (OD-37, OD-38).
 *
 * Reproduced on the unchanged code: the panel had no withdraw-revision control.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AtomicPublicationReviewPanel } from "../AtomicPublicationReviewPanel";
import { useAtomicPublicationReview } from "../hooks/useAtomicPublicationReview";
import type { AtomicPublicationRequest, AtomicPublicationViewer } from "@/app/lib/atomic/publication-review-contract";

const PURCHASE_WORDING = /add to cart|checkout|\bbuy\b|place (an )?order|purchase order|order now|project cart|populate your cart/i;
const REVIEWER: AtomicPublicationViewer = { actorId: "u-reviewer", role: "reviewer", actorKind: "human", canSubmit: true, canResolve: true, canPublish: false };
const ADMIN: AtomicPublicationViewer = { actorId: "u-admin", role: "project_admin", actorKind: "human", canSubmit: true, canResolve: true, canPublish: true };
const REVISION = "atomic_rev_published";

function request(status: AtomicPublicationRequest["status"]) {
  return {
    schemaVersion: "sirkit.atomic-publication-request.v1", requestId: "atomic-publication:w1", tenantId: "local", projectId: "sirkit-catalog-governance", branchId: "main", identityKey: "NE555DR", exactMpn: "NE555DR", profile: "pcb_assignable",
    status, requestedBy: { actorId: "u-editor", actorKind: "human", role: "pcb_editor", sessionId: "s" }, requestedAt: "2026-09-13T12:00:00.000Z", requestReason: "publish the timer", requesterMembershipRevision: "m1",
    spec: { exactMpn: "NE555DR", profile: "pcb_assignable", symbol: null, footprint: null, terminals: [], package: null, datasheet: null, manufacturer: null },
    links: [],
    evidence: { schemaVersion: "sirkit.import-review-evidence.v1", identityKey: "NE555DR", exactMpns: ["NE555DR"], profile: "pcb_assignable", registryVersion: "1.1.0", bundleId: "evidence_bundle_x", proven: false, facts: [], conflicts: [], quarantinedDisagreements: [], missing: [], supersededObservationIds: [], staleObservationIds: [], authoringDiagnostics: [], links: [], reviewEvidenceDigest: `sha256:${"4".repeat(64)}` },
    ...(status === "published" ? { publication: { publishedBy: { actorId: "u-other-admin", actorKind: "human", role: "project_admin", sessionId: "s" }, publishedAt: "2026-09-13T12:30:00.000Z", revisionId: REVISION, auditId: "audit_x", links: [] } } : {}),
    requestDigest: `sha256:${"5".repeat(64)}`, revision: 3, effectiveStatus: status,
  } as unknown as AtomicPublicationRequest & { revision: number; effectiveStatus: AtomicPublicationRequest["status"] };
}

function fakeServer(viewer: AtomicPublicationViewer, requests: Array<ReturnType<typeof request>>) {
  const posts: Array<Record<string, unknown>> = [];
  const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    if (!init?.method || init.method === "GET") return new Response(JSON.stringify({ ok: true, viewer, membershipVerified: true, requests }), { status: 200 });
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    posts.push(body);
    return new Response(JSON.stringify({ ok: true, withdrawal: { revisionId: body.revisionId, from: "published", to: body.to, eventId: "status_x", auditId: "audit_y" } }), { status: 200 });
  }) as unknown as typeof fetch;
  return { posts, fetchImpl };
}

function Harness({ fetchImpl }: { fetchImpl: typeof fetch }) {
  const review = useAtomicPublicationReview({ enabled: true, scopeHeaders: () => ({ "x-sirkit-project-id": "sirkit-catalog-governance" }), fetchImpl });
  return <AtomicPublicationReviewPanel review={review} />;
}

const ID = "atomic-publication:w1";
afterEach(async () => { cleanup(); await new Promise((resolve) => setTimeout(resolve, 0)); vi.restoreAllMocks(); });

describe("[B19-E E5 h] Withdraw revision in the publication panel", () => {
  it("an administrator completes the form; the button explains what is missing until then and sends only the operation's fields", async () => {
    const server = fakeServer(ADMIN, [request("published")]);
    render(<Harness fetchImpl={server.fetchImpl} />);
    const button = await screen.findByTestId(`atomic-withdraw-revision-${ID}`) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByTestId(`atomic-withdraw-revision-blockers-${ID}`).textContent).toMatch(/reason/i);
    fireEvent.change(screen.getByTestId(`atomic-withdraw-revision-state-${ID}`), { target: { value: "superseded" } });
    fireEvent.change(screen.getByTestId(`atomic-withdraw-revision-reason-${ID}`), { target: { value: "replaced by the reissued revision" } });
    expect((screen.getByTestId(`atomic-withdraw-revision-${ID}`) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId(`atomic-withdraw-revision-blockers-${ID}`).textContent).toMatch(/successor/i);
    fireEvent.change(screen.getByTestId(`atomic-withdraw-revision-successor-${ID}`), { target: { value: REVISION } });
    expect(screen.getByTestId(`atomic-withdraw-revision-blockers-${ID}`).textContent).toMatch(/its own successor/i);
    fireEvent.change(screen.getByTestId(`atomic-withdraw-revision-successor-${ID}`), { target: { value: "atomic_rev_successor" } });
    expect((screen.getByTestId(`atomic-withdraw-revision-${ID}`) as HTMLButtonElement).disabled).toBe(false);
    await act(async () => { fireEvent.click(screen.getByTestId(`atomic-withdraw-revision-${ID}`)); });
    await waitFor(() => expect(server.posts).toHaveLength(1));
    expect(server.posts[0]).toEqual({ operation: "withdraw_revision", revisionId: REVISION, to: "superseded", successorRevisionId: "atomic_rev_successor", reason: "replaced by the reissued revision" });
  });

  it("deprecating sends no successor when none is named", async () => {
    const server = fakeServer(ADMIN, [request("published")]);
    render(<Harness fetchImpl={server.fetchImpl} />);
    await screen.findByTestId(`atomic-withdraw-revision-${ID}`);
    fireEvent.change(screen.getByTestId(`atomic-withdraw-revision-reason-${ID}`), { target: { value: "not recommended for new designs" } });
    await act(async () => { fireEvent.click(screen.getByTestId(`atomic-withdraw-revision-${ID}`)); });
    await waitFor(() => expect(server.posts).toHaveLength(1));
    expect(server.posts[0]).toEqual({ operation: "withdraw_revision", revisionId: REVISION, to: "deprecated", reason: "not recommended for new designs" });
  });

  it("a reviewer, or an unpublished request, shows no withdraw form; no control reads as buying", async () => {
    const reviewer = fakeServer(REVIEWER, [request("published")]);
    const { unmount } = render(<Harness fetchImpl={reviewer.fetchImpl} />);
    await screen.findByText("NE555DR");
    expect(screen.queryByTestId(`atomic-withdraw-revision-${ID}`)).toBeNull();
    unmount();
    const pending = fakeServer(ADMIN, [request("pending")]);
    render(<Harness fetchImpl={pending.fetchImpl} />);
    await screen.findByText("NE555DR");
    expect(screen.queryByTestId(`atomic-withdraw-revision-${ID}`)).toBeNull();
    const texts = [...document.querySelectorAll("button, option, label, input")].map((element) => `${element.textContent} ${element.getAttribute("aria-label") ?? ""}`);
    expect(texts.filter((text) => PURCHASE_WORDING.test(text))).toEqual([]);
  });
});
