/**
 * [B19-D I5b review] A part's lifecycle as every reader must see it: a status the pricing layer stamped from vendor answers
 * (`last_refreshed_at` set) is `unknown` once it is older than the strictest bounded retention — at READ time, whether or not
 * the purge has run. KiCad-derived statuses carry no stamp and read as stored.
 */
import { sql } from "drizzle-orm";
import { parts } from "../db/schema";
import { SOURCE_IDS, SOURCE_REGISTRY } from "../acquisition/source-registry";
import type { LifecycleStatus } from "./types";

export const STRICTEST_OFFER_RETENTION_MS = Math.min(
  ...SOURCE_IDS.map((id) => SOURCE_REGISTRY[id]).filter((entry) => entry.license.storage === "bounded" && entry.license.retentionMaxMs > 0).map((entry) => entry.license.retentionMaxMs),
);

const RETENTION_SECONDS = Math.floor(STRICTEST_OFFER_RETENTION_MS / 1000);

export const partLifecycleStatus = sql<LifecycleStatus | null>`(CASE WHEN ${parts.lastRefreshedAt} IS NOT NULL AND ${parts.lastRefreshedAt} < now() - make_interval(secs => ${RETENTION_SECONDS}) THEN 'unknown' ELSE ${parts.lifecycleStatus} END)`;

/** The same rule for a row already read in full. */
export function effectiveLifecycleStatus(status: string | null, lastRefreshedAt: Date | null, now: number = Date.now()): string | null {
  if (lastRefreshedAt && now - new Date(lastRefreshedAt).getTime() > STRICTEST_OFFER_RETENTION_MS) return "unknown";
  return status;
}
