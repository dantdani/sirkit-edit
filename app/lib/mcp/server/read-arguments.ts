/**
 * [B20 B3] The argument gate and the call bindings of an MCP read (D-5, D-7; OD-70).
 *
 * Arguments: a closed rule table keyed by the nine served reads, whose property names are exactly each read's registry
 * `inputSchema` properties. At most 8 keys, counted before any key is looked at; every key declared and compared exactly
 * (`__proto__`, `constructor` and `prototype` are refused like any undeclared key); `null` on an optional property counts as
 * absent (a strict provider renders an optional property nullable); lengths are judged before patterns and an array's length
 * before its items; the output is a fresh object of validated values only. Nothing a caller wrote is ever echoed.
 *
 * Bindings: three keys of `params._meta` — never tool arguments, so the MCP input schemas stay the provider schemas — read by
 * exact key with `Object.hasOwn` (the `_meta` object is never iterated, and another key's getter is never invoked):
 * `dev.sirkit/expectedRevision` and `dev.sirkit/expectedRegistryDigest` (exactly 21 characters, `eng1-` and 16 lower-case hex
 * digits) and `dev.sirkit/idempotencyKey` (8 to 128 characters of a closed alphabet). A present value that is not a string or
 * does not match is refused (-32602, HTTP 400). Nothing here throws.
 */
import { ID_PATTERN } from "../../auth/trusted-request-context";

export const MCP_READ_ARGUMENT_MAX_KEYS = 8;
export const MCP_READ_ARGUMENT_STRING_MAX_CHARS = 128;
export const MCP_READ_COMPONENT_IDS_MAX = 512;
export const MCP_READ_META_DIGEST_CHARS = 21;
export const MCP_READ_IDEMPOTENCY_KEY_MIN_CHARS = 8;
export const MCP_READ_IDEMPOTENCY_KEY_MAX_CHARS = 128;
export const MCP_READ_ARGUMENT_BOUNDS = Object.freeze({
  MCP_READ_ARGUMENT_MAX_KEYS,
  MCP_READ_ARGUMENT_STRING_MAX_CHARS,
  MCP_READ_COMPONENT_IDS_MAX,
  MCP_READ_META_DIGEST_CHARS,
  MCP_READ_IDEMPOTENCY_KEY_MIN_CHARS,
  MCP_READ_IDEMPOTENCY_KEY_MAX_CHARS,
});
const ARGUMENT_BOUND_CEILINGS: Readonly<Record<keyof typeof MCP_READ_ARGUMENT_BOUNDS, number>> = Object.freeze({
  MCP_READ_ARGUMENT_MAX_KEYS: 64,
  MCP_READ_ARGUMENT_STRING_MAX_CHARS: 1_024,
  MCP_READ_COMPONENT_IDS_MAX: 4_096,
  MCP_READ_META_DIGEST_CHARS: 64,
  MCP_READ_IDEMPOTENCY_KEY_MIN_CHARS: 64,
  MCP_READ_IDEMPOTENCY_KEY_MAX_CHARS: 1_024,
});

/** S3: exactly the six bounds, each a safe integer in [1, its ceiling]. */
export function validateMcpReadArgumentBounds(value: unknown): string[] {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return ["the bounds are not an object"];
    const record = value as Record<string, unknown>;
    const errors: string[] = [];
    for (const key of Object.keys(record)) if (!Object.hasOwn(ARGUMENT_BOUND_CEILINGS, key)) errors.push(`unknown bound ${key.slice(0, 64)}`);
    for (const [name, ceiling] of Object.entries(ARGUMENT_BOUND_CEILINGS)) {
      const bound = record[name];
      if (typeof bound !== "number" || !Number.isSafeInteger(bound) || bound < 1 || bound > ceiling) errors.push(`${name} must be a safe integer in [1, ${ceiling}]`);
    }
    return errors;
  } catch {
    return ["the bounds could not be read"];
  }
}

/** The `_meta` binding keys (OD-70), under Sirkit's own prefix (OD-60). */
export const MCP_READ_META_KEYS = Object.freeze({
  expectedRevision: "dev.sirkit/expectedRevision",
  expectedRegistryDigest: "dev.sirkit/expectedRegistryDigest",
  idempotencyKey: "dev.sirkit/idempotencyKey",
} as const);
/** A canonical revision or a registry digest: `eng1-` and 16 lower-case hex digits (21 characters). */
export const MCP_REVISION_BINDING_PATTERN = /^eng1-[0-9a-f]{16}$/;
export const MCP_IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
/**
 * A net name MCP can query: 1 to 128 printable ASCII characters other than space, `"`, `'`, `\` and a backtick (a recorded
 * limit: native accepts those, MCP does not).
 */
export const MCP_NET_NAME_PATTERN = /^[!#-&(-[\]-_a-~]{1,128}$/;

export type McpReadArgumentRule = "projectId" | "netName" | "componentIds";
const rules = (entries: Record<string, McpReadArgumentRule>): Readonly<Record<string, McpReadArgumentRule>> => Object.freeze({ ...entries });
/** The nine served reads' argument rules; the property names are the registry input schemas' (b20-b3-read-arguments B1). */
export const MCP_READ_ARGUMENT_RULES: Readonly<Record<string, Readonly<Record<string, McpReadArgumentRule>>>> = Object.freeze({
  "sirkit.component-authority.inspect": rules({ componentIds: "componentIds" }),
  "sirkit.manufacturing.readiness-inspect": rules({}),
  "sirkit.pcb.board-inspect": rules({ projectId: "projectId" }),
  "sirkit.pcb.mechanical-inspect": rules({}),
  "sirkit.pcb.revision-inspect": rules({}),
  "sirkit.pcb.via-inspect": rules({ netName: "netName" }),
  "sirkit.project.canonical-revision-inspect": rules({}),
  "sirkit.validation.connectivity-verify": rules({}),
  "sirkit.validation.drc-run": rules({}),
});

export type McpReadArgumentGate = { readonly ok: true; readonly args: Record<string, unknown> } | { readonly ok: false };
const REFUSED: McpReadArgumentGate = Object.freeze({ ok: false });

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

/** One validated value, or undefined when it is refused. */
function gateValue(rule: McpReadArgumentRule, value: unknown, projectId: string): unknown {
  switch (rule) {
    case "projectId":
      if (typeof value !== "string" || value.length > MCP_READ_ARGUMENT_STRING_MAX_CHARS) return undefined;
      return value === projectId ? value : undefined;
    case "netName":
      if (typeof value !== "string" || value.length < 1 || value.length > MCP_READ_ARGUMENT_STRING_MAX_CHARS) return undefined;
      return MCP_NET_NAME_PATTERN.test(value) ? value : undefined;
    case "componentIds": {
      if (!Array.isArray(value)) return undefined;
      const length = value.length;
      if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 || length > MCP_READ_COMPONENT_IDS_MAX) return undefined;
      const ids: string[] = [];
      for (let index = 0; index < length; index += 1) {
        const item: unknown = value[index];
        if (typeof item !== "string" || item.length > MCP_READ_ARGUMENT_STRING_MAX_CHARS || !ID_PATTERN.test(item)) return undefined;
        ids.push(item);
      }
      return ids;
    }
  }
}

/**
 * Gate the arguments of a served read against its rules: absent is `{}`; at most 8 keys; every key declared; `null` absent;
 * each value validated; a fresh object of validated values out. Anything else is refused (`invalid_arguments`). Never throws.
 */
export function gateMcpReadArguments(toolId: string, args: unknown, principal: { readonly projectId: string }): McpReadArgumentGate {
  try {
    if (typeof toolId !== "string" || !Object.hasOwn(MCP_READ_ARGUMENT_RULES, toolId)) return REFUSED;
    const table = MCP_READ_ARGUMENT_RULES[toolId]!;
    if (args === undefined) return Object.freeze({ ok: true, args: {} });
    if (!isPlainRecord(args)) return REFUSED;
    const keys = Object.keys(args);
    if (keys.length > MCP_READ_ARGUMENT_MAX_KEYS) return REFUSED;
    const projectId = principal.projectId;
    if (typeof projectId !== "string") return REFUSED;
    const out: Record<string, unknown> = {};
    for (const key of keys) {
      if (!Object.hasOwn(table, key)) return REFUSED;
      const descriptor = Object.getOwnPropertyDescriptor(args, key);
      if (!descriptor || !("value" in descriptor)) return REFUSED; // an accessor is never invoked
      const value: unknown = descriptor.value;
      if (value === null) continue;
      const gated = gateValue(table[key]!, value, projectId);
      if (gated === undefined) return REFUSED;
      out[key] = gated;
    }
    return Object.freeze({ ok: true, args: out });
  } catch {
    return REFUSED;
  }
}

export interface McpReadCallBindings {
  readonly expectedRevision: string | null;
  readonly expectedRegistryDigest: string | null;
  readonly idempotencyKey: string | null;
}
export type McpReadBindingParse = { readonly ok: true; readonly bindings: McpReadCallBindings } | { readonly ok: false };

/** One binding: absent is null; a present value must be a string of the right length that matches, else the whole parse fails. */
function bindingOf(meta: Record<string, unknown>, key: string, lengthOk: (length: number) => boolean, pattern: RegExp): string | null | undefined {
  if (!Object.hasOwn(meta, key)) return null;
  const descriptor = Object.getOwnPropertyDescriptor(meta, key);
  if (!descriptor || !("value" in descriptor)) return undefined;
  const value: unknown = descriptor.value;
  if (typeof value !== "string" || !lengthOk(value.length) || !pattern.test(value)) return undefined;
  return value;
}

/** Parse the three call bindings of `params._meta`, by exact key only. Never throws; never echoes a value it refuses. */
export function parseMcpReadBindings(meta: unknown): McpReadBindingParse {
  try {
    if (!isPlainRecord(meta)) return Object.freeze({ ok: false });
    const digest = (length: number): boolean => length === MCP_READ_META_DIGEST_CHARS;
    const key = (length: number): boolean => length >= MCP_READ_IDEMPOTENCY_KEY_MIN_CHARS && length <= MCP_READ_IDEMPOTENCY_KEY_MAX_CHARS;
    const expectedRevision = bindingOf(meta, MCP_READ_META_KEYS.expectedRevision, digest, MCP_REVISION_BINDING_PATTERN);
    const expectedRegistryDigest = bindingOf(meta, MCP_READ_META_KEYS.expectedRegistryDigest, digest, MCP_REVISION_BINDING_PATTERN);
    const idempotencyKey = bindingOf(meta, MCP_READ_META_KEYS.idempotencyKey, key, MCP_IDEMPOTENCY_KEY_PATTERN);
    if (expectedRevision === undefined || expectedRegistryDigest === undefined || idempotencyKey === undefined) return Object.freeze({ ok: false });
    return Object.freeze({ ok: true, bindings: Object.freeze({ expectedRevision, expectedRegistryDigest, idempotencyKey }) });
  } catch {
    return Object.freeze({ ok: false });
  }
}
