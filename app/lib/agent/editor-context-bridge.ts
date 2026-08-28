/**
 * B10 — the project-owned PCB/editor context bridge.
 *
 * ONE atomic, versioned, immutable snapshot of the EXACT working copy the
 * PCB editor is displaying — `PcbEditor.state.board` (via its live board
 * ref), the live `selectionStore` selection, and the optional live netlist
 * — captured at chat-request time.
 *
 * Ownership contract:
 *  - `PcbEditor` is the SOLE producer: it registers a pull publisher whose
 *    `read()` returns the current live refs. It never reads localStorage,
 *    IndexedDB, the durable authority cache, `authorityRef`, or any API
 *    route — the read source is the working copy itself, so UNSAVED edits
 *    are visible.
 *  - `app/page.tsx` is the consumer: it calls `beginProject` at every
 *    project hydration (same site as the ProjectAsyncScope generation) and
 *    `capture` when starting a chat request.
 *  - Generations: `beginProject` retires every previously registered
 *    publisher. A publication from a retired editor (stale scope or
 *    lifecycle no longer current) is rejected; capture for a mismatched
 *    scope returns null (unavailable); a retired publisher can never serve
 *    a capture.
 *  - Immutability: captured data is a deep-frozen `structuredClone` — later
 *    editor mutations cannot alter a captured request, and external aliases
 *    cannot mutate the captured snapshot.
 *  - Demo boards are NOT current durable project boards: the editor never
 *    registers a publisher in demo mode, so demo chat PCB tools stay
 *    truthfully unavailable.
 */

import type { PcbBoard } from "../pcb/types";
import type { SelectionRef } from "../pcb/edit/commands";
import type { AgentNetlistProjection } from "./netlist-validation";
import { pcbRevisionId } from "../pcb/revision";

export const EDITOR_CONTEXT_SCHEMA = "sirkit.editor-context.v1" as const;

export interface EditorContextScope {
  tenantId: string;
  projectId: string;
  branchId: string;
}

/** The atomic captured snapshot sent to /api/chat. Local working-copy
 *  provenance ONLY — the server revalidates the board and recomputes every
 *  revision/digest; nothing here is authority. */
export interface CapturedEditorContext {
  schema: typeof EDITOR_CONTEXT_SCHEMA;
  scope: EditorContextScope;
  /** Deep clone of the EXACT current `state.board` working copy. */
  board: PcbBoard;
  /** Client-computed pcb2 semantic revision — a server-VERIFIABLE hint,
   *  never trusted (the server recomputes it). */
  pcbRevisionId: string;
  selection: { refs: SelectionRef[]; primary: SelectionRef | null };
  /** [B10.1] AUTHORITY-NEUTRAL projection only — never the full PcbNetlist. */
  netlist: AgentNetlistProjection | null;
  /** Digest of the schematic the editor context (netlist) derives from. */
  schematicDigest: string | null;
  /** [B15.3] the PCB proposal BASIS captured atomically with the board:
   *  canonical history head, session lineage, and the editor's ACTIVE DRC
   *  preset. A scope label only — the server shape-validates it and the
   *  live editor re-verifies every field at apply. null ⇒ the PCB proposal
   *  tool is truthfully unavailable (e.g. session not canonical-ready). */
  pcbProposalBasis: {
    historyHeadSequence: number;
    historyHeadLabel: string | null;
    lineageId: string;
    activeDrcPresetId: string;
  } | null;
  authoritySource: "local-working-copy";
}

export interface EditorContextPublisher {
  scope: EditorContextScope;
  /** Must be true while the producing editor's project/PCB lifecycle
   *  generation is still current (false after unmount or retirement). */
  isCurrent(): boolean;
  /** Pull the CURRENT live working-copy refs (cloned by the bridge). */
  read(): {
    board: PcbBoard | null;
    selection: { refs: readonly SelectionRef[]; primary?: SelectionRef | null };
    netlist: AgentNetlistProjection | null;
    schematicDigest: string | null;
    /** [B15.3] see `CapturedEditorContext.pcbProposalBasis`. Editors that do
     *  not supply one simply leave the PCB proposal tool unavailable. */
    pcbProposalBasis?: CapturedEditorContext["pcbProposalBasis"];
  };
}

export type PublishOutcome =
  | { ok: true; retire: () => void }
  | { ok: false; reason: string };

function sameScope(a: EditorContextScope, b: EditorContextScope): boolean {
  return a.tenantId === b.tenantId && a.projectId === b.projectId && a.branchId === b.branchId;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export class EditorContextBridge {
  private generation = 0;
  private scope: EditorContextScope | null = null;
  private publisher: { generation: number; source: EditorContextPublisher } | null = null;

  /** Called at every project hydration: advances the generation and retires
   *  any previously registered publisher. */
  beginProject(scope: EditorContextScope): void {
    this.generation += 1;
    this.scope = { ...scope };
    this.publisher = null;
  }

  /** Retire everything (page unmount / teardown). */
  invalidate(): void {
    this.generation += 1;
    this.publisher = null;
  }

  currentScope(): EditorContextScope | null {
    return this.scope ? { ...this.scope } : null;
  }

  /** Register the editor's pull publisher for the CURRENT generation. A
   *  late publication from a retired editor (foreign scope or stale
   *  lifecycle) is rejected. */
  publish(source: EditorContextPublisher): PublishOutcome {
    if (!this.scope) return { ok: false, reason: "no active project generation" };
    if (!sameScope(source.scope, this.scope)) return { ok: false, reason: "publisher scope does not match the current project generation" };
    if (!source.isCurrent()) return { ok: false, reason: "publisher lifecycle is retired" };
    const generation = this.generation;
    this.publisher = { generation, source };
    return {
      ok: true,
      retire: () => {
        if (this.publisher?.generation === generation && this.publisher.source === source) this.publisher = null;
      },
    };
  }

  /** Capture ONE atomic immutable snapshot for `expected` scope, or null
   *  (unavailable) when no current-generation publisher for that exact
   *  scope can serve it. */
  capture(expected: EditorContextScope): CapturedEditorContext | null {
    const publisher = this.publisher;
    if (!this.scope || !publisher) return null;
    if (publisher.generation !== this.generation) return null;
    if (!sameScope(expected, this.scope) || !sameScope(expected, publisher.source.scope)) return null;
    if (!publisher.source.isCurrent()) return null;
    const raw = publisher.source.read();
    if (!raw.board) return null;
    const board = structuredClone(raw.board);
    return deepFreeze({
      schema: EDITOR_CONTEXT_SCHEMA,
      scope: { ...publisher.source.scope },
      board,
      pcbRevisionId: pcbRevisionId(board),
      selection: {
        refs: structuredClone([...raw.selection.refs]),
        primary: raw.selection.primary ? structuredClone(raw.selection.primary) : null,
      },
      netlist: raw.netlist ? structuredClone(raw.netlist) : null,
      schematicDigest: raw.schematicDigest,
      pcbProposalBasis: raw.pcbProposalBasis ? structuredClone(raw.pcbProposalBasis) : null,
      authoritySource: "local-working-copy",
    });
  }
}
