/**
 * [B19-E E6] OPTIONAL live contract check of the agent read port against the REAL admitted vendors — never run in CI and never
 * by default: it runs only when an operator sets SIRKIT_LIVE_ACQUISITION_CONTRACT=1 in a shell that also holds the vendor
 * credentials (the registry names the variables; nothing here prints or logs a value).
 *
 *   SIRKIT_LIVE_ACQUISITION_CONTRACT=1 pnpm exec vitest run app/lib/acquisition/__tests__/b19-e-live-contract.test.ts
 *
 * For one well-known MPN per admitted source it checks: the exact mapping (the vendor's own MPN is the requested one), only
 * the registry's hosts were contacted, the labels are complete, exactly one quota unit was spent at the agent's purpose, and no
 * credential appeared in anything logged. The disclosure is permitted only inside this check (a test-only registry passed to
 * the port); the committed registry stays "unknown" everywhere (OD-36). [B24-B3, 2026-10-08] D24-19, OD-209: with the flag set, an absent credential name or a source that is not admitted FAILS `NOT EXERCISED`; it never passes (app/lib/evaluation/live-suites.ts).
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { makeDigiKeyClient } from "../../distributors/digikey";
import { makeOctopartClient } from "../../distributors/octopart";
import type { DistributorEgress } from "../../distributors/egress";
import type { DistributorClient } from "../../distributors/types";
import { previewAdmission, resetAdmissionControl } from "../admission-control";
import { createAgentReadPort } from "../agent-read-port";
import { admitSource, SOURCE_IDS, SOURCE_REGISTRY, type AcquisitionSourceId, type SourceRegistryEntry } from "../source-registry"; import { assertLiveResources } from "../../evaluation/live-suites"; // [B24-B3, 2026-10-08] D24-19, OD-209: the resource gate, on this line so no line moves

const LIVE = process.env.SIRKIT_LIVE_ACQUISITION_CONTRACT === "1";
/** One long-lived, widely stocked exact MPN per source. */
const KNOWN_MPN: Partial<Record<AcquisitionSourceId, string>> = { digikey: "NE555P", octopart: "NE555P" };

describe.skipIf(process.env.SIRKIT_LIVE_ACQUISITION_CONTRACT !== "1")("[B19-E E6] live acquisition contract (operator-run only)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetAdmissionControl();
  });

  for (const id of SOURCE_IDS.filter((sourceId) => KNOWN_MPN[sourceId] !== undefined)) {
    it(`${id}: exact mapping, registry host, labels, one quota unit, no credential logged`, async () => {
      const admission = admitSource(id, process.env);
      if (!admission.admitted) {
        // [B24-B3, 2026-10-08] D24-19, OD-209: this branch used to exit the case early as a pass; a source the operator's shell does not admit is never a pass
        throw new Error(`NOT EXERCISED: ${id} not admitted (${admission.refusal})`);
      }
      const hosts: string[] = [];
      const logged: string[] = [];
      for (const method of ["error", "warn", "info", "log"] as const) vi.spyOn(console, method).mockImplementation((...parts: unknown[]) => { logged.push(parts.map(String).join(" ")); });
      const egress: DistributorEgress = { fetch: async (input, init) => { hosts.push(new URL(String(input)).hostname); return fetch(input, init); } };
      const connect = (sourceId: AcquisitionSourceId, secrets: Readonly<Record<string, string>>): DistributorClient | null =>
        sourceId === "digikey" ? makeDigiKeyClient({ clientId: secrets.DIGIKEY_CLIENT_ID ?? "", clientSecret: secrets.DIGIKEY_CLIENT_SECRET ?? "", egress })
          : sourceId === "octopart" ? makeOctopartClient({ apiKey: secrets.OCTOPART_API_KEY ?? "", egress }) : null;
      const registry = Object.fromEntries(SOURCE_IDS.map((sourceId) => [sourceId, sourceId === id ? { ...SOURCE_REGISTRY[sourceId], license: { ...SOURCE_REGISTRY[sourceId].license, agentDisclosure: "permitted" as const } } : SOURCE_REGISTRY[sourceId]])) as Record<AcquisitionSourceId, SourceRegistryEntry>;
      // only this source permits disclosure in the test registry, so no other source is ever asked live
      const port = createAgentReadPort({ live: LIVE, env: process.env, registry, connect, readOfferCache: async () => new Map(), loadObservations: async () => [], loadRevisionIds: async () => [], loadRevisionStatus: async () => new Map() });
      const mpn = KNOWN_MPN[id]!;
      const share = Math.floor(Math.min(...SOURCE_REGISTRY[id].quota.limits.map((limit) => limit.max)) * 0.25);
      const answer = await port.searchExactMpns({ mpns: [mpn], liveMpnBudget: 1, scope: { tenantId: "live-contract", projectId: "live-contract" }, deadlineMs: 20_000, signal: new AbortController().signal });
      const observed = answer.observations.find((item) => item.sourceId === id && item.mpn === mpn);
      expect(observed).toMatchObject({ outcome: "observed", servedFrom: "live", exactMatch: true });
      expect(observed!.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(observed!.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(answer.sources.find((source) => source.sourceId === id)).toMatchObject({ status: "available", disclosure: "values" });
      expect(answer.liveMpnsUsed).toBe(1);
      for (const host of hosts) expect(SOURCE_REGISTRY[id].endpoints.hosts, host).toContain(host);
      // one quota unit at the agent's purpose: the agent's share now admits exactly one unit fewer
      expect(previewAdmission(id, share, Date.now(), "agent")).not.toBeNull();
      expect(previewAdmission(id, share - 1, Date.now(), "agent")).toBeNull();
      const secrets = Object.values(admission.secrets).filter((value) => value.length >= 8);
      for (const line of [...logged, JSON.stringify(answer)]) for (const secret of secrets) expect(line.includes(secret)).toBe(false);
    }, 60_000);
  }

  beforeAll(() => assertLiveResources("b19-e-live-contract")); // [B24-B3, 2026-10-08] D24-19, OD-209: with the flag set and a registry credential name absent this block fails NOT EXERCISED before any case body runs
});
