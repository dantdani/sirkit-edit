/**
 * [B24-A3] D24-8, OD-197 - the public abuse windows: per-process fixed windows on the anonymous rows that spend provider credit or
 * block the server, and on sign-in. Stated like OD-53 and the MCP limits (inbound-limits.ts:1-11): a per-process window is a stated
 * limit, so N instances allow N times as much; no shared store is used (OD-197's alternative is to require sign-in).
 *
 * Each row in `ABUSE_LIMITS` (keyed `<METHOD> <path>`) has a GLOBAL window - one bucket per process, shared by every caller, key
 * `["public", <slug>, "global"]` - and a PER-CLIENT window keyed on the caller's IP literal, `["public", <slug>, "ip-" + literal]`
 * (lower-cased; the prefix keeps every IPv4 and IPv6 form, `::`-leading ones included, inside ID_PATTERN; [B24-A3 review, 2026-10-08] security-2: an IPv6 client by its /64 prefix, an IPv4-mapped one as its IPv4 address, `clientWindowKeyPart`). The per-client window
 * applies only when SIRKIT_TRUSTED_CLIENT_IP_HEADER names one of a closed list of proxy headers and that header carries exactly one
 * IPv4 or IPv6 literal of at most 45 characters. The variable is unset by default (OD-190 names no platform, so no proxy is known to
 * set it); an absent or malformed value is never trusted and never an error; the value keys a window only - never identity and never
 * an origin.
 *
 * Order: the per-client window first, then the global one. The limiter can only take (no peek, no refund), so a per-client refusal
 * consumes nothing globally, while a global refusal has already used the client's own per-client slot. Only a per-client `limited`
 * refuses; any other per-client refusal (full, key_invalid, clock_invalid, misconfigured) falls back to the global window alone. The
 * global window refuses on any reason (fail closed, inbound-limits.ts:9-11).
 *
 * Nothing here takes a request object, a header map or an address string to parse with a network module (authorize.ts reads the one
 * configured header and hands its bounded value on), nothing opens a connection, and the route classification is not imported (it
 * imports this registry for its census).
 */
import { createFixedWindowLimiter, validateFixedWindowLimit, type FixedWindowLimit, type FixedWindowLimiter, type LimitDecision, type LimitRefusal } from "../mcp/server/inbound-limits";

/** Every window here is a minute; every limiter holds at most this many keys (expired ones are swept first). */
export const ABUSE_WINDOW_MS = 60_000;
export const ABUSE_LIMITER_MAX_KEYS = 10_000;
const perMinute = (limit: number): FixedWindowLimit => Object.freeze({ limit, windowMs: ABUSE_WINDOW_MS, maxKeys: ABUSE_LIMITER_MAX_KEYS });

/** Each public search (an OpenAI embedding per free-text query): 300 a minute across every caller, 60 a minute per keyed client. */
export const PUBLIC_SEARCH_GLOBAL_LIMIT: FixedWindowLimit = perMinute(300);
export const PUBLIC_SEARCH_PER_CLIENT_LIMIT: FixedWindowLimit = perMinute(60);
/** The public placement preview (synchronous engine work, bounded in the route): 10 a minute across every caller, 3 per keyed client. */
export const PLACEMENT_PREVIEW_GLOBAL_LIMIT: FixedWindowLimit = perMinute(10);
export const PLACEMENT_PREVIEW_PER_CLIENT_LIMIT: FixedWindowLimit = perMinute(3);
/** Sign-in (a password check against Supabase Auth): 30 a minute across every caller, 10 per keyed client. */
export const SIGNIN_GLOBAL_LIMIT: FixedWindowLimit = perMinute(30);
export const SIGNIN_PER_CLIENT_LIMIT: FixedWindowLimit = perMinute(10);

export interface PublicAbuseLimit {
  /** the key part naming the row (ID_PATTERN) */
  readonly slug: string;
  readonly global: FixedWindowLimit;
  readonly perClient: FixedWindowLimit;
  /** why the row is limited (over 40 characters; the census refuses a shorter one) */
  readonly reason: string;
}
const entry = (slug: string, global: FixedWindowLimit, perClient: FixedWindowLimit, reason: string): PublicAbuseLimit => Object.freeze({ slug, global, perClient, reason });

/** The reviewed public windows, keyed `<METHOD> <path>` (the census, `abuseLimitViolations`, holds this key set to the classification). */
export const ABUSE_LIMITS: Readonly<Record<string, PublicAbuseLimit>> = Object.freeze({
  "POST /api/parts/search": entry("parts-search", PUBLIC_SEARCH_GLOBAL_LIMIT, PUBLIC_SEARCH_PER_CLIENT_LIMIT, "an anonymous catalogue search embeds the caller's query text with OpenAI: paid provider credit on every free-text request (D24-8)"),
  "GET /api/pcb/footprints/search": entry("footprints-search", PUBLIC_SEARCH_GLOBAL_LIMIT, PUBLIC_SEARCH_PER_CLIENT_LIMIT, "an anonymous footprint search embeds the caller's q text with OpenAI: paid provider credit on every free-text request (D24-8)"),
  "POST /api/pcb/placement/preview": entry("placement-preview", PLACEMENT_PREVIEW_GLOBAL_LIMIT, PLACEMENT_PREVIEW_PER_CLIENT_LIMIT, "an anonymous placement run blocks the event loop until the engine's next budget check; the route bounds its work (at most two candidate evaluations on a bounded board: abuse-controls.md section 9)"),
  "POST /api/auth/signin": entry("signin", SIGNIN_GLOBAL_LIMIT, SIGNIN_PER_CLIENT_LIMIT, "every sign-in asks Supabase Auth to check a password: an anonymous caller can guess credentials or spend the project's own auth limit"),
});

/** Whether a registry entry is well formed: both windows valid, a slug of key-part shape, a reason over 40 characters. */
export function publicAbuseLimitProblems(value: unknown): string[] {
  if (typeof value !== "object" || value === null) return ["the entry is not an object"];
  const candidate = value as Partial<Record<keyof PublicAbuseLimit, unknown>>;
  const problems = [...validateFixedWindowLimit(candidate.global).map((problem) => `global: ${problem}`), ...validateFixedWindowLimit(candidate.perClient).map((problem) => `perClient: ${problem}`)];
  if (typeof candidate.slug !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(candidate.slug)) problems.push("the slug is not a key part");
  if (typeof candidate.reason !== "string" || candidate.reason.length <= 40) problems.push("the reason is 40 characters or fewer");
  return problems;
}

// ── the trusted client header (per-client keying) ──────────────────────────────────────────────────────────────────────────────────

export const TRUSTED_CLIENT_IP_HEADER_ENV = "SIRKIT_TRUSTED_CLIENT_IP_HEADER";
/** The closed list of proxy headers that may key a per-client window (a platform proxy sets each to exactly one address). */
export const TRUSTED_CLIENT_IP_HEADERS = Object.freeze(["x-real-ip", "cf-connecting-ip", "true-client-ip", "fly-client-ip"] as const);
/** The longest IPv6 literal (eight groups with an embedded IPv4 tail) is 45 characters. */
export const CLIENT_IP_LITERAL_MAX_CHARS = 45;

/** The configured header's name, lower-cased, when it is on the closed list; null otherwise (unset, blank or any other name). */
export function trustedClientIpHeaderName(environment: Readonly<Record<string, string | undefined>> = process.env): string | null {
  const configured = environment[TRUSTED_CLIENT_IP_HEADER_ENV]?.trim().toLowerCase();
  return configured !== undefined && (TRUSTED_CLIENT_IP_HEADERS as readonly string[]).includes(configured) ? configured : null;
}

const OCTET = "(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])";
const IPV4 = `${OCTET}(?:[.]${OCTET}){3}`;
const H16 = "[0-9a-f]{1,4}";
const LS32 = `(?:${H16}:${H16}|${IPV4})`;
/** RFC 4291 / RFC 3986 IPv6address (no zone, no brackets), over a lower-cased value; IPv4 dotted-quad without leading zeros. */
const IPV6 = [
  `(?:${H16}:){6}${LS32}`,
  `::(?:${H16}:){5}${LS32}`,
  `(?:${H16})?::(?:${H16}:){4}${LS32}`,
  `(?:(?:${H16}:){0,1}${H16})?::(?:${H16}:){3}${LS32}`,
  `(?:(?:${H16}:){0,2}${H16})?::(?:${H16}:){2}${LS32}`,
  `(?:(?:${H16}:){0,3}${H16})?::${H16}:${LS32}`,
  `(?:(?:${H16}:){0,4}${H16})?::${LS32}`,
  `(?:(?:${H16}:){0,5}${H16})?::${H16}`,
  `(?:(?:${H16}:){0,6}${H16})?::`,
].join("|");
const IP_LITERAL = new RegExp(`^(?:${IPV4}|${IPV6})$`);

/** Exactly one IPv4 or IPv6 literal of at most 45 characters, lower-cased; null for anything else (a list, a port, brackets, a zone). */
export function clientIpLiteral(value: string | null | undefined): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > CLIENT_IP_LITERAL_MAX_CHARS) return null;
  const literal = value.toLowerCase();
  return IP_LITERAL.test(literal) ? literal : null;
}

// ── the decision ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type PublicAbuseDecision =
  | { readonly ok: true; readonly keyed: boolean }
  | { readonly ok: false; readonly window: "per-client" | "global"; readonly reason: LimitRefusal; readonly retryAfterS: number };

/** Per client first (only `limited` refuses there), then global (any refusal refuses); the global window is taken only when the
 *  per-client window did not refuse, so a per-client refusal consumes nothing globally. */
export function publicWindowDecision(perClient: LimitDecision | null, takeGlobal: () => LimitDecision): PublicAbuseDecision {
  if (perClient !== null && !perClient.ok && perClient.reason === "limited") return Object.freeze({ ok: false, window: "per-client", reason: "limited", retryAfterS: perClient.retryAfterS });
  const global = takeGlobal();
  if (!global.ok) return Object.freeze({ ok: false, window: "global", reason: global.reason, retryAfterS: global.retryAfterS });
  return Object.freeze({ ok: true, keyed: perClient !== null && perClient.ok });
}

const limiters = new Map<string, { readonly global: FixedWindowLimiter; readonly perClient: FixedWindowLimiter }>(
  Object.entries(ABUSE_LIMITS).map(([key, value]) => [key, { global: createFixedWindowLimiter(value.global), perClient: createFixedWindowLimiter(value.perClient) }] as const),
);

/** Take one request on a public row at `nowMs`: null when the row has no entry here, else the decision. `clientValue` is the configured
 *  header's value (or null); it keys the per-client window only when it is exactly one IP literal. */
export function takePublicAbuseLimit(routeKey: string, clientValue: string | null, nowMs: number): PublicAbuseDecision | null {
  if (!Object.hasOwn(ABUSE_LIMITS, routeKey)) return null;
  const limit = ABUSE_LIMITS[routeKey]!;
  const pair = limiters.get(routeKey)!;
  const literal = clientIpLiteral(clientValue);
  const perClient = literal === null ? null : pair.perClient.take(["public", limit.slug, clientWindowKeyPart(literal)], nowMs); // [B24-A3 review, 2026-10-08] security-2: an IPv6 client by its /64, an IPv4-mapped one as its IPv4 address
  return publicWindowDecision(perClient, () => pair.global.take(["public", limit.slug, "global"], nowMs));
}

/** Test seam: empty every public window [B24-A3b] and every per-principal window. */
export function resetAbuseLimitsForTests(): void {
  for (const pair of limiters.values()) {
    pair.global.reset();
    pair.perClient.reset();
  }
  resetPrincipalWindows();
}

// ── [B24-A3b] the per-principal windows on authenticated spend (D24-8, OD-197) ─────────────────────────────────────────────────────
// Appended, so no line above moves (the flag inventory cites this file's line 70). Every AUTHENTICATED row that is provider credit or
// expensive has ONE fixed window per (method, path), keyed on the trusted context's [tenantId, projectId, principalId] only - never a
// header, never a body field. Per process, like every window here. Any refusal refuses (fail closed, as MCP's endpoint window): there
// is no global window to fall back to, and the trusted context's ids are ID_PATTERN-shaped (the selector is checked there; a principal
// id is a Supabase user id or a fixed local-development id). Taken in `authorizeRequest` after membership and role (so before the
// media type and the body), and in `agentStreamRoute` after `authorizeActor` (chat reads its body first, by design). The census
// (`abuseLimitViolations`) holds this key set to the classification; the classification is not imported here.

// The values are above every existing suite's count of requests per row within one file (counted 2026-10-07 over every suite that
// reaches a gated row, the windows switched off: abuse-controls.md section 15), as the task asks; A3b's stated choices (OD-197).
/** An authenticated provider-credit row (a model, distributor or embedding call per request): 60 a minute per principal (the largest
 *  count in one suite file is 18). */
export const PRINCIPAL_CREDIT_LIMIT: FixedWindowLimit = perMinute(60);
/** An authenticated expensive row (an external process, a release build or a provider exchange per request): 50 a minute per
 *  principal. The task proposed 10; two suite files send 43 to one expensive row in one window (the provider exchange's route suite,
 *  B22-D's adversarial simulate suite), and ten more send 11 to 35, so 50. */
export const PRINCIPAL_EXPENSIVE_LIMIT: FixedWindowLimit = perMinute(50);
/** `POST /api/chat` (one agent run per request, one or more model turns each): 60 a minute per principal. The task proposed 20; one
 *  suite file sends 37 chat runs in one window (b21-e3-chat-resume), and the browser job's agent-execution spec sends 82 from one
 *  principal in one project over its whole run - [B24-A3 review, 2026-10-08] regressions-1: a minute's count only because every window reads the real clock (`unfrozenNowMs`), never the fixture runtime's frozen one; 17 in 39.6 s in B18-C's recorded run - so 60. */
export const PRINCIPAL_CHAT_LIMIT: FixedWindowLimit = perMinute(60);

export type PrincipalLimitKind = "provider-credit" | "expensive" | "chat";
export interface PrincipalAbuseLimit {
  readonly kind: PrincipalLimitKind;
  readonly perPrincipal: FixedWindowLimit;
  /** why the row is limited (over 40 characters; the census refuses a shorter one) */
  readonly reason: string;
}
const PRINCIPAL_REASONS: Readonly<Record<PrincipalLimitKind, string>> = Object.freeze({
  "provider-credit": "an authenticated member spends provider credit on every request: a model, distributor or embedding call (D24-8)",
  expensive: "an authenticated member starts an external process, a release build or a provider exchange on every request (D24-8)",
  chat: "an authenticated member starts an agent run of one or more model turns on every request; its body is read first (D24-8)",
});
const principalEntry = (kind: PrincipalLimitKind): PrincipalAbuseLimit =>
  Object.freeze({ kind, perPrincipal: kind === "chat" ? PRINCIPAL_CHAT_LIMIT : kind === "expensive" ? PRINCIPAL_EXPENSIVE_LIMIT : PRINCIPAL_CREDIT_LIMIT, reason: PRINCIPAL_REASONS[kind] });

/** The 32 authenticated provider-credit rows other than `/api/chat` (the classification's, at the A3a tree). */
const PRINCIPAL_CREDIT_ROWS = Object.freeze([
  "POST /api/architecture/alternatives", "POST /api/architecture/candidates", "POST /api/architecture/compare", "POST /api/architecture/propose",
  "POST /api/bom", "POST /api/calculation/propose", "POST /api/circuit-knowledge/propose", "POST /api/circuit-verification/propose",
  "POST /api/component-selection/propose", "POST /api/interfaces/alternatives", "POST /api/interfaces/candidates", "POST /api/interfaces/compare",
  "POST /api/interfaces/propose", "POST /api/parts/external-search", "POST /api/pcb/ai-rules/from-brief", "POST /api/pcb/assign/suggest",
  "POST /api/pcb/edit/assist", "POST /api/pcb/repair/agent", "POST /api/power/alternatives", "POST /api/power/candidates",
  "POST /api/power/compare", "POST /api/power/propose", "POST /api/schematic", "POST /api/schematic-compiler/propose",
  "POST /api/schematic/build", "POST /api/schematic/build-multi", "POST /api/schematic/cross-verify", "POST /api/schematic/edit",
  "POST /api/schematic/edit-build", "POST /api/schematic/layout-critic", "POST /api/schematic/review", "POST /api/spice/ai",
] as const);
/** The 7 authenticated expensive rows (none of them is provider credit). */
const PRINCIPAL_EXPENSIVE_ROWS = Object.freeze([
  "POST /api/pcb/autoroute", "POST /api/pcb/export/gerbers", "POST /api/pcb/provider-exchange", "POST /api/pcb/qualify", "POST /api/pcb/release",
  "POST /api/simulate", "POST /api/spice/models/smoke-test",
] as const);

/** The reviewed per-principal windows, keyed `<METHOD> <path>`: the 40 authenticated provider-credit or expensive rows. */
export const PRINCIPAL_ABUSE_LIMITS: Readonly<Record<string, PrincipalAbuseLimit>> = Object.freeze(Object.fromEntries([
  ...PRINCIPAL_CREDIT_ROWS.map((key) => [key, principalEntry("provider-credit")] as const),
  ...PRINCIPAL_EXPENSIVE_ROWS.map((key) => [key, principalEntry("expensive")] as const),
  ["POST /api/chat", principalEntry("chat")] as const,
]));

/** Whether a per-principal entry is well formed: a known kind, a valid window, a reason over 40 characters. */
export function principalAbuseLimitProblems(value: unknown): string[] {
  if (typeof value !== "object" || value === null) return ["the entry is not an object"];
  const candidate = value as Partial<Record<keyof PrincipalAbuseLimit, unknown>>;
  const problems = validateFixedWindowLimit(candidate.perPrincipal).map((problem) => `perPrincipal: ${problem}`);
  if (candidate.kind !== "provider-credit" && candidate.kind !== "expensive" && candidate.kind !== "chat") problems.push("the kind is not provider-credit, expensive or chat");
  if (typeof candidate.reason !== "string" || candidate.reason.length <= 40) problems.push("the reason is 40 characters or fewer");
  return problems;
}

const principalLimiters = new Map<string, FixedWindowLimiter>(
  Object.entries(PRINCIPAL_ABUSE_LIMITS).map(([key, value]) => [key, createFixedWindowLimiter(value.perPrincipal)] as const),
);

/** Take one request on an authenticated row for `parts` - the trusted context's [tenantId, projectId, principalId], nothing else - at
 *  `nowMs`: null when the row has no entry here, else the limiter's decision (any refusal refuses). */
export function takePrincipalAbuseLimit(routeKey: string, parts: readonly string[], nowMs: number): LimitDecision | null {
  if (!Object.hasOwn(PRINCIPAL_ABUSE_LIMITS, routeKey)) return null;
  return principalLimiters.get(routeKey)!.take(parts, nowMs);
}

function resetPrincipalWindows(): void {
  for (const limiter of principalLimiters.values()) limiter.reset();
}

// ── [B24-A3 review, 2026-10-08] security-2: the per-client key part ────────────────────────────────────────────────────────────────
// Appended, so no line above moves. The lockout the global window allows stands with the header set too (abuse-controls.md section 5):
// the global window is the process-wide cap on spend, one bucket for every caller, so a few keyed clients at their per-client limit
// still exhaust it; and every new client inserts a per-client key before the global take (the limiter has no peek), so a caller with
// enough distinct /64s can fill the key map, after which a per-client `full` falls back to the global window alone.

/** The per-client window's key part for one validated IP literal (`clientIpLiteral`): an IPv4 address as itself; an IPv4-mapped IPv6
 *  address (`::ffff:a.b.c.d`, in either spelling) as its IPv4 address, the same client; any other IPv6 address by its /64 prefix, the
 *  unit one host or one subscriber is given, so a host rotating addresses inside its /64 meets one window. The `ip-` prefix keeps every
 *  part inside ID_PATTERN; a /64 is written `ip-<four groups>::`. */
export function clientWindowKeyPart(literal: string): string {
  if (!literal.includes(":")) return `ip-${literal}`;
  const groups = ipv6Groups(literal);
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) return `ip-${groups[6]! >> 8}.${groups[6]! & 255}.${groups[7]! >> 8}.${groups[7]! & 255}`;
  return `ip-${groups.slice(0, 4).map((group) => group.toString(16)).join(":")}::`;
}

/** The eight 16-bit groups of a validated IPv6 literal (an embedded IPv4 tail becomes the last two). */
function ipv6Groups(literal: string): number[] {
  let text = literal;
  const tail = /([0-9]{1,3})[.]([0-9]{1,3})[.]([0-9]{1,3})[.]([0-9]{1,3})$/.exec(text);
  if (tail) {
    const [a, b, c, d] = tail.slice(1).map(Number) as [number, number, number, number];
    text = `${text.slice(0, tail.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, rest] = text.split("::") as [string, string | undefined];
  const left = head === "" ? [] : head.split(":");
  const right = rest === undefined || rest === "" ? [] : rest.split(":");
  const fill = rest === undefined ? [] : new Array<string>(8 - left.length - right.length).fill("0");
  return [...left, ...fill, ...right].map((group) => Number.parseInt(group, 16));
}
