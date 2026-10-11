/**
 * [B24-A4] OD-193: the `pnpm run db:migrate` argument parser, side-effect free, so a suite can pin it without importing
 * scripts/db-migrate.ts (importing the script runs it: it loads `.env.local`, connects and, with no flag, applies every pending
 * migration).
 *
 *   (no flag)                                   apply every pending migration
 *   --dry-run                                   plan only
 *   --status                                    report, change nothing
 *   --baseline <name>                           adopt a database that pre-dates the ledger
 *   --rollback <name> [--confirm <typed>] [--dry-run]
 *                                               roll back the newest applied migration by its reviewed DOWN; the operator types the
 *                                               confirmation (`ROLLBACK_CONFIRMATION`, rollback.ts) - unlike --baseline, whose
 *                                               confirmation the script passes itself
 *
 * The forward CLI's inputs parse as before (`--status` before `--baseline` before applying; a bare `--` separator is ignored);
 * `--rollback` with `--baseline` or `--status` refuses, `--confirm` is only for `--rollback`, and an unknown flag or a stray word
 * refuses instead of falling through to an apply.
 */

export type MigrateCommand =
  | { readonly mode: "apply"; readonly dryRun: boolean }
  | { readonly mode: "status" }
  | { readonly mode: "baseline"; readonly through: string }
  | { readonly mode: "rollback"; readonly name: string; readonly confirmation: string | null; readonly dryRun: boolean };
export type MigrateArgumentRefusalCode = "DB_MIGRATE_ARGUMENT_MISSING" | "DB_MIGRATE_ARGUMENTS_CONFLICT" | "DB_MIGRATE_ARGUMENT_UNKNOWN";
export type MigrateArguments = { readonly ok: true; readonly command: MigrateCommand } | { readonly ok: false; readonly code: MigrateArgumentRefusalCode; readonly message: string };

const VALUED = new Set(["--baseline", "--rollback", "--confirm"]);
const BARE = new Set(["--status", "--dry-run"]);
const MISSING: Readonly<Record<string, string>> = {
  "--baseline": "--baseline needs the name of the last migration the database was built through.",
  "--rollback": "--rollback needs the name of the newest applied migration.",
  "--confirm": "--confirm needs the typed confirmation.",
};

export function parseMigrateArguments(argv: readonly string[]): MigrateArguments {
  const refuse = (code: MigrateArgumentRefusalCode, message: string): MigrateArguments => ({ ok: false, code, message });
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (token === "--") continue;
    if (VALUED.has(token)) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) return refuse("DB_MIGRATE_ARGUMENT_MISSING", MISSING[token]!);
      if (values.has(token)) return refuse("DB_MIGRATE_ARGUMENTS_CONFLICT", `${token} is given twice.`);
      values.set(token, value);
      index += 1;
      continue;
    }
    if (BARE.has(token)) { flags.add(token); continue; }
    return refuse("DB_MIGRATE_ARGUMENT_UNKNOWN", token.startsWith("--") ? `unknown flag ${token}.` : "an argument that is no flag's value.");
  }
  const rollback = values.get("--rollback");
  if (rollback !== undefined) {
    if (values.has("--baseline")) return refuse("DB_MIGRATE_ARGUMENTS_CONFLICT", "--rollback and --baseline cannot be combined.");
    if (flags.has("--status")) return refuse("DB_MIGRATE_ARGUMENTS_CONFLICT", "--rollback and --status cannot be combined.");
    return { ok: true, command: { mode: "rollback", name: rollback, confirmation: values.get("--confirm") ?? null, dryRun: flags.has("--dry-run") } };
  }
  if (values.has("--confirm")) return refuse("DB_MIGRATE_ARGUMENTS_CONFLICT", "--confirm is only for --rollback.");
  if (flags.has("--status")) return { ok: true, command: { mode: "status" } };
  const baseline = values.get("--baseline");
  if (baseline !== undefined) return { ok: true, command: { mode: "baseline", through: baseline } };
  return { ok: true, command: { mode: "apply", dryRun: flags.has("--dry-run") } };
}
