/**
 * [B22-C review] regressions-1: the server's half of the simulation authority binding (OD-138). The environments the server holds
 * are the B22-A2 runtime-profile registry, which reads the server's settings and digests install trees (node:fs, node:path); the
 * pure binding (`simulation-authority.ts`) and the evaluators that call it are in the editor's client bundle, so the registry is read
 * here, by the CD-10 execute and readiness routes alone, and passed in. Server-only: no client module may import it (pinned by
 * `b22-c-authority` case 8, which walks every "use client" graph).
 */
import { runtimeProfiles, type RuntimeProfile, type ServerSettingReader } from "./runtime-profile";

/** [B22-C] The environments the server holds: the B22-A2 runtime-profile registry, read with the server's own settings. */
export function serverSimulationEnvironments(read?: ServerSettingReader): readonly RuntimeProfile[] {
  return read ? runtimeProfiles(read) : runtimeProfiles();
}
