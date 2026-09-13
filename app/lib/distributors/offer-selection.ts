/**
 * [B19-D I5b review] The ONE rule for reading stored offers outside the pricing layer: an offer describes a part only when
 * it is within its source's freshness AND was stored for that part's exact MPN (a row stored before 0029 has none and never
 * does). The alternates route and both operator scripts read through this.
 */
import { sameExactMpn } from "../atomic/identity";
import { isOfferServable } from "./cache";

export function offersForExactMpn<T extends { distributor: string; mpn: string | null; lastRefreshedAt: Date | null }>(
  rows: readonly T[],
  mpn: string | null | undefined,
  now: number = Date.now(),
): T[] {
  return rows.filter((row) => isOfferServable(row.distributor, row.lastRefreshedAt, now) && sameExactMpn(row.mpn, mpn));
}
