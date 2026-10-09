/**
 * [B24-C2] D24-13, OD-202: the operator's retention purge - the thin wrapper over `runRetentionCli` (app/lib/durable-workflow/retention-cli.ts).
 *
 *   pnpm exec tsx scripts/retention-purge.ts                                        dry run (the default): the plan, the cutoffs, the planDigest; nothing is deleted
 *   pnpm exec tsx scripts/retention-purge.ts --as-of <instant> [--limit <1..10000>]  the same, at a stated instant
 *   pnpm exec tsx scripts/retention-purge.ts --apply --confirm <planDigest> --as-of <instant>
 *                                                                                    delete exactly the set the dry run at that instant planned
 *
 * The policy is `app/lib/observability/retention-policy.ts` (only a durable aggregate class with a finite day count is ever deleted); the
 * port reaches the database through `getDb()` alone, so the target is the process's database URL as the operator exported it (the
 * client's one variable) - nothing here loads `.env.local`, and nothing printed carries that value, a payload or a salt. No
 * package.json script names this file.
 *
 * NEVER run by the builder against a live database, the dry run included (OD-191, OD-202, LB-14): its only runs are
 * b24-c2-retention-pglite's, on a disposable in-process PostgreSQL.
 */
import { isProductionRuntime } from "../app/lib/auth/mode";
import { SERVING_DEPLOYMENT_PROFILES, resolveDeploymentProfile } from "../app/lib/auth/deployment-profile";
import { PostgresRetentionPort } from "../app/lib/durable-workflow/retention";
import { runRetentionCli } from "../app/lib/durable-workflow/retention-cli";

const profile = resolveDeploymentProfile();
const productionRuntime = isProductionRuntime() || (SERVING_DEPLOYMENT_PROFILES as readonly string[]).includes(profile.declared);
runRetentionCli(process.argv.slice(2), {
  port: new PostgresRetentionPort(),
  now: () => new Date(),
  stdout: (line) => process.stdout.write(`${line}\n`),
  stderr: (line) => process.stderr.write(`${line}\n`),
  productionRuntime,
}).then((code) => { process.exitCode = code; });
