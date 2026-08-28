// @vitest-environment jsdom
/**
 * B10.1 §A — the PRODUCTION publisher seam (useEditorContextPublisher, the
 * exact hook PcbEditor mounts) rendered under React <StrictMode> with a
 * REAL EditorContextBridge and a REAL PcbBoardLifecycleOwner. This is the
 * permanent R1 regression: a source-string scan cannot prove StrictMode
 * survival — only mounting the seam can.
 */

import { describe, expect, it } from "vitest";
import React, { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EditorContextBridge, type EditorContextScope } from "../editor-context-bridge";
import { useEditorContextPublisher } from "../use-editor-context-publisher";
import { PcbBoardLifecycleOwner } from "../../pcb/lifecycle/board-lifecycle";
import { createEmptyBoard, type PcbBoard } from "../../pcb/types";
import { pcbRevisionId } from "../../pcb/revision";

const SCOPE: EditorContextScope = { tenantId: "local", projectId: "p101", branchId: "main" };
const IDENTITY = { ...SCOPE, boardId: "board:p101" };

function Host({ bridge, lifecycle, generation, working, enabled, scope }: {
  bridge: EditorContextBridge;
  lifecycle: PcbBoardLifecycleOwner;
  generation: number;
  working: { board: PcbBoard | null };
  enabled: boolean;
  scope: EditorContextScope;
}) {
  const read = useCallback(() => ({
    board: working.board,
    selection: { refs: [], primary: null },
    netlist: null,
    schematicDigest: null,
  }), [working]);
  useEditorContextPublisher({ bridge, enabled, scope, lifecycle, lifecycleGeneration: generation, read });
  return null;
}

async function mount(element: React.ReactElement): Promise<Root> {
  const root = createRoot(document.createElement("div"));
  await act(async () => { root.render(element); });
  return root;
}

describe("B10.1 §A — StrictMode-safe production publisher", () => {
  it("R1: capture SUCCEEDS after the StrictMode setup→cleanup→setup replay and returns the LATEST unsaved state.board", async () => {
    const bridge = new EditorContextBridge();
    bridge.beginProject(SCOPE);
    const lifecycle = new PcbBoardLifecycleOwner();
    lifecycle.adopt(IDENTITY);
    const working: { board: PcbBoard | null } = { board: createEmptyBoard() };
    const root = await mount(
      <StrictMode>
        <Host bridge={bridge} lifecycle={lifecycle} generation={0} working={working} enabled scope={SCOPE} />
      </StrictMode>,
    );
    const captured = bridge.capture(SCOPE);
    expect(captured).not.toBeNull(); // the R1 defect returned null here
    // Latest UNSAVED working copy is returned on the next capture.
    working.board = structuredClone(working.board!);
    working.board.nets.push({ id: 1, name: "SIG", stableId: "net:sig", endpointKeys: [] });
    working.board.tracks.push({ id: "t-unsaved", layer: "copperTop", width: 250_000, start: { x: 1_000_000, y: 3_000_000 }, end: { x: 5_000_000, y: 3_000_000 }, netId: 1, source: "human" });
    const second = bridge.capture(SCOPE)!;
    expect(second.pcbRevisionId).toBe(pcbRevisionId(working.board));
    await act(async () => root.unmount());
  });

  it("lifecycle adoption IMMEDIATELY invalidates the old publisher; the replacement generation republishes the replacement board; unmount retires", async () => {
    const bridge = new EditorContextBridge();
    bridge.beginProject(SCOPE);
    const lifecycle = new PcbBoardLifecycleOwner();
    lifecycle.adopt(IDENTITY);
    const working: { board: PcbBoard | null } = { board: createEmptyBoard() };
    let setGeneration: (generation: number) => void = () => undefined;
    function Stateful() {
      const [generation, set] = useState(0);
      useEffect(() => { setGeneration = set; }, []);
      return <Host bridge={bridge} lifecycle={lifecycle} generation={generation} working={working} enabled scope={SCOPE} />;
    }
    const root = await mount(<StrictMode><Stateful /></StrictMode>);
    expect(bridge.capture(SCOPE)).not.toBeNull();

    // Board lifecycle adoption (checkpoint restore / sync adoption):
    // between retirement and the replacement publication, capture fails
    // CLOSED — the captured lifecycle scope went stale synchronously.
    lifecycle.adopt(IDENTITY);
    expect(bridge.capture(SCOPE)).toBeNull();

    // The replacement generation re-registers and serves the replacement board.
    const replacement = createEmptyBoard();
    replacement.nets.push({ id: 1, name: "SIG", stableId: "net:sig", endpointKeys: [] });
    working.board = replacement;
    await act(async () => { setGeneration(1); });
    const captured = bridge.capture(SCOPE);
    expect(captured).not.toBeNull();
    expect(captured!.pcbRevisionId).toBe(pcbRevisionId(replacement));

    // Real unmount retires the publication.
    await act(async () => root.unmount());
    expect(bridge.capture(SCOPE)).toBeNull();
  });

  it("project switch can never return the previous project's board; demo mode never publishes", async () => {
    const bridge = new EditorContextBridge();
    bridge.beginProject(SCOPE);
    const lifecycle = new PcbBoardLifecycleOwner();
    lifecycle.adopt(IDENTITY);
    const working: { board: PcbBoard | null } = { board: createEmptyBoard() };
    const root = await mount(
      <StrictMode>
        <Host bridge={bridge} lifecycle={lifecycle} generation={0} working={working} enabled scope={SCOPE} />
      </StrictMode>,
    );
    expect(bridge.capture(SCOPE)).not.toBeNull();
    // Hydrating project B retires project A's publisher — no scope serves it.
    bridge.beginProject({ ...SCOPE, projectId: "project-b" });
    expect(bridge.capture(SCOPE)).toBeNull();
    expect(bridge.capture({ ...SCOPE, projectId: "project-b" })).toBeNull();
    await act(async () => root.unmount());

    // Demo mode (enabled: false) never publishes at all.
    const demoBridge = new EditorContextBridge();
    demoBridge.beginProject(SCOPE);
    const demoRoot = await mount(
      <StrictMode>
        <Host bridge={demoBridge} lifecycle={lifecycle} generation={0} working={working} enabled={false} scope={SCOPE} />
      </StrictMode>,
    );
    expect(demoBridge.capture(SCOPE)).toBeNull();
    await act(async () => demoRoot.unmount());
  });

  it("the PAGE bridge survives a StrictMode replay: hydration-owned beginProject re-establishes the generation and no unmount-invalidate cleanup exists to kill it", async () => {
    // Behavioral: a consumer replicating the page seam — beginProject runs
    // in the (re-replayed) hydration effect; there is NO invalidate
    // cleanup. After StrictMode replay the bridge still serves captures.
    const bridge = new EditorContextBridge();
    const lifecycle = new PcbBoardLifecycleOwner();
    lifecycle.adopt(IDENTITY);
    const working: { board: PcbBoard | null } = { board: createEmptyBoard() };
    function PageSeam() {
      // Hydration effect (re-runs on replay; NO invalidate cleanup exists
      // to kill the bridge between the replayed setups).
      useEffect(() => { bridge.beginProject(SCOPE); }, []);
      return null;
    }
    // The real page ordering: boot hydration settles (StrictMode-replayed)
    // BEFORE the editor ever mounts (PcbEditor mounts when the PCB tab
    // first fronts, long after boot).
    const pageRoot = await mount(<StrictMode><PageSeam /></StrictMode>);
    const editorRoot = await mount(
      <StrictMode>
        <Host bridge={bridge} lifecycle={lifecycle} generation={0} working={working} enabled scope={SCOPE} />
      </StrictMode>,
    );
    expect(bridge.capture(SCOPE)).not.toBeNull();
    await act(async () => { editorRoot.unmount(); pageRoot.unmount(); });
    // And the production page source carries no unmount-invalidate effect.
    const pageSource = readFileSync(join(process.cwd(), "app/page.tsx"), "utf8");
    expect(pageSource).not.toContain("editorContextBridgeRef.current?.invalidate()");
  });
});
