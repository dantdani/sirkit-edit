/**
 * [PR-M, 2026-10-18] Section M2 (design M2.2): the FIXTURE CAD source's transport - an injected `OutboundDeps.fetch` and resolver
 * for the fixture host `cad-fixture.sirkit.test` that serve REAL committed bytes through the production egress path (`cad-egress.ts`
 * -> `outboundFetch`: the same host allowlist, address policy, deadline, body ceiling, redirect refusal and media-type check). It is
 * the fixture runtime's (and the tests') seam, never a production path: the `fixture-kicad` registry row is refused outside the
 * fixture runtime.
 *
 * Files (provenance in ./LICENSES.md): the official KiCad blobs copied verbatim at the pinned commits under ./kicad-symbols and
 * ./kicad-footprints, the Device:D / Diode_SMD:D_SOD-123 copies M1 committed under ../blinker/kicad (reused, not copied again),
 * and the ORIGINAL MIT fixture pin tables under ./datasheets. Tests may add `overrides` (a hostile asset, a 429 with Retry-After, a
 * redirect, an oversized body, a wrong media type) and read `requests` (every URL asked for - the zero-network reuse assertions).
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export const FIXTURE_CAD_HOST = "cad-fixture.sirkit.test";
/** a public (TEST-NET-3) address, so the production address policy admits it */
export const FIXTURE_CAD_ADDRESS = "203.0.113.77";

export interface FixtureCadOverride { status: number; body?: string | Uint8Array; headers?: Record<string, string>; delayMs?: number }
export interface FixtureCadTransport {
  fetch: typeof fetch;
  resolve: (hostname: string) => Promise<string[]>;
  /** every URL the transport was asked for, in order */
  readonly requests: string[];
  overrides: Map<string, FixtureCadOverride>;
}

const MEDIA: Readonly<Record<string, string>> = Object.freeze({ ".kicad_sym": "application/x-kicad-symbol", ".kicad_mod": "application/x-kicad-footprint", ".txt": "text/plain; charset=utf-8" });

function fixtureRoot(root: string): { cad: string; blinker: string } {
  return { cad: path.join(root, "app", "lib", "fixture-runtime", "cad-source"), blinker: path.join(root, "app", "lib", "fixture-runtime", "blinker", "kicad") };
}

/** The committed file a fixture path names, or null (never a file outside the two fixture directories). */
export function fixtureCadFile(urlPath: string, root: string = process.cwd()): string | null {
  const { cad, blinker } = fixtureRoot(root);
  let decoded: string;
  try { decoded = decodeURIComponent(urlPath); } catch { return null; }
  if (decoded.includes("..") || decoded.includes("\\") || /\0/.test(decoded)) return null;
  const symbol = /^\/kicad-symbols\/([A-Za-z0-9_.+-]+)\.kicad_symdir\/([A-Za-z0-9_.,+()=-]+)\.kicad_sym$/.exec(decoded);
  const footprint = /^\/kicad-footprints\/([A-Za-z0-9_.+-]+)\.pretty\/([A-Za-z0-9_.,+()=-]+)\.kicad_mod$/.exec(decoded);
  const datasheet = /^\/datasheets\/([A-Za-z0-9_.,+()=-]+)\.pin-table\.txt$/.exec(decoded);
  const candidates: string[] = [];
  if (symbol) {
    candidates.push(path.join(cad, "kicad-symbols", `${symbol[1]}.kicad_symdir`, `${symbol[2]}.kicad_sym`));
    if (symbol[1] === "Device" && symbol[2] === "D") candidates.push(path.join(blinker, "D.kicad_sym"));
  } else if (footprint) {
    candidates.push(path.join(cad, "kicad-footprints", `${footprint[1]}.pretty`, `${footprint[2]}.kicad_mod`));
    if (footprint[1] === "Diode_SMD" && footprint[2] === "D_SOD-123") candidates.push(path.join(blinker, "D_SOD-123.kicad_mod"));
  } else if (datasheet) {
    candidates.push(path.join(cad, "datasheets", `${datasheet[1]}.pin-table.txt`));
  }
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (!resolved.startsWith(path.resolve(cad) + path.sep) && !resolved.startsWith(path.resolve(blinker) + path.sep)) continue;
    if (existsSync(resolved) && statSync(resolved).isFile()) return resolved;
  }
  return null;
}

/** A fresh fixture transport (its own request log and overrides). */
export function createFixtureCadTransport(options: { root?: string } = {}): FixtureCadTransport {
  const requests: string[] = [];
  const overrides = new Map<string, FixtureCadOverride>();
  const root = options.root ?? process.cwd();
  const transport: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    requests.push(`${url.origin}${url.pathname}`);
    if (init?.signal?.aborted) throw new Error("aborted");
    if (url.hostname !== FIXTURE_CAD_HOST) return new Response("unknown host", { status: 502 });
    const override = overrides.get(url.pathname);
    if (override) {
      if (override.delayMs) await new Promise<void>((resolve, reject) => { const timer = setTimeout(resolve, override.delayMs); init?.signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("aborted")); }, { once: true }); });
      return new Response(override.body === undefined ? null : typeof override.body === "string" ? override.body : new Blob([new Uint8Array(override.body)]), { status: override.status, headers: override.headers ?? {} });
    }
    const file = fixtureCadFile(url.pathname, root);
    if (!file) return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
    const bytes = readFileSync(file);
    return new Response(new Blob([new Uint8Array(bytes)]), { status: 200, headers: { "content-type": MEDIA[path.extname(file)] ?? "application/octet-stream" } });
  };
  const resolve = async (hostname: string): Promise<string[]> => {
    if (hostname !== FIXTURE_CAD_HOST) throw new Error("fixture resolver: unknown host");
    return [FIXTURE_CAD_ADDRESS];
  };
  return { fetch: transport, resolve, requests, overrides };
}

const KEY = "__sirkitFixtureCadTransport__" as const;
/** The fixture runtime's one process transport (anchored on globalThis, as the fixture container is). */
export function fixtureRuntimeCadTransport(): FixtureCadTransport {
  const host = globalThis as unknown as Record<string, FixtureCadTransport | undefined>;
  host[KEY] ??= createFixtureCadTransport();
  return host[KEY];
}
