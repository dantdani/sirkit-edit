/**
 * [PR-L6, 2026-10-19] Runbook M.4 / M.5 item 7 (OD-253 item 8): the PCB editor refuses qualification and release IN THE PAGE while the
 * durable board is behind the schematic, shows the persistent notice beside the route-stale notice, and reports the journey fact - all
 * derived from facts (the schematic prop and the authoritative board record), never a sticky flag.
 *
 *  - the pure gate (`manufacturingGateRefusal`) answers null with no drift and a sentence naming the parts with drift;
 *  - source pins on app/components/pcb/PcbEditor.tsx (rendering the editor in jsdom is out of scope, as the PR-C pins): the drift memo
 *    reads `boardSchematicDrift(schematic, authoritativeRecord?.board ...)` and is skipped for the demo board; `handleQualify` asks the
 *    gate BEFORE the POST to /api/pcb/qualify; `performVerifiedRelease` asks it BEFORE `manufacturing.requestRelease()`; both handlers
 *    list the memo in their dependencies (a stale closure would gate on an old schematic); the notice is plain text (no control) next
 *    to the route-stale banner; the journey fact carries the drift count;
 *  - the edits are in place (the import rides line 164, so no cited line below it moves);
 *  - the manufacturing panel's own Request release (it calls `workflow.requestRelease` directly) and its Authorize release are disabled
 *    with the drift as the visible reason - the editor passes the same notice to the panel.
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createEmptyBoard, type PcbBoard } from "@/app/lib/pcb/types";
import type { SchematicState } from "@/lib/schematic-types";
import { boardBehindSchematicNotice, boardSchematicDrift, manufacturingGateRefusal } from "@/app/lib/pcb-sync/schematic-drift";
import { ManufacturingWorkflowPanel } from "@/app/components/pcb/ManufacturingWorkflowPanel";
import type { UseManufacturingWorkflowResult } from "@/app/components/pcb/hooks/useManufacturingWorkflow";

const source = readFileSync("app/components/pcb/PcbEditor.tsx", "utf8").replace(/\r\n/g, "\n");
const between = (start: string, end: string): string => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error(`section not found: ${start} … ${end}`);
  return source.slice(from, to);
};
const handleQualify = between("const handleQualify = useCallback(", "const performVerifiedRelease = useCallback(");
const performVerifiedRelease = between("const performVerifiedRelease = useCallback(", "const handleRelease = useCallback(");

function synced(identity: { footprintAssetVersionId: string; mappingCertificateId: string; symbolAssetVersionId: string }): PcbBoard {
  return { ...createEmptyBoard(), footprints: [{ id: "c-d1", ref: "D1", footprintId: identity.footprintAssetVersionId, def: { libName: "L", name: "F", attributes: { smd: true, throughHole: false, excludeFromPos: false, excludeFromBom: false }, pads: [], graphics: [], bodyBBox: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, models: [], rawSexpr: "" }, at: { x: 0, y: 0 }, rotationDeg: 0, side: "top", padNets: {}, syncIdentity: { componentInstanceId: "c-d1", bindingRevisionId: "b", footprintContentDigest: "sha256:x", syncPlanId: "p", ...identity } }] };
}
const sheet = (identity: { footprintAssetVersionId: string; mappingCertificateId: string; symbolAssetVersionId: string } | null): SchematicState => ({ components: [], wires: [], netLabels: [], kicadComponents: [{ id: "c-d1", partId: "p", x: 0, y: 0, rotation: 0, refDes: "D1", value: "", ...(identity ? { atomicPartRevisionId: "rev", ...identity } : {}) }] });
const A = { footprintAssetVersionId: "fp-a", mappingCertificateId: "map-a", symbolAssetVersionId: "sym-a" };

describe("[PR-L6 M.5-7] the in-page manufacturing gate", () => {
  it("1. the pure gate: no drift -> no refusal; drift -> both actions refused by name, nothing sent", () => {
    expect(manufacturingGateRefusal("qualify", boardSchematicDrift(sheet(A), synced(A)))).toBeNull();
    expect(manufacturingGateRefusal("release", boardSchematicDrift(sheet(A), synced(A)))).toBeNull();
    const undone = boardSchematicDrift(sheet(null), synced(A));
    expect(manufacturingGateRefusal("qualify", undone)).toBe("Qualification refused: the board is behind the schematic (D1 (without an exact part in the schematic)). Run Prepare PCB first so the board carries the schematic's exact parts; nothing was sent.");
    expect(manufacturingGateRefusal("release", boardSchematicDrift(sheet({ ...A, footprintAssetVersionId: "fp-b" }), synced(A)))).toBe("Release refused: the board is behind the schematic (D1 (replaced in the schematic)). Run Prepare PCB first so the board carries the schematic's exact parts; nothing was sent.");
  });

  it("2. the drift is a memo of the schematic prop and the AUTHORITATIVE board record (skipped for the demo board), never state of its own", () => {
    expect(source).toContain("const schematicDrift = useMemo(() => (init.demo ? null : boardSchematicDrift(schematic, authoritativeRecord?.board ?? null)), [init.demo, schematic, authoritativeRecord]);");
    expect(source).not.toMatch(/useState<[^>]*SchematicDrift/); // no sticky flag
    expect(source.match(/boardSchematicDrift\(/g)).toHaveLength(1);
  });

  it("3. handleQualify asks the gate after the board check and BEFORE the qualification POST; release asks it BEFORE requestRelease; both depend on the memo", () => {
    const gate = handleQualify.indexOf('manufacturingGateRefusal("qualify", schematicDrift)');
    expect(gate).toBeGreaterThan(handleQualify.indexOf("if (!authorityRef.current)"));
    expect(gate).toBeLessThan(handleQualify.indexOf('fetch("/api/pcb/qualify"'));
    expect(handleQualify).toContain("if (driftRefusal) { setToast(driftRefusal); return; }");
    expect(handleQualify).toContain("bumpManufacturingTruth, schematicDrift]);");
    const releaseGate = performVerifiedRelease.indexOf('manufacturingGateRefusal("release", schematicDrift)');
    expect(releaseGate).toBeGreaterThan(performVerifiedRelease.indexOf("if (!manufacturing.canRequestRelease)"));
    expect(releaseGate).toBeLessThan(performVerifiedRelease.indexOf("manufacturing.requestRelease();"));
    expect(performVerifiedRelease).toContain("if (driftRefusal) return { ok: false, message: driftRefusal };");
    expect(performVerifiedRelease).toContain("}, [syncIdentity, releasing, manufacturing, schematicDrift]);");
  });

  it("4. the notice is plain text beside the route-stale banner (no control); the journey fact carries the drift count", () => {
    const banner = between('data-testid="route-stale-banner"', "[PR-C F-08] the refusal that outlives the toast");
    expect(banner).toContain('data-testid="board-behind-schematic-banner"');
    expect(banner).toContain("{boardBehindNotice}");
    const notice = between("{boardBehindNotice && (", "/* [PR-L6, 2026-10-19] beside the route-stale notice");
    expect(notice).not.toMatch(/<button|<Button|onClick/);
    // [PR-L6, 2026-10-19] it never covers an action: no pointer events, and stacked BELOW the z-30 action panels (the Missing parts list,
    // the stackup preview) - measured in the e2e, where the centred notice intercepted "Find a replacement in the library"
    expect(notice).toContain("pointer-events-none absolute");
    expect(notice).toContain(" z-20 ");
    expect(source).toContain('<div className="absolute top-2 right-2 z-30 w-[24rem] max-w-[calc(100%-1rem)] max-h-[70%] overflow-auto">'); // the Missing parts list above it
    expect(source).toContain("const journeyBoardBehind = schematicDrift?.items.length ?? 0;");
    expect(source).toContain("released: journeyReleased, boardBehindSchematic: journeyBoardBehind });");
    expect(source).toContain("journeyRoutingStale, journeyReleased, journeyBoardBehind]);");
  });

  it("5. the edits are in place: the import rides line 164, so no cited line below it moves", () => {
    expect(source.split("\n")[163]).toMatch(/^import \{ boardBehindSchematicNotice, boardSchematicDrift, manufacturingGateRefusal \} from "@\/app\/lib\/pcb-sync\/schematic-drift";.*import \{ listUnresolvedInstances, unresolvedInstancesRefusal, type UnresolvedInstance \} from "@\/app\/lib\/pcb-sync\/unresolved-instances"; \/\/ \[PR-C F-08\]/);
  });

  // [PR-L6, 2026-10-19] the manufacturing panel's OWN "Request release" calls `workflow.requestRelease` directly (it never passes through
  // performVerifiedRelease), and its "Authorize release" posts /api/pcb/release: both are refused while the board is behind the schematic.
  it("6. the manufacturing panel's Request release is disabled with the drift as its reason, Authorize release too; the editor passes the notice", () => {
    const workflow = {
      hydration: { status: "loaded", at: 0, boardRevision: "pcb2-routed", boardDigest: "pb1-routed", truth: null },
      truth: { snapshot: null, integrity: { authority: "ok", snapshot: "ok", latestRelease: "ok", codes: [] }, viewer: { role: "project_admin", actorKind: "human", canRelease: true }, authority: { revision: 3, recordDigest: "sha256:authority-3", boardRevision: "pcb2-routed", current: true }, latestRelease: null },
      workflow: { state: "qualified", scope: { tenantId: "local", projectId: "p", branchId: "main" }, identity: { boardRevision: "pcb2-routed" }, pendingOperationKey: null, pendingReview: null, lastError: null, history: [] },
      releasing: false, releaseConfirmation: null, releaseResult: null, error: null, canRequestRelease: true, releaseCapability: { allowed: true, reason: null },
      requestRelease: () => undefined, cancelRelease: () => undefined, authorizeRelease: async () => undefined, retry: async () => undefined, refresh: async () => undefined,
    } as unknown as UseManufacturingWorkflowResult;
    const requestButton = (html: string): string => html.match(/<button[^>]*data-testid="p2g-request-release"[^>]*>/)![0];
    const render = (boardBehindNotice?: string | null) => renderToStaticMarkup(createElement(ManufacturingWorkflowPanel, { workflow, qualifying: false, canQualify: true, onQualify: () => undefined, ...(boardBehindNotice !== undefined ? { boardBehindNotice } : {}) }));
    expect(requestButton(render())).not.toContain('disabled=""');
    expect(requestButton(render(null))).not.toContain('disabled=""');
    const notice = boardBehindSchematicNotice(boardSchematicDrift(sheet(null), synced(A)))!;
    const blocked = requestButton(render(notice));
    expect(blocked).toContain('disabled=""');
    expect(blocked).toContain(`title="Release blocked — The board is behind the schematic: 1 part(s) differ - D1 (without an exact part in the schematic).`);
    // the confirmation dialog renders in a portal: its Authorize button and reason are pinned in the source
    const panel = readFileSync("app/components/pcb/ManufacturingWorkflowPanel.tsx", "utf8").replace(/\r\n/g, "\n");
    expect(panel).toContain('disabled={pending || !canRequestRelease || !releaseCapability.allowed || routeStaleNotice !== null || boardBehindNotice !== null} title={releaseTitle}');
    expect(panel).toContain('onClick={() => void workflow.authorizeRelease()} disabled={releasing || boardBehindNotice !== null}>');
    expect(panel).toContain('data-testid="p2g-release-board-behind">Release blocked — {boardBehindNotice}</p>}');
    // the editor hands the same fact-derived notice to the panel
    expect(between("<ManufacturingWorkflowPanel", "/>")).toContain("routeStaleNotice={routeStaleNotice} boardBehindNotice={boardBehindNotice}");
  });

  // [PR-L6, 2026-10-19] the journey names Prepare PCB as the one next action while the board is behind the schematic; the page's
  // Prepare PCB request ran only while NO board existed, so that action was a silent no-op on exactly the board it is offered for
  // (measured in e2e/m4-existing-board-resolution.spec.ts step 4). It now runs the button's preparation for a board behind the
  // schematic too - never for a board that is current (no drift), and never while a run is in flight; applying stays a click.
  it("7. the page's Prepare PCB request runs the button's preparation for a board behind the schematic, never for a current board", () => {
    const effect = between("const syncRequestSeenRef = useRef(0);", "// [PR-F fA] \"Missing parts\" from the page");
    expect(effect).toContain("if ((state.board !== null && (schematicDrift?.items.length ?? 0) === 0) || ownedBusy.syncing) return;");
    expect(effect).toContain("void handleSync({ centerNewParts: true, spreadOverlaps: true });"); // exactly what the button's click runs
    expect(source).toContain('onClick={() => void handleSync({ centerNewParts: true, spreadOverlaps: true })}');
    expect(effect).toContain("}, [syncRequestToken, state.board, ownedBusy.syncing, handleSync, schematicDrift]);");
    expect(effect).not.toMatch(/applySyncPlan|handleApply/); // the request never applies a plan
  });
});
