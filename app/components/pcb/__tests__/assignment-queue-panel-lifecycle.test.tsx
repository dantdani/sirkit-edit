// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { materializeAssignment } from "@/app/lib/assignment-queue/materializer";
import { sourceBundle } from "@/app/lib/assignment-queue/__tests__/fixtures";
import type { PhysicalAssignmentItem } from "@/app/lib/assignment-queue/types";
import { AssignmentQueuePanel } from "../AssignmentQueuePanel";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const scope = { tenantId: "tenant-1", projectId: "project-1", branchId: "main", assemblyVariantId: "variant-default" };
const reason = "Reviewed the package and pin mapping.";
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => { resolve = settle; });
  return { promise, resolve };
}
function queueItem(id: string, ref: string, mpn: string): PhysicalAssignmentItem {
  const base = materializeAssignment(sourceBundle()).item!;
  return { ...base, itemId: id, referenceDesignator: ref, candidateSet: base.candidateSet.map((candidate) => ({ ...candidate, exactPart: candidate.exactPart ? { ...candidate.exactPart, exactMpn: mpn } : undefined })) };
}
const queueResponse = (items: PhysicalAssignmentItem[]) => new Response(JSON.stringify({ ok: true, items, nextCursor: null }), { status: 200 });
const previewResponse = (outcome: string, planId = "assignment-plan:lifecycle") => new Response(JSON.stringify({ ok: true, plan: { planId, planDigest: "aq1-plan", expectedOutcome: outcome, operations: [], warnings: [] } }), { status: 200 });
function chooseCandidate() {
  fireEvent.click(screen.getByRole("radio"));
  fireEvent.change(screen.getByLabelText("Decision reason"), { target: { value: reason } });
}

describe("assignment queue request and selection lifetime", () => {
  it("ignores a late project-A list response after project B is selected, even if fetch ignores abort", async () => {
    const oldPage = deferred<Response>(), oldItem = queueItem("old-item", "J_A", "PART-A"), newItem = queueItem("new-item", "J_B", "PART-B");
    const nextScope = { ...scope, projectId: "project-2" };
    newItem.projectId = nextScope.projectId;
    let oldSignal: AbortSignal | null | undefined;
    const projects: string[] = [];
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      const project = new Headers(init?.headers).get("x-sirkit-project-id")!;
      projects.push(project);
      if (project === scope.projectId) { oldSignal = init?.signal; return oldPage.promise; }
      return Promise.resolve(queueResponse([newItem]));
    }));
    const view = render(<AssignmentQueuePanel scope={scope} onClose={vi.fn()} />);
    await waitFor(() => expect(projects).toEqual([scope.projectId]));
    view.rerender(<AssignmentQueuePanel scope={nextScope} onClose={vi.fn()} />);
    await screen.findByText("PART-B");
    chooseCandidate();
    expect(oldSignal?.aborted).toBe(true);
    await act(async () => { oldPage.resolve(queueResponse([oldItem])); });
    expect(screen.queryByText("PART-A")).toBeNull();
    expect(screen.getByText("PART-B")).toBeTruthy();
    expect((screen.getByRole("radio") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Decision reason") as HTMLTextAreaElement).value).toBe(reason);
    expect(projects).toEqual([scope.projectId, nextScope.projectId]);
  });

  it("never adopts a delayed preview from a previously selected item", async () => {
    const first = queueItem("first-item", "J1", "PART-1"), second = queueItem("second-item", "J2", "PART-2"), stalePreview = deferred<Response>();
    const requests: Array<{ itemId: string }> = [];
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method) return Promise.resolve(queueResponse([first, second]));
      const body = JSON.parse(String(init.body)) as { operation: string; request: { itemId: string } };
      expect(body.operation).toBe("preview");
      requests.push(body.request);
      return requests.length === 1 ? stalePreview.promise : Promise.resolve(previewResponse("Preview belongs to J2", "assignment-plan:J2"));
    }));
    render(<AssignmentQueuePanel scope={scope} onClose={vi.fn()} />);
    await screen.findByText("PART-1");
    chooseCandidate();
    fireEvent.click(screen.getByRole("button", { name: "Select exact candidate" }));
    await waitFor(() => expect(requests).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: /^J2/ }));
    await screen.findByText("PART-2");
    expect((screen.getByRole("radio") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText("Decision reason") as HTMLTextAreaElement).value).toBe(reason);
    fireEvent.click(screen.getByRole("radio"));
    await act(async () => { stalePreview.resolve(previewResponse("Stale J1 preview", "assignment-plan:J1")); });
    expect(screen.queryByText("Stale J1 preview")).toBeNull();
    expect(screen.queryByText("Exact decision preview")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect((screen.getByRole("radio") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("button", { name: "Select exact candidate" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Select exact candidate" }));
    await screen.findByText("Preview belongs to J2");
    expect(requests.map((request) => request.itemId)).toEqual([first.itemId, second.itemId]);
  });

  it("retains a same-revision draft during refresh and resets decisions when the revision changes", async () => {
    const initial = queueItem("one-item", "J1", "PART-1"), sameRevision = deferred<Response>();
    const changed = { ...initial, itemRevision: initial.itemRevision + 1, itemDigest: `${initial.itemDigest}:updated` };
    const previewRequests: Array<{ expectedItemRevision: number; expectedItemDigest: string }> = [];
    let listCalls = 0;
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method) {
        listCalls++;
        return listCalls === 2 ? sameRevision.promise : Promise.resolve(queueResponse([listCalls === 1 ? initial : changed]));
      }
      const body = JSON.parse(String(init.body)) as { operation: string; request: { expectedItemRevision: number; expectedItemDigest: string } };
      expect(body.operation).toBe("preview");
      previewRequests.push(body.request);
      return Promise.resolve(previewResponse(`Revision ${body.request.expectedItemRevision} preview`));
    }));
    render(<AssignmentQueuePanel scope={scope} onClose={vi.fn()} />);
    await screen.findByText("PART-1");
    chooseCandidate();
    fireEvent.change(screen.getByLabelText("Reviewer or group ID"), { target: { value: "package-reviewers" } });
    fireEvent.click(screen.getByRole("button", { name: "Select exact candidate" }));
    await screen.findByText("Exact decision preview");
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Refresh assignment queue" }));
    await waitFor(() => expect(listCalls).toBe(2));
    const assertDraftRetained = () => {
      expect((screen.getByRole("radio") as HTMLInputElement).checked).toBe(true);
      expect((screen.getByLabelText("Decision reason") as HTMLTextAreaElement).value).toBe(reason);
      expect((screen.getByLabelText("Reviewer or group ID") as HTMLInputElement).value).toBe("package-reviewers");
      expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
      expect((screen.getByRole("button", { name: "Commit exact plan" }) as HTMLButtonElement).disabled).toBe(false);
    };
    assertDraftRetained();
    await act(async () => { sameRevision.resolve(queueResponse([structuredClone(initial)])); });
    assertDraftRetained();
    fireEvent.click(screen.getByRole("button", { name: "Refresh assignment queue" }));
    await waitFor(() => expect(screen.queryByText("Exact decision preview")).toBeNull());
    expect(listCalls).toBe(3);
    expect((screen.getByRole("radio") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText("Reviewer or group ID") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Decision reason") as HTMLTextAreaElement).value).toBe(reason);
    expect(screen.queryByRole("checkbox")).toBeNull();
    chooseCandidate();
    fireEvent.click(screen.getByRole("button", { name: "Select exact candidate" }));
    await screen.findByText(`Revision ${changed.itemRevision} preview`);
    expect(previewRequests.map((request) => [request.expectedItemRevision, request.expectedItemDigest])).toEqual([[initial.itemRevision, initial.itemDigest], [changed.itemRevision, changed.itemDigest]]);
  });
});
