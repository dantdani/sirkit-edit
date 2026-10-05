"use client";

/**
 * [B23-B3] The provider observations of the manufacturing workflow (runbook B23-B steps 6-8, :980-982; OD-168, OD-169). Each is shown
 * as what it is - an external observation, not Sirkit proof - with its provider, operation, purpose, receipt, retrieval time and
 * freshness, the fields the screen let through and the names of those it withheld. A stale observation stays listed and says it is
 * stale and why; a provider's suggestion is shown and never applied. Display only: no control, nothing is sent, nothing is changed.
 * [B23-B3 review, 2026-10-04] coverage-4: time expiry is re-judged by the clock - an observation the server judged current reads stale
 * (past its validity) once its staleAt passes, and the list re-renders itself then, so a panel left open never keeps an expired quote
 * current; security-1: a receipt id the screen withheld reads "withheld".
 */

import { useEffect, useState } from "react";
import type { PcbSyncManufacturingObservations } from "@/app/lib/pcb-sync/client";

const STALE_REASON_TEXT: Readonly<Record<string, string>> = {
  expired: "past its validity",
  authority_unavailable: "no qualification authority",
  authority_moved: "the qualification authority changed",
  release_unavailable: "no ledgered release",
  ledger_head_moved: "another release was recorded",
  board_unavailable: "the board is not available",
  board_superseded: "the board was superseded",
  board_revision_moved: "the board revision changed after the answer",
  board_digest_moved: "the board changed after the answer",
  descriptor_moved: "the provider descriptor is not the reviewed one",
  profile_moved: "the manufacturing profile changed",
  profile_evidence_invalid: "the profile evidence is not valid",
  profile_evidence_expired: "the profile evidence expired",
  profile_evidence_too_old: "the profile evidence is older than 366 days",
};

export function ProviderObservationList({ observations }: { observations: PcbSyncManufacturingObservations }) {
  const now = useExpiryClock(observations);
  if (observations.state === "corrupt") {
    return <div className="mt-2 rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-red-200" data-testid="p2g-observations">{`Provider observations could not be verified (${observations.codes.join(", ")}); none is shown.`}</div>;
  }
  if (observations.items.length === 0) return null;
  return (
    <div className="mt-2 rounded border border-zinc-700 bg-zinc-950/60 px-2 py-1.5" data-testid="p2g-observations">
      <div className="font-medium text-zinc-100">Provider observations</div>
      <ul className="mt-1 space-y-1">
        {observations.items.map((item) => {
          // [B23-B3 review, 2026-10-04] coverage-4: the server's reasons, and expiry by the clock first when the server had not seen it yet
          const reasons = !item.staleReasons.includes("expired") && now >= Date.parse(item.freshness.staleAt) ? ["expired", ...item.staleReasons] : item.staleReasons;
          const stale = item.stale || reasons.length > 0;
          return (
            <li key={item.observationId} data-testid="p2g-observation" data-stale={stale ? "true" : "false"} className="text-zinc-300">
              <div>
                <span className="text-amber-200/90">{item.label}</span>
                <span className={stale ? "ml-2 text-red-300" : "ml-2 text-zinc-400"} data-testid="p2g-observation-freshness">{stale ? `stale: ${reasons.map((reason) => STALE_REASON_TEXT[reason] ?? reason).join("; ")}` : `current until ${item.freshness.staleAt}`}</span>
              </div>
              <div>{`${item.source.displayName} (${item.source.providerId}) · ${item.source.operationId} · ${item.purpose} · receipt ${item.source.providerReceiptId ?? "withheld"} · retrieved ${item.retrievedAt}`}</div>
              <div className="font-mono text-zinc-400">{`release ${item.digests.releaseId} · package ${item.digests.outboundPackageDigest}`}</div>
              <div>{`The provider's words; Sirkit sets no verdict from them: ${item.fields.length === 0 ? "none kept" : item.fields.map((field) => `${field.name} = ${String(field.value)}`).join(", ")}`}</div>
              {item.withheld.length > 0 && <div className="text-zinc-400">{`Withheld as untrusted: ${item.withheld.map((entry) => `${entry.name} (withheld: ${entry.reason})`).join(", ")}`}</div>}
              {item.suggestions.filter((suggestion) => suggestion.disposition === "shown_never_applied").map((suggestion) => (
                <div key={`${item.observationId}:${suggestion.field}`} data-testid="p2g-observation-suggestion">{`Provider suggestion (${suggestion.kind === "substitution" ? "substitution" : "design change"}), shown, never applied: ${suggestion.field} ${suggestion.text === null ? `(withheld: ${suggestion.withheld ?? "untrusted"})` : `= ${String(suggestion.text)}`}`}</div>
              ))}
            </li>
          );
        })}
      </ul>
      {observations.omitted > 0 && <div className="mt-1 text-zinc-400">{`${observations.omitted} older observations not shown`}</div>}
    </div>
  );
}

/** setTimeout's longest delay; a staleAt further out is re-checked when it fires. */
export const OBSERVATION_CLOCK_MAX_DELAY_MS = 2_147_483_647;

/**
 * [B23-B3 review, 2026-10-04] coverage-4: how long until the list must read the clock again - until the first staleAt after the instant
 * it last judged at (`judgedAt`), counted from `at` (0 when that instant has already passed, at most `OBSERVATION_CLOCK_MAX_DELAY_MS`);
 * null when no observation is still to expire.
 */
export function nextExpiryDelayMs(observations: PcbSyncManufacturingObservations, judgedAt: number, at: number): number | null {
  const ahead = observations.items.map((item) => Date.parse(item.freshness.staleAt)).filter((staleAt) => Number.isFinite(staleAt) && staleAt > judgedAt);
  if (ahead.length === 0) return null;
  return Math.min(OBSERVATION_CLOCK_MAX_DELAY_MS, Math.max(0, Math.min(...ahead) - at));
}

/**
 * [B23-B3 review, 2026-10-04] coverage-4: the instant the list judges time expiry at - read when the list mounts, and read again by a
 * timer at the next staleAt still ahead of it, so the list re-renders when an observation expires instead of waiting for the next
 * hydration.
 */
function useExpiryClock(observations: PcbSyncManufacturingObservations): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const delay = nextExpiryDelayMs(observations, now, Date.now());
    if (delay === null) return undefined;
    const timer = setTimeout(() => setNow(Date.now()), delay);
    return () => clearTimeout(timer);
  }, [observations, now]);
  return now;
}
