/**
 * [B24-C2] D24-13, OD-202: the purge CLI's argument parser and runner, side-effect free so a suite can pin them without importing
 * `scripts/retention-purge.ts` (the thin wrapper, which runs when imported; A4's `cli-arguments.ts` precedent).
 *
 *   (no flag)                                        DRY RUN: the plan per class, the cutoffs, a `planDigest` over exactly the set to delete; nothing is deleted
 *   --as-of <ISO instant>                            the instant the cutoffs are taken at (default: the clock's now); printed in the header and bound into the digest;
 *                                                    a value after the clock's now is refused (it would expire fresh rows)
 *   --limit <1..10000>                               at most this many aggregates per run (default 1,000)
 *   --apply --confirm <planDigest> --as-of <instant>  delete exactly the set a dry run at the SAME --as-of planned: the confirmation is always required
 *                                                    (stricter than OD-202's production-only confirmation, a stated choice), and a digest that no longer
 *                                                    matches - time passed, a head moved, a row landed - refuses and deletes nothing
 *
 * The flags are CLOSED: any other flag (`--read` included: the wrapper dispatches it to B24-C3's read mode before this parser, D12), a stray word, a repeated flag or a
 * malformed value exits 2 BEFORE any repository call and deletes nothing. In a production runtime (A1's `staging`/`production` profile, or
 * `NODE_ENV=production`) the header says so. The CLI never prints `DATABASE_URL`'s value, a payload or a salt: counts, cutoffs and digests
 * only. No package.json script and no environment variable name it (stated choices, OD-232).
 */
import { retentionPurgeRows } from "../observability/retention-policy";
import { RETENTION_LIMITS, applyRetention, isRetentionInstant, planRetention, type RetentionPlan, type RetentionPort } from "./retention";

export const RETENTION_CLI_FLAGS = Object.freeze(["--apply", "--confirm", "--limit", "--as-of"] as const);
export const RETENTION_CLI_EXIT = Object.freeze({ ok: 0, failed: 1, refused: 2 });
export type RetentionCliRefusalCode = "RETENTION_ARGUMENT_UNKNOWN" | "RETENTION_ARGUMENT_REPEATED" | "RETENTION_ARGUMENT_MISSING" | "RETENTION_ARGUMENT_MALFORMED" | "RETENTION_ARGUMENTS_CONFLICT";
export interface RetentionCliCommand { readonly apply: boolean; readonly confirm: string | null; readonly limit: number; readonly asOf: string | null }
export type RetentionCliArguments = { readonly ok: true; readonly command: RetentionCliCommand } | { readonly ok: false; readonly code: RetentionCliRefusalCode; readonly message: string };
export interface RetentionCliDeps {
  readonly port: RetentionPort;
  readonly now: () => Date;
  readonly stdout: (line: string) => void;
  readonly stderr: (line: string) => void;
  readonly productionRuntime: boolean;
  /** the allowlist (default: the policy's day-counted durable classes) */
  readonly rows?: ReadonlyArray<{ readonly aggregateType: string; readonly days: number }>;
}

const VALUED = new Set(["--confirm", "--limit", "--as-of"]);
const BARE = new Set(["--apply"]);
const MISSING: Readonly<Record<string, string>> = {
  "--confirm": "--confirm needs the planDigest of a dry run over the same set.",
  "--limit": "--limit needs a count of aggregates, 1 to 10000.",
  "--as-of": "--as-of needs an ISO-8601 instant (for example 2026-10-08T12:00:00.000Z).",
};
const DIGEST = /^eng1-[0-9a-f]{16}$/;
const INTEGER = /^(?:0|[1-9]\d*)$/;

/** Parse the closed flags; a refusal names its code and nothing of the environment. Total. */
export function parseRetentionArguments(argv: readonly string[]): RetentionCliArguments {
  const refuse = (code: RetentionCliRefusalCode, message: string): RetentionCliArguments => ({ ok: false, code, message });
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (token === "--") continue;
    if (VALUED.has(token)) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) return refuse("RETENTION_ARGUMENT_MISSING", MISSING[token]!);
      if (values.has(token)) return refuse("RETENTION_ARGUMENT_REPEATED", `${token} is given twice.`);
      values.set(token, value);
      index += 1;
      continue;
    }
    if (BARE.has(token)) {
      if (flags.has(token)) return refuse("RETENTION_ARGUMENT_REPEATED", `${token} is given twice.`);
      flags.add(token);
      continue;
    }
    return refuse("RETENTION_ARGUMENT_UNKNOWN", token.startsWith("--") ? `unknown flag ${token.slice(0, 40)}.` : "an argument that is no flag's value.");
  }
  const apply = flags.has("--apply");
  const confirm = values.get("--confirm") ?? null;
  const limitText = values.get("--limit");
  const asOf = values.get("--as-of") ?? null;
  if (confirm !== null && !apply) return refuse("RETENTION_ARGUMENTS_CONFLICT", "--confirm is only for --apply.");
  if (apply && confirm === null) return refuse("RETENTION_ARGUMENT_MISSING", "--apply needs --confirm <planDigest> from a dry run over the same set.");
  if (apply && asOf === null) return refuse("RETENTION_ARGUMENT_MISSING", "--apply needs the same --as-of as the dry run it confirms.");
  if (confirm !== null && !DIGEST.test(confirm)) return refuse("RETENTION_ARGUMENT_MALFORMED", "--confirm is not a planDigest.");
  let limit: number = RETENTION_LIMITS.default;
  if (limitText !== undefined) {
    if (!INTEGER.test(limitText)) return refuse("RETENTION_ARGUMENT_MALFORMED", "--limit is not a whole number.");
    limit = Number.parseInt(limitText, 10);
    if (limit < 1 || limit > RETENTION_LIMITS.max) return refuse("RETENTION_ARGUMENT_MALFORMED", `--limit must be 1 to ${RETENTION_LIMITS.max}.`);
  }
  if (asOf !== null && !isRetentionInstant(asOf)) return refuse("RETENTION_ARGUMENT_MALFORMED", "--as-of is not an ISO-8601 instant with milliseconds in UTC.");
  return { ok: true, command: { apply, confirm, limit, asOf } };
}

const planLines = (plan: RetentionPlan): string[] => plan.rows.map((row) => `${row.aggregateType} (${row.retentionDays} days, cutoff ${row.cutoff}): aggregates ${row.purgeable} purgeable, ${row.refused.mixed_commit + row.refused.outbox_in_flight} refused (mixed_commit ${row.refused.mixed_commit}, outbox_in_flight ${row.refused.outbox_in_flight}); records ${row.records}; replays ${row.replays}; outbox ${row.outbox}`);

/** Run the CLI: 0 on a dry run or an apply, 2 on a refusal (nothing deleted), 1 on an unexpected failure. Never throws. */
export async function runRetentionCli(argv: readonly string[], deps: RetentionCliDeps): Promise<number> {
  const refuse = (code: string, message: string): number => { deps.stderr(`REFUSED ${code}: ${message} - nothing was deleted.`); return RETENTION_CLI_EXIT.refused; };
  const parsed = parseRetentionArguments(argv);
  if (!parsed.ok) return refuse(parsed.code, parsed.message);
  const command = parsed.command;
  try {
    const now = deps.now().toISOString();
    const asOf = command.asOf ?? now;
    if (Date.parse(asOf) > Date.parse(now)) return refuse("RETENTION_AS_OF_IN_FUTURE", `--as-of ${asOf} is after the clock's now (${now}); it would expire fresh rows.`);
    deps.stdout(command.apply ? "retention-purge: APPLY" : "retention-purge: dry run (nothing is deleted)");
    deps.stdout(`as-of: ${asOf}`);
    deps.stdout(`limit: ${command.limit}`);
    deps.stdout(deps.productionRuntime ? "runtime: production (A1 profile staging or production, or NODE_ENV production)" : "runtime: non-production");
    const plan = await planRetention(deps.port, { rows: deps.rows ?? retentionPurgeRows(), asOf, limit: command.limit });
    for (const line of planLines(plan)) deps.stdout(line);
    deps.stdout(`planDigest: ${plan.planDigest}`);
    if (!command.apply) {
      deps.stdout(`nothing was deleted (dry run): to delete exactly this set, run --apply --confirm ${plan.planDigest} --as-of ${asOf}`);
      return RETENTION_CLI_EXIT.ok;
    }
    if (command.confirm !== plan.planDigest) return refuse("RETENTION_CONFIRMATION_MISMATCH", `--confirm does not match the plan at --as-of ${asOf} (planDigest ${plan.planDigest}): the set moved, or the dry run was taken at another instant.`);
    const result = await applyRetention(deps.port, plan);
    deps.stdout(`deleted: aggregates ${result.deleted.aggregates}, records ${result.deleted.records}, replays ${result.deleted.replays}, outbox ${result.deleted.outbox}; refused: mixed_commit ${result.refused.mixed_commit}, outbox_in_flight ${result.refused.outbox_in_flight}, head_moved ${result.refused.head_moved}, not_found ${result.refused.not_found}`);
    return RETENTION_CLI_EXIT.ok;
  } catch (error) {
    deps.stderr(`FAILED ${error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : "RETENTION_RUN_FAILED"}: the run stopped; an aggregate is deleted whole or not at all, so nothing is left partial.`);
    return RETENTION_CLI_EXIT.failed;
  }
}
