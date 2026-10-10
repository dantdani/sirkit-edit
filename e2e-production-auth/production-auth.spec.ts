/**
 * [B24-E] D24-34 offline, OD-191: production authentication in a real Chromium against a production-mode server and an ISOLATED
 * Supabase project (runbook B24-E item 2, `:1116`). Runs only through `playwright.production-auth.config.ts`, which refuses unless the
 * project is on the reviewed staging list - empty today, so this spec has never run: BLOCKED-LIVE-QUALIFICATION (LB-1, LB-13).
 *
 *  1. sign-in through /signin lands on /; the session is the `sb-<ref>-auth-token(.N)` family alone, each cookie HttpOnly, SameSite
 *     Lax, Path /, Secure only on https (B16-1B's `:85`, `:126-132`);
 *  2. liveness: GET /api/pcb-sync with the selector headers answers 200 through the page's request context, and 401
 *     AUTH_UNAUTHENTICATED without cookies;
 *  3. revocation: B16-1B's membership canary (`:195-215`) in the isolated database - active answers 200, revoked answers 403
 *     AUTH_NO_ACTIVE_MEMBERSHIP on the next request; its rows carry the sirkit-auth-qualification- prefix and are deleted afterwards;
 *  4. sign-out through the page's request context with the page's Origin answers {ok, signedOut, remoteRevocation: "confirmed"}
 *     (`:221`), the family is retired, and the pre-sign-out cookies replayed in a fresh context answer 401 (`:228-229`).
 *
 * Credentials are read by NAME only and never printed: the spec logs nothing, asserts names, flags, statuses and codes - never a value
 * - and clears both sign-in fields before any assertion that can fail (a failure's error-context.md holds an ARIA snapshot of the page,
 * which carries every textbox's value). A database failure is reported by its error code alone.
 * [B24-E review, 2026-10-10] correctness-1, security-1: the form steps live in `./sign-in-form.ts` - each credential the argument of one
 * bounded page evaluation, never typed (a typed value titles its step and fills a failed action's call log), every step bounded so the
 * `finally` runs before the test timeout - and the config turns the failure page snapshot off.
 */
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { databaseTls } from "../app/lib/db/connection-security";
import { PRODUCTION_AUTH_ORIGIN, PRODUCTION_AUTH_STAGING_TARGETS, productionAuthNotExercised, resolveProductionAuthTarget } from "../app/lib/deployment/production-auth-target";
import { clearCredentialFields, openSignIn, submitSignIn } from "./sign-in-form";

const answer = resolveProductionAuthTarget(process.env, PRODUCTION_AUTH_STAGING_TARGETS);
if (answer.state !== "ready") throw new Error(productionAuthNotExercised(answer));

const EMAIL = process.env.SIRKIT_AUTH_QUALIFICATION_EMAIL ?? "";
const PASSWORD = process.env.SIRKIT_AUTH_QUALIFICATION_PASSWORD ?? "";
const PROJECT_ID = process.env.SIRKIT_AUTH_QUALIFICATION_PROJECT_ID ?? "";
const TENANT_ID = process.env.SIRKIT_AUTH_QUALIFICATION_TENANT_ID ?? "local";
const DB_URL = process.env.SIRKIT_AUTH_QUALIFICATION_DATABASE_URL?.trim() ?? "";
const FAMILY = new RegExp(`^sb-${answer.target.projectRef}-auth-token(?:\\.\\d+)?$`);
const HTTPS = PRODUCTION_AUTH_ORIGIN.startsWith("https:");
const selector = (projectId: string = PROJECT_ID) => ({ "x-sirkit-tenant-id": TENANT_ID, "x-sirkit-project-id": projectId, "x-sirkit-branch-id": "main" });

type Cookies = Awaited<ReturnType<BrowserContext["cookies"]>>;
type Sql = { end: (options?: { timeout?: number }) => Promise<void>; unsafe: (query: string, parameters?: unknown[]) => Promise<unknown[]> };

/** A database step whose failure names its error code only (a driver message can name the host). */
async function databaseStep<T>(step: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const code = typeof (error as { code?: unknown })?.code === "string" && /^[A-Za-z0-9_]{1,40}$/.test((error as { code: string }).code) ? (error as { code: string }).code : "unknown";
    throw new Error(`the membership canary's ${step} failed (${code})`);
  }
}

test.describe.configure({ mode: "serial" });

test.describe("[B24-E] production auth in a real browser against an isolated project (D24-34; OD-191; LB-1, LB-13)", () => {
  let context: BrowserContext;
  let page: Page;
  let preSignout: Cookies = [];
  const canary = { sql: null as Sql | null, userId: "", projectId: `sirkit-auth-qualification-canary-${Date.now().toString(36)}`, inserted: false };

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    context = await browser.newContext({ baseURL: PRODUCTION_AUTH_ORIGIN, storageState: { cookies: [], origins: [] } });
    page = await context.newPage();
  });

  test.afterAll(async () => {
    if (canary.sql) {
      try {
        if (canary.inserted) await databaseStep("cleanup", () => canary.sql!.unsafe("DELETE FROM project_members WHERE project_id = $1 AND user_id = $2", [canary.projectId, canary.userId]));
      } finally {
        await canary.sql.end({ timeout: 5 });
      }
    }
    await context?.close();
  });

  test("1. sign-in through /signin lands on / with the session cookie family alone, each HttpOnly, SameSite Lax, Path / and Secure only on https", async () => {
    await openSignIn(page);
    let status = 0;
    try {
      status = await submitSignIn(page, EMAIL, PASSWORD);
    } finally {
      await clearCredentialFields(page);
    }
    expect(status, "the sign-in answer's status").toBe(200);
    await page.waitForURL((url) => url.pathname === "/", { timeout: 30_000 });
    expect(new URL(page.url()).pathname).toBe("/");
    const cookies = await context.cookies();
    expect(cookies.length, "the session cookie family is set").toBeGreaterThan(0);
    expect(cookies.every((cookie) => FAMILY.test(cookie.name)), "no cookie outside the sb-<ref>-auth-token family").toBe(true);
    expect(cookies.map((cookie) => [cookie.httpOnly, cookie.sameSite, cookie.path, cookie.secure])).toEqual(cookies.map(() => [true, "Lax", "/", HTTPS]));
    expect(cookies.every((cookie) => cookie.expires === -1 || cookie.expires > Date.now() / 1000), "no family cookie is already expired").toBe(true);
  });

  test("2. liveness: the protected read answers 200 through the page's request context, and 401 AUTH_UNAUTHENTICATED without cookies", async ({ playwright }) => {
    const live = await page.request.get("/api/pcb-sync", { headers: selector() });
    expect(live.status(), "the signed-in read").toBe(200);
    const anonymous = await playwright.request.newContext({ baseURL: PRODUCTION_AUTH_ORIGIN, storageState: { cookies: [], origins: [] } });
    try {
      const refused = await anonymous.get("/api/pcb-sync", { headers: selector() });
      expect(refused.status(), "the read without cookies").toBe(401);
      expect(((await refused.json().catch(() => null)) as { code?: unknown } | null)?.code).toBe("AUTH_UNAUTHENTICATED");
    } finally {
      await anonymous.dispose();
    }
  });

  test("3. revocation: an active canary membership answers 200, and once revoked the next request answers 403 AUTH_NO_ACTIVE_MEMBERSHIP (isolated database only; rows prefixed and deleted)", async () => {
    expect(DB_URL.length, "the isolated project's database is named").toBeGreaterThan(0);
    const postgres = (await import("postgres")).default;
    const sql = postgres(DB_URL, { max: 1, prepare: false, ssl: databaseTls(DB_URL), connect_timeout: 15, onnotice: () => {} });
    canary.sql = sql as unknown as Sql;
    const users = (await databaseStep("account lookup", () => canary.sql!.unsafe("SELECT id::text AS id FROM auth.users WHERE email = $1 LIMIT 1", [EMAIL]))) as Array<{ id: string }>;
    expect(users.length, "the qualification account exists in the isolated project").toBe(1);
    canary.userId = users[0]!.id;
    await databaseStep("insert", () => canary.sql!.unsafe(
      "INSERT INTO project_members (membership_id, tenant_id, project_id, user_id, role, state, version, created_at, updated_at, audit_actor_id) VALUES ($1, $2, $3, $4, 'viewer', 'active', 1, now(), now(), 'sirkit-auth-qualification')",
      [`sirkit-auth-qualification-canary-${canary.projectId}`, TENANT_ID, canary.projectId, canary.userId],
    ));
    canary.inserted = true;
    const active = await page.request.get("/api/pcb-sync", { headers: selector(canary.projectId) });
    expect(active.status(), "the active membership's read").toBe(200);
    await databaseStep("revoke", () => canary.sql!.unsafe("UPDATE project_members SET state = 'revoked', version = version + 1, updated_at = now() WHERE project_id = $1 AND user_id = $2", [canary.projectId, canary.userId]));
    const revoked = await page.request.get("/api/pcb-sync", { headers: selector(canary.projectId) });
    expect(revoked.status(), "the next read after revocation").toBe(403);
    expect(((await revoked.json().catch(() => null)) as { code?: unknown } | null)?.code).toBe("AUTH_NO_ACTIVE_MEMBERSHIP");
  });

  test("4. sign-out with the page's Origin confirms remote revocation, retires the family, and the pre-sign-out cookies replayed in a fresh context answer 401", async ({ browser }) => {
    preSignout = await context.cookies();
    expect(preSignout.length).toBeGreaterThan(0);
    const signout = await page.request.post("/api/auth/signout", { headers: { origin: new URL(page.url()).origin } });
    expect(signout.status(), "the sign-out answer's status").toBe(200);
    expect(await signout.json().catch(() => null)).toEqual({ ok: true, signedOut: true, remoteRevocation: "confirmed" });
    const after = await context.cookies();
    expect(after.filter((cookie) => FAMILY.test(cookie.name)).length, "the family is retired").toBe(0);
    const retired = await page.request.get("/api/pcb-sync", { headers: selector() });
    expect(retired.status(), "the retired session's read").toBe(401);
    const replay = await browser.newContext({ baseURL: PRODUCTION_AUTH_ORIGIN, storageState: { cookies: preSignout, origins: [] } });
    try {
      const replayed = await replay.request.get("/api/pcb-sync", { headers: selector() });
      expect(replayed.status(), "the replayed pre-sign-out cookies").toBe(401);
    } finally {
      await replay.close();
    }
  });
});
