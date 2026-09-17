/**
 * [B19-D I5e review; row 05's minimal fix] The operator ingest reads pinned, verified KiCad library commits — never upstream HEAD.
 *
 * Reproduced first by the tripwire: both ingest scripts ran `git pull --ff-only` (or cloned HEAD) with no pin. The checkout logic
 * is exercised with a scripted git runner (no network, no repository is touched).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ensurePinnedCheckout, KICAD_LIBRARY_PINS, PinnedCheckoutError, type GitRunner } from "../pinned-checkout";

const PIN = KICAD_LIBRARY_PINS.symbols.commit;
const OTHER = "1".repeat(40);

function scriptedGit(state: { head: string; dirty?: boolean; fetchLands?: boolean }): { git: GitRunner; calls: string[][] } {
  const calls: string[][] = [];
  let fetchedCommit: string | null = null;
  const git: GitRunner = async (args) => {
    calls.push([...args]);
    const verb = args[0] === "-C" ? args[2] : args[0];
    if (verb === "rev-parse") {
      if (!state.head) throw new Error("fatal: Needed a single revision");
      return `${state.head}\n`;
    }
    if (verb === "status") return state.dirty ? " M Device.kicad_symdir/R.kicad_sym\n" : "";
    if (verb === "fetch") fetchedCommit = args[args.length - 1]!;
    if (verb === "checkout") {
      if (fetchedCommit !== args[args.length - 1]) throw new Error("fatal: reference is not a tree");
      if (state.fetchLands !== false) state.head = fetchedCommit; // a checkout that silently stays elsewhere is caught by the verification
    }
    return "";
  };
  return { git, calls };
}

const verbs = (calls: string[][]) => calls.map((args) => (args[0] === "-C" ? args[2] : args[0]));

describe("[B19-D I5e review] KiCad library checkouts are pinned and verified", () => {
  it("a checkout already at the pin is verified and nothing is fetched", async () => {
    const { git, calls } = scriptedGit({ head: PIN });
    await expect(ensurePinnedCheckout({ directory: "data/kicad-symbols", repository: KICAD_LIBRARY_PINS.symbols.repository, commit: PIN, git, exists: () => true })).resolves.toEqual({ commit: PIN, fetched: false });
    expect(verbs(calls)).not.toContain("fetch");
    expect(verbs(calls)).not.toContain("pull");
  });

  it("a checkout at another commit fetches the pin by id from the pinned repository and checks it out detached", async () => {
    const { git, calls } = scriptedGit({ head: OTHER });
    await expect(ensurePinnedCheckout({ directory: "d", repository: KICAD_LIBRARY_PINS.symbols.repository, commit: PIN, git, exists: () => true })).resolves.toEqual({ commit: PIN, fetched: true });
    expect(calls).toContainEqual(["-C", "d", "fetch", "--quiet", "--depth", "1", KICAD_LIBRARY_PINS.symbols.repository, PIN]);
    expect(calls).toContainEqual(["-C", "d", "checkout", "--quiet", "--detach", PIN]);
    expect(verbs(calls)).not.toContain("pull");
  });

  it("a missing checkout is initialised and fetched at the pin", async () => {
    const { git, calls } = scriptedGit({ head: "" });
    await expect(ensurePinnedCheckout({ directory: "d", repository: KICAD_LIBRARY_PINS.footprints.repository, commit: PIN, git, exists: () => false })).resolves.toEqual({ commit: PIN, fetched: true });
    expect(calls[0]).toEqual(["init", "--quiet", "d"]);
  });

  it("a checkout that does not end at the pin is refused", async () => {
    const { git } = scriptedGit({ head: OTHER, fetchLands: false });
    await expect(ensurePinnedCheckout({ directory: "d", repository: "r", commit: PIN, git, exists: () => true })).rejects.toBeInstanceOf(PinnedCheckoutError);
  });

  it("local modifications or extra files are refused, and never discarded by a checkout", async () => {
    const atPin = scriptedGit({ head: PIN, dirty: true });
    await expect(ensurePinnedCheckout({ directory: "d", repository: "r", commit: PIN, git: atPin.git, exists: () => true })).rejects.toBeInstanceOf(PinnedCheckoutError);
    const elsewhere = scriptedGit({ head: OTHER, dirty: true });
    await expect(ensurePinnedCheckout({ directory: "d", repository: "r", commit: PIN, git: elsewhere.git, exists: () => true })).rejects.toBeInstanceOf(PinnedCheckoutError);
    expect(verbs(elsewhere.calls)).not.toContain("checkout");
  });

  it("a pin that is not a full commit id is refused", async () => {
    const { git } = scriptedGit({ head: PIN });
    await expect(ensurePinnedCheckout({ directory: "d", repository: "r", commit: "main", git, exists: () => true })).rejects.toBeInstanceOf(PinnedCheckoutError);
  });

  it.each(["scripts/ingest-kicad.ts", "scripts/ingest-footprints.ts"])("%s checks out the pin and never pulls or clones HEAD (tripwire)", (path) => {
    const source = readFileSync(path, "utf8");
    expect(source).toMatch(/ensurePinnedCheckout\(/);
    expect(source).toMatch(/KICAD_LIBRARY_PINS\.(symbols|footprints)/);
    expect(source).not.toMatch(/"pull"/);
    expect(source).not.toMatch(/"clone"/);
  });
});
