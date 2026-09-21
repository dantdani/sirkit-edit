/**
 * [B20 A2] The foreign-descriptor gates: what a server's tool definitions may become inside Sirkit (discovery D20-15
 * foreign half, D20-13 namespace isolation; reference notes section 6; OD-52, OD-58).
 *
 * A foreign definition is UNTRUSTED DATA. Nothing here trusts a name, a title, a description, an annotation or a schema:
 * each is gated, and a definition that fails any gate is EXCLUDED with a closed reason code — never repaired, never
 * truncated into shape, never partly kept. One malformed tool never prevents the others.
 *  - identity: the server's `name` must match the specification's alphabet and is otherwise never echoed; the Sirkit-side
 *    identity is namespaced and reversible (`mcp.<serverId>.<name>`, provider-facing `mcp_<serverId>__<name>` through the
 *    existing `agentProviderName` mapping), so a foreign tool can never take or shadow a `sirkit.` id — and a name that
 *    spells one is refused outright. A name that does not fit the provider alphabet and 64 characters, or that collides
 *    after the mapping, is excluded rather than truncated or renamed.
 *  - text: `title` and `description` are display-only (inert, bounded, the sent token and secret shapes redacted). One
 *    that carries a DIRECTIVE — an instruction aimed at a model, a role or tool-call marker, exfiltration phrasing, a URL
 *    with credentials, or more than a bounded share of non-printing and bidirectional characters — excludes the tool.
 *    Fail closed: the directive is never stripped so the rest can be kept.
 *  - annotations: parsed into a closed record of four optional booleans and used to GRANT NOTHING. Sirkit classifies
 *    every foreign tool as an external read observation whatever the server claims; `readOnlyHint: false` or
 *    `destructiveHint: true` excludes the tool (B20-A is read-only), and `readOnlyHint: true` earns nothing.
 *  - schemas: accepted only within the proven provider wire subset (`validateSchemaStructure`, `validateWireSubset` of
 *    `app/lib/agent/provider-tools.ts` — unchanged, reused), plus explicit refusal of `$ref` / `$defs` / `$id` /
 *    `$anchor` / `$dynamicRef`, of a non-2020-12 dialect, and of the size, depth, subschema and property bounds (OD-58:
 *    no JSON Schema library). `x-mcp-header` is the ONE extension keyword allowed, validated as section 3 of the
 *    specification defines it (narrowed to string / integer / boolean: a stated limit). An invalid OUTPUT schema drops
 *    the output schema and keeps the tool; an invalid INPUT schema excludes it. `icons`, `_meta` and every unknown field
 *    are dropped. [B20 A2 review] A schema's own text is server text too: property names match a closed pattern, enum
 *    and const strings are inert and bounded, every description and title is scanned for a directive and then scrubbed,
 *    and every one of them is compared case-folded with the sent token — a directive or an echo in either schema
 *    excludes the tool. An INPUT schema is accepted only within what the call-time validator evaluates.
 * Every bound is judged BEFORE the work it bounds (S5), every accepted descriptor is a NEW frozen object built field by
 * field (never the server's object, and no key from server data is ever created on it: S6), and `acceptForeignTools`
 * never throws (S4).
 */
import { agentProviderName } from "../agent/provider-tools";
import { validateSchemaStructure, validateWireSubset } from "../agent/provider-tools";
import { MCP_PARAM_HEADER_MAX, REDACTED, scrubVendorText, skeletonCarries, skeletonOf } from "./http-transport";
import { MCP_SERVER_ID_PATTERN, MCP_TOOL_NAME_PATTERN, type McpServerRegistryEntry } from "./server-registry";

/** How many definitions of one server are read at all; the rest are counted (reference notes section 6: paging). */
export const MCP_TOOLS_PER_SERVER_MAX = 500;
export const MCP_TOOL_TITLE_MAX_CHARS = 120;
export const MCP_TOOL_DESCRIPTION_MAX_CHARS = 1_000;
/** The schema bounds (S5): each judged before the walk, the validators or the copy it protects. */
export const MCP_SCHEMA_MAX_BYTES = 32_768;
export const MCP_SCHEMA_MAX_DEPTH = 8;
export const MCP_SCHEMA_MAX_SUBSCHEMAS = 256;
export const MCP_SCHEMA_MAX_PROPERTIES = 64;
/**
 * [B20 A2 review] The retained strings of one schema — property names, description and title values, enum and const
 * strings — COUNTED during the walk and judged before any of them is scanned (S5), and the closed shapes of the two kinds
 * that are kept verbatim: a property name is a bounded identifier, an enum or const string a bounded inert value.
 */
export const MCP_SCHEMA_MAX_STRINGS = 1_024;
export const MCP_SCHEMA_PROPERTY_NAME_MAX_CHARS = 64;
export const MCP_SCHEMA_VALUE_MAX_CHARS = 256;
/** How much of a title or description the directive scan reads: more than the scrub's own window, so nothing kept is unread. */
export const MCP_DIRECTIVE_SCAN_CHARS = 8_192;
/** The Sirkit-side namespaces of a foreign tool (OD-52). */
export const MCP_FOREIGN_TOOL_ID_PREFIX = "mcp.";
export const MCP_FOREIGN_PROVIDER_PREFIX = "mcp_";
/** The 2020-12 dialect, the only one a foreign schema may name (`$schema`, at the root only). */
const JSON_SCHEMA_2020_12: ReadonlySet<string> = new Set(["https://json-schema.org/draft/2020-12/schema", "https://json-schema.org/draft/2020-12/schema#"]);
const REF_KEYWORDS: ReadonlySet<string> = new Set(["$ref", "$defs", "$id", "$anchor", "$dynamicRef", "$dynamicAnchor", "$recursiveRef", "$recursiveAnchor", "$vocabulary", "definitions"]);
const PROTOTYPE_KEYS: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"]);
/** [B20 A2 review] a property name: the tool-name alphabet, bounded (the length is judged first) */
const PROPERTY_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;
/** [B20 A2 review] what an identifier's separators become before the directive scan, so `IGNORE_PREVIOUS_…` reads as words */
const IDENTIFIER_SEPARATORS = /[_.-]+/g;
/** [B20 A2 review] what an enum or const string kept verbatim may not carry: the characters the inert scrub would rewrite */
const NOT_INERT = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;
/** [B20 A2 review] the types `validateAgainstSchema` switches on: one string each (a type array, "null", anyOf and const it cannot evaluate) */
const CALLABLE_TYPES: ReadonlySet<string> = new Set(["object", "array", "string", "number", "integer", "boolean"]);
const X_MCP_HEADER = "x-mcp-header";
/** the nodes one foreign schema may copy: its serialised size is already bounded to 32 768 bytes */
const SCHEMA_COPY_NODES = 50_000;
/** RFC 7230 tchar, bounded to what `Mcp-Param-{Name}` may carry. */
const TCHAR_TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,64}$/;
const HEADER_PARAM_TYPES: ReadonlySet<string> = new Set(["string", "integer", "boolean"]);
/** A name Sirkit's own registry owns: a foreign tool never spells one, at any case. */
const RESERVED_NAME_PREFIXES: readonly string[] = ["sirkit.", "mcp."];
/** the share of non-printing characters a text may carry before it is read as an obfuscated directive */
const NON_PRINTING_MIN = 3;
const NON_PRINTING_SHARE_DIVISOR = 50; // more than 2 %
const NON_PRINTING = /[\p{Cc}\p{Cf}]/gu;
/** LRM, RLM, the four embedding/override controls and the four isolates — built by code point so the source stays ASCII. */
const BIDI_CONTROL = new RegExp(`[${String.fromCharCode(8206)}${String.fromCharCode(8207)}${String.fromCharCode(8234)}-${String.fromCharCode(8238)}${String.fromCharCode(8294)}-${String.fromCharCode(8297)}]`, "u");

/**
 * The directive markers, as ONE alternation of literals over the bounded, skeleton-folded, lowercased copy of a text:
 * instruction overrides, role and system-prompt markers, tool-call markup, imperatives aimed at a model, and
 * exfiltration phrasing (a URL with credentials among them).
 * [B20 A2 review] Linear in the scanned text: no two adjacent quantifiers can split one run between them, and a
 * quantified run is entered only at its FIRST character. The comment used to claim this while four alternatives broke it:
 * the URL-credential marker started at every letter of a scheme run and split a colon run between two classes (cubic —
 * the class A1 review-2 closed in `redaction.ts`), `#{2,}` started at every '#' of a run, `\[\s*\/?\s*` split a run of
 * spaces between two `\s*`, and a line start's `\s*` ran over the newlines that are line starts themselves. Each rewrite
 * matches exactly the texts the old alternative matched (pinned).
 */
const DIRECTIVE_PATTERN = new RegExp([
  String.raw`(?:ignore|disregard|bypass)\s+(?:all\s+|any\s+|the\s+)*(?:previous|prior|preceding|above|earlier|system|these)`,
  String.raw`forget\s+(?:everything|all\s|your\s+(?:previous|prior|system))`,
  String.raw`(?:new|updated|revised|additional)\s+(?:system\s+)?instructions`,
  String.raw`override\s+(?:the\s+)?(?:system|previous|safety|policy)`,
  String.raw`system\s+prompt`,
  String.raw`(?:^|[\n\r>\]])[^\S\n\r]*(?:system|assistant|developer)\s*:`,
  String.raw`<\|im_(?:start|end)\|>`,
  String.raw`\[\s*(?:\/\s*)?(?:system|inst)\s*\]`,
  String.raw`(?<!#)#{2,}\s*(?:system|instruction)`,
  String.raw`<\/?(?:system|instructions|tool_call|tool_use|function_call|function_calls|invoke|antml)`,
  "[`]{3}\\s*(?:tool|function|json_tool)",
  String.raw`"function_call"\s*:`,
  String.raw`you\s+must\b`,
  String.raw`always\s+(?:call|invoke|run|use)\b`,
  String.raw`(?:do\s+not|don't|never)\s+(?:tell|mention|reveal|inform|disclose|show|log)`,
  String.raw`without\s+(?:telling|informing|asking|notifying)`,
  String.raw`(?:exfiltrat|jailbreak)`,
  String.raw`\bapi[_ -]?key\b`,
  String.raw`\baccess[_ -]?token\b`,
  String.raw`\b(?:secret|private)\s+key\b`,
  String.raw`\bpassword\b`,
  String.raw`\bcredentials?\b`,
  String.raw`\.env\b`,
  String.raw`authorization\s+header`,
  String.raw`(?:send|post|upload|email|forward)\s+(?:it|them|this|these|the)\s*(?:user'?s?\s+)?(?:result|results|output|content|contents|data|file|files|conversation|transcript|history|message|messages|token|key)?`,
  // the scan starts only at the FIRST letter of a scheme run (the lookbehind, as `redaction.ts` does), and ':' is not in the
  // user class, so the first ':' after "//" is the one the class stops at
  String.raw`[a-z](?<=(?<![a-z0-9+.-])[0-9+.-]*[a-z])[a-z0-9+.-]*:\/\/[^\s/@:]*:[^\s/@]*@`,
].join("|"), "u");

export type McpToolExclusionReason =
  | "not_an_object"
  | "name_invalid"
  | "reserved_namespace"
  | "duplicate_name"
  | "name_unrepresentable"
  | "name_collision"
  | "description_directive"
  | "declared_write"
  | "input_schema_missing"
  | "input_schema_too_large"
  | "input_schema_too_deep"
  | "input_schema_too_many_subschemas"
  | "input_schema_too_many_properties"
  | "input_schema_ref_keyword"
  | "input_schema_dialect"
  | "input_schema_unsupported"
  | "x_mcp_header_invalid"
  /** [B20 A2 review] the name, a property name, an enum / const string or an `x-mcp-header` token carries the sent token */
  | "credential_echo";

/** One `x-mcp-header` property, as `tool-call.ts` mirrors it into a request header. */
export interface McpHeaderParameter {
  /** the annotated property's own name (the last step of `path`) */
  readonly property: string;
  /** [B20 A2 review] the property names from the schema root to it: where `prepareMcpToolCall` reads the value (own properties only) */
  readonly path: readonly string[];
  readonly token: string;
  readonly header: string;
  readonly type: "string" | "integer" | "boolean";
}

/** The four hints of `ToolAnnotations` (reference notes section 6), parsed and TRUSTED FOR NOTHING. */
export interface McpToolAnnotations {
  readonly readOnlyHint: boolean | null;
  readonly destructiveHint: boolean | null;
  readonly idempotentHint: boolean | null;
  readonly openWorldHint: boolean | null;
}

export interface McpAcceptedTool {
  readonly serverId: string;
  /** the name as the server spells it — what `tools/call` and `Mcp-Name` carry */
  readonly name: string;
  /** the Sirkit-side id: namespaced and reversible, never a `sirkit.` id (OD-52) */
  readonly toolId: string;
  readonly providerName: string;
  /** display-only, untrusted: never an instruction to a model (A4 enforces that at the observation boundary) */
  readonly title: string | null;
  readonly description: string | null;
  readonly untrusted: true;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly outputSchema: Readonly<Record<string, unknown>> | null;
  /** the server declared an output schema this client would not accept: the tool is kept without one */
  readonly outputSchemaDropped: boolean;
  readonly headerParameters: readonly McpHeaderParameter[];
  readonly annotations: McpToolAnnotations;
  /** Sirkit's own classification of EVERY foreign tool, whatever the server's annotations claim */
  readonly observation: "external-read";
}

export interface McpToolExclusion {
  readonly serverId: string;
  /** the validated name, or `(unnamed tool #n)` — a refused name is never echoed */
  readonly label: string;
  readonly reason: McpToolExclusionReason;
}

export interface McpForeignToolSet {
  readonly serverId: string;
  readonly accepted: readonly McpAcceptedTool[];
  readonly excluded: readonly McpToolExclusion[];
  /** how many definitions were read at all (at most `MCP_TOOLS_PER_SERVER_MAX`) */
  readonly considered: number;
  /** how many the server listed past that bound: counted, never read */
  readonly notRead: number;
}

export interface McpForeignToolContext {
  /** the token `mcpPost` would send to this row (`mcpRedactionSubjects`): a text that carries it is replaced whole */
  redact?: readonly string[];
  /** provider names another source already holds; a foreign name that maps onto one is excluded, never renamed */
  reservedProviderNames?: Iterable<string>;
}

// ── The accepted brand ────────────────────────────────────────────────────────

const accepted = new WeakSet<object>();

/** Whether this exact object is a descriptor THESE gates built: `callMcpTool` will send nothing else. */
export function isAcceptedMcpTool(value: unknown): value is McpAcceptedTool {
  return typeof value === "object" && value !== null && accepted.has(value);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Define an own data property, so a `__proto__` key from server data is a KEY and never a prototype (S6). */
function define(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

/**
 * Display text as this client keeps it: the transport's scrub (inert, bounded, the sent token and secret shapes
 * redacted) and then its case-folded skeleton comparison — a text that still carries the credential is replaced whole.
 */
function displayText(raw: unknown, maxChars: number, redact: readonly string[]): string | null {
  if (typeof raw !== "string") return null;
  const text = scrubVendorText(raw, maxChars, redact);
  if (text === "") return null;
  return skeletonCarries(text, redact, true) ? REDACTED : text;
}

/**
 * Whether a title or description reads as an instruction to a model. ONE pass over a BOUNDED, skeleton-folded (NFKD
 * without marks and format characters — a zero-width or fullwidth spelling folds back), lowercased copy, plus the
 * non-printing and bidirectional share of the same bounded text. A text past the scan window is never read: what this
 * client keeps of it is shorter than the window (a stated limit).
 */
export function carriesDirective(raw: unknown): boolean {
  if (typeof raw !== "string" || raw === "") return false;
  const bounded = raw.length > MCP_DIRECTIVE_SCAN_CHARS ? raw.slice(0, MCP_DIRECTIVE_SCAN_CHARS) : raw;
  if (BIDI_CONTROL.test(bounded)) return true;
  const nonPrinting = (bounded.match(NON_PRINTING) ?? []).length;
  if (nonPrinting > NON_PRINTING_MIN && nonPrinting * NON_PRINTING_SHARE_DIVISOR > bounded.length) return true;
  return DIRECTIVE_PATTERN.test(skeletonOf(bounded).toLowerCase());
}

/** The four hints, each only when it IS a boolean own property; everything else the server wrote is ignored. */
function readAnnotations(raw: unknown): McpToolAnnotations {
  const read = (key: string): boolean | null => {
    if (!isPlainObject(raw) || !Object.hasOwn(raw, key)) return null;
    const value = raw[key];
    return typeof value === "boolean" ? value : null;
  };
  return Object.freeze({ readOnlyHint: read("readOnlyHint"), destructiveHint: read("destructiveHint"), idempotentHint: read("idempotentHint"), openWorldHint: read("openWorldHint") });
}

// ── Schemas ───────────────────────────────────────────────────────────────────

type SchemaFailure = Extract<McpToolExclusionReason, `input_schema_${string}` | "x_mcp_header_invalid" | "description_directive" | "credential_echo">;
type SchemaResult = { ok: true; schema: Record<string, unknown>; headers: McpHeaderParameter[] } | { ok: false; reason: SchemaFailure };

interface Frame {
  source: Record<string, unknown>;
  target: Record<string, unknown>;
  depth: number;
  /** [B20 A2 review] the property names from the root when every step was a `properties` step (the only place `x-mcp-header` may sit), else null */
  path: readonly string[] | null;
}

/**
 * [B20 A2 review] One retained schema string, recorded by the walk and judged only once the walk has COUNTED them all (S5):
 * a property name or an enum / const string kept verbatim, or a description / title (`annotation`) kept scrubbed — the
 * walk defines it raw at its place, so key order is kept, and the judgement replaces or removes it.
 */
type RetainedText =
  | { kind: "identifier" | "value"; text: string }
  | { kind: "annotation"; text: string; target: Record<string, unknown>; key: string; maxChars: number };

/**
 * A plain JSON value copied ITERATIVELY (a deeply nested body can never exhaust the stack), with every key defined as
 * an own data property — a `__proto__` key from server data is a key and never a prototype (S6) — under a hard depth
 * and node budget. Over either budget it answers nothing: the caller decides what that means.
 */
export function boundedJsonCopy(value: unknown, depthBudget: number, nodeBudget: number): { ok: true; value: unknown } | { ok: false } {
  if (value === null || typeof value !== "object") return { ok: true, value };
  let nodes = 0;
  const root: unknown = Array.isArray(value) ? [] : {};
  const stack: Array<{ source: object; target: unknown; depth: number }> = [{ source: value, target: root, depth: 1 }];
  while (stack.length > 0) {
    const frame = stack.pop()!;
    nodes += 1;
    if (nodes > nodeBudget || frame.depth > depthBudget) return { ok: false };
    const entries: Array<[string, unknown]> = Array.isArray(frame.source)
      ? frame.source.map((item, index) => [String(index), item])
      : Object.entries(frame.source as Record<string, unknown>);
    for (const [key, child] of entries) {
      if (child !== null && typeof child === "object") {
        const next: unknown = Array.isArray(child) ? [] : {};
        if (Array.isArray(frame.target)) (frame.target as unknown[]).push(next);
        else define(frame.target as Record<string, unknown>, key, next);
        stack.push({ source: child as object, target: next, depth: frame.depth + 1 });
      } else if (Array.isArray(frame.target)) {
        (frame.target as unknown[]).push(child);
      } else {
        define(frame.target as Record<string, unknown>, key, child);
      }
    }
  }
  return { ok: true, value: root };
}

/** [B20 A2 review] A property name kept as a KEY: a bounded identifier, never a member of Object.prototype (the call-time validator reads `required` with `in`). */
function isPropertyName(name: string): boolean {
  return name.length <= MCP_SCHEMA_PROPERTY_NAME_MAX_CHARS && PROPERTY_NAME_PATTERN.test(name) && !PROTOTYPE_KEYS.has(name) && !Object.hasOwn(Object.prototype, name);
}

/**
 * [B20 A2 review] Whether `validateAgainstSchema` (the call-time validator, unchanged) evaluates every node of an accepted
 * copy: it switches on ONE `type` string (or answers by `enum` alone), has no `anyOf` branch and never reads `const`. An
 * input schema it cannot evaluate would be a tool that can never be called, or a constraint that is never enforced.
 */
function callValidatorEvaluates(schema: Record<string, unknown>): boolean {
  const stack: unknown[] = [schema];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!isPlainObject(node) || node.anyOf !== undefined || node.const !== undefined) return false;
    if (node.type === undefined ? node.enum === undefined : !(typeof node.type === "string" && CALLABLE_TYPES.has(node.type))) return false;
    if (isPlainObject(node.properties)) for (const child of Object.values(node.properties)) stack.push(child);
    if (node.items !== undefined) stack.push(node.items);
  }
  return true;
}

/**
 * [B20 A2 review] The retained strings of one schema, judged once the walk has counted them: a name or a value carrying the
 * sent token (case-folded skeleton) is `credential_echo`; any of them reading as a directive is `description_directive`
 * (an identifier's separators read as spaces); a description or title that passes is replaced by its scrubbed, bounded
 * text — whole by the marker when it still carries the token — or removed when nothing of it is left.
 */
function judgeRetainedTexts(texts: readonly RetainedText[], redact: readonly string[]): SchemaFailure | null {
  for (const entry of texts) {
    if (entry.kind === "annotation") {
      if (carriesDirective(entry.text)) return "description_directive";
      const kept = displayText(entry.text, entry.maxChars, redact);
      if (kept === null) delete entry.target[entry.key];
      else entry.target[entry.key] = kept;
      continue;
    }
    if (skeletonCarries(entry.text, redact, true)) return "credential_echo";
    if (carriesDirective(entry.kind === "identifier" ? entry.text.replace(IDENTIFIER_SEPARATORS, " ") : entry.text)) return "description_directive";
  }
  return null;
}

/**
 * One foreign schema, read once: the size, then ONE iterative walk that enforces the depth, subschema and property
 * bounds, refuses every `$…` keyword and a foreign dialect, collects the `x-mcp-header` annotations with their path,
 * and builds a fresh copy without them — then the two repository validators over that copy.
 * [B20 A2 review] The walk also COUNTS every string it retains (at most `MCP_SCHEMA_MAX_STRINGS`, else too large) and holds
 * the two verbatim kinds to their closed shapes; only then are the retained strings scanned (`judgeRetainedTexts`). An
 * INPUT schema (`input`) must also be one the call-time validator evaluates (`callValidatorEvaluates`).
 */
function readForeignSchema(raw: unknown, input: boolean, redact: readonly string[]): SchemaResult {
  if (!isPlainObject(raw)) return { ok: false, reason: "input_schema_missing" };
  let serialized: string;
  try {
    serialized = JSON.stringify(raw) ?? "";
  } catch {
    return { ok: false, reason: "input_schema_too_large" };
  }
  if (serialized.length > MCP_SCHEMA_MAX_BYTES) return { ok: false, reason: "input_schema_too_large" };

  const schema: Record<string, unknown> = {};
  const headers: McpHeaderParameter[] = [];
  const tokens = new Set<string>();
  const texts: RetainedText[] = [];
  /** [B20 A2 review] one more retained string: false when that is one too many */
  const retain = (entry: RetainedText): boolean => texts.push(entry) <= MCP_SCHEMA_MAX_STRINGS;
  /** [B20 A2 review] an enum or const string kept verbatim: bounded (the length first) and inert, then retained */
  const verbatimValue = (text: string): SchemaFailure | null => {
    if (text.length > MCP_SCHEMA_VALUE_MAX_CHARS || NOT_INERT.test(text)) return "input_schema_unsupported";
    return retain({ kind: "value", text }) ? null : "input_schema_too_large";
  };
  const stack: Frame[] = [{ source: raw, target: schema, depth: 1, path: [] }];
  let subschemas = 0;
  while (stack.length > 0) {
    const frame = stack.pop()!;
    subschemas += 1;
    if (subschemas > MCP_SCHEMA_MAX_SUBSCHEMAS) return { ok: false, reason: "input_schema_too_many_subschemas" };
    if (frame.depth > MCP_SCHEMA_MAX_DEPTH) return { ok: false, reason: "input_schema_too_deep" };
    for (const key of Object.keys(frame.source)) {
      if (REF_KEYWORDS.has(key)) return { ok: false, reason: "input_schema_ref_keyword" };
      const value = frame.source[key];
      if (key === "$schema") {
        if (frame.source !== raw || typeof value !== "string" || !JSON_SCHEMA_2020_12.has(value)) return { ok: false, reason: "input_schema_dialect" };
        continue; // the dialect is the default one: it is never copied into the accepted schema
      }
      if (key === X_MCP_HEADER) {
        const token = typeof value === "string" ? value : "";
        const type = frame.source.type;
        const path = frame.path;
        if (!input || path === null || path.length === 0 || !TCHAR_TOKEN.test(token) || typeof type !== "string" || !HEADER_PARAM_TYPES.has(type)) return { ok: false, reason: "x_mcp_header_invalid" };
        if (tokens.has(token.toLowerCase()) || headers.length >= MCP_PARAM_HEADER_MAX) return { ok: false, reason: "x_mcp_header_invalid" };
        // [B20 A2 review] a tchar token can spell a b64token: the sent token, in any case, is never a header name
        if (skeletonCarries(token, redact, true)) return { ok: false, reason: "credential_echo" };
        tokens.add(token.toLowerCase());
        headers.push(Object.freeze({ property: path[path.length - 1]!, path: Object.freeze([...path]), token, header: `Mcp-Param-${token}`, type: type as "string" | "integer" | "boolean" }));
        continue; // the extension keyword never reaches the accepted schema
      }
      if (key === "properties" && isPlainObject(value)) {
        const names = Object.keys(value);
        if (names.length > MCP_SCHEMA_MAX_PROPERTIES) return { ok: false, reason: "input_schema_too_many_properties" };
        const properties: Record<string, unknown> = {};
        define(frame.target, key, properties);
        for (const name of names) {
          // [B20 A2 review] a property name becomes a KEY of the accepted schema: a closed identifier or nothing (S1, S6)
          if (!isPropertyName(name)) return { ok: false, reason: "input_schema_unsupported" };
          if (!retain({ kind: "identifier", text: name })) return { ok: false, reason: "input_schema_too_large" };
          const child = value[name];
          if (isPlainObject(child)) {
            const next: Record<string, unknown> = {};
            define(properties, name, next);
            stack.push({ source: child, target: next, depth: frame.depth + 1, path: frame.path === null ? null : [...frame.path, name] });
          } else {
            const copied = boundedJsonCopy(child, MCP_SCHEMA_MAX_DEPTH * 2, SCHEMA_COPY_NODES);
            if (!copied.ok) return { ok: false, reason: "input_schema_too_deep" };
            define(properties, name, copied.value); // not a schema object: the validators refuse it below
          }
        }
        continue;
      }
      if (key === "items" && isPlainObject(value)) {
        const next: Record<string, unknown> = {};
        define(frame.target, key, next);
        stack.push({ source: value, target: next, depth: frame.depth + 1, path: null });
        continue;
      }
      if (key === "anyOf" && Array.isArray(value)) {
        const members: unknown[] = [];
        define(frame.target, key, members);
        for (const member of value) {
          if (isPlainObject(member)) {
            const next: Record<string, unknown> = {};
            members.push(next);
            stack.push({ source: member, target: next, depth: frame.depth + 1, path: null });
          } else {
            const copied = boundedJsonCopy(member, MCP_SCHEMA_MAX_DEPTH * 2, SCHEMA_COPY_NODES);
            if (!copied.ok) return { ok: false, reason: "input_schema_too_deep" };
            members.push(copied.value);
          }
        }
        continue;
      }
      // [B20 A2 review] the retained strings of a schema node: a description or title is kept scrubbed (defined raw HERE so
      // key order is kept, then judged), an enum member or a const that is a string is kept verbatim in its closed shape
      if ((key === "description" || key === "title") && typeof value === "string") {
        if (!retain({ kind: "annotation", text: value, target: frame.target, key, maxChars: key === "title" ? MCP_TOOL_TITLE_MAX_CHARS : MCP_TOOL_DESCRIPTION_MAX_CHARS })) return { ok: false, reason: "input_schema_too_large" };
        define(frame.target, key, value);
        continue;
      }
      if (key === "enum" && Array.isArray(value)) {
        for (const member of value) {
          const refused = typeof member === "string" ? verbatimValue(member) : null;
          if (refused !== null) return { ok: false, reason: refused };
        }
      }
      if (key === "const" && typeof value === "string") {
        const refused = verbatimValue(value);
        if (refused !== null) return { ok: false, reason: refused };
      }
      const copied = boundedJsonCopy(value, MCP_SCHEMA_MAX_DEPTH * 2, SCHEMA_COPY_NODES);
      if (!copied.ok) return { ok: false, reason: "input_schema_too_deep" };
      define(frame.target, key, copied.value);
    }
  }
  // [B20 A2 review] every retained string was counted by the walk: only now is any of them scanned
  const judged = judgeRetainedTexts(texts, redact);
  if (judged !== null) return { ok: false, reason: judged };
  // a tool's arguments are an object: a string, array or enum root can never describe them (as `toStrictSchema` requires)
  if (schema.type !== "object") return { ok: false, reason: "input_schema_unsupported" };
  if (validateSchemaStructure(schema).length > 0 || validateWireSubset(schema).length > 0) return { ok: false, reason: "input_schema_unsupported" };
  if (input && !callValidatorEvaluates(schema)) return { ok: false, reason: "input_schema_unsupported" };
  return { ok: true, schema, headers };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

// ── acceptForeignTools ────────────────────────────────────────────────────────

/**
 * Turn one server's tool definitions into accepted descriptors and exclusions. Never throws: a definition that cannot
 * even be read is excluded like any other.
 */
export function acceptForeignTools(server: McpServerRegistryEntry, rawTools: unknown, context: McpForeignToolContext = {}): McpForeignToolSet {
  const acceptedTools: McpAcceptedTool[] = [];
  const excluded: McpToolExclusion[] = [];
  let considered = 0;
  let notRead = 0;
  let serverId = "";
  try {
    const id: unknown = (server as { id?: unknown } | null)?.id;
    serverId = typeof id === "string" && MCP_SERVER_ID_PATTERN.test(id) ? id : "";
  } catch {
    serverId = "";
  }
  if (serverId === "" || !Array.isArray(rawTools)) {
    return Object.freeze({ serverId, accepted: Object.freeze([]), excluded: Object.freeze([]), considered: 0, notRead: 0 });
  }

  let redact: readonly string[] = [];
  let reserved = new Set<string>();
  try {
    const given = context?.redact;
    if (Array.isArray(given)) redact = given.filter((entry): entry is string => typeof entry === "string" && entry !== "");
    const names = context?.reservedProviderNames;
    if (names !== undefined && names !== null) reserved = new Set(Array.from(names).filter((entry): entry is string => typeof entry === "string"));
  } catch {
    redact = [];
    reserved = new Set<string>();
  }

  notRead = Math.max(0, rawTools.length - MCP_TOOLS_PER_SERVER_MAX);
  const names = new Set<string>();
  const providerNames = new Set<string>(reserved);
  for (let index = 0; index < rawTools.length && index < MCP_TOOLS_PER_SERVER_MAX; index += 1) {
    considered += 1;
    const position = index + 1;
    try {
      const outcome = acceptOne(serverId, rawTools[index], names, providerNames, redact);
      if (outcome.ok) {
        names.add(outcome.tool.name);
        providerNames.add(outcome.tool.providerName);
        acceptedTools.push(outcome.tool);
      } else {
        excluded.push(Object.freeze({ serverId, label: outcome.label ?? `(unnamed tool #${position})`, reason: outcome.reason }));
      }
    } catch {
      excluded.push(Object.freeze({ serverId, label: `(unnamed tool #${position})`, reason: "not_an_object" }));
    }
  }
  return Object.freeze({ serverId, accepted: Object.freeze(acceptedTools), excluded: Object.freeze(excluded), considered, notRead });
}

type AcceptOne = { ok: true; tool: McpAcceptedTool } | { ok: false; reason: McpToolExclusionReason; label?: string };

function acceptOne(serverId: string, raw: unknown, names: ReadonlySet<string>, providerNames: ReadonlySet<string>, redact: readonly string[]): AcceptOne {
  if (!isPlainObject(raw)) return { ok: false, reason: "not_an_object" };
  const name: unknown = raw.name;
  // the length is judged before the pattern: a megabyte-long name meets no regex (S5)
  if (typeof name !== "string" || name.length > 128 || !MCP_TOOL_NAME_PATTERN.test(name)) return { ok: false, reason: "name_invalid" };
  // [B20 A2 review] the alphabet admits a b64token without '+', '/' or '=': a name that IS the sent token, in any case, is
  // refused before any exclusion could echo it, and reported by position only (S2)
  if (skeletonCarries(name, redact, true)) return { ok: false, reason: "credential_echo" };
  const lower = name.toLowerCase();
  if (RESERVED_NAME_PREFIXES.some((prefix) => lower.startsWith(prefix))) return { ok: false, reason: "reserved_namespace", label: name };
  if (names.has(name)) return { ok: false, reason: "duplicate_name", label: name };

  const toolId = `${MCP_FOREIGN_TOOL_ID_PREFIX}${serverId}.${name}`;
  let providerName: string;
  try {
    providerName = agentProviderName(`${MCP_FOREIGN_PROVIDER_PREFIX}${serverId}__${name}`);
  } catch {
    return { ok: false, reason: "name_unrepresentable", label: name };
  }
  if (providerNames.has(providerName)) return { ok: false, reason: "name_collision", label: name };

  // the raw text is judged for a directive BEFORE it is scrubbed: a scrub would hide the marker, not the intent
  if (carriesDirective(raw.title) || carriesDirective(raw.description)) return { ok: false, reason: "description_directive", label: name };

  const annotations = readAnnotations(raw.annotations);
  if (annotations.readOnlyHint === false || annotations.destructiveHint === true) return { ok: false, reason: "declared_write", label: name };

  const input = readForeignSchema(raw.inputSchema, true, redact);
  if (!input.ok) return { ok: false, reason: input.reason, label: name };

  let outputSchema: Record<string, unknown> | null = null;
  let outputSchemaDropped = false;
  if (raw.outputSchema !== undefined) {
    const output = readForeignSchema(raw.outputSchema, false, redact);
    if (output.ok) outputSchema = output.schema;
    // [B20 A2 review] a directive or the sent token in the output schema is the SERVER's intent, not a malformed schema:
    // the tool is excluded, as for the input schema, rather than kept without its output schema
    else if (output.reason === "description_directive" || output.reason === "credential_echo") return { ok: false, reason: output.reason, label: name };
    else outputSchemaDropped = true;
  }

  const tool: McpAcceptedTool = Object.freeze({
    serverId,
    name,
    toolId,
    providerName,
    title: displayText(raw.title, MCP_TOOL_TITLE_MAX_CHARS, redact),
    description: displayText(raw.description, MCP_TOOL_DESCRIPTION_MAX_CHARS, redact),
    untrusted: true,
    inputSchema: deepFreeze(input.schema),
    outputSchema: outputSchema === null ? null : deepFreeze(outputSchema),
    outputSchemaDropped,
    headerParameters: Object.freeze(input.headers),
    annotations,
    observation: "external-read",
  });
  accepted.add(tool);
  return { ok: true, tool };
}
