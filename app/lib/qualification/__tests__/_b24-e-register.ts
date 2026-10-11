/**
 * [B24-E] The live-blocker register, its `PROGRAM_STATE.json` mirror and the qualification matrix, read as text (D24-33, OD-217;
 * D24-35 and D24-36 as recorded). Test-only: `b24-e-register` reads the committed files through these functions, and the same
 * functions check a drafted register and mirror before the lead applies them (the two records are the lead's, lead decision D14).
 * Pure: every function takes text and returns data or problems; nothing is read or written here.
 */
import { EVAL_CLASSES } from "../../evaluation/golden-catalog";

const NEWLINE = String.fromCharCode(10);

// ── the register (artifacts/remaining-builder-program/LIVE_BLOCKERS.md) ─────────────────────────────────────────────────────────

/** OD-217's closed classification forms: a cell starts with exactly one of them. */
export const CLASSIFICATION_FORMS = Object.freeze(["BLOCKED-LIVE-QUALIFICATION", "QUALIFIED", "NOT APPLICABLE"] as const);
export type ClassificationForm = (typeof CLASSIFICATION_FORMS)[number];

export interface Classification {
  readonly form: ClassificationForm;
  /** the form as the mirror and the matrix state it: `BLOCKED-LIVE-QUALIFICATION`, `QUALIFIED (<date>, <scope>, <resource>)`, `NOT APPLICABLE` */
  readonly text: string;
  readonly qualified?: { readonly date: string; readonly scope: string; readonly resource: string };
}

const QUALIFIED_FORM = /^QUALIFIED \((\d{4}-\d{2}-\d{2}), ([^,()]+), ([^,()]+)\)/;

/** The form a cell starts with, or null when it starts with none of the three (anything else first is no form). */
export function classificationOf(cell: string): Classification | null {
  const after = (prefix: string): boolean => cell.startsWith(prefix) && (cell.length === prefix.length || cell[prefix.length] === " " || cell[prefix.length] === ";");
  if (after("BLOCKED-LIVE-QUALIFICATION")) return { form: "BLOCKED-LIVE-QUALIFICATION", text: "BLOCKED-LIVE-QUALIFICATION" };
  if (after("NOT APPLICABLE")) return { form: "NOT APPLICABLE", text: "NOT APPLICABLE" };
  const qualified = QUALIFIED_FORM.exec(cell);
  if (qualified) {
    const [text, date, scope, resource] = qualified as unknown as [string, string, string, string];
    const day = new Date(`${date}T00:00:00.000Z`);
    if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== date) return null;
    if (scope !== scope.trim() || resource !== resource.trim() || scope === "" || resource === "") return null;
    return { form: "QUALIFIED", text, qualified: { date, scope, resource } };
  }
  return null;
}

export interface RegisterRow {
  readonly id: string;
  readonly number: number;
  /** the five cells: id, check, classification, what exists instead, unblocks when */
  readonly cells: readonly string[];
  readonly line: number;
}

/** Every `| LB-<n> |` row, in file order, with its cells (the register's cells hold no `|`). */
export function registerRows(text: string): RegisterRow[] {
  return text.split(NEWLINE).flatMap((line, index) => {
    const match = /^\| (LB-(\d+)) \|/.exec(line);
    if (!match) return [];
    const cells = line.endsWith(" |") ? line.slice(1, -1).split("|").map((cell) => cell.trim()) : [];
    return [{ id: match[1]!, number: Number(match[2]), cells, line: index + 1 }];
  });
}

/** What the register's shape breaks: a row not of five cells, ids out of LB-1..LB-n order, a duplicate. */
export function registerProblems(rows: readonly RegisterRow[]): string[] {
  const problems: string[] = [];
  rows.forEach((row, index) => {
    if (row.cells.length !== 5) problems.push(`${row.id}: ${row.cells.length} cells`);
    if (row.number !== index + 1) problems.push(`${row.id}: at position ${index + 1}`);
  });
  if (new Set(rows.map((row) => row.id)).size !== rows.length) problems.push("duplicate id");
  return problems;
}

/** The rows whose classification starts with none of OD-217's three forms. */
export function classificationProblems(rows: readonly RegisterRow[]): string[] {
  return rows.filter((row) => classificationOf(row.cells[2] ?? "") === null).map((row) => `${row.id}: classification outside OD-217's forms`);
}

// ── the mirror (artifacts/remaining-builder-program/PROGRAM_STATE.json `liveBlockers`) ────────────────────────────────────────────

const MIRROR_ENTRY = /^(LB-\d+): (BLOCKED-LIVE-QUALIFICATION|QUALIFIED \(\d{4}-\d{2}-\d{2}, [^,()]+, [^,()]+\)|NOT APPLICABLE): (\S.*)$/;

/** What the mirror breaks: not one `LB-<n>: <form>: <check>` string per register row, in order, with the row's id and form. */
export function mirrorProblems(state: unknown, rows: readonly RegisterRow[]): string[] {
  const entries = (state as { liveBlockers?: unknown } | null)?.liveBlockers;
  if (!Array.isArray(entries)) return ["liveBlockers is not a list"];
  const problems: string[] = [];
  if (entries.length !== rows.length) problems.push(`${entries.length} entries for ${rows.length} rows`);
  entries.forEach((entry, index) => {
    const match = typeof entry === "string" ? MIRROR_ENTRY.exec(entry) : null;
    if (!match) {
      problems.push(`entry ${index + 1} is not "LB-<n>: <form>: <check>"`);
      return;
    }
    const row = rows[index];
    if (!row || match[1] !== row.id) problems.push(`entry ${index + 1} is ${match[1]}, row ${row?.id ?? "none"}`);
    else if (match[2] !== classificationOf(row.cells[2] ?? "")?.text) problems.push(`${row.id}: the mirror's form is not the register's`);
  });
  return problems;
}

// ── the matrix (artifacts/ai-control-plane-b24/qualification-matrix.md part 2) ──────────────────────────────────────────────────

/** The column set B24-F's `b24-f-verdict-lines` reads; changed only with that suite. */
export const MATRIX_HEADER = "| Row | Gate | Runbook | Class | Readiness scope | Built offline | Recorded live runs | Unblocking resource | State | LB |";
/** The ten readiness scopes of runbook `:1146-1155`, in its order and words. */
export const READINESS_SCOPES = Object.freeze(["deterministic local readiness", "CI readiness", "staging authentication readiness", "live provider readiness", "external component-provider readiness", "MCP readiness", "sandbox readiness", "manufacturing-file readiness", "external quote/order readiness", "physical hardware validation"] as const);
/** B24-F's status-line -> row table reads these row ids (task-E deliverable 4); a row is never renumbered. */
export const STATUS_LINE_ROWS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  provider: ["Q1"],
  "production auth": ["Q2"],
  "database/RLS": ["Q9", "Q10"],
  "component acquisition": ["Q3"],
  MCP: ["Q12", "Q14"],
  "multi-agent": ["Q15"],
  sandbox: ["Q4"],
  "manufacturing release": ["Q6"],
  "external quote/order": ["Q5"],
  "physical hardware": ["Q7", "Q8"],
});
/** The CI jobs a NOT APPLICABLE row must name as its evidence (the workflows' job keys). */
export const CI_EVIDENCE_JOBS = Object.freeze(["prompt-to-gerber", "database-delivery", "agent-boundary-suites", "page-browser-e2e", "page-browser-e2e-b24", "production-smoke"] as const);

export interface MatrixRow {
  readonly row: string;
  readonly gate: string;
  readonly runbook: string;
  readonly evalClass: string;
  readonly scope: string;
  readonly builtOffline: string;
  readonly recorded: string;
  readonly unblocking: string;
  readonly state: string;
  readonly lb: readonly string[];
}

/** The matrix table under its header, or the problems of reading it. */
export function matrixRows(page: string): { readonly rows: MatrixRow[]; readonly problems: string[] } {
  const lines = page.split(NEWLINE);
  const at = lines.indexOf(MATRIX_HEADER);
  if (at < 0) return { rows: [], problems: ["no matrix header"] };
  if (lines.indexOf(MATRIX_HEADER, at + 1) >= 0) return { rows: [], problems: ["two matrix headers"] };
  if (!/^\|(?:---\|){10}$/.test(lines[at + 1] ?? "")) return { rows: [], problems: ["no separator under the header"] };
  const rows: MatrixRow[] = [];
  const problems: string[] = [];
  for (const line of lines.slice(at + 2)) {
    if (!line.startsWith("| ")) break;
    const cells = line.endsWith(" |") ? line.slice(1, -1).split("|").map((cell) => cell.trim()) : [];
    if (cells.length !== 10) {
      problems.push(`${line.slice(0, 12)}: ${cells.length} cells`);
      continue;
    }
    const [row, gate, runbook, evalClass, scope, builtOffline, recorded, unblocking, state, lb] = cells as [string, string, string, string, string, string, string, string, string, string];
    rows.push({ row, gate, runbook, evalClass, scope, builtOffline, recorded, unblocking, state, lb: lb === "none" ? [] : lb.split(", ") });
  }
  return { rows, problems };
}

/**
 * What the matrix breaks against the register: its rows Q1..Q15 in order; a class of B1's six, a scope of the ten or `—`; a state of
 * OD-217's three forms that agrees with the register (QUALIFIED only when every cited LB is, NOT APPLICABLE only when none is cited,
 * else BLOCKED); every register row cited by a matrix row and every cited LB a register row; a NOT APPLICABLE row naming its CI
 * evidence; and the sandbox rule (Q4 BLOCKED while its recorded runs hold the failing class 4 NOT CONTAINED result).
 */
export function matrixProblems(rows: readonly MatrixRow[], register: readonly RegisterRow[]): string[] {
  const problems: string[] = [];
  const ids = rows.map((row) => row.row);
  const expected = Array.from({ length: 15 }, (_, index) => `Q${index + 1}`);
  if (JSON.stringify(ids) !== JSON.stringify(expected)) problems.push(`rows ${ids.join(", ")}`);
  const classes = new Set(EVAL_CLASSES.map((entry) => entry.label));
  const byId = new Map(register.map((row) => [row.id, row] as const));
  const formOf = (id: string): Classification | null => classificationOf(byId.get(id)?.cells[2] ?? "");
  for (const row of rows) {
    if (!classes.has(row.evalClass)) problems.push(`${row.row}: class ${row.evalClass}`);
    if (row.scope !== "—" && !(READINESS_SCOPES as readonly string[]).includes(row.scope)) problems.push(`${row.row}: scope ${row.scope}`);
    if (!/^`:\d{4}`(?:, `:\d{4}`)*$/.test(row.runbook)) problems.push(`${row.row}: runbook ${row.runbook}`);
    if (row.lb.some((id) => !/^LB-\d+$/.test(id))) problems.push(`${row.row}: LB cell`);
    const state = classificationOf(row.state);
    if (state === null || state.text !== row.state) {
      problems.push(`${row.row}: state outside OD-217's forms`);
      continue;
    }
    for (const id of row.lb) if (!byId.has(id)) problems.push(`${row.row}: ${id} is no register row`);
    const cited = row.lb.map(formOf);
    if (row.lb.length === 0) {
      if (state.form !== "NOT APPLICABLE") problems.push(`${row.row}: cites no LB but is ${state.form}`);
      if (!CI_EVIDENCE_JOBS.some((job) => row.builtOffline.includes(job))) problems.push(`${row.row}: NOT APPLICABLE without CI evidence named`);
    } else if (cited.every((form) => form?.form === "QUALIFIED")) {
      if (state.form !== "QUALIFIED" || cited.some((form) => form?.text !== state.text)) problems.push(`${row.row}: every cited LB is QUALIFIED, the state is not theirs`);
    } else if (state.form !== "BLOCKED-LIVE-QUALIFICATION") problems.push(`${row.row}: cites a blocked LB but is ${state.form}`);
    if (row.recorded !== "none" && !/\b\d{4}-\d{2}-\d{2}\b/.test(row.recorded)) problems.push(`${row.row}: a recorded run with no date`);
  }
  const cited = new Set(rows.flatMap((row) => row.lb));
  for (const row of register) if (!cited.has(row.id)) problems.push(`${row.id}: in no matrix row`);
  const q4 = rows.find((row) => row.row === "Q4");
  if (!q4 || !(q4.recorded.includes("`failing`") && q4.recorded.includes("class 4 NOT CONTAINED")) || q4.state !== "BLOCKED-LIVE-QUALIFICATION") problems.push("Q4: the sandbox rule");
  for (const [line, rowIds] of Object.entries(STATUS_LINE_ROWS)) for (const id of rowIds) if (!ids.includes(id)) problems.push(`${line}: ${id} is no row`);
  return problems;
}
