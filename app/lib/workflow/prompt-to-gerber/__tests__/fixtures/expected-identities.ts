/**
 * [B16-A F9] Pinned release identities for the deterministic acceptance run.
 *
 * Reproduced gap: the acceptance suite compared two in-process releases with
 * each other and wrote the archive sha256 to an evidence file, but no test
 * asserted the RECORDED identities, and no CI workflow ran the suite — so a
 * cross-host drift (e.g. the locale-dependent canonicalization of F8) would
 * have gone undetected. The identities are now pinned in a committed JSON
 * file next to the router recordings and asserted on every replay; they are
 * (re)written only when the fixtures are (re)recorded with the real router
 * (`SIRKIT_B16_1C_RECORD_ROUTES=1`), and the assertion is skipped only under
 * the opt-in LIVE router run (`SIRKIT_B16_1C_LIVE_ROUTER=1`), where a
 * different router outcome is a legitimate — and reported — possibility.
 *
 * Every value here is a function of: the committed KiCad fixtures, the fake
 * provider's recorded design, the frozen clock (FIXED_NOW), the deterministic
 * UUIDs, the committed router recording, and the code. Any change to any of
 * those legitimately changes these values — and must be re-recorded on purpose.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const EXPECTED_IDENTITIES_SCHEMA = "sirkit.b16-1c.expected-identities.v1" as const;
export const EXPECTED_IDENTITIES_PATH = join(dirname(fileURLToPath(import.meta.url)), "expected-identities.json");

export interface ExpectedReleaseIdentities {
  schemaVersion: typeof EXPECTED_IDENTITIES_SCHEMA;
  /** The frozen clock the identities were recorded under (informational). */
  fixedNow: string;
  qualification: {
    boardRevision: string;
    authorityRevision: number;
    authorityDigest: string;
    componentAuthorityDigest: string;
    rc01Digest: string;
    rc02Digest: string;
    rc03Digest: string;
    routerExecutions: number;
  };
  release: {
    releaseId: string;
    filename: string;
    archiveSha256: string;
    archiveByteLength: number;
    manifestContentDigest: string;
    counts: Record<string, number>;
    files: Array<{ path: string; role: string; sha256: string }>;
  };
}

export function loadExpectedIdentities(path = EXPECTED_IDENTITIES_PATH): ExpectedReleaseIdentities | null {
  if (!existsSync(path)) return null;
  const parsed = JSON.parse(readFileSync(path, "utf8")) as ExpectedReleaseIdentities;
  if (parsed.schemaVersion !== EXPECTED_IDENTITIES_SCHEMA) throw new Error(`EXPECTED_IDENTITIES_SCHEMA_MISMATCH:${String(parsed.schemaVersion)}`);
  return parsed;
}

export function saveExpectedIdentities(identities: ExpectedReleaseIdentities, path = EXPECTED_IDENTITIES_PATH): void {
  writeFileSync(path, JSON.stringify(identities, null, 2) + "\n", "utf8");
}
