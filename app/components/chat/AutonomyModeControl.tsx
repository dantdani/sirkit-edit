"use client";

/**
 * [B18-D I11] The project's agent autonomy in the chat header (B18-A's handoff, permission-tiers.md §3): every member
 * sees the current mode and what it means; a project administrator may change it. It reads `GET /api/agent/autonomy`
 * and changes it with exactly `{ mode, expectedRevision }` (the server's compare-and-set). A stale revision (409) is
 * re-read and said so; the route's own refusals are shown verbatim. The server decides who may change it and what the
 * agent may do — this control only asks and shows.
 * [B18-D review 2] It claims only what it knows: a lost, unreadable or unconfirmed response leaves the outcome unknown,
 * so the setting is read again and shown; a setting it cannot read is "not known here", never a mode. Every result is
 * announced (a status region), focus returns to the select, and the note (with the lock reason) describes the select.
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
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
export const AUTONOMY_UNREADABLE = "The autonomy setting could not be read, so the mode is not known here; every run still applies the server's setting.";

type Body = { ok?: unknown; code?: unknown; error?: unknown; setting?: { mode?: unknown; revision?: unknown }; viewer?: { canChange?: unknown } };
type Loaded =
  | { kind: "loading" }
  | { kind: "ready"; mode: AutonomyMode; revision: number; canChange: boolean }
  | { kind: "unavailable"; message: string };

/** The route's own named refusal (`AGENT_AUTONOMY_*`, answered before or instead of a change): what it says is shown. */
const isRouteRefusal = (body: Body | null): body is Body & { code: string } => body !== null && body.ok === false && typeof body.code === "string" && body.code.startsWith("AGENT_AUTONOMY_");
const errorText = (body: Body | null): string | null => (body && typeof body.error === "string" && body.error.length > 0 ? body.error.slice(0, 300) : null);

/** Read the setting; never throws — ready (the mode, its revision, whether this viewer may change it) or unavailable
 *  (the server's own words, or "not known here" when nothing readable came back). */
async function readAutonomy(headers: Record<string, string>): Promise<Loaded> {
  try {
    const response = await fetch("/api/agent/autonomy", { headers, cache: "no-store" });
    const body = (await response.json().catch(() => null)) as Body | null;
    if (response.ok && body?.ok === true && isMode(body.setting?.mode) && Number.isSafeInteger(body.setting?.revision)) {
      return { kind: "ready", mode: body.setting.mode, revision: body.setting.revision as number, canChange: body.viewer?.canChange === true };
    }
    return { kind: "unavailable", message: errorText(body) ?? AUTONOMY_UNREADABLE };
  } catch {
    return { kind: "unavailable", message: AUTONOMY_UNREADABLE };
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
  const noteId = useId();
  const selectRef = useRef<HTMLSelectElement>(null);
  const refocusRef = useRef(false);

  const headers = useCallback((): Record<string, string> => (tenantId && projectId && branchId ? projectSelectorHeaders({ tenantId, projectId, branchId }) : {}), [tenantId, projectId, branchId]);

  useEffect(() => {
    if (!projectId) return;
    let current = true;
    void readAutonomy(headers()).then((next) => { if (current) setLoaded(next); });
    return () => { current = false; };
  }, [projectId, headers]);

  // [B18-D review 2] the Change button unmounts (or the controls were disabled) while focused: focus returns to the select
  useEffect(() => {
    if (busy || !refocusRef.current) return;
    refocusRef.current = false;
    const active = document.activeElement;
    if (!active || active === document.body) selectRef.current?.focus();
  }, [busy]);

  const change = async (): Promise<void> => {
    if (loaded.kind !== "ready" || !target || target === loaded.mode) return;
    setBusy(true);
    setNotice(null);
    refocusRef.current = true;
    let response: Response | null = null;
    let body: Body | null = null;
    try {
      response = await fetch("/api/agent/autonomy", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers() },
        body: JSON.stringify({ mode: target, expectedRevision: loaded.revision }),
      });
      body = (await response.json().catch(() => null)) as Body | null;
    } catch {
      response = null; // the request may or may not have reached the server
    }
    try {
      if (response?.ok && body?.ok === true && isMode(body.setting?.mode) && Number.isSafeInteger(body.setting?.revision)) {
        setLoaded({ ...loaded, mode: body.setting.mode, revision: body.setting.revision as number });
        setTarget(null);
        setNotice(`Changed to ${AUTONOMY_MODE_LABELS[body.setting.mode]} (revision ${body.setting.revision as number}).`);
      } else if (response?.status === 409 && isRouteRefusal(body)) {
        setTarget(null);
        setLoaded(await readAutonomy(headers()));
        setNotice("The setting changed since you read it. It has been read again; nothing was changed.");
      } else if (response && !response.ok && isRouteRefusal(body)) {
        setNotice(errorText(body) ?? `Refused (${body.code}).`);
      } else {
        // [B18-D review 2] a lost, unreadable or unconfirmed response: the change may or may not have been made — read it again
        const detail = response ? `HTTP ${response.status}${errorText(body) ? ` — ${errorText(body)}` : ""}` : "no response";
        setTarget(null);
        setLoaded(await readAutonomy(headers()));
        setNotice(`The response did not confirm the change (${detail}); the setting was read again and is shown here.`);
      }
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
              ref={selectRef}
              aria-label="Agent autonomy"
              aria-describedby={noteId}
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
          <span id={noteId} className="text-[10px] leading-4 text-zinc-500" data-testid="autonomy-note">
            {AUTONOMY_MODE_NOTES[loaded.mode]}{loaded.canChange ? "" : " Only a project administrator can change this."}
          </span>
        </>
      ) : null}
      {/* [B18-D review 2] always present, so every result is announced; visually empty when there is nothing to say */}
      <span role="status" aria-live="polite" className="text-[10px] leading-4 text-zinc-400 empty:sr-only" data-testid="autonomy-notice">{notice ?? ""}</span>
    </div>
  );
}
