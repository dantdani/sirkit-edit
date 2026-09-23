/**
 * [B20 C3] THE first-party descriptor text gate (OD-99, OD-100; D20-15, first-party half). Sirkit's own tool titles,
 * descriptions and schema texts are reviewed repository text, but they are also MODEL-BOUND text: the MCP renderer, the
 * OpenAI and Anthropic adapters and the agent loop all put them in front of a model. This gate is DEFENSE IN DEPTH over
 * that text — like OD-81's foreign-text rules, not a guarantee against every paraphrase — and it runs where a descriptor
 * becomes real: `validateToolDescriptor`, so every registry and every adapter inherits it, and again in the MCP renderer
 * after the strict conversion, over exactly what that renderer emits.
 *
 * What is judged: the descriptor's `toolId`, `title` and `description`, and inside `inputSchema` / `outputSchema` every
 * `title` and `description` value, every property NAME, every `required` entry and every string `enum` / `const` member.
 * Enum members computed from the view-session bus modules (`app/lib/agent/view-context.ts` VIEW_TOOL_ENUMS) are judged too.
 *
 * The ID is judged because it is MODEL-BOUND: MCP lists it as the tool `name` and both provider adapters render
 * `agentProviderName(toolId)` from it, so it is the one descriptor field a model reads verbatim. The structural rules
 * (TOOL_ID_PATTERN, MCP_TOOL_NAME_PATTERN) decide its alphabet, never its meaning, and the caseless stream already turns
 * `.` and `-` into spaces, so R1-R6 read an id exactly as they read a title. A2 runs the same check over a FOREIGN tool's
 * name (`foreign-tools.ts`); this is the first-party half.
 *
 * The order is the contract, and every COUNT and LENGTH is decided before any regular expression, case fold or stream
 * (S5): 1. the bounded schema walk (ancestor-path cycles, so a shared subschema like TARGET is accepted and each of its
 * occurrences counted; a reserved or `Object.prototype` name is refused; a throwing getter or a hostile Proxy is
 * `unreadable`); 2. length; 3. the character rule; 4. the secret shape; 5. markers; 6. directive phrases.
 *
 * Issues are FIXED sentences naming the field KIND and the rule ID. They never contain the judged text (S1, S2). Neither
 * exported function throws. It is NOT A2's foreign-text matcher: importing that would cross the MCP server's import
 * boundary (`foreign-tools.ts` reaches `http-transport.ts`), and its foreign vocabulary would refuse legitimate
 * first-party prose. A2's `carriesDirective` is run over the catalog as a test-time cross-check instead.
 *
 * Its one import is the repository's redaction authority, which imports nothing.
 */
import { containsTokenAnchoredSecretShapedText } from "../agent/redaction";

/**
 * OD-99: the reviewed bounds. `titleMaxChars` and `descriptionMaxChars` are A2's foreign bounds, applied to our own text;
 * `idMaxChars` is the specification's own tool-name limit (reference notes section 6, `MCP_TOOL_NAME_PATTERN`).
 */
export const DESCRIPTOR_TEXT_BOUNDS = Object.freeze({
  idMaxChars: 128,
  titleMaxChars: 120,
  descriptionMaxChars: 1_000,
  schemaTextMaxChars: 500,
  schemaMaxStrings: 512,
  /** counted per own-key nesting level, exactly as `tool-definitions.ts` schemaKeyScan counts */
  schemaMaxDepth: 64,
  schemaMaxNodes: 4_096,
});
export type DescriptorTextBounds = typeof DESCRIPTOR_TEXT_BOUNDS;
const BOUND_CEILINGS: Readonly<Record<keyof DescriptorTextBounds, number>> = Object.freeze({
  idMaxChars: 1_024, titleMaxChars: 1_000, descriptionMaxChars: 10_000, schemaTextMaxChars: 5_000, schemaMaxStrings: 8_192, schemaMaxDepth: 256, schemaMaxNodes: 65_536,
});

/** S3: every bound is a safe integer of at least 1, within its reviewed ceiling. */
export function validateDescriptorTextBounds(value: unknown): string[] {
  const issues: string[] = [];
  if (typeof value !== "object" || value === null) return ["descriptor text bounds: not an object"];
  const candidate = value as Record<string, unknown>;
  for (const name of Object.keys(BOUND_CEILINGS) as Array<keyof DescriptorTextBounds>) {
    const bound: unknown = candidate[name];
    if (typeof bound !== "number" || !Number.isSafeInteger(bound)) { issues.push(`descriptor text bounds: ${name} must be a safe integer`); continue; }
    if (bound < 1 || bound > BOUND_CEILINGS[name]) issues.push(`descriptor text bounds: ${name} must be within [1, ${BOUND_CEILINGS[name]}]`);
  }
  return issues;
}

/**
 * Beside printable ASCII (U+0020 to U+007E), the closed typographic set first-party text may use: the two dashes, the four
 * curly quotes, the ellipsis, degree, plus-minus, micro, multiplication, the rightwards arrow, minus, not-equal and the two
 * inequalities. Everything else — line breaks, tabs, format and bidirectional characters, no-break space, line and
 * paragraph separators, other scripts, astral characters and lone surrogates — is refused.
 */
export const DESCRIPTOR_TEXT_ALLOWED_EXTRA: readonly number[] = Object.freeze([
  0x2013, 0x2014, 0x2018, 0x2019, 0x201c, 0x201d, 0x2026, 0x00b0, 0x00b1, 0x00b5, 0x00d7, 0x2192, 0x2212, 0x2260, 0x2264, 0x2265,
]);
const ALLOWED_EXTRA = new Set<number>(DESCRIPTOR_TEXT_ALLOWED_EXTRA);

export const DESCRIPTOR_TEXT_RULES = Object.freeze([
  "length", "characters", "secret-shape", "marker", "directive-phrase", "reserved-name", "schema-bounds", "unreadable", "annotation-field",
] as const);
export type DescriptorTextRule = (typeof DESCRIPTOR_TEXT_RULES)[number];
export const DESCRIPTOR_TEXT_FIELDS = Object.freeze([
  "tool id", "title", "description", "schema title", "schema description", "schema property name", "schema required name", "schema enum value", "schema const value", "schema", "descriptor",
] as const);
export type DescriptorTextField = (typeof DESCRIPTOR_TEXT_FIELDS)[number];

/** A fixed sentence: the field KIND and the rule ID, never the judged text. */
const issueOf = (field: DescriptorTextField, rule: DescriptorTextRule): string =>
  `first-party descriptor text: a ${field} breaks the ${rule} rule (B20-C3, OD-99)`;

/** Markers, matched case-insensitively on the text itself (never on a word stream). */
const MARKER_LITERALS: readonly string[] = Object.freeze([
  "<|im_start|>", "<|im_end|>", "[inst]", "[/inst]",
  "<system", "</system", "<instructions", "<tool_call", "<tool_use", "<function_call", "<invoke", "antml",
  "```tool", "```function", `"function_call"`,
  "-----begin", "://",
]);
const MARKER_PATTERNS: readonly RegExp[] = Object.freeze([
  /(?:^|[^a-z0-9_-])(?:system|assistant|developer)\s*:/,
  /\.env\b/,
]);

/** R1-R5, matched as whole words over a space-padded word stream; R6 is a stem inside one token of the caseless stream. */
const PHRASE_PATTERNS: readonly RegExp[] = Object.freeze([
  // R1
  / (?:ignore|disregard|forget|bypass)(?: (?:all|any|the|your|my|previous|prior|above|earlier|preceding|system|these|those|other))* (?:instruction|instructions|prompt|prompts|directive|directives|guideline|guidelines) /,
  // R2
  / (?:system|developer) (?:prompt|message|instruction|instructions) /,
  / (?:new|updated|revised|hidden|secret|additional)(?: system)? (?:instruction|instructions) /,
  // R3
  / (?:you must|always call|always invoke) /,
  // R4
  / (?:do not|dont|don t|never) (?:tell|reveal|mention|disclose|inform|show)(?: the)? (?:user|human|operator) /,
  / without (?:telling|informing|asking|notifying) /,
  // R5
  / (?:send|include|provide|paste|share|post|upload|email|forward|reveal|print|output|return)(?: (?:your|the|any|all|my|their))* (?:api key|apikey|access token|token|password|passcode|secret|secrets|credential|credentials|cookie|cookies|session|private key) /,
]);
/** R6: stems that survive every separator, judged inside ONE token of the caseless stream. */
const PHRASE_STEMS: readonly string[] = Object.freeze([
  "exfiltrat", "jailbreak", "ignoreprevious", "ignoreallprevious", "ignoreprior", "disregardprevious", "disregardprior", "forgetprevious", "systemprompt", "apikey", "accesstoken",
]);

const RESERVED_NAMES: readonly string[] = Object.freeze(["__proto__", "constructor", "prototype"]);
/** A property or `required` name a schema may declare: never reserved, never an `Object.prototype` member (S6). */
const reservedName = (name: string): boolean => RESERVED_NAMES.includes(name) || Object.hasOwn(Object.prototype, name);

/** Every character inside printable ASCII or the closed typographic set (no regex: a code-point scan). */
function charactersAllowed(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= 0x20 && code <= 0x7e) continue;
    if (!ALLOWED_EXTRA.has(code)) return false;
  }
  return true;
}

/** A run of non-letters becomes one space; lower-cased; padded, so every pattern can match whole words. */
const caselessStream = (text: string): string => ` ${text.replaceAll(/[^A-Za-z]+/g, " ").trim().toLowerCase()} `;
/** The same, after a space at every lower-to-upper boundary and before the last capital of a capital run followed by lower case. */
const caseSplitStream = (text: string): string => caselessStream(text.replaceAll(/([a-z])([A-Z])/g, "$1 $2").replaceAll(/([A-Z]+)([A-Z][a-z])/g, "$1 $2"));

/** One judged string, in the contract's order. The caller has already decided this string may be read. */
function textIssues(text: string, maxChars: number): DescriptorTextRule | null {
  if (text.length > maxChars) return "length"; // the length FIRST: nothing longer ever meets a pattern, a fold or a stream
  if (!charactersAllowed(text)) return "characters";
  if (containsTokenAnchoredSecretShapedText(text)) return "secret-shape";
  const folded = text.toLowerCase();
  if (MARKER_LITERALS.some((marker) => folded.includes(marker))) return "marker";
  if (MARKER_PATTERNS.some((pattern) => pattern.test(folded))) return "marker";
  const caseless = caselessStream(text);
  const split = caseSplitStream(text);
  if (PHRASE_PATTERNS.some((pattern) => pattern.test(caseless) || pattern.test(split))) return "directive-phrase";
  if (caseless.split(" ").some((token) => token.length > 0 && PHRASE_STEMS.some((stem) => token.includes(stem)))) return "directive-phrase";
  return null;
}

interface Collected { readonly field: DescriptorTextField; readonly text: string }

/**
 * The bounded structural pass over one schema: depth, node count, cycles by ANCESTOR PATH (a shared subschema is accepted
 * and counted once per occurrence), reserved and `Object.prototype` names, and the judged strings COLLECTED but not yet
 * read. A throwing getter or a hostile Proxy is `unreadable`. Never throws.
 */
function collectSchemaText(schema: unknown, issues: Set<string>, collected: Collected[]): void {
  const budget = { nodes: 0 };
  let bounded = true;
  const visit = (node: unknown, depth: number, ancestors: object[]): void => {
    if (!bounded) return;
    if (typeof node !== "object" || node === null) return;
    budget.nodes += 1;
    if (budget.nodes > DESCRIPTOR_TEXT_BOUNDS.schemaMaxNodes || depth > DESCRIPTOR_TEXT_BOUNDS.schemaMaxDepth || ancestors.includes(node)) {
      issues.add(issueOf("schema", "schema-bounds"));
      bounded = false;
      return;
    }
    ancestors.push(node);
    try {
      if (Array.isArray(node)) {
        for (const item of node) visit(item, depth + 1, ancestors);
        return;
      }
      const record = node as Record<string, unknown>;
      for (const key of Object.keys(record)) {
        const value: unknown = record[key];
        if (key === "properties" && typeof value === "object" && value !== null && !Array.isArray(value)) {
          for (const name of Object.keys(value as Record<string, unknown>)) {
            if (reservedName(name)) { issues.add(issueOf("schema property name", "reserved-name")); bounded = false; return; }
            collected.push({ field: "schema property name", text: name });
          }
        }
        if (key === "required" && Array.isArray(value)) {
          for (const entry of value) {
            if (typeof entry !== "string") { issues.add(issueOf("schema required name", "unreadable")); bounded = false; return; }
            if (reservedName(entry)) { issues.add(issueOf("schema required name", "reserved-name")); bounded = false; return; }
            collected.push({ field: "schema required name", text: entry });
          }
        }
        if ((key === "title" || key === "description") && typeof value === "string") collected.push({ field: key === "title" ? "schema title" : "schema description", text: value });
        if (key === "enum" && Array.isArray(value)) for (const member of value) if (typeof member === "string") collected.push({ field: "schema enum value", text: member });
        if (key === "const" && typeof value === "string") collected.push({ field: "schema const value", text: value });
        visit(value, depth + 1, ancestors);
        if (!bounded) return;
      }
    } finally {
      ancestors.pop();
    }
  };
  try {
    visit(schema, 0, []);
  } catch {
    issues.add(issueOf("schema", "unreadable"));
    collected.length = 0;
    return;
  }
  if (!bounded) { collected.length = 0; return; }
  if (collected.length > DESCRIPTOR_TEXT_BOUNDS.schemaMaxStrings) {
    issues.add(issueOf("schema", "schema-bounds"));
    collected.length = 0;
  }
}

/**
 * The strings the gate COLLECTS from one schema (never the issues it decides): the measurement the parity page publishes
 * is taken with this collector, so the page can never claim a shallower reach than the gate actually judges. A schema that
 * breaks a structural bound collects nothing, exactly as the gate reads it.
 */
export function judgedSchemaStrings(schema: unknown): readonly string[] {
  const collected: Collected[] = [];
  collectSchemaText(schema, new Set<string>(), collected);
  return Object.freeze(collected.map((entry) => entry.text));
}

/**
 * The tool ID, judged on its own: it is the one descriptor field the MCP renderer emits verbatim as the model-visible
 * `name`, and the one both provider adapters derive their name from. Same rule chain, under the specification's own name
 * bound. Never throws, and the issue never contains the id.
 */
export function firstPartyIdIssues(toolId: unknown): readonly string[] {
  try {
    if (typeof toolId !== "string") return Object.freeze([issueOf("tool id", "unreadable")]);
    const rule = textIssues(toolId, DESCRIPTOR_TEXT_BOUNDS.idMaxChars);
    return Object.freeze(rule === null ? [] : [issueOf("tool id", rule)]);
  } catch {
    return Object.freeze([issueOf("tool id", "unreadable")]);
  }
}

export interface FirstPartyTextInput {
  /** judged when the key is present: a descriptor always carries one, the MCP renderer judges the name it emits on its own */
  readonly toolId?: unknown;
  readonly title?: unknown;
  readonly description?: unknown;
  readonly inputSchema?: unknown;
  readonly outputSchema?: unknown;
}

/**
 * The gate. `outputSchema` is optional, so the MCP renderer can skip a schema it does not declare. Returns fixed sentences
 * (deduplicated, in the order they were decided) and never throws.
 */
export function firstPartyTextIssues(input: FirstPartyTextInput): readonly string[] {
  const issues = new Set<string>();
  try {
    // the NAME first: it is the one field a model reads verbatim, and the shortest string here
    if (Object.hasOwn(input, "toolId") && input.toolId !== undefined) for (const issue of firstPartyIdIssues(input.toolId)) issues.add(issue);
    for (const [field, value, maxChars] of [
      ["title", input.title, DESCRIPTOR_TEXT_BOUNDS.titleMaxChars],
      ["description", input.description, DESCRIPTOR_TEXT_BOUNDS.descriptionMaxChars],
    ] as ReadonlyArray<readonly [DescriptorTextField, unknown, number]>) {
      if (typeof value !== "string") { issues.add(issueOf(field, "unreadable")); continue; }
      const rule = textIssues(value, maxChars);
      if (rule !== null) issues.add(issueOf(field, rule));
    }
    for (const key of ["inputSchema", "outputSchema"] as const) {
      if (!Object.hasOwn(input, key) || input[key] === undefined) continue;
      const collected: Collected[] = [];
      collectSchemaText(input[key], issues, collected);
      for (const entry of collected) {
        const rule = textIssues(entry.text, DESCRIPTOR_TEXT_BOUNDS.schemaTextMaxChars);
        if (rule !== null) issues.add(issueOf(entry.field, rule));
      }
    }
  } catch {
    issues.add(issueOf("descriptor", "unreadable"));
  }
  return Object.freeze([...issues]);
}

/** OD-100: a descriptor never carries an MCP annotation of its own — annotations are DERIVED from Sirkit's classification. */
export const DESCRIPTOR_ANNOTATION_FIELDS: readonly string[] = Object.freeze([
  "readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint", "annotations",
]);

export function annotationFieldIssues(descriptor: unknown): readonly string[] {
  try {
    if (typeof descriptor !== "object" || descriptor === null) return Object.freeze([]);
    return Object.freeze(DESCRIPTOR_ANNOTATION_FIELDS.some((field) => Object.hasOwn(descriptor, field)) ? [issueOf("descriptor", "annotation-field")] : []);
  } catch {
    return Object.freeze([issueOf("descriptor", "unreadable")]);
  }
}
