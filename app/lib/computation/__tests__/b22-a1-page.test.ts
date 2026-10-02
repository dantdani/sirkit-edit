/**
 * [B22-A1] The page `artifacts/ai-control-plane-b22/deck-and-secret-corrections.md` states what the code holds: its sections
 * and labels, the approval level of every SPICE AI operation kind (the code's table), the output bounds (the code's
 * constants), the kicad-cli environment allowlist (the code's list), every citation resolving on the line it names, every
 * B22-A1 suite with its `it(`/`it.each(` block count, and the lead's reserved texts in full.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const PAGE = "artifacts/ai-control-plane-b22/deck-and-secret-corrections.md";
const SUITES_DIR = "app/lib/computation/__tests__";
const NEWLINE = String.fromCharCode(10);
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");
const SECTIONS = [
  "0. What B22-A1 is",
  "1. The model screen screens what the deck emits (D22-4)",
  "2. The diagnostic channels are bounded (D22-4, D22-8)",
  "3. kicad-cli's explicit environment (D22-5)",
  "4. Output caps for kicad-cli and FreeRouting (D22-8, OD-148)",
  "5. SPICE AI approval levels (OD-150, the approval half)",
  "6. CI admission (OD-146)",
  "7. Pin moves",
  "8. Gates",
  "9. What stays open",
  "10. Citations",
  "11. For the lead",
];
/** The text of `## <title>` up to the next `## ` heading. */
function section(page: string, title: string): string {
  const start = page.indexOf(`${NEWLINE}## ${title}${NEWLINE}`);
  expect(start, `section "${title}"`).toBeGreaterThan(-1);
  const end = page.indexOf(`${NEWLINE}## `, start + 4);
  return page.slice(start, end < 0 ? undefined : end);
}

describe("[B22-A1] the page", () => {
  it("1. exists with its labels and its twelve sections in order", () => {
    const page = read(PAGE);
    expect(page.startsWith("# B22-A1 - ")).toBe(true);
    for (const label of ["CONFIRMED", "INFERRED", "RECORDED", "UNKNOWN"]) expect(page, label).toContain(`**${label}**`);
    const positions = SECTIONS.map((title) => page.indexOf(`${NEWLINE}## ${title}${NEWLINE}`));
    expect(positions.every((position) => position > 0), JSON.stringify(positions)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("2. section 5 lists every SPICE AI operation kind with the level the code's table gives it", async () => {
    const { SPICE_AI_APPROVAL } = await import("@/app/lib/spice/ai-approval");
    const rows = [...section(read(PAGE), SECTIONS[5]!).matchAll(/^\| `([a-z-]+)` \| (automatic|review|explicit) \|/gm)].map((match) => [match[1], match[2]]);
    expect(rows.sort()).toEqual(Object.entries(SPICE_AI_APPROVAL).sort());
  });

  it("3. sections 2 and 4 state the bounds the code holds", async () => {
    const bounds = await import("@/app/lib/computation/output-bounds");
    const two = section(read(PAGE), SECTIONS[2]!);
    const four = section(read(PAGE), SECTIONS[4]!);
    expect(two).toContain(`\`DIAGNOSTIC_OUTPUT_MAX_BYTES\` = ${bounds.DIAGNOSTIC_OUTPUT_MAX_BYTES}`);
    expect(two).toContain(`\`DIAGNOSTIC_EXCERPT_MAX_BYTES\` = ${bounds.DIAGNOSTIC_EXCERPT_MAX_BYTES}`);
    expect(two).toContain(`\`${JSON.stringify(bounds.OUTPUT_TRUNCATION_MARKER).slice(1, -1)}\``);
    expect(four).toContain(`\`TOOL_OUTPUT_FILE_MAX_BYTES\` = ${bounds.TOOL_OUTPUT_FILE_MAX_BYTES}`);
  });

  it("4. section 3 states the kicad-cli allowlist the code holds", async () => {
    const runner = await import("@/app/lib/pcb/fab/kicad-cli-runner");
    const line = section(read(PAGE), SECTIONS[3]!).split(NEWLINE).find((text) => text.startsWith("The allowlist: "));
    expect(line, "the allowlist line").toBeDefined();
    expect([...line!.matchAll(/`([A-Za-z_]+)`/g)].map((match) => match[1])).toEqual([...runner.KICAD_CLI_ENV_KEYS]);
  });

  it("5. every citation in section 10 resolves on the line it names, ids run C1..Cn, and every changed production file is cited", () => {
    const rows = [...section(read(PAGE), SECTIONS[10]!).matchAll(/^\| (C\d+) \| `([^`]+)` \| (\d+) \| `([^`]+)` \|/gm)];
    expect(rows.length).toBeGreaterThanOrEqual(20);
    expect(rows.map((row) => row[1])).toEqual(rows.map((_, index) => `C${index + 1}`));
    const stale = rows.filter((row) => !(read(row[2]!).split(NEWLINE)[Number(row[3]) - 1] ?? "").includes(row[4]!)).map((row) => `${row[1]} ${row[2]}:${row[3]}`);
    expect(stale).toEqual([]);
    for (const path of [
      "app/lib/computation/output-bounds.ts",
      "app/lib/spice/models.ts",
      "app/lib/spice/netlist.ts",
      "app/lib/spice/server/worker.ts",
      "app/lib/spice/server/job-store.ts",
      "app/lib/spice/ai-approval.ts",
      "app/api/spice/models/smoke-test/route.ts",
      "app/api/spice/ai/route.ts",
      "app/components/spice/SpiceStudio.tsx",
      "app/lib/pcb/fab/kicad-cli-runner.ts",
      "app/lib/pcb/fab/build-bundle.ts",
      "app/lib/pcb/autoroute/runner.ts",
      ".github/workflows/deterministic-manufacturing.yml",
      "app/lib/acquisition/__tests__/b19-e-ci-job-scope.test.ts",
    ]) expect(rows.some((row) => row[2] === path), path).toBe(true);
  });

  it("6. section 8 names every B22-A1 suite with its it( / it.each( block count", () => {
    const eight = section(read(PAGE), SECTIONS[8]!);
    const suites = readdirSync(join(ROOT, SUITES_DIR)).filter((name) => name.startsWith("b22-a1-") && name.endsWith(".test.ts")).sort(); // [B22-A2] reviewed pin move: the folder is shared by every B22 increment; A1's page names A1's suites (was: every suite in the folder)
    expect(suites.length).toBeGreaterThanOrEqual(6);
    for (const name of suites) {
      const path = `${SUITES_DIR}/${name}`;
      const blocks = (read(path).match(/^\s*it(?:\.each)?[(<]/gm) ?? []).length;
      expect(eight, path).toMatch(new RegExp(`^\\| \`${path.replace(/[.]/g, "\\.")}\` \\| ${blocks} \\|`, "m"));
    }
  });

  it("7. section 11 holds every reserved text in full: OD-146, OD-148 and OD-150 as applied, the README row, the ledger paragraph and the discovery clauses for D22-4, D22-5, D22-8 and OD-150", () => {
    const lead = section(read(PAGE), SECTIONS[11]!);
    expect(lead.length).toBeGreaterThan(4_000);
    for (const heading of ["### OWNER_DECISIONS", "### README row", "### EXECUTION_LEDGER paragraph", "### Discovery closure clauses"]) expect(lead, heading).toContain(heading);
    for (const decision of ["OD-146", "OD-148", "OD-150"]) expect(lead, decision).toMatch(new RegExp(`^> ## ${decision} — .+, as applied \\(B22-A1, 2026-10-01\\)$`, "m"));
    for (const clause of ["D22-4", "D22-5", "D22-8", "OD-150"]) expect(lead, clause).toMatch(new RegExp(`^- ${clause}: `, "m"));
    expect(lead).toMatch(/^\| B22-A1 /m);
    expect(lead).toMatch(/^> ### B22-A1 - /m);
  });
});
