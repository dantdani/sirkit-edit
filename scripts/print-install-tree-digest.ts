/**
 * [B22-A3] Prints the `sirkit-install-tree-sha256/1` digest of an install directory: the value the owner puts in a profile's digest
 * setting to pin that install (OD-135). It reads files only; it starts no process and runs nothing it hashes.
 *
 * Usage:
 *   tsx scripts/print-install-tree-digest.ts <install root> [--members a,b,...]
 *
 * For the local ngspice (`ngspice-local-diagnostic`): the root is the `Spice64` folder, whole (no `--members`); set
 * `SIRKIT_NGSPICE_INSTALL_ROOT` to that folder and `SIRKIT_NGSPICE_INSTALL_SHA256` to the 64 hex characters printed here. For
 * FreeRouting the members are `freerouting-2.2.4.jar,jdk-25.0.3+9-jre` (`runtime-profiles.md` section 2).
 */
import { resolve } from "node:path";
import { INSTALL_TREE_DIGEST_ALGORITHM, installTreeDigest } from "@/app/lib/computation/runtime-profile";

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const membersAt = args.indexOf("--members");
  const members = membersAt >= 0 ? (args[membersAt + 1] ?? "").split(",").filter((name) => name !== "") : null;
  const root = args.find((arg, index) => !arg.startsWith("--") && (membersAt < 0 || index !== membersAt + 1));
  if (!root) {
    console.error("usage: tsx scripts/print-install-tree-digest.ts <install root> [--members a,b,...]");
    return 2;
  }
  const digest = await installTreeDigest(resolve(root), { members });
  console.log(digest.sha256);
  console.error(`${INSTALL_TREE_DIGEST_ALGORITHM}: ${digest.fileCount} files, ${digest.totalBytes} bytes${members ? `, members ${members.join(",")}` : ", the whole tree"}`);
  return 0;
}

main().then(
  (code) => { process.exitCode = code; },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  },
);
