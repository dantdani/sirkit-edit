/**
 * [PR-M, 2026-10-18] Section M2 (design M2.5/M2.6): the two server reads the acquisition task needs beside M1's ports, neither a
 * provider call:
 *
 *  - `catalogPartIdsByExactMpn`: the catalog parts whose MPN IS the exact MPN (case-folded) - the lexical recall of a discovery row or
 *    a same-MPN part, so a published revision is found again with NO embedding, reranker or model (M.3 item 8; the fixture runtime reads
 *    its committed catalog);
 *  - `cachedIdentityEvidence`: whether the OFFER CACHE holds a distributor observation naming that exact MPN (a cache read, never a
 *    vendor call) - the only distributor input the validation's identity rule reads, and an identity hint for the reviewer, never proof.
 */
import { sql } from "drizzle-orm";
import { getDb } from "../../db/client";
import { parts } from "../../db/schema";
import { fixtureContainer } from "../../fixture-runtime/container";
import { fixtureRuntimeEnabled } from "../../fixture-runtime/mode";
import { canonicalExactMpn } from "../../atomic/identity";
import { loadCachedExternalObservations } from "../../acquisition/offer-cache-observations";
import { candidateFromObservation } from "../../acquisition/quarantine";

const MAX_IDS = 8;

export async function catalogPartIdsByExactMpn(exactMpn: string): Promise<string[]> {
  let key: string;
  try { key = canonicalExactMpn(exactMpn); } catch { return []; }
  if (fixtureRuntimeEnabled()) {
    return [...fixtureContainer().catalog.cachedParts.values()].filter((part) => { try { return part.mpn !== null && part.mpn !== undefined && canonicalExactMpn(part.mpn) === key; } catch { return false; } }).map((part) => part.id).sort().slice(0, MAX_IDS);
  }
  const rows = await getDb().select({ id: parts.id }).from(parts).where(sql`upper(${parts.mpn}) = ${key}`).limit(MAX_IDS);
  return rows.map((row) => row.id).sort();
}

export async function cachedIdentityEvidence(exactMpn: string): Promise<{ distributorExactMpn: boolean; manufacturerDatasheet: boolean }> {
  if (fixtureRuntimeEnabled()) return { distributorExactMpn: false, manufacturerDatasheet: false };
  let key: string;
  try { key = canonicalExactMpn(exactMpn); } catch { return { distributorExactMpn: false, manufacturerDatasheet: false }; }
  const observations = await loadCachedExternalObservations(exactMpn);
  return { distributorExactMpn: observations.some((observation) => candidateFromObservation(observation).identityKey === key), manufacturerDatasheet: false };
}
