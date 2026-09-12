// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { materializeAssignment } from "@/app/lib/assignment-queue/materializer";
import { sourceBundle } from "@/app/lib/assignment-queue/__tests__/fixtures";
import { AssignmentQueuePanel } from "../AssignmentQueuePanel";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const scope = { tenantId: "tenant-1", projectId: "project-1", branchId: "main", assemblyVariantId: "variant-default" };

describe("physical assignment workbench", () => {
  it("does not preselect a candidate and requires preview plus explicit exact-plan confirmation", { timeout: 20_000 }, async () => {
    const item = materializeAssignment(sourceBundle()).item!;
    const calls: Array<{ url: string; body?: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input), body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : undefined; calls.push({ url, body });
      if (!init?.method) return new Response(JSON.stringify({ ok: true, items: [item], nextCursor: null }), { status: 200 });
      if (body?.operation === "preview") return new Response(JSON.stringify({ ok: true, plan: { planId: "assignment-plan:test", planDigest: "aq1-plan", expectedOutcome: "Owner commits and revalidation follows.", operations: [{ operationId: "operation-1", owner: "stage1", action: "select", beforeRevision: "1" }], warnings: [] } }), { status: 200 });
      if (body?.operation === "commit") return new Response(JSON.stringify({ ok: true, result: { status: "revalidation_pending", auditIds: ["audit-1"], warnings: [], boardChanged: false } }), { status: 200 });
      return new Response(JSON.stringify({ ok: false }), { status: 400 });
    }));
    render(<AssignmentQueuePanel scope={scope} onClose={vi.fn()} />);
    await screen.findByText("ABC123", {}, { timeout: 15_000 });
    // The panel auto-selects the first item after loading and resets its per-item state (candidate, preview, confirmation) in
    // an effect keyed on the selection. Flush that effect before interacting: a click that lands first is wiped. A loaded broad
    // run showed exactly that (the candidate unchecked, the reason typed, "Select exact candidate" still disabled, so no preview
    // could ever appear); the longer waits added earlier never addressed it. Each interaction is now checked as it happens.
    await act(async () => {});
    const candidate = screen.getByRole("radio") as HTMLInputElement;
    expect(candidate.checked).toBe(false);
    fireEvent.click(candidate);
    expect(candidate.checked).toBe(true);
    fireEvent.change(screen.getByLabelText("Decision reason"), { target: { value: "Reviewed exact package and mapping evidence." } });
    const selectExact = screen.getByRole("button", { name: "Select exact candidate" }) as HTMLButtonElement;
    expect(selectExact.disabled).toBe(false);
    fireEvent.click(selectExact);
    // The preview renders after the mocked decision round trip (alone the whole test takes about 0.3 s).
    await screen.findByText("Exact decision preview", {}, { timeout: 15_000 });
    const commit = screen.getByRole("button", { name: "Commit exact plan" }) as HTMLButtonElement;
    expect(commit.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(commit.disabled).toBe(false);
    fireEvent.click(commit);
    await waitFor(() => expect(calls.filter((call) => call.body?.operation === "commit")).toHaveLength(1));
    const previewRequest = calls.find((call) => call.body?.operation === "preview")?.body?.request as Record<string, unknown>, committedRequest = calls.find((call) => call.body?.operation === "commit")?.body?.request as Record<string, unknown>;
    expect(previewRequest.mode).toBe("preview");
    expect(committedRequest).toMatchObject({ mode: "commit", planId: "assignment-plan:test", planDigest: "aq1-plan" });
    expect(screen.getByText(/Board changed: no/)).toBeTruthy();
  });

  it("requires an explicit assignee for the reviewer assignment action", { timeout: 20_000 }, async () => {
    const item = materializeAssignment(sourceBundle()).item!;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, items: [item], nextCursor: null }), { status: 200 })));
    render(<AssignmentQueuePanel scope={scope} onClose={vi.fn()} />);
    await screen.findByLabelText("Reviewer or group ID", {}, { timeout: 15_000 }); // the same initial-load path as above
    await act(async () => {}); // the same per-item reset as above: flush it before interacting
    fireEvent.change(screen.getByLabelText("Decision reason"), { target: { value: "Send to package reviewer." } });
    const assign = screen.getByRole("button", { name: "Assign reviewer" }) as HTMLButtonElement;
    expect(assign.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Reviewer or group ID"), { target: { value: "pcb-reviewers" } });
    expect(assign.disabled).toBe(false);
  });
});
