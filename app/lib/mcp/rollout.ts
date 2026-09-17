/**
 * [B20 A0] The MCP feature flag (OD-54, flag part). Both MCP surfaces — Sirkit consuming an approved external server
 * (B20-A) and Sirkit exposing its own read/propose tools (B20-B) — stay OFF unless `SIRKIT_MCP_ENABLED` is exactly "1".
 * `SIRKIT_MCP_DISABLED_SERVERS` names registry ids an operator forces off although the registry approves them: it can only
 * remove a server, never add one (a server exists only as a reviewed registry row, OD-48).
 *
 * Read through the repository's environment-record pattern (`app/lib/pcb-sync/rollout.ts`, `app/lib/db/test-qualification.ts`):
 * the environment is a parameter that defaults to `process.env` at call time, nothing is read at module load, the enabling
 * value is compared untrimmed exactly as `SIRKIT_DB_QUALIFICATION` is (the `.env.local` loader trims unquoted file values
 * before they reach the environment), and no value is ever echoed.
 */
export const MCP_ENABLED_ENV = "SIRKIT_MCP_ENABLED" as const;
export const MCP_DISABLED_SERVERS_ENV = "SIRKIT_MCP_DISABLED_SERVERS" as const;

export interface McpFeatureState {
  /** true only when the flag's value is exactly "1", untrimmed ("true", "yes", "on" and a padded "1" leave it off) */
  readonly enabled: boolean;
  /** registry ids forced off: trimmed, lower-cased, de-duplicated, sorted; blanks dropped */
  readonly disabledServers: readonly string[];
}

export function mcpFeatureState(environment: Record<string, string | undefined> = process.env): McpFeatureState {
  const enabled = environment[MCP_ENABLED_ENV] === "1";
  const listed = (environment[MCP_DISABLED_SERVERS_ENV] ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  return Object.freeze({ enabled, disabledServers: Object.freeze([...new Set(listed)].sort()) });
}
