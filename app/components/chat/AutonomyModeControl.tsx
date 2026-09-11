"use client";

/**
 * [B18-D I11] The project's agent autonomy in the chat header (B18-A's handoff, permission-tiers.md §3): every member
 * sees the current mode and what it means; a project administrator may change it. It reads `GET /api/agent/autonomy`
 * and changes it with exactly `{ mode, expectedRevision }` (the server's compare-and-set). A stale revision (409) is
 * re-read and said so; a refusal (403 and the rest) is shown verbatim; an unavailable store means the project behaves as
 * proposal only. The server decides who may change it and what the agent may do — this control only asks and shows.
 */
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { projectSelectorHeaders, type ProjectSelectorScope } from "@/app/lib/project/project-selector";

export type AutonomyMode = "proposal_only" | "execute_explicit_tier1";
const MODES: readonly AutonomyMode[] = ["proposal_only", "execute_explicit_tier1"];
const isMode = (value: unknown): value is AutonomyMode => typeof value === "string" && (MODES as readonly string[]).includes(value);

export const AUTONOMY_MODE_LABELS: Readonly<Record<AutonomyMode, string>> = Object.freeze({
  proposal_only: "Proposal only",
  execute_explicit_tier1: "Explicit Tier 1",
});
export const AUTONOMY_MODE_NOTES: Readonly<Record<AutonomyMode, string>> = Object.freeze({
  proposal_only: "Every AI change waits for your confirmation.",
  execute_explicit_tier1: "An exact request for a reversible Tier 1 edit runs without the card; everything else still asks.",
});
const UNAVAILABLE = "The autonomy setting is unavailable; the project behaves as proposal only.";

type Loaded =
  | { kind: "loading" }
  | { kind: "ready"; mode: AutonomyMode; revision: number; canChange: boolean }
  | { kind: "unavailable"; message: string };

/** Read the setting; never throws — ready (the mode, its revision, whether this viewer may change it) or unavailable. */
async function readAutonomy(headers: Record<string, string>): Promise<Loaded> {
  try {
    const response = await fetch("/api/agent/autonomy", { headers, cache: "no-store" });
    const body = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: unknown; setting?: { mode?: unknown; revision?: unknown }; viewer?: { canChange?: unknown } };
    if (response.ok && body.ok === true && isMode(body.setting?.mode) && Number.isSafeInteger(body.setting?.revision)) {
      return { kind: "ready", mode: body.setting.mode, revision: body.setting.revision as number, canChange: body.viewer?.canChange === true };
    }
    return { kind: "unavailable", message: typeof body.error === "string" && body.error.length > 0 ? body.error.slice(0, 300) : UNAVAILABLE };
  } catch {
    return { kind: "unavailable", message: UNAVAILABLE };
  }
}

export function AutonomyModeControl({ scope }: { scope: ProjectSelectorScope | null }) {
  const tenantId = scope?.tenantId ?? null;
  const projectId = scope?.projectId ?? null;
  const branchId = scope?.branchId ?? null;
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [target, setTarget] = useState<AutonomyMode | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const headers = useCallback((): Record<string, string> => (tenantId && projectId && branchId ? projectSelectorHeaders({ tenantId, projectId, branchId }) : {}), [tenantId, projectId, branchId]);

  useEffect(() => {
    if (!projectId) return;
    let current = true;
    void readAutonomy(headers()).then((next) => { if (current) setLoaded(next); });
    return () => { current = false; };
  }, [projectId, headers]);

  const change = async (): Promise<void> => {
    if (loaded.kind !== "ready" || !target || target === loaded.mode) return;
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch("/api/agent/autonomy", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers() },
        body: JSON.stringify({ mode: target, expectedRevision: loaded.revision }),
      });
      const body = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: unknown; setting?: { mode?: unknown; revision?: unknown } };
      if (response.ok && body.ok === true && isMode(body.setting?.mode) && Number.isSafeInteger(body.setting?.revision)) {
        setLoaded({ ...loaded, mode: body.setting.mode, revision: body.setting.revision as number });
        setTarget(null);
        setNotice(`Changed to ${AUTONOMY_MODE_LABELS[body.setting.mode]} (revision ${body.setting.revision as number}).`);
      } else if (response.status === 409) {
        setTarget(null);
        setLoaded(await readAutonomy(headers()));
        setNotice("The setting changed since you read it. It has been read again; nothing was changed.");
      } else {
        setNotice(typeof body.error === "string" && body.error.length > 0 ? body.error.slice(0, 300) : `Refused (${response.status}); nothing was changed.`);
      }
    } catch {
      setNotice("The change could not be sent; nothing was changed.");
    } finally {
      setBusy(false);
    }
  };

  if (!projectId) return null;
  return (
    <div className="flex flex-col gap-1 min-w-40" data-testid="autonomy-control" data-mode={loaded.kind === "ready" ? loaded.mode : loaded.kind}>
      <span className="text-[10px] uppercase tracking-wide text-zinc-500">Agent autonomy</span>
      {loaded.kind === "loading" ? <span className="text-xs text-zinc-500">Loading…</span> : null}
      {loaded.kind === "unavailable" ? <span className="text-[11px] text-amber-300" data-testid="autonomy-unavailable">{loaded.message}</span> : null}
      {loaded.kind === "ready" ? (
        <>
          <div className="flex items-center gap-1.5">
            <select
              aria-label="Agent autonomy"
              data-testid="autonomy-mode"
              value={target ?? loaded.mode}
              disabled={!loaded.canChange || busy}
              onChange={(event) => setTarget(event.target.value as AutonomyMode)}
              className="h-7 rounded border border-zinc-700 bg-zinc-900 px-2 text-xs text-zinc-200 outline-none focus:border-teal-500 disabled:opacity-70"
            >
              {MODES.map((mode) => <option key={mode} value={mode}>{AUTONOMY_MODE_LABELS[mode]}</option>)}
            </select>
            {loaded.canChange && target && target !== loaded.mode ? (
              <Button size="sm" data-testid="autonomy-change" disabled={busy} onClick={() => void change()}>
                Change
              </Button>
            ) : null}
          </div>
          <span className="text-[10px] leading-4 text-zinc-500" data-testid="autonomy-note">
            {AUTONOMY_MODE_NOTES[loaded.mode]}{loaded.canChange ? "" : " Only a project administrator can change this."}
          </span>
        </>
      ) : null}
      {notice ? <span className="text-[10px] leading-4 text-zinc-400" data-testid="autonomy-notice">{notice}</span> : null}
    </div>
  );
}
