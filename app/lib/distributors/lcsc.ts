/**
 * LCSC distributor — BLOCKED in the source registry.
 *
 * [B19-A I3] LCSC has an official API, and access to it requires an approved partner application. Sirkit has no such
 * access, so the registry records the source as blocked: nothing constructs a client, and nothing may scrape around the
 * API. This file is reserved for a real implementation once legitimate access exists.
 */

import type { DistributorClient } from "./types";
import { SOURCE_REGISTRY } from "../acquisition/source-registry";

export function makeLcscClient(_opts: { apiKey: string }): DistributorClient {
  throw new Error(`LCSC is blocked: ${SOURCE_REGISTRY.lcsc.state.reason}`);
}
