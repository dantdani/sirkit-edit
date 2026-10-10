/**
 * [B24-E] D24-34 offline, OD-191: the production-auth browser harness's own config (runbook B24-E item 2, `:1116`).
 *
 * Its folder is `e2e-production-auth/` - outside `./e2e` and `./e2e-orchestration`, so neither CI step selects it, and no workflow
 * names this file. Its server is a production-mode build (`next build`, then `next start` on the fixed loopback port 3102) in production
 * auth on the staging profile, whose accounts live in an ISOLATED Supabase project named on the reviewed staging list. That list is
 * empty (OD-6, OD-191), so this config throws `PRODUCTION_AUTH_NOT_EXERCISED` with closed codes and variable names, before anything
 * is built or started: the run is BLOCKED-LIVE-QUALIFICATION (LB-1, LB-13). It never imports the fixture config and never selects the
 * local development auth mode.
 *
 * The shape lives in `app/lib/deployment/production-auth-target.ts` as plain data (pinned by `b24-e-production-auth-config`); this
 * file only wraps it in `defineConfig`. Trace, screenshot and video are off and the only reporter is the list reporter, so no report
 * or trace holds typed input; the spec clears both sign-in fields before any assertion that can fail (a failure's error context
 * holds an ARIA snapshot of the page).
 * [B24-E review, 2026-10-10] correctness-1, security-1: a ready config also sets `PRODUCTION_AUTH_RUNNER_ENV` in its own process - the
 * runner's and each worker's, since a worker loads the config too - so Playwright writes no failure page snapshot at all, even for a
 * test that timed out before its `finally` ran; the spec's form steps are bounded and type no value (`e2e-production-auth/sign-in-form.ts`).
 *
 *   pnpm exec playwright test -c playwright.production-auth.config.ts      (an owner-resourced run only)
 */
import { defineConfig } from "@playwright/test";
import { PRODUCTION_AUTH_RUNNER_ENV, PRODUCTION_AUTH_STAGING_TARGETS, productionAuthNotExercised, productionAuthPlaywrightConfig, resolveProductionAuthTarget } from "./app/lib/deployment/production-auth-target";

const answer = resolveProductionAuthTarget(process.env, PRODUCTION_AUTH_STAGING_TARGETS);
if (answer.state !== "ready") throw new Error(productionAuthNotExercised(answer));
Object.assign(process.env, PRODUCTION_AUTH_RUNNER_ENV);

export default defineConfig(productionAuthPlaywrightConfig(answer));
