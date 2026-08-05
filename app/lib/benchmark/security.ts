import path from "node:path";

const SECRET_PATTERNS = [
  /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/g,
  /(?:api[_-]?key|token|secret|password)\s*[:=]\s*[^\s,;]+/gi,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
];

export function resolveInside(root: string, candidate: string): string {
  if (candidate.includes("\0")) throw new Error("PACKAGE_PATH_INVALID: NUL byte.");
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, candidate);
  const relative = path.relative(resolvedRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("PACKAGE_PATH_TRAVERSAL_DENIED");
  return resolved;
}

export function validatePackagePath(relativePath: string): void {
  if (path.isAbsolute(relativePath) || relativePath.split(/[\\/]+/).includes("..")) throw new Error("PACKAGE_PATH_TRAVERSAL_DENIED");
  if (/\.(?:exe|dll|bat|cmd|ps1|sh|js|mjs|cjs|vbs|scr|com|msi)$/i.test(relativePath)) throw new Error("PACKAGE_EXECUTABLE_DENIED");
}

export function redactSecrets(text: string): { redacted: string; matches: number } {
  let redacted = text; let matches = 0;
  for (const pattern of SECRET_PATTERNS) redacted = redacted.replace(pattern, () => { matches += 1; return "[REDACTED_SECRET]"; });
  return { redacted, matches };
}

export function assertArtifactSafe(text: string): void {
  const result = redactSecrets(text);
  if (result.matches > 0) throw new Error(`ARTIFACT_SECRET_DETECTED:${result.matches}`);
}

export function sanitizeUntrustedMetadata(value: string, maximumLength = 4_000): string {
  const clipped = value.slice(0, maximumLength);
  return clipped.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/<\/?(?:script|iframe|object|embed)[^>]*>/gi, "[REMOVED_TAG]");
}
