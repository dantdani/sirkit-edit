/**
 * [B24-A2] Origin and redirect allowlists per environment, recorded (D24-6, OD-196).
 *
 * One pure function, `supabaseAuthUrls(profile, configuredOrigin)` (`app/lib/deployment/auth-url-allowlist.ts`), takes one of B24-A1's
 * profile values and the deployment's one configured origin and returns the two values the Supabase project must hold: the Site
 * URL, which is that origin normalised (`normalizeOrigin`, expected-origin.ts:63-85), and the redirect allowlist, exactly
 * `<origin>/api/auth/callback` - the one callback (route-policy.ts:131; callback/route.ts:35-63), whose `next` the app limits with
 * `safeRedirectPath` - with no wildcard and no second host. Staging and production refuse an http origin on a non-loopback host
 * (expected-origin.ts:96-98); development and ci accept one; loopback http is accepted everywhere. One origin per deployment
 * (expected-origin.ts:16-22): a preview deployment declares its own, and there is no multi-origin list. The app starts no Supabase flow
 * that redirects to the callback (only `signInWithPassword` and `exchangeCodeForSession`), so the Supabase-initiated flows and the
 * project's template settings are UNKNOWN and BLOCKED-LIVE-QUALIFICATION (LB-1, LB-13): nothing here is verified against a project.
 *
 * Failing first on 1b2c08c: the module does not exist and nothing records the Site URL or the redirect list (page section 8). Files
 * are read as text; nothing is written to disk and no process is started.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEPLOYMENT_PROFILES, SERVING_DEPLOYMENT_PROFILES } from "@/app/lib/auth/deployment-profile";
import { isLoopbackHostname, normalizeOrigin } from "@/app/lib/auth/expected-origin";
import { policyFor } from "@/app/lib/auth/route-policy";
import { SUPABASE_AUTH_CALLBACK_PATH, SUPABASE_AUTH_URL_REFUSALS, supabaseAuthUrls } from "@/app/lib/deployment/auth-url-allowlist";

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8").replaceAll(`${CR}${NEWLINE}`, NEWLINE);
const PAGE = "artifacts/ai-control-plane-b24/edge-security.md";
const MODULE = "app/lib/deployment/auth-url-allowlist.ts";

/** Code with every comment removed (line breaks kept); strings kept. */
function code(text: string): string {
  let out = "";
  let state: "code" | "line" | "block" | "'" | '"' | "`" = "code";
  for (let index = 0; index < text.length; index += 1) {
    const c = text[index]!;
    const next = text[index + 1] ?? "";
    if (state === "code") {
      if (c === "/" && next === "/") { state = "line"; index += 1; continue; }
      if (c === "/" && next === "*") { state = "block"; index += 1; continue; }
      if (c === "'" || c === '"' || c === "`") state = c;
      out += c;
    } else if (state === "line") {
      if (c === NEWLINE) { state = "code"; out += c; }
    } else if (state === "block") {
      if (c === "*" && next === "/") { state = "code"; index += 1; } else if (c === NEWLINE) out += c;
    } else {
      if (c === String.fromCharCode(92)) { out += c + next; index += 1; continue; }
      if (c === state || (c === NEWLINE && state !== "`")) state = "code";
      out += c;
    }
  }
  return out;
}
const SOURCE = /\.(?:tsx?|mts|mjs|cjs|js)$/;
function sources(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return entry.name === "__tests__" || entry.name === "node_modules" || entry.name.startsWith(".") ? [] : sources(path);
    return SOURCE.test(entry.name) && !/\.(?:test|spec)\.[a-z]+$/.test(entry.name) ? [path] : [];
  });
}
const section = (page: string, number: number): string => {
  const start = page.search(new RegExp(`${NEWLINE}## ${number}\\. `));
  const next = page.indexOf(`${NEWLINE}## `, start + 1);
  return start < 0 ? "" : page.slice(start, next < 0 ? undefined : next);
};

const HTTPS = "https://Sirkit.Example/";
const NORMALISED = "https://sirkit.example";
const LOOPBACK = ["http://localhost:3100", "http://127.0.0.1:3000", "http://[::1]:3000", "http://app.localhost:3000"] as const;
const MALFORMED = ["", "   ", "sirkit.example", "https://sirkit.example/app", "https://sirkit.example/api/auth/callback", "https://sirkit.example/?next=/x", "https://sirkit.example/#f", "https://user:pw@sirkit.example", "ftp://sirkit.example", "https://", "https://a.example https://b.example"] as const;

describe("[B24-A2] the Supabase auth URLs per environment (D24-6, OD-196)", () => {
  it("1. counterexample (red on 1b2c08c, where nothing records them): for every profile the Site URL is the normalised origin and the redirect allowlist is exactly [<origin>/api/auth/callback] - no `*`, no second host; the answer holds those two values and nothing else, frozen", () => {
    expect([...DEPLOYMENT_PROFILES]).toEqual(["development", "ci", "staging", "production"]);
    expect(SUPABASE_AUTH_CALLBACK_PATH).toBe("/api/auth/callback");
    for (const profile of DEPLOYMENT_PROFILES) {
      const answer = supabaseAuthUrls(profile, HTTPS);
      expect(answer, profile).toEqual({ ok: true, siteUrl: NORMALISED, redirectAllowlist: [`${NORMALISED}/api/auth/callback`] });
      if (!answer.ok) continue;
      expect(Object.keys(answer).sort()).toEqual(["ok", "redirectAllowlist", "siteUrl"]);
      expect(Object.isFrozen(answer) && Object.isFrozen(answer.redirectAllowlist)).toBe(true);
      expect(JSON.stringify(answer)).not.toContain("*");
      expect(answer.redirectAllowlist.map((url) => new URL(url).origin)).toEqual([answer.siteUrl]);
    }
  });

  it("2. staging and production refuse an http origin on a non-loopback host (the expected-origin.ts:96-98 rule); development and ci accept it; loopback http is accepted for every profile", () => {
    expect([...SERVING_DEPLOYMENT_PROFILES]).toEqual(["staging", "production"]);
    for (const profile of DEPLOYMENT_PROFILES) {
      const strict = (SERVING_DEPLOYMENT_PROFILES as readonly string[]).includes(profile);
      const plain = supabaseAuthUrls(profile, "http://sirkit.example");
      if (strict) expect(plain, profile).toEqual({ ok: false, code: "AUTH_URL_ORIGIN_NOT_HTTPS" });
      else expect(plain, profile).toEqual({ ok: true, siteUrl: "http://sirkit.example", redirectAllowlist: ["http://sirkit.example/api/auth/callback"] });
      for (const origin of LOOPBACK) {
        expect(isLoopbackHostname(new URL(origin).hostname), origin).toBe(true);
        const normalised = normalizeOrigin(origin)!;
        expect(supabaseAuthUrls(profile, origin), `${profile} ${origin}`).toEqual({ ok: true, siteUrl: normalised, redirectAllowlist: [`${normalised}/api/auth/callback`] });
      }
    }
  });

  it("3. a malformed or path-bearing origin is refused through normalizeOrigin, for every profile, exactly when normalizeOrigin refuses it; an unknown profile is refused; no refusal echoes the value", () => {
    for (const profile of DEPLOYMENT_PROFILES) {
      for (const origin of MALFORMED) {
        expect(normalizeOrigin(origin), origin).toBeNull();
        const answer = supabaseAuthUrls(profile, origin);
        expect(answer, `${profile} ${JSON.stringify(origin)}`).toEqual({ ok: false, code: "AUTH_URL_ORIGIN_MALFORMED" });
      }
    }
    // a wildcard host normalises (the URL parser takes it) but is a glob in the Supabase allowlist: refused
    for (const origin of ["https://*.sirkit.example", "http://*.localhost:3000"]) {
      expect(normalizeOrigin(origin), origin).not.toBeNull();
      for (const profile of DEPLOYMENT_PROFILES) expect(supabaseAuthUrls(profile, origin), `${profile} ${origin}`).toEqual({ ok: false, code: "AUTH_URL_ORIGIN_MALFORMED" });
    }
    for (const profile of ["", "Production", " staging", "preview", "prod"]) {
      const answer = supabaseAuthUrls(profile as never, HTTPS);
      expect(answer, JSON.stringify(profile)).toEqual({ ok: false, code: "AUTH_URL_PROFILE_INVALID" });
    }
    expect([...SUPABASE_AUTH_URL_REFUSALS]).toEqual(["AUTH_URL_PROFILE_INVALID", "AUTH_URL_ORIGIN_MALFORMED", "AUTH_URL_ORIGIN_NOT_HTTPS"]);
    const sentinel = ["https://b24-a2-origin", "sentinel.example/path"].join("-");
    expect(JSON.stringify(supabaseAuthUrls("production", sentinel))).not.toContain("sentinel");
    // pure: the module reads no environment and imports only the profile and origin rules
    const text = code(read(MODULE));
    expect(text).not.toMatch(/process\.env|\benvironment\b/);
    expect(text.split(NEWLINE).filter((line) => /^\s*import\b/.test(line)).map((line) => /from "([^"]+)"/.exec(line)?.[1])).toEqual(["@/app/lib/auth/deployment-profile", "@/app/lib/auth/expected-origin"]);
  });

  it("4. the one callback: a public GET row; its handler redirects only to the server-owned origin and limits `next` with safeRedirectPath; no other route exchanges a code", () => {
    const row = policyFor(SUPABASE_AUTH_CALLBACK_PATH, "GET");
    expect(row).toMatchObject({ path: "/api/auth/callback", method: "GET", requiresAuth: false });
    const route = read("app/api/auth/callback/route.ts");
    expect(route).toContain('const next = safeRedirectPath(meta.query?.next, "/");');
    expect(route).toContain("const origin = meta.origin!;");
    expect(route).toContain("return Response.redirect(new URL(next, origin), 303);");
    expect(existsSync(join(ROOT, "app/api/auth/callback/route.ts"))).toBe(true);
  });

  it("5. the app starts no Supabase flow that redirects to the callback: its only auth calls are signInWithPassword (sign-in), exchangeCodeForSession (the callback), signOut and the session reads; no signUp, OAuth, OTP, recovery, invite, generated link, redirectTo or emailRedirectTo anywhere in production code", () => {
    const files = ["app", "components", "lib", "scripts"].flatMap((dir) => sources(dir));
    const calls = new Map<string, string[]>();
    const offenders: string[] = [];
    for (const file of files) {
      const text = code(read(file));
      for (const match of text.matchAll(/\.auth\.(?:admin\.)?([A-Za-z]+)\(/g)) calls.set(match[1]!, [...new Set([...(calls.get(match[1]!) ?? []), file])]);
      if (/\b(?:signUp|signInWithOAuth|signInWithOtp|signInWithSSO|resetPasswordForEmail|inviteUserByEmail|generateLink|redirectTo|emailRedirectTo)\b/.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
    expect([...calls.keys()].sort()).toEqual(["exchangeCodeForSession", "getClaims", "getUser", "signInWithPassword", "signOut"]);
    expect(calls.get("signInWithPassword")).toEqual(["app/api/auth/signin/route.ts"]);
    expect(calls.get("exchangeCodeForSession")).toEqual(["app/api/auth/callback/route.ts"]);
  });
});

describe("[B24-A2] the page edge-security.md, its origin half", () => {
  it("6. the page states the rule per environment (one origin each, a preview deployment its own, no multi-origin list), the Supabase-initiated flows that must land on the callback, that the app starts none of them, the template settings UNKNOWN and BLOCKED-LIVE-QUALIFICATION (LB-1, LB-13), and claims nothing about / handling ?code=", () => {
    const three = section(read(PAGE), 3);
    for (const profile of DEPLOYMENT_PROFILES) expect(three, profile).toMatch(new RegExp(`^\\| \`${profile}\` \\|`, "m"));
    for (const fact of ["`<origin>/api/auth/callback`", "Site URL", "no wildcard", "preview deployment", "multi-origin", "invite", "recovery", "email confirmation", "starts none of them", "**UNKNOWN**", "**BLOCKED-LIVE-QUALIFICATION**", "LB-1", "LB-13", "`safeRedirectPath`", "supabaseAuthUrls", "b24-a2-origin-allowlist"]) expect(three, fact).toContain(fact);
    expect(three).not.toMatch(/`\/`[^\n]*handles[^\n]*\?code=/);
  });

  it("7. [B24-A2 review, 2026-10-06] coverage-4 (red on the page the review read): one OD number for the single-origin choice - the module and the page's section 3 both record the absent multi-origin list as a stated choice under OD-196 (task deliverable 3, D24-6)", () => {
    const odOf = (text: string): string | undefined => /no multi-origin list \(a stated choice, (OD-\d+)\)/.exec(text.replace(/\s+/g, " ").replace(/ \* /g, " "))?.[1];
    expect(odOf(readFileSync(join(ROOT, "app/lib/deployment/auth-url-allowlist.ts"), "utf8"))).toBe("OD-196");
    expect(odOf(section(read(PAGE), 3))).toBe("OD-196");
  });
});
