import { realpath } from "node:fs/promises";
import path from "node:path";
import { blockedHostnameReason } from "../net/ip-policy"; // [B19-B I1] the one address policy

export const INGEST_LIMITS = Object.freeze({
  maxTextBytes: 8 * 1024 * 1024,
  maxModelBytes: 100 * 1024 * 1024,
  maxSExpressionDepth: 160,
  maxSExpressionTokens: 1_000_000,
  maxArchiveEntries: 10_000,
  maxDecompressedBytes: 512 * 1024 * 1024,
  maxCompressionRatio: 100,
  // [B19-D I5d rows 37, 44] counts are policy, checked before per-pin work: the largest KiCad symbols (FPGAs) carry a few
  // thousand pins and the largest footprints (BGAs) a few thousand pads; `extends` must not multiply what is hashed
  maxSymbolPins: 10_000,
  maxExpandedSymbolPins: 200_000,
  maxFootprintPads: 10_000,
  // [B19-D I5d review] inheritance also multiplies properties and raw blocks, which are hashed and stored per symbol
  maxExpandedSymbolProperties: 100_000,
  maxExpandedSymbolRawChars: 32 * 1024 * 1024,
});

export class IngestSecurityError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "IngestSecurityError";
  }
}

/** Linear preflight prevents a recursive parser from seeing abusive input. */
export function assertBoundedSExpression(source: string, limits = INGEST_LIMITS): { maxDepth: number; tokens: number; bytes: number } {
  const bytes = Buffer.byteLength(source, "utf8");
  if (bytes > limits.maxTextBytes) throw new IngestSecurityError("file_too_large", `S-expression exceeds ${limits.maxTextBytes} bytes`);
  let depth = 0;
  let maxDepth = 0;
  let tokens = 0;
  let inString = false;
  let escaped = false;
  let inToken = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      inToken = false;
      tokens++;
    } else if (char === "(") {
      inToken = false;
      depth++;
      maxDepth = Math.max(maxDepth, depth);
      tokens++;
      if (depth > limits.maxSExpressionDepth) throw new IngestSecurityError("sexpr_too_deep", `S-expression depth exceeds ${limits.maxSExpressionDepth}`);
    } else if (char === ")") {
      inToken = false;
      depth--;
      if (depth < 0) throw new IngestSecurityError("sexpr_unbalanced", "Unexpected closing parenthesis");
    } else if (/\s/.test(char)) {
      inToken = false;
    } else if (!inToken) {
      inToken = true;
      tokens++;
    }
    if (tokens > limits.maxSExpressionTokens) throw new IngestSecurityError("too_many_tokens", `S-expression token count exceeds ${limits.maxSExpressionTokens}`);
  }
  if (inString) throw new IngestSecurityError("unterminated_string", "Unterminated string");
  if (depth !== 0) throw new IngestSecurityError("sexpr_unbalanced", "Unbalanced parentheses");
  return { maxDepth, tokens, bytes };
}

export function assertArchiveBudget(input: { entries: number; compressedBytes: number; decompressedBytes: number }): void {
  // [B19-D I5b row 43] a count that is not a whole, non-negative, finite number cannot be trusted — refuse it, never compare it
  for (const name of ["entries", "compressedBytes", "decompressedBytes"] as const) {
    const value = input[name];
    if (!Number.isSafeInteger(value) || value < 0) throw new IngestSecurityError("archive_budget_invalid", `Archive ${name} is not a non-negative integer`);
  }
  if (input.entries > INGEST_LIMITS.maxArchiveEntries) throw new IngestSecurityError("archive_entries", "Archive entry count exceeds policy");
  if (input.decompressedBytes > INGEST_LIMITS.maxDecompressedBytes) throw new IngestSecurityError("archive_size", "Expanded archive exceeds policy");
  const ratio = input.compressedBytes <= 0 ? Infinity : input.decompressedBytes / input.compressedBytes;
  if (ratio > INGEST_LIMITS.maxCompressionRatio) throw new IngestSecurityError("archive_ratio", "Archive compression ratio exceeds policy");
}

export interface SafePathPolicy {
  roots: string[];
  variables: Record<string, string>;
  extensions: string[];
}

function expandVariables(reference: string, variables: Record<string, string>): string {
  return reference.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_whole, name: string) => {
    // [B19-D I5d row 49] only the policy's own variables: `${constructor}` must not read the prototype
    const value = Object.hasOwn(variables, name) ? variables[name] : undefined;
    if (typeof value !== "string" || !value) throw new IngestSecurityError("unknown_path_variable", `Unknown path variable: ${name}`);
    return value;
  });
}

function within(child: string, root: string): boolean {
  const relative = path.relative(root, child);
  // [B19-D I5d row 49] an escape is the `..` SEGMENT; a directory named `..foo` inside the root is not one
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

export function resolvePermittedPath(reference: string, policy: SafePathPolicy): string {
  if (reference.includes("\0")) throw new IngestSecurityError("nul_path", "NUL is not permitted in paths");
  const expanded = expandVariables(reference, policy.variables);
  // [B19-D I5d row 49] a relative reference would resolve against the process working directory — an implicit base the
  // policy never named. It must be absolute, directly or through one of the policy's variables.
  if (!path.isAbsolute(expanded)) throw new IngestSecurityError("relative_path", "Library paths must be absolute or start with a configured path variable");
  const resolved = path.resolve(expanded);
  const permittedRoots = policy.roots.map((root) => path.resolve(root));
  if (!permittedRoots.some((root) => within(resolved, root))) throw new IngestSecurityError("path_escape", "Resolved path is outside configured library roots");
  const extension = path.extname(resolved).toLowerCase();
  if (!policy.extensions.map((item) => item.toLowerCase()).includes(extension)) throw new IngestSecurityError("file_type", `Unsupported file type: ${extension || "none"}`);
  return resolved;
}

/**
 * [B19-D I5d row 48] The directories a footprint's 3D model reference may name. Nothing opens model files today; the policy
 * decides whether a reference is well-formed before any future resolver sees it: one KiCad model-directory variable, then
 * forward-slash segments without `.`/`..`, ending in a model file type. Resolution goes through `resolvePermittedPath` against
 * a virtual root, so the same variable, relative-path and escape rules apply.
 */
const MODEL_VIRTUAL_ROOT = path.resolve("/sirkit-kicad-3d-models");
const MODEL_PATH_VARIABLES = ["KICAD6_3DMODEL_DIR", "KICAD7_3DMODEL_DIR", "KICAD8_3DMODEL_DIR", "KICAD9_3DMODEL_DIR", "KICAD10_3DMODEL_DIR", "KISYS3DMOD", "KIPRJMOD"] as const;
export const MODEL_FILE_EXTENSIONS: readonly string[] = [".step", ".stp", ".stpz", ".wrl", ".wrz", ".x3d", ".igs", ".iges"];
const MODEL_PATH_POLICY: SafePathPolicy = {
  roots: [MODEL_VIRTUAL_ROOT],
  variables: Object.fromEntries(MODEL_PATH_VARIABLES.map((name) => [name, path.join(MODEL_VIRTUAL_ROOT, name)])),
  extensions: [...MODEL_FILE_EXTENSIONS],
};

/** Why a footprint's 3D model reference is refused, as a stable code; `null` when it is well-formed. */
export function modelReferencePathIssue(reference: string): string | null {
  const match = /^\$\{([A-Za-z0-9_]+)\}\/(.+)$/.exec(reference);
  if (!match) return "model_path_variable_required";
  if (/[\\\u0000-\u001f\u007f]/.test(match[2]!)) return "model_path_characters";
  // a doubled separator is harmless (upstream KiCad writes one: `${KICAD10_3DMODEL_DIR}//TerminalBlock_Degson.3dshapes/…`)
  if (match[2]!.split("/").some((segment) => segment === "." || segment === "..")) return "model_path_traversal";
  try {
    resolvePermittedPath(reference, MODEL_PATH_POLICY);
    return null;
  } catch (error) {
    return error instanceof IngestSecurityError ? error.code : "model_path_invalid";
  }
}

/** Resolve symlinks and re-check roots; call before opening untrusted files. */
export async function resolvePermittedRealPath(reference: string, policy: SafePathPolicy): Promise<string> {
  const lexical = resolvePermittedPath(reference, policy);
  const resolved = await realpath(lexical);
  const realRoots = await Promise.all(policy.roots.map((root) => realpath(path.resolve(root))));
  if (!realRoots.some((root) => within(resolved, root))) throw new IngestSecurityError("symlink_escape", "Symlink target is outside configured library roots");
  return resolved;
}

function isPrivateIpv4(hostname: string): boolean {
  const octets = hostname.split(".").map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return false;
  return octets[0] === 10 || octets[0] === 127 || octets[0] === 0 ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168);
}

export function assertPermittedUrl(raw: string, allowedHosts: string[]): URL {
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new IngestSecurityError("url_scheme", "Only HTTPS source URLs are permitted");
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  // [B19-B I1] the address policy is shared with the egress path. The old IPv4-only table let an allowlisted [::1],
  // [fd00::1], [::ffff:127.0.0.1] or 100.64.0.1 through — the allowlist was doing all the work.
  if (hostname === "localhost" || hostname.endsWith(".local") || isPrivateIpv4(hostname) || blockedHostnameReason(hostname) !== null) {
    throw new IngestSecurityError("private_network", "Private-network source URLs are prohibited");
  }
  const allowed = allowedHosts.some((host) => hostname === host.toLowerCase() || hostname.endsWith(`.${host.toLowerCase()}`));
  if (!allowed) throw new IngestSecurityError("host_not_allowed", `Source host is not allowed: ${hostname}`);
  url.username = "";
  url.password = "";
  return url;
}

export function assertPermittedRedirect(from: URL, to: string, allowedHosts: string[]): URL {
  const destination = assertPermittedUrl(new URL(to, from).toString(), allowedHosts);
  if (!allowedHosts.some((host) => destination.hostname === host || destination.hostname.endsWith(`.${host}`))) {
    throw new IngestSecurityError("redirect_host", "Redirect changed to an unapproved host");
  }
  return destination;
}

export function redactSecrets(value: string): string {
  return value
    .replace(/\b(sk-(?:proj-)?[A-Za-z0-9_-]{12,})\b/g, "[REDACTED_API_KEY]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/([?&](?:key|token|secret|api_key)=)[^&#\s]+/gi, "$1[REDACTED]");
}

/** Prevent CSV consumers from executing formula-like cell content. */
export function safeSpreadsheetCell(value: string): string {
  return /^[\s]*[=+\-@]/.test(value) ? `'${value}` : value;
}

