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
  for (const [name, value] of Object.entries(input)) {
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
    const value = variables[name];
    if (!value) throw new IngestSecurityError("unknown_path_variable", `Unknown path variable: ${name}`);
    return value;
  });
}

function within(child: string, root: string): boolean {
  const relative = path.relative(root, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function resolvePermittedPath(reference: string, policy: SafePathPolicy): string {
  if (reference.includes("\0")) throw new IngestSecurityError("nul_path", "NUL is not permitted in paths");
  const expanded = expandVariables(reference, policy.variables);
  const resolved = path.resolve(expanded);
  const permittedRoots = policy.roots.map((root) => path.resolve(root));
  if (!permittedRoots.some((root) => within(resolved, root))) throw new IngestSecurityError("path_escape", "Resolved path is outside configured library roots");
  const extension = path.extname(resolved).toLowerCase();
  if (!policy.extensions.map((item) => item.toLowerCase()).includes(extension)) throw new IngestSecurityError("file_type", `Unsupported file type: ${extension || "none"}`);
  return resolved;
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

