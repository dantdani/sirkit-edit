/**
 * [B20 A0] Fixture MCP server rows for tests. None is ever committed to the registry (OD-48); every value is an obvious
 * fake assembled here, and every secret is a reference by environment variable NAME, never a value.
 */
import type { McpServerRegistryEntry } from "../server-registry";

/** 2026-09-17T12:00:00Z — a fixed clock for the admission windows. */
export const T0 = Date.UTC(2026, 8, 17, 12, 0, 0);

/** The host a fixture row named by id alone lives at: canonical URIs are unique across a revision (one server is one row). */
export const fixtureHost = (id?: string): string => (id === undefined ? "mcp.example.com" : `${id}.example.com`);

export function fixtureServer(overrides: Partial<McpServerRegistryEntry> = {}): McpServerRegistryEntry {
  const host = fixtureHost(overrides.id);
  const base: McpServerRegistryEntry = {
    id: "docs-example",
    title: "Example documentation server (fixture)",
    canonicalUri: `https://${host}/mcp`,
    endpoint: { host, port: null, path: "/mcp" },
    supportedProtocolVersions: ["2026-07-28"],
    compatibilityEra: false,
    auth: { mode: "none", secrets: [], scopes: [] },
    descriptorPin: { toolsListDigest: null, pinnedAt: null },
    limits: {
      requestsPerMinute: 10,
      maxConcurrent: 2,
      deadlineMs: 10_000,
      maxResponseBytes: 1_000_000,
      breaker: { failureThreshold: 3, cooldownMs: 60_000 },
      perTool: { search: { requestsPerMinute: 4 }, read: { requestsPerMinute: 10 } },
    },
    maxRedirects: 0,
    agentDisclosure: "unknown",
    // [B20 A4L] fail closed: a fixture row names NO agent-callable tool. A suite that drives the agent port names the
    // tools that row's operator approved, exactly as a reviewed registry row would.
    agentTools: [],
    terms: { documentationUrl: "https://example.com/docs/mcp", checkedOn: "2026-09-17", retentionNote: "fixture; nothing is retained" },
    state: { status: "approved", ownerDecision: "OD-48", reason: "test fixture; never a committed row" },
  };
  return { ...base, ...overrides };
}

/** A writable deep copy of a row, shaped only as far as crafted revisions need. */
export type WritableServer = {
  id: string;
  title: string;
  canonicalUri: string;
  endpoint: { host: string; port: number | null; path: string };
  supportedProtocolVersions: string[];
  compatibilityEra: boolean;
  /** [B20 A3] `authorizationServer`: the pinned issuer and token endpoint of a client-credentials row (OD-61) */
  auth: { mode: string; secrets: Array<{ env: string; role: string }>; scopes: string[]; authorizationServer?: { issuer: string; tokenEndpoint: string } | null };
  descriptorPin: { toolsListDigest: string | null; pinnedAt: string | null } | null;
  limits: {
    requestsPerMinute: number;
    maxConcurrent: number;
    deadlineMs: number;
    maxResponseBytes: number;
    breaker: { failureThreshold: number; cooldownMs: number };
    perTool?: Record<string, { requestsPerMinute: number }> | unknown[];
  };
  maxRedirects: number;
  agentDisclosure: string;
  /** [B20 A4L] the per-tool agent allowlist; `unknown` so a crafted revision can hold a non-array or a hostile entry */
  agentTools: unknown;
  terms: { documentationUrl?: string; checkedOn?: string; retentionNote?: string };
  state: { status: string; ownerDecision: string; reason: string };
};

/** One fixture row with `change` applied to a JSON copy — for the validator's refusal cases. */
export function mutated(change: (entry: WritableServer) => void): McpServerRegistryEntry {
  const copy = JSON.parse(JSON.stringify(fixtureServer())) as WritableServer;
  change(copy);
  return copy as unknown as McpServerRegistryEntry;
}
