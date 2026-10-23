/**
 * [PR-J3, 2026-10-22] Runbook section J increment 3 (J.3, J.8.1, J.9; OD-255 item 7, OD-257): SOURCE PINS of app/page.tsx's carriage of
 * the sheet tree and of the sheet lens wiring, with the whole-project consumers proven on the whole state.
 *
 *  1. app/page.tsx keeps its 9156 lines (every J3 edit was in place) and carries `sheets` iff present at EVERY site that rebuilds the
 *     five schematic fields: the undo snapshot type, the adoption snapshot, the lifecycle applier, the proposal content digest
 *     (OD-257 item 4), autosave, both history seeds, the projection the session opens with, the design-state watcher, the checkpoint
 *     restore, the applied AI result and the simulate body (eleven spreads, named); never the forbidden flat literal (b07-3).
 *  2. the lens wiring: the raw graph is wrapped once, the canvas is keyed by the activation (never for a single-sheet document), the
 *     editor and the SPICE legacy panel receive the lens arrays, the navigator sits beside the editor, the editor consumes the four
 *     sheet props, the Go to fallback and the scoped glyph are in place, the Go-to submit sequence is unchanged;
 *  3. the whole-project consumers (ERC / design checks, Missing parts, BOM, PCB, SPICE studio) read `authoritativeSchematic` and never
 *     the lens, and the lens is used for nothing but the canvas - proven on the fixture: the IMU sheet's lens holds 5 of 41 instances
 *     while the design checks of the whole document carry the Sheet connections check, and a lens handed over as a document is refused;
 *  4. the AI replace-result guard (OD-257 item 3) is called at the Build start (before the activity log and the task), the edit request,
 *     Tidy (before the capture), the offer and the FINAL apply boundary, in that source order;
 *  5. no new browser uuid draw: the page's crypto.randomUUID count is 6e60efa0's, and none of the lens / navigator modules draws one.
 * Source-reading plus pure functions on the committed fixture; no DOM, no network.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listUnresolvedInstances } from "@/app/lib/pcb-sync/unresolved-instances";
import { computeDesignChecks } from "@/app/lib/schematic/design-checks";
import { projectSheet } from "@/app/lib/schematic/sheet-lens";
import { fixtureParts } from "@/app/lib/schematic/__tests__/_j1-fixtures";
import { J3_ROOT_REFS, multiSheetDroneFixtureState } from "@/app/lib/schematic/__tests__/_j3-fixtures";
import { ROOT_SHEET_ID, type SchematicState } from "@/lib/schematic-types";

const ROOT = process.cwd();
const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");
const page = read("app/page.tsx");
const count = (text: string, needle: string): number => text.split(needle).length - 1;
const spread = (expr: string): string => `...(${expr}.sheets !== undefined ? { sheets: ${expr}.sheets } : {})`;
/** b24-d3's PAGE_LINES and l6-post-apply-admission's pin: every edit is in place. */
const PAGE_LINES = 9156;
/** The page's crypto.randomUUID draws at 6e60efa0 (prompt-to-gerber's fixture router replay is keyed by the browser's draws). */
const UUID_DRAWS_AT_6E60EFA0 = 36; // occurrences (one line holds two)

describe("[PR-J3] 1. app/page.tsx carries the sheet tree iff present at every site that rebuilds the schematic fields", () => {
  it("keeps its line count, is LF, and the undo snapshot type carries the tree", () => {
    expect(page.includes("\r")).toBe(false);
    expect(page.split("\n").length - 1).toBe(PAGE_LINES);
    expect(page).toContain(', type PageSize, type SchematicSheetSet } from "@/lib/schematic-types";');
    expect(page).toContain("  netLabels: NetLabel[]; sheets?: SchematicSheetSet; // [PR-J3, 2026-10-22]");
  });

  it("the eleven carriage sites, each named", () => {
    const sites: Array<[string, string]> = [
      ["adoption snapshot", `snapshot: (authoritative) => ({ components: authoritative.components, wires: authoritative.wires, kicadComponents: authoritative.kicadComponents!, netLabels: authoritative.netLabels!, ${spread("authoritative")} }),`],
      ["lifecycle applier", `const authoritative: SchematicState = { components: state.components ?? [], wires: state.wires ?? [], kicadComponents: state.kicadComponents ?? [], netLabels: state.netLabels ?? [], ...(state.pageSize ? { pageSize: state.pageSize } : {}), ${spread("state")} };`],
      ["proposal content digest (OD-257 item 4)", `const proposalContentDigest = useCallback((state: SchematicState): string => schematicStateDigest({ components: state.components ?? [], wires: state.wires ?? [], kicadComponents: state.kicadComponents ?? [], netLabels: state.netLabels ?? [], ${spread("state")} }), []);`],
      ["autosave", `state: { components: authoritative.components, wires: authoritative.wires, kicadComponents: authoritative.kicadComponents ?? [], netLabels: authoritative.netLabels ?? [], pageSize: authoritative.pageSize ?? live.pageSize, ${spread("authoritative")} },`],
      ["recovery adoption history seed", `kicadComponents: adopted.kicadComponents ?? [], netLabels: adopted.netLabels ?? [], ${spread("adopted")},`],
      ["hydration history seed", `kicadComponents: state.kicadComponents ?? [], netLabels: state.netLabels ?? [], ${spread("state")},`],
      ["projection the session opens with", `projectionForOpen: { components: state.components ?? [], wires: state.wires ?? [], kicadComponents: state.kicadComponents ?? [], netLabels: state.netLabels ?? [], pageSize: state.pageSize, ${spread("state")} },`],
      ["design-state watcher", "const snap: SchematicSnapshot = { components, wires, kicadComponents, netLabels, ...(schHistoryRef.current.present.sheets !== undefined ? { sheets: schHistoryRef.current.present.sheets } : {}) };"],
      ["checkpoint restore", `${spread("checkpoint.schematic")},`],
      ["applied AI result", `...(state.pageSize ? { pageSize: state.pageSize } : { ...(liveStateRef.current.pageSize ? { pageSize: liveStateRef.current.pageSize } : {}) }), ${spread("state")},`],
      ["simulate body", `body: JSON.stringify({ state: { components: authoritative.components, wires: authoritative.wires, netLabels: authoritative.netLabels ?? [], ${spread("authoritative")} }, analysis: analysisConfig }),`],
    ];
    for (const [name, literal] of sites) expect(count(page, literal), name).toBe(1);
    expect(count(page, ".sheets !== undefined ? { sheets:")).toBe(sites.length);
    // the undo / redo target (PR-L6 class): the tree from the snapshot, the size from the authoritative state
    expect(page).toContain("return snap ? historyStepState(snap, gestureCoordinatorRef.current?.authoritativeState()) : null;");
    expect(page).toContain("applyLifecycleSchematicProjection(historyStepState(snap, gestureCoordinatorRef.current?.authoritativeState()));");
    // b07-3's forbidden flat literal is never created
    expect(page).not.toContain("state: { components, wires, kicadComponents, netLabels, pageSize }");
  });
});

describe("[PR-J3] 2. the sheet lens wiring", () => {
  it("wraps the raw graph once and hands the canvas the active sheet", () => {
    expect(count(page, "const rawSchematicGraphApi = useMemo(() => ({")).toBe(1);
    expect(count(page, "const sheetLens = useSchematicSheetLens({ authoritative: authoritativeSchematic, graph: rawSchematicGraphApi, runSchematicCommand, projectId: project?.id ?? null, getPart: getCachedPart, components, wires, kicadComponents, netLabels, viewSessionBridge: viewSessionBridgeRef.current, selectedId, selectedKicadId, captureScope: captureSheetScope, onSheetSwitch: clearSheetSelection }); const schematicGraphApi = sheetLens.graph;")).toBe(1);
    expect(count(page, "graph={schematicGraphApi}")).toBe(1); // b07-1's adversarial anchor
    expect(count(page, "const captureSheetScope = useCallback(() => projectScopeRegistryRef.current?.capture() ?? null, []); const clearSheetSelection = useCallback(() => { setWireDraftStart(null); setSelectedId(null); setSelectedKicadId(null); }, []);")).toBe(1);
    expect(count(page, "<SchematicEditor key={sheetLens.legacy ? undefined : sheetLens.activation}")).toBe(1);
    expect(count(page, "components={sheetLens.components}")).toBe(2); // the editor and the SPICE legacy panel
    expect(count(page, "wires={sheetLens.wires}")).toBe(2);
    expect(count(page, "netLabels={sheetLens.netLabels}")).toBe(2);
    expect(count(page, "kicadComponents={sheetLens.kicadComponents}")).toBe(1);
    expect(count(page, "{...sheetLens.editorProps}")).toBe(1);
    expect(count(page, "<SheetNavigator {...sheetLens.navigatorProps} />")).toBe(1);
    // the lens is used for nothing else
    const uses = new Set([...page.matchAll(/sheetLens\.(\w+)/g)].map((match) => match[1]));
    expect([...uses].sort()).toEqual(["activation", "components", "editorProps", "graph", "kicadComponents", "legacy", "navigatorProps", "netLabels", "wires"]);
  });

  it("the editor consumes the four sheet props: a stored camera replaces the mount fit, camera writes, the block layer, Go to's fallback; the scoped glyph", () => {
    expect(page).toContain("  viewSessionBridge, initialCamera, onCameraChange, sheetLayer, onLocateElsewhere, // [PR-J3, 2026-10-22]");
    expect(page).toContain("initialCamera?: SheetCamera; onCameraChange?: (camera: SheetCamera) => void; sheetLayer?: React.ReactNode; onLocateElsewhere?: (ref: string) => boolean;");
    expect(page).toContain("const fittedForRef = useRef<PageSize | null>(initialCamera !== undefined ? pageSize : null);");
    expect(page).toContain("useState<Point>(initialCamera?.pan ?? { x: 100, y: 80 });");
    expect(page).toContain("useState(initialCamera?.zoom ?? 1);");
    expect(page).toContain("if (fittedForRef.current === pageSize) return; fittedForRef.current = pageSize; fitToPage();");
    expect(page).toContain("useEffect(() => { onCameraChange?.({ pan, zoom }); }, [pan, zoom, onCameraChange]);");
    expect(page).toContain("if (!selected.ok) { if (onLocateElsewhere?.(ref)) { setSchematicViewNotice(null); return; } setSchematicViewNotice(`${selected.code} — ${selected.message}`); return; }");
    expect(page).toContain("{sheetLayer /* [PR-J3, 2026-10-22]");
    expect(count(page, "label.scope !== undefined ? <ScopedNetLabelGlyph key={label.id} label={label} role={nets.roleAt(label.position)} zoom={zoom}")).toBe(1);
    expect(count(page, "<NetLabelGlyph")).toBe(3); // the label map's plain branch, the pending label ghost and the palette preview, as before
    // the Go-to submit sequence control-registry.ts pins (view.schematic-goto) is byte-identical
    expect(page).toContain('onSubmit={(e) => { e.preventDefault(); const ref = schematicGoTo.trim(); if (ref) void goToSchematicComponent(ref); }}');
    for (const name of ["useSchematicSheetLens", "SheetNavigator", "ScopedNetLabelGlyph", "flatReplacementRefusal, multiSheetReplaceRefusal", "type { SheetCamera }"]) expect(page, name).toContain(`import ${name.startsWith("type") ? name : `{ ${name} }`} from`);
  });
});

describe("[PR-J3] 3. the whole-project consumers read the whole state regardless of the active sheet", () => {
  it("source: ERC / design checks, Missing parts, BOM, PCB and the SPICE studio read authoritativeSchematic, never the lens", () => {
    expect(count(page, "return computeDesignChecks(authoritativeSchematic, parts, schematicStateDigest(authoritativeSchematic), mode);")).toBe(1);
    expect(count(page, "const missingPartsCount = useMemo(() => listUnresolvedInstances(authoritativeSchematic).length, [authoritativeSchematic]);")).toBe(1);
    expect(count(page, "state={authoritativeSchematic}")).toBe(1); // BomView
    expect(count(page, "schematic={authoritativeSchematic}")).toBe(1); // PcbEditor
    expect(count(page, "schematic={{ ...authoritativeSchematic, pageSize: authoritativeSchematic.pageSize ?? pageSize }}")).toBe(1); // SpiceStudio
    for (const forbidden of ["state={sheetLens", "schematic={sheetLens", "computeDesignChecks(sheetLens", "listUnresolvedInstances(sheetLens", "schematicStateDigest(sheetLens"]) expect(page, forbidden).not.toContain(forbidden);
  });

  it("fixture: the IMU lens holds 5 of 41 instances; the whole document's design checks carry Sheet connections, a flat lens state does not", () => {
    const fixture = multiSheetDroneFixtureState();
    expect(fixture.kicadComponents).toHaveLength(41);
    const imu = projectSheet(fixture, "sheet-imu");
    expect(imu.kicadComponents.map((item) => item.refDes).sort()).toEqual(["C10", "C9", "R11", "R12", "U3"]);
    expect(projectSheet(fixture, ROOT_SHEET_ID).kicadComponents.map((item) => item.refDes).sort()).toEqual([...J3_ROOT_REFS].sort());
    const parts = fixtureParts();
    const whole = computeDesignChecks(fixture, parts, "j3-whole", "build").checks.map((check) => check.id);
    expect(whole).toContain("sheet-interfaces");
    // a lens handed to a consumer as if it were the document is REFUSED (its entities name a sheet the flat state does not have):
    // the consumers must read the whole authoritative state, which is what the source pins above hold the page to
    const lensAsState: SchematicState = { components: imu.components, wires: imu.wires, kicadComponents: imu.kicadComponents, netLabels: imu.netLabels, pageSize: fixture.pageSize };
    expect(() => computeDesignChecks(lensAsState, parts, "j3-lens", "build")).toThrow(/SHEET_HIERARCHY_INVALID: SHEET_REFERENCE_INVALID/);
    expect(() => listUnresolvedInstances(lensAsState)).not.toThrow(); // a plain copy carries no brand; the page never hands it over (pinned above)
    // Missing parts is a whole-project listing: every one of the 41 instances is counted, whatever sheet is open
    expect(listUnresolvedInstances(fixture)).toEqual([]);
    expect(listUnresolvedInstances({ ...fixture, kicadComponents: fixture.kicadComponents!.map((item, index) => (index === 0 ? { ...item, atomicPartRevisionId: undefined } : item)) }).length).toBeGreaterThan(0);
  });
});

describe("[PR-J3] 4. the AI replace-result guard sits at the Build start, the edit request, Tidy, the offer and the final apply", () => {
  it("call sites and their order", () => {
    expect(count(page, "multiSheetReplaceRefusal(")).toBe(3);
    expect(count(page, "flatReplacementRefusal(")).toBe(2);
    const at = (literal: string): number => { const index = page.indexOf(literal); expect(index, literal).toBeGreaterThan(0); expect(page.indexOf(literal, index + 1), `${literal} once`).toBe(-1); return index; };
    // Build: refused before the activity log and before any task start (no task, no spend)
    const buildGuard = at("const sheetRefusal = multiSheetReplaceRefusal(gestureCoordinatorRef.current!.authoritativeState()); if (sheetRefusal !== null) { setScopedGenError(projectScopeRegistryRef.current!.capture(), sheetRefusal, 12000); return; }");
    expect(buildGuard).toBeGreaterThan(page.indexOf("  async function handleGenerateSchematic(prompt: string) {"));
    expect(buildGuard).toBeLessThan(at('const logId = startActivityLog("Generating schematic", "Preparing request", prompt);'));
    expect(buildGuard).toBeLessThan(at("const started = await startGenerationTask({ scope, clientRequestId: newGenerationClientRequestId(), prompt, provider: aiBrainRef.current,"));
    // edit: before /api/schematic/edit
    const editGuard = at("const editRefusal = multiSheetReplaceRefusal(snapshot); if (editRefusal !== null) { setScopedGenError(scope, editRefusal, 12000); return; }");
    expect(editGuard).toBeLessThan(at('const res = await fetch("/api/schematic/edit", {'));
    // tidy: before the capture and the layout-critic request
    const tidyGuard = at("const tidyRefusal = multiSheetReplaceRefusal(tidySnapshot); if (tidyRefusal !== null) { if (!auto) setScopedGenError(tidyScope, tidyRefusal, 12000); return; }");
    expect(tidyGuard).toBeLessThan(at("const image = await captureSchematicPng();"));
    expect(tidyGuard).toBeLessThan(at('const res = await fetch("/api/schematic/layout-critic", {'));
    // the offer (chat-started tasks arrive here) refuses before any proposal state exists
    const offerGuard = at("const flatRefusal = flatReplacementRefusal(gestureCoordinatorRef.current!.authoritativeState(), state); if (resultIssues.length > 0 || flatRefusal !== null) {");
    expect(offerGuard).toBeLessThan(at("setPendingReplace({ state, explanation, prompt, logId, promptAlreadyLogged: true, pin, validationNote });"));
    expect(page).toContain('failActivityLog(logId, flatRefusal !== null ? "Generated schematic would replace the project\'s sheets — nothing applied" : "Generated schematic failed validation — nothing applied");');
    // the FINAL boundary: between the applied state and the lifecycle adoption
    const finalGuard = at("const flatRefusal = flatReplacementRefusal(gestureCoordinator.authoritativeState(), appliedState); if (flatRefusal !== null) { showToast(flatRefusal); return false; }");
    expect(finalGuard).toBeGreaterThan(at("const appliedState: SchematicState = {"));
    expect(finalGuard).toBeLessThan(at("const outcome = await gestureCoordinator.adoptLifecycle({"));
  });
});

describe("[PR-J3] 5. no new browser uuid draw", () => {
  it("the page's crypto.randomUUID count is 6e60efa0's and the lens modules draw none", () => {
    expect(count(page, "crypto.randomUUID")).toBe(UUID_DRAWS_AT_6E60EFA0);
    for (const rel of ["app/components/schematic/hooks/useSchematicSheetLens.tsx", "app/components/schematic/hooks/sheet-navigation-controller.ts", "app/components/schematic/SheetNavigator.tsx", "app/components/schematic/SheetBlocksLayer.tsx", "app/components/schematic/ScopedNetLabelGlyph.tsx", "app/lib/schematic/sheet-lens.ts", "app/lib/project/sheet-navigation-store.ts", "app/lib/project/sheet-replace-guard.ts", "app/lib/project/history-step-state.ts", "app/lib/project/canonical-adoption.ts"]) {
      expect(read(rel), rel).not.toContain("randomUUID(");
    }
  });
});
