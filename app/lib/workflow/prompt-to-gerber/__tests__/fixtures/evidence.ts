/**
 * B16.1C — evidence sink for the deterministic suites.
 *
 * Tests never write under app/, lib/, scripts/ or artifacts/ (B11.5 closure).
 * Evidence (the released ZIP, its manifest, the check tables) goes to an
 * explicit directory: `SIRKIT_B16_1C_EVIDENCE_DIR` when set, otherwise
 * `<os tmpdir>/sirkit-b16-1c-evidence`. The independent Python verifier and
 * the stage artifacts read from there.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function evidenceDirectory(): string {
  return process.env.SIRKIT_B16_1C_EVIDENCE_DIR?.trim() || join(tmpdir(), "sirkit-b16-1c-evidence");
}

export function writeEvidence(name: string, data: Uint8Array | string): string {
  const directory = evidenceDirectory();
  mkdirSync(directory, { recursive: true });
  const path = join(directory, name);
  writeFileSync(path, data);
  return path;
}
