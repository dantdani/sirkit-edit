// @vitest-environment jsdom
/**
 * [PR-B] A committed assignment decision's result outlives the per-item detail (assignment checkpoint B.2/B.3). The detail
 * is keyed to the item's revision and digest so a server-side revision bump resets stale per-item choices; the commit
 * result, however, is the panel's record of what just happened and must still be visible after the queue reloads the item
 * at its new revision (and when the resolved item leaves the open view).
 *
 * Failing first on the pending tree (2026-10-14): the result banner disappeared the moment the reload answered with
 * revision + 1 (the keyed detail remounted).
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { materializeAssignment } from "@/app/lib/assignment-queue/materializer";
import { sourceBundle } from "@/app/lib/assignment-queue/__tests__/fixtures";
import type { PhysicalAssignmentItem } from "@/app/lib/assignment-queue/types";
import { AssignmentQueuePanel } from "../AssignmentQueuePanel";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const scope = { tenantId: "tenant-1", projectId: "project-1", branchId: "main", assemblyVariantId: "variant-default" };
function queueItem(id: string, ref: string, mpn: string): PhysicalAssignmentItem {
  const base = materializeAssignment(sourceBundle()).item!;
  return { ...base, itemId: id, referenceDesignator: ref, candidateSet: base.candidateSet.map((candidate) => ({ ...candidate, exactPart: candidate.exactPart ? { ...candidate.exactPart, exactMpn: mpn } : undefined })) };
}
const queueResponse = (items: PhysicalAssignmentItem[]) => new Response(JSON.stringify({ ok: true, items, nextCursor: null }), { status: 200 });
const previewResponse = () => new Response(JSON.stringify({ ok: true, plan: { planId: "assignment-plan:commit", planDigest: "aq1-plan", expectedOutcome: "Owner commits and revalidation follows.", operations: [], warnings: [] } }), { status: 200 });
const commitResponse = () => new Response(JSON.stringify({ ok: true, result: { status: "revalidation_pending", auditIds: ["audit-1"], warnings: ["Revalidation is queued."], boardChanged: false, itemId: "one-item" } }), { status: 200 });

describe("assignment commit result lifetime", () => {
  it("keeps the committed decision's result visible after the queue reloads the item at a new revision", { timeout: 20_000 }, async () => {
    const initial = queueItem("one-item", "J1", "PART-1");
    const changed = { ...initial, itemRevision: initial.itemRevision + 1, itemDigest: `${initial.itemDigest}:committed` };
    let listCalls = 0;
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method) { listCalls++; return Promise.resolve(queueResponse([listCalls === 1 ? initial : changed])); }
      const body = JSON.parse(String(init.body)) as { operation: string };
      return Promise.resolve(body.operation === "commit" ? commitResponse() : previewResponse());
    }));
    render(<AssignmentQueuePanel scope={scope} onClose={vi.fn()} />);
    await screen.findByText("PART-1");
    await act(async () => {});
    fireEvent.click(screen.getByRole("radio"));
    fireEvent.change(screen.getByLabelText("Decision reason"), { target: { value: "Reviewed the package and pin mapping." } });
    fireEvent.click(screen.getByRole("button", { name: "Select exact candidate" }));
    await screen.findByText("Exact decision preview");
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Commit exact plan" }));
    await waitFor(() => expect(listCalls).toBe(2));
    await screen.findByText(`Item revision ${changed.itemRevision}`, { exact: false });
    expect(screen.getByText(/Board changed: no/)).toBeTruthy(); // the result survived the keyed detail's remount
    expect(screen.getByText("Revalidation is queued.")).toBeTruthy();
    expect(screen.getByText(/J1:/)).toBeTruthy();
    expect(screen.queryByText("Exact decision preview")).toBeNull(); // the stale preview did not survive it
  });
});
