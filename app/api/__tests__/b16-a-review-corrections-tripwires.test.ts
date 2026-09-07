/**
 * B16-A — source-level tripwires for the review corrections that cannot be
 * exercised by a unit test of the page component (app/page.tsx is a single
 * 6,000-line client component). Each tripwire pins the exact shape of the
 * correction so a regression fails CI before a human notices.
 *
 * F11 — provider-generated schematics NEVER apply themselves. The only
 * `applySchematic(` call sites allowed in app/page.tsx are: the function's
 * own definition, the review dialog's approval handler, and the deterministic
 * layout "tidy" (positions/wire geometry only; connectivity is verified
 * unchanged by the server before it is applied, and it is documented as such).
 * The Tier-2 topology edit path (`/api/schematic/edit-build`) and the
 * "Apply suggestions" path must stage their result in the SAME review dialog
 * (`setPendingReplace`) as generation does.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..");
const read = (relative: string): string => readFileSync(join(ROOT, relative), "utf8");

describe("B16-A F11 — no hidden auto-apply of provider output (app/page.tsx)", () => {
  const page = read("app/page.tsx");

  it("applySchematic is invoked from exactly three places: definition, review-dialog approval, layout tidy", () => {
    const sites = [...page.matchAll(/applySchematic\(/g)].map((match) => match.index ?? -1);
    expect(sites).toHaveLength(3);
    const contexts = sites.map((index) => page.slice(Math.max(0, index - 400), index + 200));
    expect(contexts[0]).toMatch(/async function applySchematic\(/);
    expect(contexts[1]).toMatch(/Tidy the schematic layout/);
    expect(contexts[2]).toMatch(/const pending = pendingReplace;/);
  });

  it("the Tier-2 topology edit path stages the edit-build result for review (never applies it)", () => {
    const start = page.indexOf('await fetch("/api/schematic/edit-build"');
    expect(start).toBeGreaterThan(0);
    const branch = page.slice(start, page.indexOf("// B06.1: receiving provider output MUTATES NOTHING", start));
    expect(branch).toContain("setPendingReplace({ state: built.state");
    expect(branch).toContain("skipAutoRun: isApplyingSuggestions");
    expect(branch).not.toMatch(/applySchematic\(/);
  });

  it("the review dialog carries the edit path's options and shows the validation note", () => {
    expect(page).toContain("skipAutoRun: pending.skipAutoRun");
    expect(page).toContain('data-testid="schematic-proposal-validation"');
    expect(page).toContain("validationNote?: string | null;");
  });

  it("the layout tidy path applies only a server-verified re-layout (connectivity unchanged) and says so", () => {
    const tidy = page.slice(page.indexOf("if (data.applied) {"), page.indexOf('await applySchematic(data.state, note, "Tidy the schematic layout"'));
    expect(tidy).toMatch(/Re-layout replaces positions/);
    expect(page).toContain("A tidied re-layout would have broken connectivity, so the original was kept.");
  });
});

describe("B16-A F3/F6 — closed manufacturing request bodies", () => {
  it("the qualify and release routes declare closed key sets and refuse undeclared keys", () => {
    const qualify = read("app/api/pcb/qualify/route.ts");
    expect(qualify).toContain('export const QUALIFY_BODY_KEYS: ReadonlySet<string> = new Set(["boardId", "designId"]);');
    expect(qualify).toContain('manufacturingRefusal("MFG_API_UNKNOWN_FIELD"');
    expect(qualify).not.toMatch(/body\.seeds/);
    const release = read("app/api/pcb/release/route.ts");
    expect(release).toContain('export const RELEASE_BODY_KEYS: ReadonlySet<string> = new Set(["boardId", "designId", "expectedAuthorityRevision", "expectedAuthorityDigest", "format"]);');
    expect(release).toContain('manufacturingRefusal("MFG_AUTHORITY_CONFIRMATION_REQUIRED"');
  });

  it("qualification never publishes the board outside the atomic commit and never runs a process-local guard", () => {
    const qualify = read("app/api/pcb/qualify/route.ts");
    expect(qualify).not.toMatch(/publishBoard\(/);
    expect(qualify).not.toMatch(/commitSelected:/); // the layout callback that used to publish the board mid-qualification
    expect(qualify).not.toMatch(/new Map</);
    expect(qualify).toContain("commitQualification(workflow, {");
    expect(qualify).toContain("new DurableQualificationLease(");
    expect(qualify).toContain("snapshotToSourceNetlist(applied.snapshot)");
    expect(qualify).not.toMatch(/boardToSourceNetlist/);
  });
});
