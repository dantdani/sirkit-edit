// @vitest-environment jsdom
/**
 * [B23-B1] The provider panel in the manufacturing workflow (runbook :976-977; OD-166): it names the provider and purpose, lists
 * the files and fields a preview says would leave, and states that no provider is enabled in B23. Preview and commit are two
 * separate controls: a commit exists only for a previewed plan and sends that exact plan (its id, digest and an idempotency key)
 * with the opt-in header; one click never sends a commit. The server decides everything; the panel shows what it answers.
 *
 * The transport is a fake `fetchImpl`. Nothing is written to disk and nothing leaves the process.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderExchangePanel, PROVIDER_EXCHANGE_CHOICES } from "@/app/components/pcb/ProviderExchangePanel";
import { ManufacturingWorkflowPanel } from "@/app/components/pcb/ManufacturingWorkflowPanel";
import type { UseManufacturingWorkflowResult } from "@/app/components/pcb/hooks/useManufacturingWorkflow";

const SCOPE = { tenantId: "local", projectId: "p2g", branchId: "main", designId: "design:p2g", boardId: "board:p2g" };
const AUTHORITY = { revision: 3, recordDigest: "sha256:authority-record-digest" };
const PLAN = {
  schema: "sirkit.provider-exchange-plan.v1",
  planId: "provider-exchange-plan:0123456789abcdef0123456789abcdef",
  planDigest: "dw1-plan",
  purpose: "quote",
  provider: { providerId: "jlcpcb", displayName: "JLCPCB", operationId: "pcb-quote", operationName: "PCB API: real-time quotations", descriptorVersion: "1.0.0", descriptorDigest: "dw1-descriptor" },
  release: { releaseId: "mfg-release-0123456789abcdef0123456789abcdef", archiveSha256: "a".repeat(64), manifestContentDigest: "mfg-manifest-1", filename: "sirkit-board-p2g.zip" },
  authority: { revision: 3, recordDigest: AUTHORITY.recordDigest, boardRevision: "pcb2-routed", boardDigest: "pcb-authority-x" },
  outbound: {
    files: [{ path: "gerber/board-p2g.GTL", role: "copper_top", kind: "gerber", mediaType: "application/vnd.gerber", bytes: 1234, sha256: "b".repeat(64) }, { path: "gerber/board-p2g-pth-1-2.xnc", role: "pth_drill", kind: "xnc", mediaType: "text/plain", bytes: 321, sha256: "c".repeat(64) }],
    manifest: { path: "sirkit-outbound-manifest.json", bytes: 512, sha256: "d".repeat(64) },
    metadata: { schema: "sirkit.provider-outbound-manifest.v1", releaseId: "mfg-release-0123456789abcdef0123456789abcdef", archiveSha256: "a".repeat(64), capabilityProfile: { profileId: "jlcpcb-2l", version: 2 }, files: [] },
    fields: ["schema", "releaseId", "archiveSha256", "capabilityProfile.profileId", "capabilityProfile.version", "files[].path"],
    withheldFiles: ["gerber/README.txt", "gerber/release-manifest.json"],
    // [B23-B1 review, 2026-10-04] security-1 / coverage-1: the server's plan names an id whose value leaves as carried, never as kept
    withheldFields: ["tenantId", "branchId", "designId", "actor"],
    carried: [
      { field: "projectId", value: "p2g", form: "as-is", names: ["gerber/board-p2g-pth-1-2.xnc", "gerber/board-p2g.GTL"], bytes: ["gerber/board-p2g.GTL", "sirkit-outbound-manifest.json"] },
      { field: "boardId", value: "board-p2g", form: "file-safe", names: ["gerber/board-p2g-pth-1-2.xnc", "gerber/board-p2g.GTL"], bytes: ["gerber/board-p2g.GTL", "sirkit-outbound-manifest.json"] },
    ],
    embedded: [
      { field: "G04", value: "Sirkit native Gerber X2/X3", paths: ["gerber/board-p2g.GTL"] },
      { field: "TF.GenerationSoftware", value: "Sirkit,Sirkit Fab Compiler,0.1.0", paths: ["gerber/board-p2g-pth-1-2.xnc", "gerber/board-p2g.GTL"] },
      { field: "TF.ProjectId", value: "board-p2g,11111111-2222-5333-8444-555555555555,rev-p2g", paths: ["gerber/board-p2g.GTL"] },
      { field: "TO.N", value: "/root/GND", paths: ["gerber/board-p2g.GTL"] },
    ],
    outboundPackageDigest: "mfg-outbound-e",
  },
  requestDigest: "dw1-request",
  admission: { admitted: false, refusal: "provider_not_admitted", message: "JLCPCB pcb-quote (dfm_quote_transfer) is not admitted: B23 admits no provider for a transfer or an order (no owner account, OD-160)." },
  createdAt: "2026-10-03T12:00:00.000Z",
  expiresAt: "2026-10-03T12:10:00.000Z",
};
const PURCHASE_WORDING = /add to cart|checkout|\bbuy\b|place (an )?order|purchase order|order now|project cart|populate your cart/i;

function transport() {
  const calls: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> = [];
  const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({ url: String(url), headers: { ...(init?.headers as Record<string, string>) }, body });
    if (body.operation === "preview") return Response.json({ ok: true, operation: "preview", sent: false, plan: PLAN });
    return Response.json({ ok: false, code: "PX_PROVIDER_NOT_ADMITTED", error: "The provider is not admitted for this exchange: no provider is enabled in B23 (no owner account). Nothing was sent.", refusal: "provider_not_admitted", sent: false, planId: PLAN.planId, correlationId: "corr-1" }, { status: 409 });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

afterEach(() => { cleanup(); });

describe("[B23-B1] the provider panel: preview, then a separate commit of the exact plan", () => {
  it("1. it names the provider and purpose, offers only the reviewed board-file exchanges and states that no provider is enabled in B23; no request is made on render", () => {
    const { fetchImpl, calls } = transport();
    render(<ProviderExchangePanel scope={SCOPE} authority={AUTHORITY} canAct fetchImpl={fetchImpl} newKey={() => "key-1"} />);
    expect(screen.getByTestId("p2g-provider-notice").textContent).toMatch(/No provider is enabled in B23/);
    const options = [...(screen.getByTestId("p2g-provider-choice") as HTMLSelectElement).options].map((option) => option.textContent);
    expect(options).toEqual(PROVIDER_EXCHANGE_CHOICES.map((choice) => choice.label));
    expect(options[0]).toMatch(/JLCPCB.*quote/i);
    expect(calls).toEqual([]);
    expect((screen.getByTestId("p2g-provider-commit") as HTMLButtonElement).disabled).toBe(true);
  });

  it("2. preview sends exactly one preview request with the scope selectors and the confirmed authority, and lists every file, field and identity the server answered; the commit control appears enabled only now", async () => {
    const { fetchImpl, calls } = transport();
    render(<ProviderExchangePanel scope={SCOPE} authority={AUTHORITY} canAct fetchImpl={fetchImpl} newKey={() => "key-1"} />);
    fireEvent.click(screen.getByTestId("p2g-provider-preview"));
    await waitFor(() => expect(screen.getByTestId("p2g-provider-plan")).toBeTruthy());
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("/api/pcb/provider-exchange");
    expect(calls[0]!.body).toEqual({ operation: "preview", designId: SCOPE.designId, boardId: SCOPE.boardId, expectedAuthorityRevision: 3, expectedAuthorityDigest: AUTHORITY.recordDigest, providerId: "jlcpcb", operationId: "pcb-quote", purpose: "quote" });
    expect(calls[0]!.headers).toMatchObject({ "content-type": "application/json", "x-sirkit-tenant-id": "local", "x-sirkit-project-id": "p2g", "x-sirkit-branch-id": "main" });
    expect(Object.keys(calls[0]!.headers)).not.toContain("x-sirkit-provider-exchange-commit");
    const plan = screen.getByTestId("p2g-provider-plan").textContent ?? "";
    for (const expected of ["JLCPCB", "pcb-quote", "quote", "gerber/board-p2g.GTL", "1234", "b".repeat(64), "gerber/board-p2g-pth-1-2.xnc", "sirkit-outbound-manifest.json", "capabilityProfile.profileId", "files[].path", "mfg-release-0123456789abcdef0123456789abcdef", "a".repeat(64), "dw1-request", "mfg-outbound-e", "2026-10-03T12:10:00.000Z", "gerber/README.txt", "tenantId", "provider_not_admitted"]) expect(plan, expected).toContain(expected);
    expect((screen.getByTestId("p2g-provider-commit") as HTMLButtonElement).disabled).toBe(false);
  });

  it("3. commit is its own control: it sends the exact plan's id and digest with an idempotency key and the opt-in header, and shows the server's refusal - nothing was sent", async () => {
    const { fetchImpl, calls } = transport();
    render(<ProviderExchangePanel scope={SCOPE} authority={AUTHORITY} canAct fetchImpl={fetchImpl} newKey={() => "key-1"} />);
    fireEvent.click(screen.getByTestId("p2g-provider-preview"));
    await waitFor(() => expect(screen.getByTestId("p2g-provider-plan")).toBeTruthy());
    expect(calls).toHaveLength(1);
    fireEvent.click(screen.getByTestId("p2g-provider-commit"));
    await waitFor(() => expect(screen.getByTestId("p2g-provider-result").textContent).toMatch(/provider_not_admitted/));
    expect(calls).toHaveLength(2);
    expect(calls[1]!.body).toEqual({ operation: "commit", planId: PLAN.planId, planDigest: PLAN.planDigest, idempotencyKey: "key-1" });
    expect(calls[1]!.headers).toMatchObject({ "x-sirkit-provider-exchange-commit": "send_exact_plan", "x-sirkit-project-id": "p2g" });
    expect(screen.getByTestId("p2g-provider-result").textContent).toMatch(/Nothing was sent/);
    // the plan is spent: commit is disabled until the next preview
    expect((screen.getByTestId("p2g-provider-commit") as HTMLButtonElement).disabled).toBe(true);
  });

  it("4. a viewer the server says may not act sees both controls disabled with the reason; no request is ever made", () => {
    const { fetchImpl, calls } = transport();
    render(<ProviderExchangePanel scope={SCOPE} authority={AUTHORITY} canAct={false} fetchImpl={fetchImpl} newKey={() => "key-1"} />);
    expect((screen.getByTestId("p2g-provider-preview") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("p2g-provider-commit") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("p2g-provider-preview").getAttribute("title")).toMatch(/project administrator/i);
    fireEvent.click(screen.getByTestId("p2g-provider-preview"));
    expect(calls).toEqual([]);
  });

  it("5. changing the provider discards the previewed plan (its commit is disabled again) and nothing is sent; the copy carries no purchase wording", async () => {
    const { fetchImpl, calls } = transport();
    render(<ProviderExchangePanel scope={SCOPE} authority={AUTHORITY} canAct fetchImpl={fetchImpl} newKey={() => "key-1"} />);
    fireEvent.click(screen.getByTestId("p2g-provider-preview"));
    await waitFor(() => expect(screen.getByTestId("p2g-provider-plan")).toBeTruthy());
    expect(PURCHASE_WORDING.test(document.body.textContent ?? "")).toBe(false);
    fireEvent.change(screen.getByTestId("p2g-provider-choice"), { target: { value: "3" } });
    expect(screen.queryByTestId("p2g-provider-plan")).toBeNull();
    expect((screen.getByTestId("p2g-provider-commit") as HTMLButtonElement).disabled).toBe(true);
    expect(calls).toHaveLength(1);
    expect(PURCHASE_WORDING.test(document.body.textContent ?? "")).toBe(false);
  });
});

/** [B23-B1 review, 2026-10-04] A transport that answers each call in turn (a plan, a refusal, a throw, or an unreadable body). */
function sequence(answers: Array<"plan" | "refused" | "throws" | "garbled">) {
  const operations: string[] = [];
  const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    operations.push(String((JSON.parse(String(init?.body)) as Record<string, unknown>).operation));
    const answer = answers[Math.min(operations.length - 1, answers.length - 1)];
    if (answer === "throws") throw new TypeError("Failed to fetch");
    if (answer === "garbled") return new Response("<html>bad gateway</html>", { status: 502 });
    if (answer === "refused") return Response.json({ ok: false, code: "MFG_AUTHORITY_CONFIRMATION_MISMATCH", error: "The confirmed authority is not the current one.", correlationId: "corr-2" }, { status: 409 });
    return Response.json({ ok: true, operation: "preview", sent: false, plan: PLAN });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, operations };
}
const PANEL_AUTHORITY = { revision: 3, recordDigest: AUTHORITY.recordDigest, boardRevision: "pcb2-routed", boardDigest: "pb1-routed", schematicRevision: "schematic:abc", schematicDigest: "sha256:sch", componentAuthorityDigest: "qualification-authority-abc", fabricationProfileId: "jlcpcb-2l", qualifiedAt: "2026-10-03T12:00:00.000Z", actor: "u-editor", current: true };
const PANEL_RELEASE = { releaseId: "mfg-release-0123456789abcdef", archiveSha256: "a".repeat(64), manifestContentDigest: "mfg-manifest-1", filename: "sirkit-board-p2g.zip", authorityRecordDigest: AUTHORITY.recordDigest, authorityRevision: 3, boardRevision: "pcb2-routed", actor: "u-admin", releasedAt: "2026-10-03T12:30:00.000Z", current: true };
/** [B23-B1 review, 2026-10-04] The workflow panel's input as the hook answers it, with the truth and viewer a case names. */
function workflowOf(truth: { authority: typeof PANEL_AUTHORITY | null; latestRelease: typeof PANEL_RELEASE | null } | null, options: { snapshot?: boolean; allowed?: boolean } = {}): UseManufacturingWorkflowResult {
  const allowed = options.allowed ?? true;
  return {
    hydration: { status: "loaded", at: 0, boardRevision: "pcb2-routed", boardDigest: "pb1-routed", truth: null },
    truth: truth ? { snapshot: null, integrity: { authority: "ok", snapshot: "ok", latestRelease: "ok", codes: [] }, viewer: { role: allowed ? "project_admin" : "pcb_editor", actorKind: "human", canRelease: allowed }, ...truth } : null,
    workflow: options.snapshot === false ? null : { state: "released", scope: SCOPE, identity: { boardRevision: "pcb2-routed" }, pendingOperationKey: null, pendingReview: null, lastError: null, history: [] },
    releasing: false,
    releaseConfirmation: null,
    releaseResult: null,
    error: null,
    canRequestRelease: true,
    releaseCapability: { allowed, reason: allowed ? null : "Only a project administrator can authorize a manufacturing release." },
    requestRelease: () => undefined,
    cancelRelease: () => undefined,
    authorizeRelease: async () => undefined,
    retry: async () => undefined,
    refresh: async () => undefined,
  } as unknown as UseManufacturingWorkflowResult;
}

describe("[B23-B1 review, 2026-10-04] a refused or failed preview, the panel's mounting, and what the plan says leaves", () => {
  it("6. a refused preview after a good one discards the shown plan: no plan, commit disabled, the server's code shown, and no commit request is ever made (tests-7)", async () => {
    const { fetchImpl, operations } = sequence(["plan", "refused"]);
    render(<ProviderExchangePanel scope={SCOPE} authority={AUTHORITY} canAct fetchImpl={fetchImpl} newKey={() => "key-1"} />);
    fireEvent.click(screen.getByTestId("p2g-provider-preview"));
    await waitFor(() => expect(screen.getByTestId("p2g-provider-plan")).toBeTruthy());
    fireEvent.click(screen.getByTestId("p2g-provider-preview"));
    await waitFor(() => expect(screen.getByTestId("p2g-provider-result").textContent).toMatch(/MFG_AUTHORITY_CONFIRMATION_MISMATCH/));
    expect(screen.queryByTestId("p2g-provider-plan")).toBeNull();
    expect((screen.getByTestId("p2g-provider-commit") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("p2g-provider-commit"));
    expect(operations).toEqual(["preview", "preview"]);
  });

  it("7. a preview whose request never completes, or whose answer cannot be read, is shown as such and leaves no plan to commit (tests-7)", async () => {
    for (const [failure, code, text] of [["throws", "PX_CLIENT_TRANSPORT", /did not complete: Failed to fetch/], ["garbled", "PX_UNKNOWN", /gave no reason/]] as const) {
      const { fetchImpl, operations } = sequence(["plan", failure]);
      render(<ProviderExchangePanel scope={SCOPE} authority={AUTHORITY} canAct fetchImpl={fetchImpl} newKey={() => "key-1"} />);
      fireEvent.click(screen.getByTestId("p2g-provider-preview"));
      await waitFor(() => expect(screen.getByTestId("p2g-provider-plan")).toBeTruthy());
      fireEvent.click(screen.getByTestId("p2g-provider-preview"));
      await waitFor(() => expect(screen.getByTestId("p2g-provider-result").textContent, failure).toContain(code));
      expect(screen.getByTestId("p2g-provider-result").textContent, failure).toMatch(text);
      expect(screen.queryByTestId("p2g-provider-plan"), failure).toBeNull();
      expect((screen.getByTestId("p2g-provider-commit") as HTMLButtonElement).disabled, failure).toBe(true);
      expect(operations, failure).toEqual(["preview", "preview"]);
      cleanup();
    }
  });

  it("8. the workflow panel mounts the provider panel only for a CURRENT ledgered release of a CURRENT authority (OD-183 (h)); a viewer the server says may not release sees its preview disabled (coverage-3, tests-3)", () => {
    const mounted = (workflow: UseManufacturingWorkflowResult) => {
      render(<ManufacturingWorkflowPanel workflow={workflow} qualifying={false} canQualify onQualify={() => undefined} />);
      const shown = screen.queryByTestId("p2g-provider-panel") !== null;
      const previewDisabled = shown ? (screen.getByTestId("p2g-provider-preview") as HTMLButtonElement).disabled : null;
      cleanup();
      return { shown, previewDisabled };
    };
    expect(mounted(workflowOf({ authority: PANEL_AUTHORITY, latestRelease: PANEL_RELEASE }))).toEqual({ shown: true, previewDisabled: false });
    expect(mounted(workflowOf({ authority: PANEL_AUTHORITY, latestRelease: PANEL_RELEASE }, { allowed: false }))).toEqual({ shown: true, previewDisabled: true });
    const hidden = { shown: false, previewDisabled: null };
    expect(mounted(workflowOf({ authority: { ...PANEL_AUTHORITY, current: false }, latestRelease: PANEL_RELEASE })), "a stale authority").toEqual(hidden);
    expect(mounted(workflowOf({ authority: PANEL_AUTHORITY, latestRelease: { ...PANEL_RELEASE, current: false } })), "a stale release").toEqual(hidden);
    expect(mounted(workflowOf({ authority: PANEL_AUTHORITY, latestRelease: null })), "no release").toEqual(hidden);
    expect(mounted(workflowOf({ authority: null, latestRelease: PANEL_RELEASE })), "no authority").toEqual(hidden);
    expect(mounted(workflowOf({ authority: PANEL_AUTHORITY, latestRelease: PANEL_RELEASE }, { snapshot: false })), "no workflow").toEqual(hidden);
    expect(mounted(workflowOf(null)), "no truth").toEqual(hidden);
  });

  it("9. next to the fields that would leave, the panel lists the Sirkit identifiers whose value leaves inside file names or bytes and every metadata field the files carry; 'kept in Sirkit' lists only what the server says stays (security-1, coverage-1)", async () => {
    const { fetchImpl } = transport();
    render(<ProviderExchangePanel scope={SCOPE} authority={AUTHORITY} canAct fetchImpl={fetchImpl} newKey={() => "key-1"} />);
    fireEvent.click(screen.getByTestId("p2g-provider-preview"));
    await waitFor(() => expect(screen.getByTestId("p2g-provider-plan")).toBeTruthy());
    const carried = screen.getByTestId("p2g-provider-carried").textContent ?? "";
    for (const entry of PLAN.outbound.carried) for (const text of [entry.field, entry.value, ...entry.names, ...entry.bytes]) expect(carried, text).toContain(text);
    const embedded = screen.getByTestId("p2g-provider-embedded").textContent ?? "";
    for (const entry of PLAN.outbound.embedded) for (const text of [entry.field, entry.value]) expect(embedded, text).toContain(text);
    const kept = screen.getByTestId("p2g-provider-kept").textContent ?? "";
    for (const text of [...PLAN.outbound.withheldFiles, ...PLAN.outbound.withheldFields]) expect(kept, text).toContain(text);
    for (const entry of PLAN.outbound.carried) expect(kept, entry.field).not.toContain(entry.field);
    expect(PURCHASE_WORDING.test(document.body.textContent ?? "")).toBe(false);
  });
});
