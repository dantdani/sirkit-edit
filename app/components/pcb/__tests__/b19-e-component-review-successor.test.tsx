// @vitest-environment jsdom
/**
 * [B19-E E5 h] The component review panel shows each bound revision's catalog status and, for a withdrawn revision that names
 * a successor, previews the upgrade diff; a reviewer or administrator rebinds with a reason and the previewed digest (Rebind
 * stays disabled, with the reason shown, while the diff has blockers or no reason is written). An editor may preview but is
 * told that rebinding is a reviewer's act. The server decides everything again.
 *
 * [B19-E E5 review] Preview successor is offered only while the component's approved binding is the withdrawn revision (the
 * server refuses every other move): once rebound, the panel names the schematic replacement that remains; with no approved
 * binding it names that remedy. A named successor that was itself withdrawn is previewed at the first selectable revision of
 * its chain. The review requests, and the PCB sync's bind, carry the placed instance's symbol version.
 *
 * Reproduced on the unchanged code: the hook read no status and the panel had no successor controls.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComponentReviewPanel } from "../ComponentReviewPanel";
import { atomicBindRequestBody, reviewableComponentOf, useComponentReview, type ReviewableComponent } from "../hooks/useComponentReview";

const COMPONENTS: ReviewableComponent[] = [
  { id: "c-u1", refDes: "U1", atomicPartRevisionId: "rev-old", symbolAssetVersionId: "sym-old" },
  { id: "c-r1", refDes: "R1", atomicPartRevisionId: "rev-revoked" },
  { id: "c-c1", refDes: "C1", atomicPartRevisionId: "rev-current" },
];
const EDITOR = { actorId: "u-editor", role: "pcb_editor", actorKind: "human", canRequest: true, canResolve: false };
const REVIEWER = { actorId: "u-reviewer", role: "reviewer", actorKind: "human", canRequest: true, canResolve: true };
type StatusView = { revisionId: string; state: string; selectable: boolean; pinnable: boolean; successorRevisionId: string | null; selectableSuccessorRevisionId: string | null; since: string | null };
const STATUSES: StatusView[] = [
  { revisionId: "rev-old", state: "superseded", selectable: false, pinnable: true, successorRevisionId: "rev-new", selectableSuccessorRevisionId: "rev-new", since: "2026-09-13T00:00:00.000Z" },
  { revisionId: "rev-revoked", state: "revoked", selectable: false, pinnable: false, successorRevisionId: null, selectableSuccessorRevisionId: null, since: "2026-09-13T00:00:00.000Z" },
  { revisionId: "rev-current", state: "published", selectable: true, pinnable: true, successorRevisionId: null, selectableSuccessorRevisionId: null, since: null },
];
const DIGEST = `sha256:${"d".repeat(64)}`;

function fakeServer(viewer: typeof EDITOR, options: { blockers?: string[]; statuses?: StatusView[]; effective?: Record<string, string | null> } = {}) {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const statuses = options.statuses ?? STATUSES;
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push({ url: String(url), body });
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
    if (String(url) === "/api/components/revision-status") return json({ ok: true, statuses: statuses.filter((status) => (body.revisionIds as string[]).includes(status.revisionId)) });
    if (body.operation === "list_review_requests") return json({ ok: true, viewer, membershipVerified: true, requests: [] });
    // by default each component's approved binding is the revision it names
    if (body.operation === "list_effective_atomic_selections") return json({ ok: true, selections: (body.componentInstanceIds as string[]).map((id) => ({ componentInstanceId: id, atomicPartRevisionId: options.effective && id in options.effective ? options.effective[id] : COMPONENTS.find((component) => component.id === id)!.atomicPartRevisionId })) });
    if (body.operation === "preview_atomic_successor") return json({ ok: true, preview: { fromRevisionId: body.fromRevisionId, toRevisionId: body.toRevisionId, fromStatus: "superseded", toStatus: "published", setId: "set-1", bindingRevisionId: "b:r4", diff: { fromRevisionId: body.fromRevisionId, toRevisionId: body.toRevisionId, impacts: ["footprint_geometry_change"], invalidates: ["placement", "routing"], safeForAutomaticMetadataRefresh: false, blockers: options.blockers ?? [] }, diffDigest: DIGEST } });
    if (body.operation === "rebind_atomic_successor") return json({ ok: true, rebind: { setId: "set-1", supersededBindingRevisionId: "b:r4", bindingRevisionId: "n:r4", lifecycleState: "selected", alreadyBound: false, diffDigest: DIGEST } }, 201);
    return json({ ok: false, code: "PB_API_OPERATION_UNSUPPORTED" }, 400);
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

function Harness({ fetchImpl, catalogStatus = true }: { fetchImpl: typeof fetch; catalogStatus?: boolean }) {
  const review = useComponentReview({ enabled: true, scopeHeaders: () => ({ "x-sirkit-project-id": "p" }), boardInstanceId: "board", components: COMPONENTS, fetchImpl, catalogStatus });
  return <ComponentReviewPanel review={review} />;
}

afterEach(() => cleanup());

describe("[B19-E E5 h] ComponentReviewPanel successor review", () => {
  it("reads the catalog status of the bound revisions and labels withdrawn ones; a published one is unmarked", async () => {
    const server = fakeServer(REVIEWER);
    render(<Harness fetchImpl={server.fetchImpl} />);
    await waitFor(() => expect(screen.getByTestId("review-catalog-status-U1").textContent).toMatch(/superseded/i));
    expect(screen.getByTestId("review-catalog-status-U1").textContent).toContain("rev-new");
    expect(screen.getByTestId("review-catalog-status-R1").textContent).toMatch(/revoked.*no successor/i);
    expect(screen.queryByTestId("review-catalog-status-C1")).toBeNull();
    expect(screen.queryByTestId("review-successor-preview-R1")).toBeNull();
    const statusCall = server.calls.find((call) => call.url === "/api/components/revision-status")!;
    expect([...(statusCall.body.revisionIds as string[])].sort()).toEqual(["rev-current", "rev-old", "rev-revoked"]);
  });

  it("a reviewer previews the diff, writes a reason and rebinds with the previewed digest", async () => {
    const server = fakeServer(REVIEWER);
    render(<Harness fetchImpl={server.fetchImpl} />);
    const previewButton = await screen.findByTestId("review-successor-preview-U1");
    await act(async () => { fireEvent.click(previewButton); });
    const diff = await screen.findByTestId("review-successor-diff-U1");
    expect(diff.textContent).toContain("footprint_geometry_change");
    expect(diff.textContent).toContain("placement");
    expect(server.calls.find((call) => call.body.operation === "preview_atomic_successor")!.body).toEqual({ operation: "preview_atomic_successor", componentInstanceId: "c-u1", boardInstanceId: "board", fromRevisionId: "rev-old", toRevisionId: "rev-new" });
    const rebind = screen.getByTestId("review-successor-rebind-U1") as HTMLButtonElement;
    expect(rebind.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("review-successor-reason-U1"), { target: { value: "move to the reissued revision" } });
    expect((screen.getByTestId("review-successor-rebind-U1") as HTMLButtonElement).disabled).toBe(false);
    await act(async () => { fireEvent.click(screen.getByTestId("review-successor-rebind-U1")); });
    await waitFor(() => expect(server.calls.some((call) => call.body.operation === "rebind_atomic_successor")).toBe(true));
    expect(server.calls.find((call) => call.body.operation === "rebind_atomic_successor")!.body).toEqual({ operation: "rebind_atomic_successor", componentInstanceId: "c-u1", boardInstanceId: "board", fromRevisionId: "rev-old", toRevisionId: "rev-new", diffDigest: DIGEST, reason: "move to the reissued revision" });
  });

  it("a diff with blockers keeps Rebind disabled and shows them", async () => {
    const server = fakeServer(REVIEWER, { blockers: ["target revision is deprecated"] });
    render(<Harness fetchImpl={server.fetchImpl} />);
    const previewButton = await screen.findByTestId("review-successor-preview-U1");
    await act(async () => { fireEvent.click(previewButton); });
    expect((await screen.findByTestId("review-successor-diff-U1")).textContent).toContain("target revision is deprecated");
    fireEvent.change(screen.getByTestId("review-successor-reason-U1"), { target: { value: "try anyway" } });
    expect((screen.getByTestId("review-successor-rebind-U1") as HTMLButtonElement).disabled).toBe(true);
  });

  it("an editor may preview but gets no Rebind control, only the reason it is a reviewer's act", async () => {
    const server = fakeServer(EDITOR);
    render(<Harness fetchImpl={server.fetchImpl} />);
    const previewButton = await screen.findByTestId("review-successor-preview-U1");
    await act(async () => { fireEvent.click(previewButton); });
    await screen.findByTestId("review-successor-diff-U1");
    expect(screen.queryByTestId("review-successor-rebind-U1")).toBeNull();
    expect(screen.getByTestId("review-successor-diff-U1").textContent).toMatch(/reviewer or (a project )?administrator/i);
  });

  it("without the catalog status option the hook reads no status (the panel is unchanged)", async () => {
    const server = fakeServer(REVIEWER);
    render(<Harness fetchImpl={server.fetchImpl} catalogStatus={false} />);
    await waitFor(() => expect(screen.getByTestId("component-review-viewer").textContent).toContain("reviewer"));
    expect(server.calls.some((call) => call.url === "/api/components/revision-status")).toBe(false);
    expect(server.calls.some((call) => call.body.operation === "list_effective_atomic_selections")).toBe(false);
    expect(screen.queryByTestId("review-catalog-status-U1")).toBeNull();
  });
});

describe("[B19-E E5 review] Preview successor only where the server can honour it", () => {
  it("reads the approved binding of each component on a withdrawn or unpublished revision (never a published one)", async () => {
    const server = fakeServer(REVIEWER);
    render(<Harness fetchImpl={server.fetchImpl} />);
    await screen.findByTestId("review-successor-preview-U1");
    const read = server.calls.find((call) => call.body.operation === "list_effective_atomic_selections")!;
    expect(read.body).toEqual({ operation: "list_effective_atomic_selections", boardInstanceId: "board", componentInstanceIds: ["c-u1", "c-r1"] });
  });

  it("once the binding names another revision (a rebind happened) the panel names the schematic replacement instead of a preview", async () => {
    const server = fakeServer(REVIEWER, { effective: { "c-u1": "rev-new" } });
    render(<Harness fetchImpl={server.fetchImpl} />);
    const next = await screen.findByTestId("review-successor-next-U1");
    expect(next.textContent).toContain("rev-new");
    expect(next.textContent).toMatch(/replace/i);
    expect(screen.queryByTestId("review-successor-preview-U1")).toBeNull();
  });

  it("with no approved binding on the withdrawn revision it names that remedy and offers no preview", async () => {
    const server = fakeServer(REVIEWER, { effective: { "c-u1": null } });
    render(<Harness fetchImpl={server.fetchImpl} />);
    const next = await screen.findByTestId("review-successor-next-U1");
    expect(next.textContent).toMatch(/no approved binding/i);
    expect(screen.queryByTestId("review-successor-preview-U1")).toBeNull();
  });

  it("a named successor that was itself withdrawn is previewed at the first selectable revision of its chain", async () => {
    const chained = STATUSES.map((status) => (status.revisionId === "rev-old" ? { ...status, successorRevisionId: "rev-mid", selectableSuccessorRevisionId: "rev-new" } : status));
    const server = fakeServer(REVIEWER, { statuses: chained });
    render(<Harness fetchImpl={server.fetchImpl} />);
    const previewButton = await screen.findByTestId("review-successor-preview-U1");
    expect(screen.getByTestId("review-catalog-status-U1").textContent).toContain("rev-new");
    await act(async () => { fireEvent.click(previewButton); });
    await screen.findByTestId("review-successor-diff-U1");
    expect(server.calls.find((call) => call.body.operation === "preview_atomic_successor")!.body).toMatchObject({ fromRevisionId: "rev-old", toRevisionId: "rev-new" });
  });
});

describe("[B19-E E5 review] the placed instance's symbol version travels with every review request and bind", () => {
  it("Request review and Request all send it for an instance that has one, and nothing for one that has none", async () => {
    const server = fakeServer(EDITOR);
    render(<Harness fetchImpl={server.fetchImpl} catalogStatus={false} />);
    const one = await screen.findByTestId("review-request-U1");
    await act(async () => { fireEvent.click(one); });
    await waitFor(() => expect(server.calls.some((call) => call.body.operation === "request_atomic_review")).toBe(true));
    expect(server.calls.find((call) => call.body.operation === "request_atomic_review")!.body).toMatchObject({ componentInstanceId: "c-u1", atomicPartRevisionId: "rev-old", symbolAssetVersionId: "sym-old" });
    const before = server.calls.length;
    await act(async () => { fireEvent.click(screen.getByTestId("review-request-all")); });
    await waitFor(() => expect(server.calls.slice(before).filter((call) => call.body.operation === "request_atomic_review")).toHaveLength(3));
    const all = server.calls.slice(before).filter((call) => call.body.operation === "request_atomic_review").map((call) => call.body);
    expect(all.find((body) => body.componentInstanceId === "c-u1")).toMatchObject({ symbolAssetVersionId: "sym-old" });
    expect(all.find((body) => body.componentInstanceId === "c-r1")).not.toHaveProperty("symbolAssetVersionId");
  });

  it("the PCB sync's bind body and the reviewable components come from the shared helpers, which carry the symbol", () => {
    expect(atomicBindRequestBody({ id: "c-u1", atomicPartRevisionId: "rev-old", symbolAssetVersionId: "sym-old" }, "board")).toEqual({ operation: "bind_atomic_selection", componentInstanceId: "c-u1", boardInstanceId: "board", atomicPartRevisionId: "rev-old", symbolAssetVersionId: "sym-old" });
    expect(atomicBindRequestBody({ id: "c-r1", atomicPartRevisionId: "rev-revoked" }, "board")).toEqual({ operation: "bind_atomic_selection", componentInstanceId: "c-r1", boardInstanceId: "board", atomicPartRevisionId: "rev-revoked" });
    expect(reviewableComponentOf({ id: "c-u1", refDes: "U1", atomicPartRevisionId: "rev-old", symbolAssetVersionId: "sym-old" })).toEqual(COMPONENTS[0]);
    expect(reviewableComponentOf({ id: "c-r1", refDes: "R1", atomicPartRevisionId: "rev-revoked" })).toEqual(COMPONENTS[1]);
    expect(reviewableComponentOf({ id: "c-x", refDes: "X1" })).toBeNull();
    const editor = readFileSync(join(process.cwd(), "app", "components", "pcb", "PcbEditor.tsx"), "utf8");
    expect(editor).toMatch(/\.map\(reviewableComponentOf\)/);
    expect(editor).toMatch(/body: JSON\.stringify\(atomicBindRequestBody\(k, syncIdentity\.boardId\)\)/);
    expect(editor).not.toMatch(/operation: "bind_atomic_selection"/);
  });
});
