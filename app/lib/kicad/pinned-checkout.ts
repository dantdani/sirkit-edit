/**
 * [B19-D I5e review; row 05's minimal fix] The KiCad library checkouts the operator ingests read are pinned to reviewed commits.
 *
 * `pnpm ingest:kicad` and the footprint ingest ran `git pull --ff-only` on an existing checkout (or cloned upstream HEAD), so
 * whatever upstream had merged — descriptions, manufacturer and pin-name text, footprint geometry — entered the catalog on the
 * next run without review. A checkout is now made exactly the pinned commit (fetched by id when it is not already there), is
 * verified to be that commit afterwards, and is refused when it has local modifications or extra files, which the ingest would
 * otherwise read. Moving a pin is a reviewed change to this file.
 *
 * The pins are the commits the B19-D whole-library corpus checks ran on (data/kicad-symbols, data/kicad-footprints).
 */
import { join } from "node:path";

export const KICAD_LIBRARY_PINS = Object.freeze({
  symbols: Object.freeze({
    repository: "https://gitlab.com/kicad/libraries/kicad-symbols.git",
    commit: "90c39c3880f0062a56b5944d428edc846968d72b",
    committedAt: "2026-06-09T02:55:35Z",
  }),
  footprints: Object.freeze({
    repository: "https://gitlab.com/kicad/libraries/kicad-footprints.git",
    commit: "645402ed82e16096cf827fea7114fdbef4c46948",
    committedAt: "2026-06-20T18:07:17Z",
  }),
});

/** Runs `git` with an argument vector (never a shell) and resolves with its standard output. */
export type GitRunner = (args: readonly string[]) => Promise<string>;

export class PinnedCheckoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PinnedCheckoutError";
  }
}

export interface PinnedCheckoutInput {
  directory: string;
  repository: string;
  commit: string;
  git: GitRunner;
  exists: (path: string) => boolean;
}

async function headOf(git: GitRunner, directory: string): Promise<string> {
  try {
    return (await git(["-C", directory, "rev-parse", "--verify", "HEAD"])).trim();
  } catch {
    return ""; // a fresh repository has no HEAD yet
  }
}

async function assertClean(git: GitRunner, directory: string): Promise<void> {
  const status = await git(["-C", directory, "status", "--porcelain", "--untracked-files=all", "--ignored"]);
  if (status.trim() !== "") throw new PinnedCheckoutError(`The checkout in ${directory} has local modifications or extra files; the ingest reads only the pinned commit's files.`);
}

export async function ensurePinnedCheckout(input: PinnedCheckoutInput): Promise<{ commit: string; fetched: boolean }> {
  const { directory, repository, commit, git, exists } = input;
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new PinnedCheckoutError("The pinned commit is not a full 40-character commit id.");
  if (!exists(join(directory, ".git"))) await git(["init", "--quiet", directory]);
  let fetched = false;
  if ((await headOf(git, directory)) !== commit) {
    if (exists(join(directory, ".git")) && (await headOf(git, directory)) !== "") await assertClean(git, directory); // never discard local work
    await git(["-C", directory, "fetch", "--quiet", "--depth", "1", repository, commit]);
    await git(["-C", directory, "checkout", "--quiet", "--detach", commit]);
    fetched = true;
  }
  const head = await headOf(git, directory);
  if (head !== commit) throw new PinnedCheckoutError(`The checkout in ${directory} is not the pinned commit after fetching it.`);
  await assertClean(git, directory);
  return { commit: head, fetched };
}
