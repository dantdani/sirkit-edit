// @vitest-environment jsdom
/**
 * B16-C.2 — the visible component-binding review handoff in the browser:
 * an editor requests review (one / all) and sees the durable state; a
 * reviewer sees the server-projected evidence and approves / rejects (reject
 * needs a reason); refusals are bounded and shown with their code; the
 * viewer block is the SERVER's, never the browser's.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComponentReviewPanel } from "../ComponentReviewPanel";
import { useComponentReview, type ReviewableComponent } from "../hooks/useComponentReview";
import type { ComponentReviewRequest } from "@/app/lib/physical-binding/review-handoff";

const COMPONENTS: ReviewableComponent[] = [
  { id: "c-u1", refDes: "U1", atomicPartRevisionId: "rev-timer" },
  { id: "c-r1", refDes: "R1", atomicPartRevisionId: "rev-resistor" },
];
const EDITOR = { actorId: "u-editor", role: "pcb_editor", actorKind: "human", canRequest: true, canResolve: false };
const REVIEWER = { actorId: "u-reviewer", role: "reviewer", actorKind: "human", canRequest: true, canResolve: true };

function request(component: ReviewableComponent, status: ComponentReviewRequest["status"], extra: Partial<ComponentReviewRequest> = {}): ComponentReviewRequest & { revision: number } {
  return {
    schemaVersion: "sirkit.component-review-request.v1", requestId: `review:${component.id}:${status}`, tenantId: "local", projectId: "p", branchId: "main", boardInstanceId: "board", componentInstanceId: component.id, atomicPartRevisionId: component.atomicPartRevisionId,
    status, requestedBy: { actorId: "u-editor", actorKind: "human", role: "pcb_editor", sessionId: "s" }, requestedAt: "2026-09-09T12:00:00.000Z", requestReason: "please", requesterMembershipRevision: "m1",
    evidence: {
      candidate: { atomicPartRevisionId: component.atomicPartRevisionId, logicalPartId: "lp", exactPartId: "ep", exactMpn: `${component.refDes}-MPN`, manufacturerId: "m", manufacturerName: "Fixture Corp" },
      symbol: { logicalAssetId: "sym", versionId: "sym:v1", contentHash: "h", semanticHash: "h", symbolName: "NE555", pinCount: 8 },
      footprint: { logicalAssetId: "fp", versionId: "fp:v1", contentHash: "h", semanticHash: "h", footprintName: "SOIC-8", libraryNickname: "Package_SO", mountingTechnology: "smd", padCount: 8, electricalPadCount: 8, mechanicalPadCount: 0 },
      package: { canonicalName: "SOIC-8", identitySystem: "manufacturer", pinCount: 8, mountingTechnology: "smd" },
      pinToPad: { mappingId: "map:1", state: "approved", semanticHash: "h", entries: [{ terminalId: "t:1", symbolPinIds: ["pin:1"], padNumbers: ["1"], classification: "signal" }], missingTerminalIds: [], missingSymbolPinIds: [], missingPadNumbers: [], ambiguous: [] },
      sourceRevisions: { atomicPartRevisionId: component.atomicPartRevisionId, symbolVersionId: "sym:v1", footprintVersionId: "fp:v1", mappingId: "map:1", capturedAt: "2026-09-01T00:00:00.000Z" },
      evidenceRefs: ["ev:1"], evidenceDigest: "sha256:evidence",
    },
    requestDigest: "sha256:request", revision: 1, ...extra,
  };
}

/** A fake server: list responses come from `state`, mutations are recorded and applied. */
function fakeServer(initial: { viewer: typeof EDITOR; requests: Array<ComponentReviewRequest & { revision: number }> }) {
  const state = { ...initial, calls: [] as Array<Record<string, unknown>>, refuse: null as null | { status: number; code: string } };
  const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    state.calls.push(body);
    if (body.operation === "list_review_requests") return new Response(JSON.stringify({ ok: true, viewer: state.viewer, membershipVerified: true, requests: state.requests }), { status: 200 });
    if (state.refuse) return new Response(JSON.stringify({ ok: false, code: state.refuse.code, error: state.refuse.code }), { status: state.refuse.status });
    if (body.operation === "request_atomic_review") {
      const component = COMPONENTS.find((item) => item.id === body.componentInstanceId)!;
      const created = request(component, "pending");
      state.requests = [...state.requests.filter((item) => item.componentInstanceId !== component.id), created];
      return new Response(JSON.stringify({ ok: true, created: true, request: created, revision: 1 }), { status: 201 });
    }
    if (body.operation === "resolve_review_request") {
      state.requests = state.requests.map((item) => item.requestId === body.requestId ? { ...item, status: body.decision === "approve" ? "approved" : "rejected", decision: { decidedBy: { actorId: "u-reviewer", actorKind: "human", role: "reviewer", sessionId: "s" }, decidedAt: "2026-09-09T12:05:00.000Z", reason: String(body.reason) } } : item);
      return new Response(JSON.stringify({ ok: true, request: state.requests.find((item) => item.requestId === body.requestId), revision: 2 }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: false, code: "PB_API_OPERATION_UNSUPPORTED" }), { status: 400 });
  }) as unknown as typeof fetch;
  return { state, fetchImpl };
}

function Harness({ fetchImpl, notices }: { fetchImpl: typeof fetch; notices: string[] }) {
  const review = useComponentReview({ enabled: true, scopeHeaders: () => ({ "x-sirkit-project-id": "p" }), boardInstanceId: "board", components: COMPONENTS, fetchImpl, onNotice: (message) => notices.push(message) });
  return <ComponentReviewPanel review={review} />;
}

afterEach(() => cleanup());

describe("ComponentReviewPanel + useComponentReview (B16-C.2)", () => {
  it("an editor sees every exact candidate, requests review for one and for all, and the durable state comes back from the server", async () => {
    const server = fakeServer({ viewer: EDITOR, requests: [] });
    const notices: string[] = [];
    render(<Harness fetchImpl={server.fetchImpl} notices={notices} />);
    await waitFor(() => expect(screen.getByTestId("component-review-viewer").textContent).toContain("pcb_editor · may request"));
    expect(screen.getByTestId("review-state-U1").getAttribute("data-state")).toBe("none");
    expect(screen.queryByTestId("review-approve-U1")).toBeNull(); // no reviewer controls for an editor
    await act(async () => { fireEvent.click(screen.getByTestId("review-request-U1")); });
    await waitFor(() => expect(screen.getByTestId("review-state-U1").getAttribute("data-state")).toBe("pending"));
    expect(server.state.calls.filter((call) => call.operation === "request_atomic_review")).toHaveLength(1);
    expect(screen.getByTestId("component-review-pending").textContent).toBe("1 pending");
    expect(screen.getByTestId("review-withdraw-U1")).toBeTruthy(); // the requester may withdraw their own request
    await act(async () => { fireEvent.click(screen.getByTestId("review-request-all")); });
    await waitFor(() => expect(screen.getByTestId("review-state-R1").getAttribute("data-state")).toBe("pending"));
    expect(server.state.calls.filter((call) => call.operation === "request_atomic_review").map((call) => call.componentInstanceId)).toEqual(["c-u1", "c-r1"]);
    expect(notices).toEqual([]);
  });

  it("a reviewer sees the evidence and approves; rejecting needs a reason; the decision reason is shown to the editor afterwards", async () => {
    const server = fakeServer({ viewer: REVIEWER, requests: [request(COMPONENTS[0]!, "pending"), request(COMPONENTS[1]!, "pending")] });
    const notices: string[] = [];
    render(<Harness fetchImpl={server.fetchImpl} notices={notices} />);
    await waitFor(() => expect(screen.getByTestId("component-review-viewer").textContent).toContain("reviewer · may approve"));
    fireEvent.click(screen.getByTestId("review-evidence-toggle-U1"));
    const evidence = screen.getByTestId("review-evidence-U1").textContent ?? "";
    expect(evidence).toContain("U1-MPN"); expect(evidence).toContain("Fixture Corp"); expect(evidence).toContain("NE555"); expect(evidence).toContain("Package_SO:SOIC-8"); expect(evidence).toContain("pads 1"); expect(evidence).toContain("map:1");
    expect((screen.getByTestId("review-reject-R1") as HTMLButtonElement).disabled).toBe(true); // reject needs a reason
    fireEvent.change(screen.getByTestId("review-reason-R1"), { target: { value: "wrong tolerance" } });
    expect((screen.getByTestId("review-reject-R1") as HTMLButtonElement).disabled).toBe(false);
    await act(async () => { fireEvent.click(screen.getByTestId("review-approve-U1")); });
    await waitFor(() => expect(screen.getByTestId("review-state-U1").getAttribute("data-state")).toBe("approved"));
    await act(async () => { fireEvent.click(screen.getByTestId("review-reject-R1")); });
    await waitFor(() => expect(screen.getByTestId("review-state-R1").getAttribute("data-state")).toBe("rejected"));
    expect(screen.getByTestId("review-row-R1").textContent).toContain("wrong tolerance");
    const resolves = server.state.calls.filter((call) => call.operation === "resolve_review_request");
    expect(resolves.map((call) => call.decision)).toEqual(["approve", "reject"]);
    expect(resolves[1]!.reason).toBe("wrong tolerance");
  });

  it("a refusal is bounded and visible with its code; a retired request shows why", async () => {
    const server = fakeServer({ viewer: EDITOR, requests: [request(COMPONENTS[1]!, "retired", { retirement: { retiredAt: "2026-09-09T13:00:00.000Z", reasonCode: "REQUESTER_ROLE_CHANGED", detail: "The requester's role changed." } })] });
    server.state.refuse = { status: 403, code: "PB_REVIEW_REQUEST_FORBIDDEN" };
    const notices: string[] = [];
    render(<Harness fetchImpl={server.fetchImpl} notices={notices} />);
    await waitFor(() => expect(screen.getByTestId("review-state-R1").getAttribute("data-state")).toBe("retired"));
    expect(screen.getByTestId("review-row-R1").textContent).toContain("The requester's role changed.");
    await act(async () => { fireEvent.click(screen.getByTestId("review-request-U1")); });
    await waitFor(() => expect(screen.getByTestId("component-review-error").textContent).toContain("PB_REVIEW_REQUEST_FORBIDDEN"));
    expect(notices.some((message) => message.includes("PB_REVIEW_REQUEST_FORBIDDEN"))).toBe(true);
    expect(screen.getByTestId("review-state-U1").getAttribute("data-state")).toBe("none");
  });
});
