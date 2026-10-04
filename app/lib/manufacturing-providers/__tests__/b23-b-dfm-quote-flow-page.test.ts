/**
 * [B23-B2 review, 2026-10-04] The page `artifacts/ai-control-plane-b23/dfm-quote-flow.md` states what the tree holds, and the earlier
 * B23 pages carry a dated note on every statement B2 made false (the adversarial review's regressions-2, coverage-7, coverage-8 and
 * coverage-9):
 *  1. its closure line splits D23-4: the exchange half closes in B2, the order-contract half stays B23-C's (OD-172);
 *  2. it never calls B1's suites unchanged, since its own section 10 lists B1 pins B2 moved;
 *  3. every citation of its section 14 resolves on the line it names (the anchor text is the check);
 *  4. the B1 and A2 statements B2 made false each carry a dated B2 note on their own line;
 *  5. the exchange record's header states the whole re-derivation condition, rule-profile evidence included, and leaves the
 *     staleness half to B23-B3 (OD-168);
 *  6. [B23-B2 lead, 2026-10-04] low-1: the B1 statements that a commit of a plan this instance does not hold answers PX_PLAN_NOT_FOUND
 *     before any durable read each carry a dated lead note, and section 4 states the production order.
 * Reads files only. Nothing is written and nothing leaves the process.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const PAGE = "artifacts/ai-control-plane-b23/dfm-quote-flow.md";
const NEWLINE = String.fromCharCode(10);
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8").replaceAll(`${String.fromCharCode(13)}${NEWLINE}`, NEWLINE);
const lines = (path: string): string[] => read(path).split(NEWLINE);
/** The text of `## <number>.` up to the next `## ` heading. */
function section(page: string, number: number): string {
  const start = page.indexOf(`${NEWLINE}## ${number}. `);
  expect(start, `section ${number}`).toBeGreaterThan(-1);
  const end = page.indexOf(`${NEWLINE}## `, start + 4);
  return page.slice(start, end < 0 ? undefined : end);
}
const NOTE = "[B23-B2, 2026-10-04]";

describe("[B23-B2 review] the dfm-quote-flow page and the statements B2 made false", () => {
  it("1. coverage-7: the closure line closes D23-3, D23-4's exchange half and D23-5's receipt half, and leaves D23-4's order-contract half to B23-C (OD-172)", () => {
    const closes = lines(PAGE).slice(0, 12).join(" ");
    expect(closes).toContain("Closes D23-3, D23-4's exchange half");
    expect(closes).toMatch(/D23-4's order-contract half stays B23-C's \(OD-172\)/);
    expect(closes).toContain("D23-5's receipt half");
    expect(closes).not.toMatch(/Closes D23-3, D23-4 and D23-5/);
  });

  it("2. coverage-9: the page never calls B1's suites unchanged, while its section 10 lists the B1 pins B2 moved", () => {
    const page = read(PAGE);
    expect(section(page, 10)).toContain("`b23-b-exchange-route.test.ts` case 4");
    expect(section(page, 10)).toContain("`b23-b-approval-plan.test.ts` case 9");
    for (const stale of ["B1's suites unchanged", "case 9, unchanged", "its suites ran unchanged"]) expect(page, stale).not.toContain(stale);
  });

  it("3. every citation of section 14 resolves on the line it names, and ids run C1..Cn", () => {
    const rows = [...section(read(PAGE), 14).matchAll(/^\| (C\d+) \| `([^`]+)` \| (\d+) \| (.+) \|$/gm)];
    expect(rows.length).toBeGreaterThanOrEqual(40);
    expect(rows.map((row) => row[1])).toEqual(rows.map((_, index) => `C${index + 1}`));
    const unescape = (cell: string): string => {
      const fence = cell.startsWith("``") && cell.endsWith("``") ? 2 : 1;
      expect(cell.startsWith("`") && cell.endsWith("`"), cell).toBe(true);
      return cell.slice(fence, -fence).replaceAll("\\|", "|");
    };
    const stale = rows.filter((row) => !(lines(row[2]!)[Number(row[3]) - 1] ?? "").includes(unescape(row[4]!))).map((row) => `${row[1]} ${row[2]}:${row[3]}`);
    expect(stale).toEqual([]);
  });

  it("4. regressions-2: each B1 and A2 statement B2 made false carries a dated B2 note on its own line", () => {
    const statements: ReadonlyArray<readonly [string, string]> = [
      ["artifacts/ai-control-plane-b23/outbound-disclosure.md", "the service still has no transport and answers `PX_SEND_UNAVAILABLE`"],
      ["artifacts/ai-control-plane-b23/outbound-disclosure.md", "case 8) passes unchanged. CONFIRMED"],
      ["artifacts/ai-control-plane-b23/tier3-vocabulary.md", "Eleven route files reach the boundary"],
    ];
    for (const [path, statement] of statements) {
      const found = lines(path).filter((line) => line.includes(statement));
      expect(found, `${path}: ${statement}`).toHaveLength(1);
      expect(found[0], `${path}: ${statement}`).toContain(NOTE);
    }
    // the "exactly six modules" paragraph ends on the line its note is on
    const page = lines("artifacts/ai-control-plane-b23/outbound-disclosure.md");
    const at = page.findIndex((line) => line.includes("plus exactly six modules"));
    expect(at).toBeGreaterThan(-1);
    expect(page.slice(at, at + 4).join(" ")).toContain(`${NOTE} No longer true as written`);
  });

  it("5. coverage-8: the exchange record's header states the whole re-derivation condition - authority head, board current, rule-profile evidence unexpired and within RELEASE_PROFILE_EVIDENCE_MAX_AGE_MS - and leaves the staleness half to B23-B3 (OD-168)", () => {
    const header = read("app/lib/manufacturing-providers/exchange-ledger.ts").split("*/")[0]!;
    for (const fact of ["while its authority is head", "its board current", "rule-profile evidence unexpired", "RELEASE_PROFILE_EVIDENCE_MAX_AGE_MS", "B23-B3's, OD-168"]) expect(header, fact).toContain(fact);
  });

  it("6. [B23-B2 lead, 2026-10-04] low-1: since tests-3's durable read (`recorded`), a commit whose plan this instance does not hold reads the exchange record before it answers PX_PLAN_NOT_FOUND; each B1 statement that said otherwise - the commit's checks before any port, the restart, another instance - and B1's approval-plan case 4, whose ports hold no exchange record, carries a dated lead note on its own line naming the store-unavailable answer and the case that pins the production order, and this page's section 4 states the order", () => {
    const LEAD = "[B23-B2 lead, 2026-10-04]";
    const statements: ReadonlyArray<readonly [string, string]> = [
      ["artifacts/ai-control-plane-b23/outbound-disclosure.md", "the plan exists in this project (`PX_PLAN_NOT_FOUND` 404)"],
      ["artifacts/ai-control-plane-b23/outbound-disclosure.md", "them, and a commit then refuses `PX_PLAN_NOT_FOUND`"],
      ["artifacts/ai-control-plane-b23/outbound-disclosure.md", "`PX_PLAN_NOT_FOUND`. INFERRED"],
      ["app/lib/manufacturing-providers/__tests__/b23-b-approval-plan.test.ts", "an unknown plan, another project's plan and a wrong digest are refused before any port is called"],
    ];
    for (const [path, statement] of statements) {
      const found = lines(path).filter((line) => line.includes(statement));
      expect(found, `${path}: ${statement}`).toHaveLength(1);
      for (const part of [LEAD, "MFG_DURABLE_STORE_UNAVAILABLE", "b23-b-exchange-ledger"]) expect(found[0], `${path}: ${statement} - ${part}`).toContain(part);
    }
    const four = section(read(PAGE), 4);
    for (const part of [LEAD, "MFG_DURABLE_STORE_UNAVAILABLE", "case 23"]) expect(four, part).toContain(part);
  });
});
