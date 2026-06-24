/**
 * LCSC distributor — STUB.
 *
 * LCSC's official pricing/stock API is partner-only. Until we have access (or
 * pivot to another Asian distributor), instantiating the client throws. The
 * aggregator never wires LCSC into a choice, and the BOM UI hides it, so this
 * file is reserved for the real implementation rather than wired in.
 */

import type { DistributorClient } from "./types";

export function makeLcscClient(_opts: { apiKey: string }): DistributorClient {
  throw new Error("LCSC integration requires partner API access — see roadmap");
}
