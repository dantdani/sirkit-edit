/**
 * [B23-B1 review, 2026-10-04] The page `artifacts/ai-control-plane-b23/outbound-disclosure.md` states what the tree holds: its
 * sections in order; every line citation the discovery and A2's page make into a file B1 changed, mapped to the line its content holds
 * now (section 8; the first page mapped one range a line low and left most of the moved ranges out); every citation of section 12 on
 * the line it names; and a stale statement B1 left in place on purpose (the provider registry's header says no route reads it, but
 * the provider exchange route does; a registry edit bumps its version, so the page records it until the next reviewed revision).
 *
 * Reads files only. Nothing is written and nothing leaves the process.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { collectProductionFiles } from "@/app/lib/project/__tests__/_import-gate-helpers";
import { importClosure } from "@/app/lib/mcp/server/__tests__/_import-closure";

const ROOT = process.cwd();
const PAGE = "artifacts/ai-control-plane-b23/outbound-disclosure.md";
const NEWLINE = String.fromCharCode(10);
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8").replaceAll(`${String.fromCharCode(13)}${NEWLINE}`, NEWLINE);
const lines = (path: string): string[] => read(path).split(NEWLINE);
const SECTIONS = [
  "0. What B23-B1 is",
  "1. The exact disclosure of the pinned 555 release",
  "2. Step 1: `revalidateReleaseAuthority` (D23-7)",
  "3. Step 2: `buildOutboundPackage` (D23-6, OD-163)",
  "4. Step 3: the sealed plan and the commit (OD-164, OD-166)",
  "5. The route, its rows and the census (OD-174)",
  "6. The panel",
  "7. Test-first record",
  "8. Every pin moved, and why",
  "9. Gates",
  "10. OD-183 - B23-B1's choices beyond its task text",
  "11. What stays open",
  "12. Citations",
  "13. The adversarial review of the first B1 tree, and what it changed",
];
/** The text of `## <title>` up to the next `## ` heading. */
function section(page: string, title: string): string {
  const start = page.indexOf(`${NEWLINE}## ${title}${NEWLINE}`);
  expect(start, `section "${title}"`).toBeGreaterThan(-1);
  const end = page.indexOf(`${NEWLINE}## `, start + 4);
  return page.slice(start, end < 0 ? undefined : end);
}
const REGISTRY = "app/lib/manufacturing-providers/provider-registry.ts";
const STALE_SENTENCE = "no route reads this registry yet";

describe("[B23-B1 review] the outbound-disclosure page", () => {
  it("1. exists with its labels and its fourteen sections in order", () => {
    const page = read(PAGE);
    expect(page.startsWith("# B23-B1 - ")).toBe(true);
    for (const label of ["CONFIRMED", "INFERRED", "RECORDED", "UNKNOWN", "BLOCKED-LIVE-QUALIFICATION"]) expect(page, label).toContain(`**${label}**`);
    const positions = SECTIONS.map((title) => page.indexOf(`${NEWLINE}## ${title}${NEWLINE}`));
    expect(positions.every((position) => position > 0), JSON.stringify(positions)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("2. section 8 maps every moved citation (regressions-1, regressions-2): each anchor is on the first line it names now, each range ends inside its file, and the release route's and the workflow panel's cited ranges are all there", () => {
    const rows = [...section(read(PAGE), SECTIONS[8]!).matchAll(/^\| `([^`]+)` \| (\d+(?:-\d+)?) \| ([^|]+) \| (\d+)(?:-(\d+))? \| `([^`]+)` \|$/gm)];
    expect(rows.length).toBeGreaterThanOrEqual(24);
    const stale = rows.filter((row) => !(lines(row[1]!)[Number(row[4]) - 1] ?? "").includes(row[6]!)).map((row) => `${row[1]}:${row[2]} -> :${row[4]} (${row[6]})`);
    expect(stale).toEqual([]);
    const short = rows.filter((row) => lines(row[1]!).length < Number(row[5] ?? row[4])).map((row) => `${row[1]}:${row[4]}-${row[5]}`);
    expect(short).toEqual([]);
    const cited = (file: string) => rows.filter((row) => row[1] === file).map((row) => row[2]);
    expect(cited("app/api/pcb/release/route.ts")).toEqual(["88-123", "95-101", "95-120", "107", "109", "109-111", "114-120", "116-120", "124", "124-139", "126-139", "140-151", "152-153"]);
    expect(cited("app/components/pcb/ManufacturingWorkflowPanel.tsx")).toEqual(["52", "71", "96", "106-112"]);
    // the workflow panel's import was appended in place: its cited lines hold their content
    expect(rows.filter((row) => row[1] === "app/components/pcb/ManufacturingWorkflowPanel.tsx").every((row) => row[2] === `${row[4]}${row[5] ? `-${row[5]}` : ""}`)).toBe(true);
  });

  it("3. every citation in section 12 resolves on the line it names, and ids run C1..Cn", () => {
    const rows = [...section(read(PAGE), SECTIONS[12]!).matchAll(/^\| (C\d+) \| `([^`]+)` \| (\d+) \| (.+) \|$/gm)];
    expect(rows.length).toBeGreaterThanOrEqual(19);
    expect(rows.map((row) => row[1])).toEqual(rows.map((_, index) => `C${index + 1}`));
    /** The anchor inside its code span (single or double backticks), with the table's escaped pipes restored. */
    const unescape = (cell: string): string => {
      const fence = cell.startsWith("``") && cell.endsWith("``") ? 2 : 1;
      expect(cell.startsWith("`") && cell.endsWith("`"), cell).toBe(true);
      return cell.slice(fence, -fence).replaceAll("\\|", "|");
    };
    const stale = rows.filter((row) => !(lines(row[2]!)[Number(row[3]) - 1] ?? "").includes(unescape(row[4]!))).map((row) => `${row[1]} ${row[2]}:${row[3]}`);
    expect(stale).toEqual([]);
  });

  it("4. regressions-4: while the provider registry's header still says no route reads it and the provider exchange route's closure reads it, the page records that statement as stale, citing its line", () => {
    const header = lines(REGISTRY);
    const at = header.findIndex((line) => line.includes(STALE_SENTENCE));
    const closure = importClosure(collectProductionFiles(ROOT), ["app/api/pcb/provider-exchange/route.ts"]);
    expect(closure.has(REGISTRY)).toBe(true);
    if (at < 0) return; // corrected by a reviewed registry revision: nothing left to record
    const records = read(PAGE).split(NEWLINE).filter((line) => line.includes(`\`${REGISTRY.split("/").at(-1)}:${at + 1}\``) && line.includes(STALE_SENTENCE));
    expect(records, `${REGISTRY}:${at + 1}`).toHaveLength(1);
  });
});

const FILE_NAME = String.raw`[A-Za-z0-9_./-]+\.(?:tsx?|md|csv|json|sql|yml)\b`;
const RUNBOOK_LEAD = /^(?:[Rr]unbook|Requirement:|global)$/;
/**
 * [B23-B1 lead, 2026-10-04] low-2: what each citation `:<range>` on one page line cites. A citation written `file:<range>` cites that
 * file. A bare one cites the nearest file or runbook named before it on the same line: the discovery introduces the runbook's lines
 * with "Runbook", "Requirement:" or "global". A bare citation with nothing named before it on its line continues an earlier line's
 * subject; this does not resolve it (null), so such a row is accepted unchecked.
 */
function citedFiles(line: string, range: string): Array<string | null> {
  const found: Array<string | null> = [];
  for (const match of line.matchAll(new RegExp(String.raw`(?<![0-9])([A-Za-z0-9_./-]*\.(?:tsx?|md|csv|json|sql|yml))?:${range}(?![0-9]|-[0-9])`, "g"))) {
    if (match[1]) { found.push(match[1]); continue; }
    const named = [...line.slice(0, match.index).matchAll(new RegExp(String.raw`\b(?:[Rr]unbook|Requirement:|global)(?=\W)|${FILE_NAME}`, "g"))].at(-1)?.[0] ?? null;
    found.push(named === null ? null : RUNBOOK_LEAD.test(named) ? "runbook" : named);
  }
  return found;
}

describe("[B23-B1 lead, 2026-10-04] the citation map's 'cited at' column (low-2)", () => {
  it("5. every discovery and A2-page line that section 8's 'cited at' column names cites that row's file at that row's range - never another file's or the runbook's same numbers (discovery :544 and :997 cite runbook :152-153, not the release route's)", () => {
    // the resolver itself: a qualified citation, a bare one after a file, the runbook's two leads, and one with nothing before it
    expect(citedFiles("(`app/api/pcb/release/route.ts:124-139` before `:152-153`)", "152-153")).toEqual(["app/api/pcb/release/route.ts"]);
    expect(citedFiles("Requirement: B23-B step 2 `:976`; global `:152-153`. Finding:", "152-153")).toEqual(["runbook"]);
    expect(citedFiles("at `release-gate.ts:367`. Runbook `:152-153` is a loose anchor", "152-153")).toEqual(["runbook"]);
    expect(citedFiles("  revision AND digest, `MFG_AUTHORITY_STALE` (`:109-111`); rule-profile", "109")).toEqual([]);
    expect(citedFiles("  revision AND digest, `MFG_AUTHORITY_STALE` (`:109-111`); rule-profile", "109-111")).toEqual([null]);
    const sources: Record<string, string[]> = { discovery: lines("artifacts/ai-control-plane-b23/discovery.md").filter((line) => !/^- \[B23(?:-[B-D]\d*| closeout)\b/.test(line)), "A2 page": lines("artifacts/ai-control-plane-b23/tier3-vocabulary.md") }; // [B23-B1 lead, 2026-10-04] the map numbers the discovery as at da36d51: each closure clause the lead inserts from B23-B1 on is one dated line, dropped before resolving
    const rows = [...section(read(PAGE), SECTIONS[8]!).matchAll(/^\| `([^`]+)` \| (\d+(?:-\d+)?) \| ([^|]+) \| (\d+)(?:-(\d+))? \| `([^`]+)` \|$/gm)];
    expect(rows.length).toBeGreaterThanOrEqual(24);
    const wrong: string[] = [];
    let checked = 0;
    for (const row of rows) {
      const [file, range] = [row[1]!, row[2]!];
      for (const [label, source] of Object.entries(sources)) {
        const listed = new RegExp(String.raw`${label} ((?::\d+(?:, )?)+)`).exec(row[3]!)?.[1]?.match(/\d+/g) ?? [];
        for (const at of listed) {
          const files = citedFiles(source[Number(at) - 1] ?? "", range);
          checked += 1;
          if (!files.some((cited) => cited === null || cited === file || file.endsWith(`/${cited}`))) wrong.push(`${file}:${range} cited at ${label} :${at} -> ${JSON.stringify(files)}`);
        }
      }
    }
    expect(wrong).toEqual([]);
    expect(checked).toBeGreaterThanOrEqual(40);
  });
});
