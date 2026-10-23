/**
 * [B17-E] IMPORT / EXPORT OUTCOMES — every import or export path declares,
 * machine-readably, what it produces: CANONICAL STATE (it mutates the
 * authoritative schematic / board / project store through a canonical
 * transaction), an INERT PROPOSAL (a sealed artifact a human must approve),
 * or a FILE ARTIFACT (bytes handed to the user; nothing changes). Imported
 * content is UNTRUSTED until it passed the path's structural and semantic
 * validation; the declaration names that validation. The registry gate
 * checks that every import/export action record has a declaration.
 */

export const IO_OUTCOME_SCHEMA = "sirkit.io-outcome.v1" as const;

export type IoProduces = "canonical-state" | "inert-proposal" | "file-artifact";
export type IoDirection = "import" | "export";
export type IoValidation = "structural" | "structural+semantic" | "none (read-only export of validated state)";

export interface IoOutcomeDeclaration {
  schema: typeof IO_OUTCOME_SCHEMA;
  /** The B01 action record this path belongs to. */
  recordId: string;
  direction: IoDirection;
  produces: IoProduces;
  /** What the path validates before anything is created (imports) or emitted (exports). */
  validation: IoValidation;
  /** Where the outcome is reported to the person (a toast, a dialog, a download, an announcement). */
  reportedAs: string;
  /** Present when the path is not (yet) available; the precise blocker. */
  unavailable?: string;
}

const declare = (d: Omit<IoOutcomeDeclaration, "schema">): IoOutcomeDeclaration => ({ schema: IO_OUTCOME_SCHEMA, ...d });

/** The declarations, one per import/export path (record id → direction → declaration). */
export const IO_OUTCOMES: readonly IoOutcomeDeclaration[] = [
  declare({ recordId: "schematic.import-export-kicad", direction: "export", produces: "file-artifact", validation: "none (read-only export of validated state)", reportedAs: "a .kicad_sch download (a project with sheets: one .zip holding the root and child sheet files, [PR-J4, 2026-10-23]); a refused export is a structured toast naming the SCHEMATIC_STATE_INVALID issues (nothing changed)" }),
  declare({ recordId: "schematic.import-export-kicad", direction: "import", produces: "canonical-state", validation: "structural+semantic", reportedAs: "not applicable — the path does not exist yet", unavailable: "no .kicad_sch import path exists (no control, no route); the only reader (app/lib/schematic-compiler/kicad-adapter.ts) answers CD8_KICAD_SEMANTIC_ADAPTER_NOT_CERTIFIED" }),
  declare({ recordId: "pcb.export-kicad", direction: "export", produces: "file-artifact", validation: "none (read-only export of validated state)", reportedAs: "a .kicad_pcb download gated on a verified authoritative board; unsupported content is reported as a toast (X-Sirkit-Export-Unsupported) from every entry point" }),
  declare({ recordId: "pcb.autoroute-import", direction: "import", produces: "canonical-state", validation: "structural+semantic", reportedAs: "a routing candidate (sirkit.layout-candidate.v1) reviewed before apply; the apply is one canonical transaction with a toast" }),
  declare({ recordId: "project.open-file", direction: "import", produces: "canonical-state", validation: "structural+semantic", reportedAs: "an announcement naming the project, restored checkpoints, missing catalog parts and warnings; a refused file is a toast (nothing changed)" }),
  declare({ recordId: "project.save-file", direction: "export", produces: "file-artifact", validation: "none (read-only export of validated state)", reportedAs: "a .sirkit.json download with an integrity digest" }),
  declare({ recordId: "manufacturing.export-engineering", direction: "export", produces: "file-artifact", validation: "none (read-only export of validated state)", reportedAs: "the fab dialog's report id; verified releases are refused for browser boards; engineering overrides need a waiver" }),
  declare({ recordId: "manufacturing.release", direction: "export", produces: "canonical-state", validation: "structural+semantic", reportedAs: "the manufacturing workflow panel and durable stage evidence (release id, revision)" }),
];

export function ioOutcomesFor(recordId: string): IoOutcomeDeclaration[] {
  return IO_OUTCOMES.filter((item) => item.recordId === recordId);
}

/** A structured refusal payload from an export route (the sanitized 422), rendered for a person. */
export function describeExportRefusal(status: number, body: unknown): string {
  if (body && typeof body === "object") {
    const record = body as { code?: unknown; error?: unknown; issues?: unknown; issueCount?: unknown };
    const code = typeof record.code === "string" ? record.code : `HTTP ${status}`;
    const error = typeof record.error === "string" ? record.error : "the export was refused";
    const issues = Array.isArray(record.issues) ? record.issues.filter((issue): issue is string => typeof issue === "string").slice(0, 3) : [];
    const count = typeof record.issueCount === "number" ? record.issueCount : issues.length;
    return `${code} — ${error}${issues.length > 0 ? ` (${count} issue${count === 1 ? "" : "s"}: ${issues.join("; ")}${count > issues.length ? "; …" : ""})` : ""}`;
  }
  return `HTTP ${status} — the export was refused; nothing was changed.`;
}

/**
 * [PR-J4, 2026-10-23] The file name an export response names in its Content-Disposition (`attachment; filename="x.zip"`), else the
 * fallback: a sheeted KiCad export downloads as `<title>.zip`, a single-sheet one as `<title>.kicad_sch` (the same rule the fab
 * export's hook applies, app/components/pcb/hooks/useFabExport.ts). Pure.
 */
export function filenameFromDisposition(header: string | null | undefined, fallback: string): string {
  const match = header?.match(/filename="([^"]+)"/);
  return match ? match[1]! : fallback;
}
