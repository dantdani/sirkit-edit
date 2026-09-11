// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { materializeAssignment } from "@/app/lib/assignment-queue/materializer";
import { sourceBundle } from "@/app/lib/assignment-queue/__tests__/fixtures";
import { AssignmentQueuePanel } from "../AssignmentQueuePanel";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const scope = { tenantId: "tenant-1", projectId: "project-1", branchId: "main", assemblyVariantId: "variant-default" };

describe("physical assignment workbench", () => {
  it("does not preselect a candidate and requires preview plus explicit exact-plan confirmation", async () => {
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
    await screen.findByText("ABC123");
    const candidate = screen.getByRole("radio") as HTMLInputElement;
    expect(candidate.checked).toBe(false);
    fireEvent.click(candidate);
    fireEvent.change(screen.getByLabelText("Decision reason"), { target: { value: "Reviewed exact package and mapping evidence." } });
    fireEvent.click(screen.getByRole("button", { name: "Select exact candidate" }));
    // The preview renders after the mocked decision round-trip; under a broad parallel run it has taken ~1.25 s, past
    // testing-library's default one-second wait (it failed twice at 1.24-1.26 s, never alone), so the wait is explicit.
    await screen.findByText("Exact decision preview", {}, { timeout: 5_000 });
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

  it("requires an explicit assignee for the reviewer assignment action", async () => {
    const item = materializeAssignment(sourceBundle()).item!;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, items: [item], nextCursor: null }), { status: 200 })));
    render(<AssignmentQueuePanel scope={scope} onClose={vi.fn()} />);
    await screen.findByLabelText("Reviewer or group ID");
    fireEvent.change(screen.getByLabelText("Decision reason"), { target: { value: "Send to package reviewer." } });
    const assign = screen.getByRole("button", { name: "Assign reviewer" }) as HTMLButtonElement;
    expect(assign.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Reviewer or group ID"), { target: { value: "pcb-reviewers" } });
    expect(assign.disabled).toBe(false);
  });
});
