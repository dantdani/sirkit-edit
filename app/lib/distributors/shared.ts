/**
 * Browser-safe distributor surface.
 *
 * Types and pure constants/functions that carry NO server-only dependencies —
 * no DB client, no `postgres`, no API credentials. Client Components import
 * from HERE, never from "./index": the orchestrator in index.ts pulls in the
 * Drizzle/Postgres graph (`getDb` → `postgres` → `fs`), and importing any value
 * from it into a "use client" module drags that graph into the browser bundle
 * and fails the build with "Can't resolve 'fs'".
 *
 * The server barrel ("./index") re-exports everything defined here, so
 * server-side callers can keep importing from "@/app/lib/distributors"
 * unchanged.
 */

import type {
  PartPricing,
  PriceBreak,
  DistributorClient,
  DistributorName,
  LifecycleStatus,
} from "./types";

export type {
  PartPricing,
  PriceBreak,
  DistributorClient,
  DistributorName,
  LifecycleStatus,
};

export { LIFECYCLE_SEVERITY, consolidateLifecycle, mapLifecycleString } from "./lifecycle";

// LCSC is excluded from the union until partner API access lands (stub throws).
export type DistributorChoice = "none" | "digikey" | "mouser" | "octopart" | "all";

export type AggregatedPricing = {
  partId: string;
  mpn: string;
  offers: PartPricing[]; // one entry per distributor that returned data
  bestOverall: PartPricing | null;
  lifecycleStatus: LifecycleStatus; // consolidated (worst-wins) across offers
  sourcesQueried: string[]; // which distributors were actually called
  sourcesFromCache: number;
  sourcesFromLive: number;
};
