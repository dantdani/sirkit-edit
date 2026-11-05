/**
 * [B24-E] The live-blocker register normalised, its mirror, and the qualification matrix (D24-33, OD-217; D24-35 as recorded, OD-218;
 * D24-36 as recorded, OD-219; runbook B24-E `:1113-1123`, `:1157`).
 *
 *  1. every classification starts with exactly one of OD-217's three forms, and a QUALIFIED form's date, scope and resource parse;
 *  2. the ids run LB-1..LB-17 with no gap or duplicate;
 *  3. `PROGRAM_STATE.json` `liveBlockers` mirrors every row, one `LB-<n>: <form>: <check>` string per row, in order, nothing else;
 *  4. only LB-4 is QUALIFIED, and its cell names 2026-09-24, non-isolated and LB-14;
 *  5. each changed cell keeps its f663d71 wording verbatim inside B24-E's dated note, every other cell keeps its 6e4e1bb text as its
 *     prefix (no earlier note rewritten), and B24-E's dated notes stand where the task puts them;
 *  6. every `LB-<n>` a B24 page cites is a register row;
 *  7. the matrix parses: its column set, fifteen rows Q1..Q15 (Q14 and Q15 included), B1's six classes, the ten readiness scopes;
 *  8. LB coverage holds both ways, every row's state agrees with the register, Q6 and Q14 pass under the column rule (NOT APPLICABLE
 *     with CI evidence named), and the sandbox rule holds (Q4 BLOCKED while its recorded runs hold the failing class 4 result);
 *  9. every row's code fact holds - read from the code, not restated - and the matrix never names the retired ngspice variable;
 * 10. `ruleProfileEvidenceStatus` answers "ok" at 2027-09-09T23:59:59.999Z and "expired" at 2027-09-10T00:00:00.000Z.
 *
 * The register and its mirror are the lead's files (lead decision D14): B24-E drafts them, the lead applies them, and the drafts are
 * checked by the same functions (`_b24-e-register.ts`) before they are applied. Failing first on 6e4e1bb: the four cells fail the
 * closed set, the mirror holds eight strings with no LB id or form, and the matrix page is absent (qualification-matrix.md part 3).
 * Files are read as text; nothing is written to disk, nothing is started and nothing is contacted.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { admitSource } from "@/app/lib/acquisition/source-registry";
import { ACTION_COVERAGE_REGISTRY } from "@/app/lib/engineering/action-registry";
import { INTENTIONAL_MCP_EXPOSED_TOOL_IDS } from "@/app/lib/engineering/mcp-exposure-review";
import { OCI_HOST_CLIENT_SETTINGS, RUNTIME_PROFILE_DIGEST_SETTINGS } from "@/app/lib/computation/runtime-profile";
import { PRODUCTION_AUTH_STAGING_TARGETS } from "@/app/lib/deployment/production-auth-target";
import { EVAL_CLASSES, liveBlockerIdsOf } from "@/app/lib/evaluation/golden-catalog";
import { LIVE_PRICE_TABLE_SCHEMA } from "@/app/lib/evaluation/live-spend";
import { liveSuite } from "@/app/lib/evaluation/live-suites";
import { MODEL_PRICE_TABLE } from "@/app/lib/evaluation/model-price-table";
import { ORDERING_OWNER_RECORD, ORDER_SUBMISSION_PORT_WIRING } from "@/app/lib/manufacturing-providers/ordering-enablement";
import { ASSEMBLY_DATA_AUTHORITY, PHYSICAL_EVIDENCE_REVIEW_PORT_WIRING, assembledProductEligibility } from "@/app/lib/manufacturing-providers/physical-evidence";
import { PROVIDER_TRANSFER_DESCRIPTORS } from "@/app/lib/manufacturing-providers/provider-egress";
import { PROVIDER_REGISTRY } from "@/app/lib/manufacturing-providers/provider-registry";
import { MCP_SERVER_REGISTRY } from "@/app/lib/mcp/server-registry";
import { executeAuthoritativeSimulation } from "@/app/lib/model-simulation/safe-execution";
import { JLCPCB_2L_RULE_PROFILE_EVIDENCE, ruleProfileEvidenceStatus, ruleProfileExpiry } from "@/app/lib/pcb/fab/rule-profile";
import { CLASSIFICATION_FORMS, READINESS_SCOPES, STATUS_LINE_ROWS, classificationOf, classificationProblems, matrixProblems, matrixRows, mirrorProblems, registerProblems, registerRows, type MatrixRow, type RegisterRow } from "./_b24-e-register";
import { ciAdmission } from "./_ci-admission";

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8").replaceAll(`${CR}${NEWLINE}`, NEWLINE);
const readOrEmpty = (path: string): string => (existsSync(join(ROOT, path)) ? read(path) : "");
const REGISTER = "artifacts/remaining-builder-program/LIVE_BLOCKERS.md";
const STATE = "artifacts/remaining-builder-program/PROGRAM_STATE.json";
const MATRIX = "artifacts/ai-control-plane-b24/qualification-matrix.md";
const B24_PAGES = "artifacts/ai-control-plane-b24";
const NOTE = "[B24-E, 2026-10-10]";
const sha256 = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

/** The four classification cells B24-E changes, with their f663d71 wording (unchanged at 6e4e1bb) and the form each takes. */
const CHANGED: Readonly<Record<string, { readonly was: string; readonly starts: string }>> = {
  "LB-2": { was: "UNKNOWN", starts: "BLOCKED-LIVE-QUALIFICATION " },
  "LB-3": { was: "local-only; CI replays committed recordings keyed by placed-board revision and refuses unknown boards", starts: "BLOCKED-LIVE-QUALIFICATION for CI and qualified platforms " },
  "LB-4": { was: "dead external resource; one opt-in DB test fails in the default suite", starts: "QUALIFIED (2026-09-24, migrations and the nine DB-gated suites on two empty databases of a non-isolated server, the PostgreSQL 17.6 server of the main Supabase project); isolated staging: BLOCKED-LIVE-QUALIFICATION (LB-14) " },
  "LB-5": { was: "not attempted", starts: "BLOCKED-LIVE-QUALIFICATION " },
};
/**
 * Every row's cells at 6e4e1bb, kept as prefixes: the lengths of the check, classification (0 for the four changed cells), what exists
 * instead and unblocks when cells, and the sha256 of those prefixes joined by NUL. A rewritten earlier note changes the digest.
 */
const KEPT: Readonly<Record<string, readonly [readonly [number, number, number, number], string]>> = {
  "LB-1": [[107, 26, 163, 412], "8a69ab07543eaf601f270cd1e7a05c935285baee6a550e6ceb15c88e898f72c0"],
  "LB-2": [[67, 0, 121, 598], "444acb43399d1eb72ac50d01c54eb236b1d2062aad7215e52004c90856822b1f"],
  "LB-3": [[67, 0, 299, 480], "0597d40714e5af183202781325d237735115ae5ffa5c6dfb10dd072212551ff5"],
  "LB-4": [[98, 0, 85, 57], "10471fdc8713e2db11ca0f5cb21e40ec0620d18d129b58563273cfdcafd5aa67"],
  "LB-5": [[68, 0, 328, 35], "2a146045a78528247e2f703edff14861772738ca9b49a799af4b5ebd865752a1"],
  "LB-6": [[127, 64, 212, 83], "58ad76498b4975ef0e102f80f0d290bad06a29058d66d5c8e2033b4e8dfbe896"],
  "LB-7": [[164, 26, 261, 64], "c8c6e011206f2b8fc0ee20264e7701feb6812f23bf91445f6fb9a2da7f714058"],
  "LB-8": [[85, 26, 418, 428], "2fa50471bd0187dea9a87130f87027dc01ff220da42caa9354450a0740dd5e25"],
  "LB-9": [[81, 26, 584, 563], "978df7b2e34637577b327d3bf5e4fa4c1418d9fe810c8aa2de8aa9d3a8680a74"],
  "LB-10": [[113, 26, 1183, 1477], "7655c838792999fb849ff004e1283b1e5ae13554c203eaeb568e8b2ff7fe1dbe"],
  "LB-11": [[327, 26, 1061, 555], "37c80f9db51bf2b8535408a13f554662e0e53f97960ba4d273b9ede08f495bb2"],
  "LB-12": [[198, 26, 572, 651], "57c09d7125e8b663e1b1d0d5d139fc9aa21e74b44e6e43c2aa18f53b08875652"],
  "LB-13": [[165, 26, 455, 2016], "75a17d3b773fbfe6b066e3f4c9aec82e7463d376e1aecc0d43a511522c4f808a"],
  "LB-14": [[141, 26, 543, 2138], "95bed7690a48a5e97be3810e2531f6c34461370331002ce804235a938bdf043e"],
  "LB-15": [[114, 26, 465, 340], "0c740c56f6a9fb98c29c7e306a0fdad4e51b911f0cce971a27e8efad963601c4"],
  "LB-16": [[166, 26, 396, 88], "feeed429830a9921c7ff74b3877befa37371fa6310f83eaacf56f9a0d8aca1ab"],
  "LB-17": [[107, 26, 376, 839], "55b0736078bf3c6f00dd05a4e136ea8d4ab55ab7eec48aa157891764903b22e4"],
};
/** Where B24-E's dated notes stand: the unblocks-when notes the task names, and a checked-against-OD-217 note on LB-13..LB-17. */
const E_NOTED: readonly string[] = ["LB-1", "LB-2", "LB-5", "LB-7", "LB-9", "LB-13", "LB-14", "LB-15", "LB-16", "LB-17"];

const rowsOf = (): RegisterRow[] => registerRows(read(REGISTER));
const matrix = (): { rows: MatrixRow[]; problems: string[] } => matrixRows(readOrEmpty(MATRIX));
const rowOf = (rows: readonly MatrixRow[], id: string): MatrixRow => {
  const row = rows.find((candidate) => candidate.row === id);
  if (!row) throw new Error(`no matrix row ${id}`);
  return row;
};

describe("[B24-E] the live-blocker register in OD-217's vocabulary, its mirror and the qualification matrix (D24-33, D24-35, D24-36)", () => {
  it("1. every classification starts with exactly one of OD-217's forms - BLOCKED-LIVE-QUALIFICATION (with an optional qualifier), QUALIFIED (<date>, <scope>, <resource>) with no comma in the scope or the resource, or NOT APPLICABLE - and the reader refuses everything else", () => {
    const rows = rowsOf();
    expect(classificationProblems(rows)).toEqual([]);
    expect([...CLASSIFICATION_FORMS]).toEqual(["BLOCKED-LIVE-QUALIFICATION", "QUALIFIED", "NOT APPLICABLE"]);
    for (const row of rows.filter((candidate) => classificationOf(candidate.cells[2] ?? "")?.form === "QUALIFIED")) {
      const qualified = classificationOf(row.cells[2]!)!.qualified!;
      expect(qualified.date, row.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(`${qualified.scope}${qualified.resource}`, row.id).not.toContain(",");
    }
    // the reader bites: the old words, a padded or lower-cased form, a word glued to the form, a bad date, a comma in a part
    for (const cell of ["UNKNOWN", "local-only; CI replays committed recordings", "dead external resource", "not attempted", " BLOCKED-LIVE-QUALIFICATION", "blocked-live-qualification", "BLOCKED-LIVE-QUALIFICATIONS", "QUALIFIED", "QUALIFIED (2026-02-30, a scope, a resource)", "QUALIFIED (2026-09-24, a scope, with, a comma)", "QUALIFIED (2026-09-24, , a resource)", "NOT APPLICABLEX", "PARTIAL"]) expect(classificationOf(cell), cell).toBeNull();
    expect(classificationOf("BLOCKED-LIVE-QUALIFICATION for CI and qualified platforms")?.text).toBe("BLOCKED-LIVE-QUALIFICATION");
    expect(classificationOf("NOT APPLICABLE")?.form).toBe("NOT APPLICABLE");
  });

  it("2. the ids run LB-1..LB-17 in order with no gap or duplicate, each row of five cells, and B1's register reader reads the same ids", () => {
    const rows = rowsOf();
    expect(rows.map((row) => row.id)).toEqual(Array.from({ length: 17 }, (_, index) => `LB-${index + 1}`));
    expect(registerProblems(rows)).toEqual([]);
    expect(liveBlockerIdsOf(read(REGISTER))).toEqual(rows.map((row) => row.id));
    // the check bites: a duplicate, a gap, a sixth cell
    const swapped = [rows[0]!, rows[2]!, rows[1]!, ...rows.slice(3)];
    expect(registerProblems(swapped).length).toBeGreaterThan(0);
    expect(registerProblems([...rows, rows[16]!])).toContain("duplicate id");
    expect(registerProblems([{ ...rows[0]!, cells: [...rows[0]!.cells, "x"] }, ...rows.slice(1)])).toContain("LB-1: 6 cells");
  });

  it("3. PROGRAM_STATE.json stays valid JSON, and its liveBlockers mirror every register row, one `LB-<n>: <form>: <check>` string per row, in id order, with the row's id and form and nothing else (OD-217 reverses OD-179's partial mirror)", () => {
    const state = JSON.parse(read(STATE)) as Record<string, unknown>;
    const rows = rowsOf();
    expect(mirrorProblems(state, rows)).toEqual([]);
    expect(typeof state.nextAction).toBe("string");
    // the check bites: an entry dropped, two swapped, a form changed, an id-less string added
    const entries = state.liveBlockers as string[];
    expect(mirrorProblems({ liveBlockers: entries.slice(1) }, rows).length).toBeGreaterThan(0);
    expect(mirrorProblems({ liveBlockers: [entries[1], entries[0], ...entries.slice(2)] }, rows).length).toBeGreaterThan(0);
    expect(mirrorProblems({ liveBlockers: entries.map((entry, index) => (index === 3 ? entry.replace(/^LB-4: QUALIFIED \([^)]*\)/, "LB-4: BLOCKED-LIVE-QUALIFICATION") : entry)) }, rows)).toEqual(["LB-4: the mirror's form is not the register's"]);
    expect(mirrorProblems({ liveBlockers: [...entries, "real LLM provider turn: UNKNOWN (no credits)"] }, rows).length).toBeGreaterThan(0);
  });

  it("4. only LB-4 is QUALIFIED - the 2026-09-24 run on two empty databases of the main project's server, non-isolated - and its cell keeps isolated staging BLOCKED-LIVE-QUALIFICATION under LB-14", () => {
    const rows = rowsOf();
    expect(rows.filter((row) => classificationOf(row.cells[2]!)?.form === "QUALIFIED").map((row) => row.id)).toEqual(["LB-4"]);
    expect(rows.filter((row) => classificationOf(row.cells[2]!)?.form === "NOT APPLICABLE").map((row) => row.id)).toEqual([]);
    const lb4 = rows[3]!.cells[2]!;
    for (const fact of ["2026-09-24", "non-isolated", "LB-14", "isolated staging: BLOCKED-LIVE-QUALIFICATION"]) expect(lb4, fact).toContain(fact);
    expect(classificationOf(lb4)?.qualified).toEqual({ date: "2026-09-24", scope: "migrations and the nine DB-gated suites on two empty databases of a non-isolated server", resource: "the PostgreSQL 17.6 server of the main Supabase project" });
  });

  it("5. each changed cell keeps its f663d71 wording verbatim inside B24-E's dated note; every other cell keeps its 6e4e1bb text as its prefix (no earlier note is rewritten); LB-4's check keeps its stale clause with a dated note; B24-E's notes stand on LB-1, LB-2, LB-5, LB-7, LB-9 and LB-13..LB-17, once each", () => {
    const rows = rowsOf();
    for (const [id, { was, starts }] of Object.entries(CHANGED)) {
      const cell = rows.find((row) => row.id === id)!.cells[2]!;
      expect(cell.startsWith(starts), id).toBe(true);
      expect(cell, id).toContain(`${NOTE} was "${was}" (OD-217)`);
    }
    const problems: string[] = [];
    for (const row of rows) {
      const [lengths, digest] = KEPT[row.id] ?? [[0, 0, 0, 0], ""];
      const kept = [row.cells[1], row.cells[2], row.cells[3], row.cells[4]].map((cell, index) => (cell ?? "").slice(0, lengths[index])).join(String.fromCharCode(0));
      if (sha256(kept) !== digest) problems.push(`${row.id}: a 6e4e1bb cell is no longer its prefix`);
    }
    expect(problems).toEqual([]);
    const lb4Check = rows[3]!.cells[1]!;
    expect(lb4Check.startsWith("Database-backed tests (`DATABASE_URL` in `.env.local` points to a project that no longer resolves) ")).toBe(true);
    expect(lb4Check).toContain(`${NOTE} the clause about the project that no longer resolves is stale`);
    const counts = Object.fromEntries(rows.map((row) => [row.id, row.cells.reduce((sum, cell, index) => sum + (index === 2 ? 0 : cell.split(`${NOTE} ${row.id} note:`).length - 1), 0)]).filter(([, count]) => (count as number) > 0));
    expect(counts).toEqual(Object.fromEntries(E_NOTED.map((id) => [id, 1])));
    expect(E_NOTED).toHaveLength(10);
    // the content the task names for each note
    const note = (id: string): string => { const row = rows.find((candidate) => candidate.id === id)!; const text = row.cells.join(" | "); return text.slice(text.indexOf(`${NOTE} ${id} note:`)); };
    for (const fact of ["playwright.production-auth.config.ts", "PRODUCTION_AUTH_STAGING_TARGETS", "LB-13"]) expect(note("LB-1"), fact).toContain(fact);
    for (const id of ["LB-2", "LB-7", "LB-9"]) for (const fact of ["sirkit.live-price-table.v1", "--price-table", "--spend-cap", "OD-216", "credits"]) expect(note(id), `${id} ${fact}`).toContain(fact);
    for (const fact of ["OD-218", "store", "recording route", "review port"]) expect(note("LB-5"), fact).toContain(fact);
    for (const [id, fact] of [["LB-13", "Q11"], ["LB-14", "Q10"], ["LB-15", "Q3"], ["LB-16", "Q12"], ["LB-17", "Q13"]] as const) expect(note(id), id).toContain(fact);
  });

  it("6. every LB id a B24 page, table or record cites is a register row", () => {
    const register = new Set(rowsOf().map((row) => row.id));
    const cited = new Map<string, string>();
    for (const name of readdirSync(join(ROOT, B24_PAGES)).filter((file) => /\.(?:md|csv|json)$/.test(file))) for (const match of read(`${B24_PAGES}/${name}`).matchAll(/\bLB-(\d+)\b/g)) cited.set(match[0], name);
    expect(cited.size).toBeGreaterThanOrEqual(17);
    expect([...cited].filter(([id]) => !register.has(id)).map(([id, file]) => `${id} (${file})`)).toEqual([]);
  });

  it("7. the matrix parses: the column set B24-F reads, fifteen rows Q1..Q15 (Q14, MCP readiness's passing row, and Q15, the multi-agent row, included), B1's six classes, the ten readiness scopes or a dash", () => {
    const { rows, problems } = matrix();
    expect(problems).toEqual([]);
    expect(rows.map((row) => row.row)).toEqual(Array.from({ length: 15 }, (_, index) => `Q${index + 1}`));
    expect(new Set(rows.map((row) => row.evalClass))).toEqual(new Set(["model-in-loop", "browser E2E", "external-provider staging", "physical-hardware validation", "deterministic offline", "database-backed"]));
    expect(EVAL_CLASSES.map((entry) => entry.label)).toEqual(["deterministic offline", "model-in-loop", "browser E2E", "database-backed", "external-provider staging", "physical-hardware validation"]);
    expect(READINESS_SCOPES).toHaveLength(10);
    expect(Object.fromEntries(rows.map((row) => [row.row, row.scope]))).toEqual({ Q1: "live provider readiness", Q2: "staging authentication readiness", Q3: "external component-provider readiness", Q4: "sandbox readiness", Q5: "external quote/order readiness", Q6: "manufacturing-file readiness", Q7: "physical hardware validation", Q8: "physical hardware validation", Q9: "—", Q10: "—", Q11: "—", Q12: "MCP readiness", Q13: "—", Q14: "MCP readiness", Q15: "—" });
    expect(Object.fromEntries(rows.map((row) => [row.row, row.evalClass]))).toEqual({ Q1: "model-in-loop", Q2: "browser E2E", Q3: "external-provider staging", Q4: "physical-hardware validation", Q5: "external-provider staging", Q6: "deterministic offline", Q7: "physical-hardware validation", Q8: "physical-hardware validation", Q9: "database-backed", Q10: "database-backed", Q11: "external-provider staging", Q12: "external-provider staging", Q13: "physical-hardware validation", Q14: "deterministic offline", Q15: "model-in-loop" });
    expect(Object.fromEntries(rows.map((row) => [row.row, row.lb.join(", ") || "none"]))).toEqual({ Q1: "LB-2, LB-7, LB-9", Q2: "LB-1, LB-13", Q3: "LB-15", Q4: "LB-10, LB-3, LB-8", Q5: "LB-11, LB-12", Q6: "none", Q7: "LB-5", Q8: "LB-5", Q9: "LB-4", Q10: "LB-14, LB-6", Q11: "LB-13", Q12: "LB-16", Q13: "LB-17", Q14: "none", Q15: "LB-9, LB-7" });
    expect(Object.keys(STATUS_LINE_ROWS)).toEqual(["provider", "production auth", "database/RLS", "component acquisition", "MCP", "multi-agent", "sandbox", "manufacturing release", "external quote/order", "physical hardware"]);
  });

  it("8. LB coverage holds both ways and every state agrees with the register; Q6 and Q14 pass under the column rule (NOT APPLICABLE with CI evidence named); the sandbox rule holds; and each rule bites", () => {
    const { rows } = matrix();
    const register = rowsOf();
    expect(matrixProblems(rows, register)).toEqual([]);
    expect(rows.filter((row) => row.state === "NOT APPLICABLE").map((row) => row.row)).toEqual(["Q6", "Q14"]);
    expect(rows.filter((row) => row.state.startsWith("QUALIFIED")).map((row) => row.row)).toEqual(["Q9"]);
    // the rules bite, each by one change
    const edit = (id: string, change: Partial<MatrixRow>): MatrixRow[] => rows.map((row) => (row.row === id ? { ...row, ...change } : row));
    expect(matrixProblems(edit("Q6", { lb: ["LB-5"] }), register)).toContain("Q6: cites a blocked LB but is NOT APPLICABLE");
    expect(matrixProblems(edit("Q1", { state: "NOT APPLICABLE" }), register)).toContain("Q1: cites a blocked LB but is NOT APPLICABLE");
    expect(matrixProblems(edit("Q14", { builtOffline: "the read-only server's suites" }), register)).toContain("Q14: NOT APPLICABLE without CI evidence named");
    expect(matrixProblems(edit("Q9", { state: "BLOCKED-LIVE-QUALIFICATION" }), register)).toContain("Q9: every cited LB is QUALIFIED, the state is not theirs");
    expect(matrixProblems(edit("Q4", { recorded: rowOf(rows, "Q4").recorded.replaceAll("`failing`", "failing") }), register)).toContain("Q4: the sandbox rule");
    expect(matrixProblems(edit("Q4", { state: "NOT APPLICABLE" }), register)).toContain("Q4: the sandbox rule");
    expect(matrixProblems(edit("Q13", { lb: [] , state: "NOT APPLICABLE", builtOffline: "prompt-to-gerber" }), register)).toContain("LB-17: in no matrix row");
    expect(matrixProblems(edit("Q3", { lb: ["LB-15", "LB-18"] }), register)).toContain("Q3: LB-18 is no register row");
    expect(matrixProblems(edit("Q2", { scope: "staging readiness" }), register)).toContain("Q2: scope staging readiness");
    expect(matrixProblems(edit("Q2", { evalClass: "browser" }), register)).toContain("Q2: class browser");
  });

  it("9. every row's code fact holds, read from the code - the one price table and its null owner table, the empty staging list, the distributor refusal, the blocked runner and B22's pin names, the empty transfer list and disabled ordering, the release identity and its expiry, the physical-evidence block, the real-server run, the empty MCP registry, the env-gated oracle, the nine MCP reads, the orchestration suites' CI jobs - and the matrix names no retired ngspice variable", { timeout: 60_000 }, async () => {
    const { rows } = matrix();
    const cell = (id: string): string => { const row = rowOf(rows, id); return [row.builtOffline, row.recorded, row.unblocking].join(" | "); };
    const has = (id: string, ...facts: string[]): void => { for (const fact of facts) expect(cell(id), `${id}: ${fact}`).toContain(fact); };
    const line = (path: string, at: number): string => read(path).split(NEWLINE)[at - 1] ?? "";
    const admission = ciAdmission();
    // Q1: B3b's one price table, C2's null owner table, the command's two required flags; no second price schema anywhere
    expect(LIVE_PRICE_TABLE_SCHEMA).toBe("sirkit.live-price-table.v1");
    expect(MODEL_PRICE_TABLE).toBeNull();
    expect(read("app/lib/evaluation/model-price-table.ts")).toContain("MODEL_PRICE_TABLE: LivePriceTable | null = null");
    for (const flag of ['"--price-table"', '"--spend-cap"', '"--contract-turns"']) expect(read("scripts/run-b21-live-orchestration-evaluation.ts"), flag).toContain(flag);
    const schemas = new Set<string>();
    const walk = (dir: string): void => { for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) { const path = `${dir}/${entry.name}`; if (entry.isDirectory()) { if (entry.name !== "__tests__" && entry.name !== "node_modules") walk(path); } else if (/\.tsx?$/.test(entry.name)) for (const match of read(path).matchAll(/sirkit\.[a-z-]*price-table\.v\d+/g)) schemas.add(match[0]); } };
    walk("app");
    walk("scripts");
    expect([...schemas]).toEqual(["sirkit.live-price-table.v1"]);
    expect(admission.jobsOf("app/lib/qualification/__tests__/b24-b3-model-in-loop.test.ts")).toContain("prompt-to-gerber");
    has("Q1", "`sirkit.live-price-table.v1`", "`MODEL_PRICE_TABLE`", "`--price-table`", "`--spend-cap`", "`b24-b3-model-in-loop`", "2026-09-24", "429", "`failing`", "2026-07-29");
    // Q2: the staging list is empty; the spec no CI job runs
    expect(PRODUCTION_AUTH_STAGING_TARGETS).toEqual([]);
    expect(admission.jobsOf("e2e-production-auth/production-auth.spec.ts")).toEqual([]);
    has("Q2", "`PRODUCTION_AUTH_STAGING_TARGETS`", "`playwright.production-auth.config.ts`", "`e2e-production-auth/production-auth.spec.ts`", "`b24-e-production-auth-config`");
    // Q3: a distributor without its credential names is refused
    const digikey = admitSource("digikey", {});
    expect(digikey.admitted ? "admitted" : digikey.refusal).toBe("credentials_missing");
    expect(line("app/lib/acquisition/source-registry.ts", 568)).toContain("export function admitSource(");
    expect(line("app/lib/acquisition/source-registry.ts", 584)).toContain('refusal: "credentials_missing"');
    has("Q3", '`admitSource("digikey", {})`', "`credentials_missing`", "`source-registry.ts:568, :584`");
    // Q4: the authoritative runner is blocked; the unblocking resource is named by B22's pin names (never the retired variable)
    await expect(executeAuthoritativeSimulation()).rejects.toThrow("CD10_AUTHORITATIVE_RUNNER_BLOCKED_NO_VALIDATED_SANDBOX");
    expect(line("app/lib/model-simulation/safe-execution.ts", 28)).toContain("CD10_AUTHORITATIVE_RUNNER_BLOCKED_NO_VALIDATED_SANDBOX");
    expect([RUNTIME_PROFILE_DIGEST_SETTINGS["ngspice-local-diagnostic"], RUNTIME_PROFILE_DIGEST_SETTINGS["ngspice-oci"], OCI_HOST_CLIENT_SETTINGS.path, OCI_HOST_CLIENT_SETTINGS.digest]).toEqual(["SIRKIT_NGSPICE_INSTALL_SHA256", "SIRKIT_NGSPICE_OCI_IMAGE", "SIRKIT_OCI_CLI_PATH", "SIRKIT_OCI_CLI_SHA256"]);
    expect(read("app/lib/computation/runtime-profile.ts")).toContain('installRootSetting: "SIRKIT_NGSPICE_INSTALL_ROOT"');
    expect(line("app/lib/computation/__tests__/b22-a3-runner-live.test.ts", 17)).toContain('process.env.SIRKIT_B22_LIVE_RUNNER === "1"');
    has("Q4", "`SIRKIT_NGSPICE_INSTALL_ROOT`", "`SIRKIT_NGSPICE_INSTALL_SHA256`", "`SIRKIT_B22_LIVE_RUNNER`", "`SIRKIT_NGSPICE_OCI_IMAGE`", "`SIRKIT_OCI_CLI_PATH`", "`SIRKIT_OCI_CLI_SHA256`", "`safe-execution.ts:28`", "2026-10-02", "12 of 13", "2026-10-01");
    // Q5: no transfer descriptor, no owner ordering record, no wired order port
    expect([PROVIDER_TRANSFER_DESCRIPTORS.length, ORDERING_OWNER_RECORD, ORDER_SUBMISSION_PORT_WIRING]).toEqual([0, null, "none"]);
    expect(line("app/lib/manufacturing-providers/ordering-enablement.ts", 36)).toContain("ORDERING_OWNER_RECORD: OrderingOwnerRecord | null = null");
    expect(line("app/lib/manufacturing-providers/ordering-enablement.ts", 39)).toContain('ORDER_SUBMISSION_PORT_WIRING: OrderSubmissionPortWiring = "none"');
    has("Q5", "`PROVIDER_TRANSFER_DESCRIPTORS`", "`ORDERING_OWNER_RECORD === null`", '`ORDER_SUBMISSION_PORT_WIRING === "none"`', "`ordering-enablement.ts:36, :39`");
    // Q6: the release identity is the committed one, and its rule-profile evidence expires with the registry's copy of the date
    const identities = JSON.parse(read("app/lib/workflow/prompt-to-gerber/__tests__/fixtures/expected-identities.json")) as { fixedNow: string; release: { releaseId: string; archiveSha256: string } };
    has("Q6", identities.release.releaseId, identities.release.archiveSha256, identities.fixedNow, "2027-09-09", "2027-09-10T00:00:00.000Z", "`expected-identities.json:15, :17`", "prompt-to-gerber");
    expect(ruleProfileExpiry(JLCPCB_2L_RULE_PROFILE_EVIDENCE.retrievedAt)).toBe("2027-09-09");
    const jlcpcb = PROVIDER_REGISTRY.jlcpcb.capabilityProfile;
    expect(jlcpcb.mapping === "jlcpcb-2l" ? jlcpcb.evidenceExpiresAt : "none").toBe(ruleProfileExpiry(JLCPCB_2L_RULE_PROFILE_EVIDENCE.retrievedAt));
    expect(line("app/api/pcb/release/route.ts", 185)).toContain("ruleProfileEvidenceStatus(storedProfile.evidence, new Date().toISOString())");
    expect(line("app/api/pcb/release/route.ts", 186)).toContain("MFG_RULE_PROFILE_EXPIRED");
    expect(admission.jobsOf("app/lib/workflow/prompt-to-gerber/__tests__/acceptance-pipeline.test.ts")).toContain("prompt-to-gerber");
    // Q7 and Q8: nothing records physical evidence; the review port is unwired, the assembly data absent, eligibility blocked
    const importsEvidence: string[] = [];
    const scan = (dir: string): void => { for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) { const path = `${dir}/${entry.name}`; if (entry.isDirectory()) { if (entry.name !== "__tests__" && entry.name !== "node_modules") scan(path); } else if (/\.tsx?$/.test(entry.name) && path !== "app/lib/manufacturing-providers/physical-evidence.ts" && /from ["'][^"']*physical-evidence["']/.test(read(path))) importsEvidence.push(path); } };
    scan("app");
    expect(importsEvidence).toEqual([]);
    has("Q7", "none built");
    expect([PHYSICAL_EVIDENCE_REVIEW_PORT_WIRING, ASSEMBLY_DATA_AUTHORITY]).toEqual(["none", "absent"]);
    const blocked = assembledProductEligibility({ release: { releaseId: identities.release.releaseId, archiveSha256: identities.release.archiveSha256, boardRevision: "pcb2-f61eca48a58212d9", boardDigest: "b24-e-fixture" }, lotId: "lot-b24-e", records: [] });
    expect([blocked.eligible, blocked.status]).toEqual([false, "blocked"]);
    expect(ACTION_COVERAGE_REGISTRY.find((entry) => entry.id === "manufacturing.assembled-release")?.status).toBe("missing");
    has("Q8", '`PHYSICAL_EVIDENCE_REVIEW_PORT_WIRING === "none"`', '`ASSEMBLY_DATA_AUTHORITY === "absent"`', "`physical-evidence.ts:330`", "`:454`", "`:484`", "`action-registry.ts:118`");
    // Q9: the recorded real-server run
    const ledger = read("artifacts/remaining-builder-program/EXECUTION_LEDGER.md");
    for (const fact of ["### LB-4 - the database qualification run against a real server (2026-09-24", "PostgreSQL 17.6", "all nine DB-gated suites are qualified on the real server"]) expect(ledger, fact).toContain(fact);
    has("Q9", "2026-09-24", "non-isolated", "`EXECUTION_LEDGER.md:2490-2509`");
    // Q10, Q11: the offline proofs exist and run where the rows say
    for (const suite of ["b24-a4-rls-default-deny", "b24-a4-rollback", "b24-a4-restore", "b24-d2-restart-pglite"]) expect(admission.jobsOf(`app/lib/qualification/database/__tests__/${suite}.test.ts`), suite).toEqual(["database-delivery"]);
    has("Q10", "database-delivery", "`b24-a4-rls-default-deny`", "`b24-d2-restart-pglite`");
    expect(read(".github/workflows/deterministic-manufacturing.yml").split(NEWLINE)).toContain("  production-smoke:");
    has("Q11", "`production-smoke`", "`b24-a1-environment-profile`", "`b24-a2-headers`");
    // Q12: no approved external MCP server
    expect(MCP_SERVER_REGISTRY).toHaveLength(0);
    expect(line("app/lib/mcp/server-registry.ts", 140)).toContain("export const MCP_SERVER_REGISTRY");
    expect(admission.jobsOf("app/lib/mcp/__tests__/b20-a2-tool-discovery.test.ts")).toEqual(["agent-boundary-suites"]);
    has("Q12", "`server-registry.ts:140`", "`b20-a2-tool-discovery`", "agent-boundary-suites");
    // Q13: the oracle is env-gated on KICAD_CLI and blocked on LB-17
    const oracle = liveSuite("kicad-cli-oracle");
    expect(["flag" in oracle ? oracle.flag.name : "none", "blockers" in oracle ? [...oracle.blockers] : []]).toEqual(["KICAD_CLI", ["LB-17"]]);
    has("Q13", "`kicad-cli-oracle`", "`KICAD_CLI`");
    // Q14: nine MCP reads, pinned in agent-boundary-suites, and the endpoint spec in page-browser-e2e
    expect(INTENTIONAL_MCP_EXPOSED_TOOL_IDS).toHaveLength(9);
    expect(line("app/lib/mcp/server/__tests__/b20-c1-three-way-parity.test.ts", 241)).toContain("mcpExposed: 9");
    expect(admission.jobsOf("app/lib/mcp/server/__tests__/b20-c1-three-way-parity.test.ts")).toEqual(["agent-boundary-suites"]);
    expect(admission.jobsOf("e2e/mcp-endpoint.spec.ts")).toEqual(["page-browser-e2e"]);
    has("Q14", "`b20-c1-three-way-parity.test.ts:241`", "mcpExposed 9", "`e2e/mcp-endpoint.spec.ts`", "agent-boundary-suites", "page-browser-e2e");
    // Q15: B21's suites offline in CI - prompt-to-gerber lists the orchestration folder, page-browser-e2e runs the orchestration config
    expect(admission.filters["prompt-to-gerber"]).toContain("app/lib/agent/orchestration/__tests__");
    expect(admission.jobsOf("app/lib/agent/orchestration/__tests__/b21-a-contracts.test.ts")).toEqual(["agent-boundary-suites"]); // [PR-G, 2026-10-17] reviewed pin move (OD-250): was ["prompt-to-gerber"] - prompt-to-gerber's positional filter stays and excludes the directory, agent-boundary-suites runs its suites (ci-split.md section 4)
    expect(admission.jobsOf("e2e-orchestration/specialist-orchestration.spec.ts")).toEqual(["page-browser-e2e"]);
    const workflow = read(".github/workflows/deterministic-manufacturing.yml").split(NEWLINE);
    const job = (key: string): string[] => { const start = workflow.indexOf(`  ${key}:`); const end = workflow.findIndex((text, index) => index > start && /^ {2}[a-z][a-z0-9-]*:$/.test(text)); return workflow.slice(start, end < 0 ? undefined : end); };
    expect(job("page-browser-e2e").some((text) => text.trim() === "run: pnpm exec playwright test -c playwright.orchestration.config.ts")).toBe(true);
    has("Q15", "`app/lib/agent/orchestration/__tests__`", "`pnpm exec playwright test -c playwright.orchestration.config.ts`", "`e2e-orchestration/specialist-orchestration.spec.ts`", "prompt-to-gerber", "page-browser-e2e", "agent-boundary-suites"); // [PR-G, 2026-10-17] + agent-boundary-suites (OD-250)
    // the matrix names B22's pins, never the retired variable
    expect(readOrEmpty(MATRIX)).not.toContain(["NGSPICE", "BIN"].join("_"));
  });

  it("10. the deterministic release's rule-profile evidence is valid through 2027-09-09 and expired from 2027-09-10T00:00:00.000Z UTC (rule-profile.ts: the expiry date itself is still valid)", () => {
    expect(ruleProfileEvidenceStatus(JLCPCB_2L_RULE_PROFILE_EVIDENCE, "2027-09-09T23:59:59.999Z")).toBe("ok");
    expect(ruleProfileEvidenceStatus(JLCPCB_2L_RULE_PROFILE_EVIDENCE, "2027-09-10T00:00:00.000Z")).toBe("expired");
    expect(ruleProfileEvidenceStatus(JLCPCB_2L_RULE_PROFILE_EVIDENCE, "2026-09-09T12:00:00.000Z")).toBe("ok");
    expect(JLCPCB_2L_RULE_PROFILE_EVIDENCE.expiresAt).toBe("2027-09-09");
  });
});
