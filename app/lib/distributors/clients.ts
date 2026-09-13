/**
 * [B19-E E2] The process-wide distributor clients, admitted by the source registry — shared by pricing (`./index`) and the
 * external candidate search (`app/lib/acquisition/external-search.ts`), so both spend one token cache and one request queue
 * per source. This module reaches no database and no offer cache.
 *
 * [B19-A I3] A client is built only when the registry ADMITS its source: never a blocked one, a disabled one only after a
 * reviewed registry change, and not when the operator has switched it off or its credentials are missing. Credentials are
 * read by reference (the registry names the variables) and handed only to the connector that uses them. The decision is
 * taken once per process, like the credentials were before.
 */
import type { DistributorClient } from "./types";
import { makeDigiKeyClient } from "./digikey";
import { makeOctopartClient } from "./octopart";
import { makeMouserClient } from "./mouser";
import { admitSource, type AcquisitionSourceId } from "../acquisition/source-registry";

const clients = new Map<AcquisitionSourceId, DistributorClient | null>();

/** The admitted client for a source, built once per process; null when the registry does not admit it. */
export function admittedDistributorClient(id: AcquisitionSourceId): DistributorClient | null {
  if (clients.has(id)) return clients.get(id) ?? null;
  const admission = admitSource(id, process.env);
  let client: DistributorClient | null = null;
  if (admission.admitted) {
    const secret = (name: string): string => admission.secrets[name] ?? "";
    try {
      if (id === "digikey") client = makeDigiKeyClient({ clientId: secret("DIGIKEY_CLIENT_ID"), clientSecret: secret("DIGIKEY_CLIENT_SECRET") });
      else if (id === "mouser") client = makeMouserClient({ apiKey: secret("MOUSER_API_KEY") });
      else if (id === "octopart") client = makeOctopartClient({ apiKey: secret("OCTOPART_API_KEY") });
    } catch {
      client = null;
    }
  }
  clients.set(id, client);
  return client;
}
