/**
 * B10.1 — the PRODUCTION editor-context publisher seam (extracted from
 * PcbEditor so the exact production registration lifecycle can be mounted
 * under React StrictMode in tests).
 *
 * Strict-Mode-safe ownership:
 *  - Liveness is EFFECT-LOCAL: reset to live on every effect setup and
 *    retired only by THAT setup's cleanup. A development setup → cleanup →
 *    setup replay therefore re-registers a fully live publisher (the old
 *    one-way component-ref pattern left the replayed publisher permanently
 *    dead — B10.1 counterexample R1).
 *  - A PcbBoardLifecycleScope is captured at REGISTRATION time; the
 *    publisher is current only while BOTH the effect and that captured
 *    lifecycle generation are current. Board lifecycle adoption advances
 *    the owner generation synchronously, so between retirement and the
 *    replacement publication every capture fails closed; the
 *    `lifecycleGeneration` dependency then re-registers a fresh publisher
 *    for the replacement board.
 *  - `active` (hidden workspace tab) is deliberately NOT an input: a
 *    hidden-but-mounted editor still owns the current working copy.
 *  - Real unmount retires the publication; demo/scopeless editors never
 *    publish (`enabled: false`).
 */

import { useEffect } from "react";
import type { EditorContextBridge, EditorContextPublisher, EditorContextScope } from "./editor-context-bridge";

/** Structural subset of PcbBoardLifecycleOwner the publisher needs. */
export interface EditorLifecycleSource {
  capture(): { isCurrent(): boolean };
}

export function useEditorContextPublisher(input: {
  bridge: EditorContextBridge | undefined;
  /** false in demo mode or without a project scope — never publishes. */
  enabled: boolean;
  scope: EditorContextScope | null;
  /** The REAL board lifecycle owner (generation-first, B08.2). */
  lifecycle: EditorLifecycleSource;
  /** Advances on every board lifecycle adoption — re-registers the
   *  publisher for the replacement generation. */
  lifecycleGeneration: number;
  /** Stable callback reading the LIVE working-copy refs. */
  read: EditorContextPublisher["read"];
}): void {
  const { bridge, enabled, scope, lifecycle, lifecycleGeneration, read } = input;
  useEffect(() => {
    if (!bridge || !enabled || !scope) return;
    let effectLive = true;
    const lifecycleScope = lifecycle.capture();
    const published = bridge.publish({
      scope,
      isCurrent: () => effectLive && lifecycleScope.isCurrent(),
      read,
    });
    return () => {
      effectLive = false;
      if (published.ok) published.retire();
    };
  }, [bridge, enabled, scope, lifecycle, lifecycleGeneration, read]);
}
