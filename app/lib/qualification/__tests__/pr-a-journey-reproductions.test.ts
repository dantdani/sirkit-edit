/**
 * [PR-A] Product reliability, checkpoint A: the confirmed defects of the prompt-to-PCB user journey, reproduced against the
 * unmodified code and pinned as expected failures (`it.fails`) before any load-bearing edit. Each `it.fails` case states the
 * contract the fix must meet; the checkpoint that fixes it (C: request and status contracts, E: the interface in place) turns
 * the case into an ordinary `it`. A case that already passes here is a false reproduction and fails this suite.
 *
 * What is pinned (artifacts/product-reliability-simple-ui/reproductions.md holds the browser evidence):
 *  1. Theory mode: `lib/apply-netlist.ts::generateSchematic` posts `/api/schematic` with only a content type and no
 *     AbortSignal, and the route's canonical wrapper refuses it with 400 AUTH_PROJECT_SELECTOR_REQUIRED before any provider
 *     work (CONFIRMED in the browser on 2026-10-14: the chat shows "A project selector is required."). The server-side half
 *     is an ordinary `it`: the wrapper is right and must stay; the client is what changes.
 *  2. Build mode: `/api/schematic/build-multi` answers `ok: true` when a subsystem block failed, naming the omission only in
 *     prose, and its post-merge electrical check is advisory and skipped on exception without a structured status.
 *  3. The composer: the "ask" route renders no submit control (`showComposerButton`), the chat panel starts closed while the
 *     empty sheet says "Describe a circuit above".
 *  4. Dead and placeholder controls: the header Settings button has no handler; the top-level 3D tab renders the literal
 *     "3D view" while the real `PcbPreview3D` is mounted only by the PCB editor's preview sheet.
 *  5. Decorative checks: the Build sidebar renders unconditional `<CheckRow ok ...>` rows that no validation computes.
 *  6. The PCB sync entry returns without feedback when the client or the scope is absent (`if (!client || !syncIdentity) return;`).
 *
 * Files are read as text; nothing is written; no provider, database or process work (the route case mocks the provider loop).
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { injectAuthorizedPrincipal, resetInjectedIdentity } from "@/app/lib/auth/test-support";

const page = readFileSync("app/page.tsx", "utf8");
const theoryClient = readFileSync("lib/apply-netlist.ts", "utf8");
const pcbEditor = readFileSync("app/components/pcb/PcbEditor.tsx", "utf8");
const buildMulti = readFileSync("app/api/schematic/build-multi/route.ts", "utf8");

const SEL = { "x-sirkit-tenant-id": "local", "x-sirkit-project-id": "proj-1", "x-sirkit-branch-id": "main" };
const generate = vi.fn();
const buildLoop = vi.fn();
vi.mock("@/app/lib/llm/router", () => ({ llmRouter: { generate: (...args: unknown[]) => generate(...args) } }));
vi.mock("@/app/lib/build-loop", () => ({ runBuildToolLoop: (...args: unknown[]) => buildLoop(...args) }));
vi.mock("@/app/lib/parts-search", () => ({ getPartsByIds: async () => [] }));

afterEach(() => { resetInjectedIdentity(); generate.mockReset(); buildLoop.mockReset(); });

describe("[PR-A 1] the Theory request contract", () => {
  it("the request the Theory client sends today is refused by the server before any provider work (the wrapper is right)", async () => {
    const { POST } = await import("@/app/api/schematic/route");
    injectAuthorizedPrincipal({ userId: "editor-1", tenantId: "local", projectId: "proj-1", role: "editor" });
    // exactly lib/apply-netlist.ts's request: a content type, the body, no selector, no signal
    const res = await POST(new Request("http://localhost/api/schematic", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost" }, body: JSON.stringify({ prompt: "make a schematic for a 555 LED blinker", provider: "openai" }) }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, code: "AUTH_PROJECT_SELECTOR_REQUIRED" });
    expect(generate).not.toHaveBeenCalled();
  });

  // [PR-C] fixed: lib/apply-netlist.ts prepares its request through app/lib/project/ai-request.ts and takes the lifecycle signal
  it("the Theory client sends the project selector the wrapper requires (through the shared request preparation)", () => {
    expect(theoryClient).toMatch(/aiRequestHeaders\(options\.scope\)/);
    expect(page).toMatch(/generateSchematic\(prompt, \{ scope, signal: scope\.signal/);
  });

  it("the Theory client passes a cancellation signal so a project switch aborts the request", () => {
    expect(theoryClient).toMatch(/signal: options\.signal/);
  });
});

describe("[PR-A 2] the Build request's partial and skipped results", () => {
  // [PR-C] fixed: app/api/schematic/build-multi/route.ts answers the structured contract of app/lib/schematic/build-result.ts
  it("a failed subsystem block is reported as structured status, not only in prose", async () => {
    const { POST } = await import("@/app/api/schematic/build-multi/route");
    injectAuthorizedPrincipal({ userId: "editor-1", tenantId: "local", projectId: "proj-1", role: "editor" });
    generate.mockResolvedValueOnce({ toolCalls: [{ name: "submit_plan", input: { blocks: [{ name: "Power", brief: "a", sharedNets: ["VCC"] }, { name: "Blinker", brief: "b", sharedNets: ["VCC"] }], rationale: "two blocks" } }], text: "", stopReason: "tool_use" });
    buildLoop
      .mockResolvedValueOnce({ ok: true, netlist: { components: [], nets: [], explanation: "power" }, explanation: "power" })
      .mockResolvedValueOnce({ ok: false, error: "the block's design loop ended without a submission", status: 500 });
    const res = await POST(new Request("http://localhost/api/schematic/build-multi", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...SEL }, body: JSON.stringify({ prompt: "build a blinker with its own supply" }) }));
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body).toMatchObject({ status: "partial", omittedBlocks: ["Blinker"] });
  });

  it("a skipped post-merge electrical check is a structured 'not run' status, never silence", () => {
    expect(buildMulti).toMatch(/electricalCheck/);
    expect(buildMulti).toMatch(/state: "skipped"/);
  });
});

describe("[PR-A 3] the composer's visible route and submission", () => {
  // [PR-C] fixed: the control renders for every route with text; its label names the route's action ("Send" for ask)
  it("every composer route has a visible submit control (the ask route included)", () => {
    expect(page).not.toMatch(/const showComposerButton = composerAction !== "ask" \|\| isGenerating \|\| isEditing;/);
    expect(page).toMatch(/const showComposerButton = Boolean\(composerText\) \|\| isGenerating \|\| isEditing;/);
    expect(page).toMatch(/data-testid="composer-submit"/);
    expect(page).toMatch(/: "Send";/);
  });

  // [PR-E] fixed: the empty sheet carries the circuit-entry action itself (opens the chat and focuses the composer)
  it("the empty sheet's circuit-entry hint does not point above a closed chat panel", () => {
    expect(page).not.toMatch(/Describe a circuit above, or pick a tool from the toolbar/);
    expect(page).toMatch(/data-testid="empty-sheet-describe-circuit"/);
    expect(page).toMatch(/onClick=\{\(\) => handleJourneyAction\("describe_circuit"\)\}/);
  });
});

describe("[PR-A 4] dead and placeholder controls", () => {
  // [PR-E] fixed: a labelled button opens the workspace settings dialog (sheet size, AI brain, autonomy, runtime)
  it("the header Settings button has a handler or is withheld with a reason", () => {
    expect(page).not.toMatch(/<Button size="sm" variant="ghost" className="text-zinc-300">\s*<Settings className="size-3\.5" \/>\s*<\/Button>/);
    expect(page).toMatch(/aria-label="Workspace settings" data-testid="workspace-settings" onClick=\{\(\) => setSettingsOpen\(true\)\}/);
    expect(page).toMatch(/data-testid="workspace-settings-dialog"/);
  });

  // [PR-E] fixed: the 3D tab presents the PCB editor's own preview (one renderer) or says why none exists
  it("the 3D workspace tab renders the existing preview or an accurate unavailable state, never a placeholder literal", () => {
    expect(page).not.toMatch(/\{view === "3d"\s+&& "3D view"\}/);
    expect(page).toMatch(/presentation=\{view === "3d" \? "3d" : "editor"\}/);
    expect(pcbEditor).toMatch(/data-testid="pcb-3d-pane"/);
    expect(pcbEditor).toMatch(/data-testid="pcb-3d-unavailable"/);
    expect((pcbEditor.match(/<PcbPreview3D /g) ?? []).length).toBe(2); // the side sheet and the 3D presentation, never mounted together
  });
});

describe("[PR-A 5] decorative design checks", () => {
  // [PR-E] fixed: the rows render computeDesignChecks' real states (pass / findings / not run with the reason)
  it("no design-check row is an unconditional pass", () => {
    expect(page).not.toMatch(/<CheckRow ok label="No floating nets" \/>/);
    expect(page).not.toMatch(/<CheckRow ok label="Supply rails connected" \/>/);
    expect(page).toMatch(/computeDesignChecks\(authoritativeSchematic, parts, schematicStateDigest\(authoritativeSchematic\), mode\)/);
    expect(page).toMatch(/data-testid=\{`design-check-\$\{check\.id\}`\} data-state=\{check\.state\}/);
  });
});

describe("[PR-A 6] the PCB sync entry never returns without feedback", () => {
  // [PR-C] fixed: PcbEditor.tsx names the reason (demo scope / scope unavailable) and the unresolved instances before any server call
  it("an absent sync client or scope is reported to the user, not swallowed", () => {
    expect(pcbEditor).not.toMatch(/if \(!client \|\| !syncIdentity\) return;/);
    expect(pcbEditor).toMatch(/listUnresolvedInstances\(/);
    expect(pcbEditor).toMatch(/data-testid="sync-readiness-panel"/);
  });
});
