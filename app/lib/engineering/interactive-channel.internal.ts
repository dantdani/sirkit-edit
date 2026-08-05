/**
 * B03.2 — INTERNAL editor-session composition module. NOT part of the
 * engineering public API: the barrel (`./index`) deliberately does not
 * export this module, and an architectural CI test
 * (`__tests__/b03-2-boundary.test.ts`) fails if any production file outside
 * the approved composition boundary imports it. Approved importers:
 *
 *   - `./editor-adapter.ts`   (creates the session channel)
 *   - `./executor.ts`         (verifies the capability by identity)
 *   - dedicated security tests under `./__tests__/`
 *
 * This is an APPLICATION COMPOSITION boundary, not cryptographic DRM:
 * JavaScript cannot prevent an in-process module from importing this file,
 * but such code already has direct access to the transaction service. The
 * boundary's purpose is that no SUPPORTED public surface (barrel exports,
 * API routes, agent runtimes, tool registries, workers, serialized request
 * data) can create or convey the capability, and CI enforces the import
 * rule.
 */

import type { ExecutorCommandContract } from "./executor";

/**
 * Capability object granting DESTRUCTIVE-tier approval authority to the
 * interactive editor session. Security properties:
 *
 *  - Created only by `createEditorSessionChannel` below — called exclusively
 *    from the editor-session composition (`CanonicalEditorSession`).
 *  - A branded class instance: deserialized JSON, tool arguments, model
 *    context, and traces can never produce one; `toJSON` yields an inert
 *    marker so it never escapes into serialized state as a reusable secret;
 *    structurally forged objects fail the `instanceof` identity check.
 *  - Narrow scope: approves only destructive-tier commands that are already
 *    kernel-executable (shipped, reversible, canonically undoable UI
 *    behavior). Release-tier commands are categorically rejected before the
 *    approval gate and are unaffected by any channel.
 */
let make: (description: string) => InteractiveUiChannel;

export class InteractiveUiChannel {
  private readonly scope = "interactive-editor-session";
  private constructor(readonly description: string) {}
  // The ONLY constructor path is the module-scoped factory below — captured
  // in a static initialization block so the private constructor never gains
  // a public static entry point.
  static {
    make = (description) => new InteractiveUiChannel(description);
  }
  approvesDestructive(contract: ExecutorCommandContract): boolean {
    return this.scope === "interactive-editor-session" && contract.approvalTier === "destructive" && contract.executable;
  }
  /** The capability must never serialize into persistence, traces, or tool output. */
  toJSON(): string {
    return "[interactive-ui-channel]";
  }
}

/**
 * Editor-session composition ONLY. Never call from API routes, agent
 * runtimes, tool registries, workers, or generic command callers — the
 * architectural CI test enforces this import boundary.
 */
export function createEditorSessionChannel(description: string): InteractiveUiChannel {
  return make(description);
}
