// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { materializeAssignment } from "@/app/lib/assignment-queue/materializer";
import { sourceBundle } from "@/app/lib/assignment-queue/__tests__/fixtures";
import { AssignmentQueuePanel } from "../AssignmentQueuePanel";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const scope = { tenantId: "tenant-1", projectId: "project-1", branchId: "main", assemblyVariantId: "variant-default" };
const queueResponse = (items: unknown[]) => new Response(JSON.stringify({ ok: true, items, nextCursor: null }), { status: 200 });
const plan = { planId: "assignment-plan:test", planDigest: "aq1-plan", expectedOutcome: "Owner commits and revalidation follows.", operations: [{ operationId: "operation-1", owner: "stage1", action: "select", beforeRevision: "1" }], warnings: [] };
// Click an element the instant it lands in the DOM: the MutationObserver callback is a MICROTASK after the
// commit that rendered it, so the click is processed before React's scheduler (a MessageChannel macrotask)
// flushes that commit's passive effects. That is the window a real click lands in, and the window in which a
// reset run as a passive effect would discard it. Deliberately not `fireEvent`, which wraps the dispatch in
// `act` and would flush those effects first.
const clickOnAppearance = <T extends Element>(selector: string) => new Promise<T>((resolve) => {
  const click = (element: T) => { element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); resolve(element); };
  const present = document.querySelector<T>(selector); if (present) return click(present);
  const observer = new MutationObserver(() => { const element = document.querySelector<T>(selector); if (element) { observer.disconnect(); click(element); } });
  observer.observe(document.body, { childList: true, subtree: true });
});

describe("physical assignment workbench", () => {
  it("does not preselect a candidate and requires preview plus explicit exact-plan confirmation", { timeout: 20_000 }, async () => {
    const item = materializeAssignment(sourceBundle()).item!;
    const calls: Array<{ url: string; body?: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input), body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : undefined; calls.push({ url, body });
      if (!init?.method) return queueResponse([item]);
      if (body?.operation === "preview") return new Response(JSON.stringify({ ok: true, plan }), { status: 200 });
      if (body?.operation === "commit") return new Response(JSON.stringify({ ok: true, result: { status: "revalidation_pending", auditIds: ["audit-1"], warnings: [], boardChanged: false } }), { status: 200 });
      return new Response(JSON.stringify({ ok: false }), { status: 400 });
    }));
    render(<AssignmentQueuePanel scope={scope} onClose={vi.fn()} />);
    await screen.findByText("ABC123", {}, { timeout: 15_000 });
    // The panel auto-selects the first item after loading. Its per-item state (candidate, assignee, preview,
    // confirmation, result) is reset by remounting the detail pane under key={selected.itemId}, so it is already
    // clear in the commit that first renders these candidates — nothing has to be flushed before interacting.
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
    vi.stubGlobal("fetch", vi.fn(async () => queueResponse([item])));
    render(<AssignmentQueuePanel scope={scope} onClose={vi.fn()} />);
    await screen.findByLabelText("Reviewer or group ID", {}, { timeout: 15_000 }); // the same initial-load path as above
    fireEvent.change(screen.getByLabelText("Decision reason"), { target: { value: "Send to package reviewer." } });
    const assign = screen.getByRole("button", { name: "Assign reviewer" }) as HTMLButtonElement;
    expect(assign.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Reviewer or group ID"), { target: { value: "pcb-reviewers" } });
    expect(assign.disabled).toBe(false);
  });

  it("keeps a decision entered in the very render that first shows the auto-selected item", { timeout: 20_000 }, async () => {
    // Regression guard: the per-item reset must happen IN the commit that selects the item, never in a passive
    // effect afterwards. Nothing here flushes effects before interacting — a reset that ran late would unselect
    // the candidate, leave "Select exact candidate" disabled and no preview could ever appear.
    const item = materializeAssignment(sourceBundle()).item!;
    const calls: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : undefined; if (body) calls.push(body);
      if (!init?.method) return queueResponse([item]);
      return new Response(JSON.stringify({ ok: true, plan }), { status: 200 });
    }));
    render(<AssignmentQueuePanel scope={scope} onClose={vi.fn()} />);
    const candidate = await clickOnAppearance<HTMLInputElement>("input[type=radio]");
    await act(async () => {}); // every effect that commit scheduled now runs; the click above must survive them
    expect(candidate.checked).toBe(true);
    fireEvent.change(screen.getByLabelText("Decision reason"), { target: { value: "Chosen on the first render after load." } });
    const selectExact = screen.getByRole("button", { name: "Select exact candidate" }) as HTMLButtonElement;
    expect(selectExact.disabled).toBe(false);
    fireEvent.click(selectExact);
    await screen.findByText("Exact decision preview", {}, { timeout: 15_000 });
    expect(calls.find((call) => call.operation === "preview")?.request).toMatchObject({ selectedCandidateId: "candidate-1", reason: "Chosen on the first render after load." });
  });

  it("clears the per-item decision state when another item is selected, and keeps the decision reason", { timeout: 20_000 }, async () => {
    const first = materializeAssignment(sourceBundle()).item!, second = { ...first, itemId: `${first.itemId}:second`, componentId: "component-2", referenceDesignator: "J2", displayName: "Header" };
    vi.stubGlobal("fetch", vi.fn(async () => queueResponse([first, second])));
    render(<AssignmentQueuePanel scope={scope} onClose={vi.fn()} />);
    await screen.findByRole("button", { name: /J2/ }, { timeout: 15_000 });
    fireEvent.click(screen.getByRole("radio"));
    fireEvent.change(screen.getByLabelText("Reviewer or group ID"), { target: { value: "pcb-reviewers" } });
    fireEvent.change(screen.getByLabelText("Decision reason"), { target: { value: "Same audit note for the whole review pass." } });
    fireEvent.click(screen.getByRole("button", { name: /J2/ }));
    expect((screen.getByRole("radio") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText("Reviewer or group ID") as HTMLInputElement).value).toBe("");
    expect((screen.getByRole("button", { name: "Assign reviewer" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("Decision reason") as HTMLTextAreaElement).value).toBe("Same audit note for the whole review pass."); // not per item, as before
  });
});
