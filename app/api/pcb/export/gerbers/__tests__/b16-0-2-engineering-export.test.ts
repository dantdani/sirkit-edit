/**
 * B16.0.2 §G — truthful, protected engineering export.
 *
 * R8 closure: the legacy export requires authenticated membership + an
 * engineering role + same-origin CSRF (through the shared boundary, BEFORE the
 * body is read or kicad-cli can run); `body.actor` / `body.projectIdentity`
 * are refused; every attribution label is derived from the trusted request
 * context; the response/headers/manifest inputs are labelled as an UNVERIFIED
 * engineering prototype export; verified mode is refused on this path.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { BundleResult } from "@/app/lib/pcb/fab/types";
import { createEmptyBoard } from "@/app/lib/pcb/types";
import { evaluatePcbFabricationReadiness } from "@/app/lib/pcb/readiness/evaluate";
import { getFabPreset } from "@/app/lib/pcb/fab/presets";
import { getPreset } from "@/app/lib/pcb/drc/presets";
import type { ManufacturingReleaseManifest } from "@/app/lib/pcb/readiness/types";
import { injectAuthorizedPrincipal, injectIdentity, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import { policyFor } from "@/app/lib/auth/route-policy";

const buildFabBundleMock = vi.fn();
const compileNativeMock = vi.fn();
vi.mock("@/app/lib/pcb/fab/build-bundle", () => ({ buildFabBundle: (...args: unknown[]) => buildFabBundleMock(...args) }));
vi.mock("@/app/lib/pcb/fab/native/compiler", () => ({ compileNativeFabPackage: (...args: unknown[]) => compileNativeMock(...args) }));

import { POST, ENGINEERING_EXPORT_FORBIDDEN_BODY_KEYS, ENGINEERING_EXPORT_NOTICE, engineeringExportAttribution } from "../route";

const board = createEmptyBoard();
const netlist = { components: [], nets: [] };
const readiness = evaluatePcbFabricationReadiness({ board, netlist, fabPreset: getFabPreset("jlcpcb-2l"), drcPreset: getPreset("jlcpcb-2l") });
const SCOPE = { tenantId: "local", projectId: "project-gerbers", branchId: "main" };
const SELECTOR = { "x-sirkit-tenant-id": SCOPE.tenantId, "x-sirkit-project-id": SCOPE.projectId, "x-sirkit-branch-id": SCOPE.branchId };

function request(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/pcb/export/gerbers", { method: "POST", headers: { "Content-Type": "application/json", origin: "http://localhost", ...SELECTOR, ...headers }, body: JSON.stringify(body) });
}

function fakeResult(): BundleResult {
  const releaseManifest = { disposition: "engineering_prototype_export", verified: false, designRevision: readiness.designRevision, readinessReportId: readiness.reportId } as unknown as ManufacturingReleaseManifest;
  return { sourceRevision: readiness.designRevision, readiness, releaseManifest, zipBytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04]), filename: "x.zip", stats: { drcErrors: 0, drcWarnings: 0, gerberFiles: ["a.GTL"], drillFiles: [], posFiles: [], bomFile: "b.csv", totalBytes: 4, elapsedMs: 1 } };
}

const engineeringBody = { board, netlist, fabPresetId: "jlcpcb-2l", boardName: "demo", releaseMode: "engineering", waiverReason: "prototype only, reviewed" };

beforeEach(() => {
  buildFabBundleMock.mockReset(); compileNativeMock.mockReset();
  injectAuthorizedPrincipal({ userId: "editor-1", tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, role: "editor", authMethod: "supabase_cookie" });
});
afterEach(() => { resetInjectedIdentity(); });

describe("B16.0.2 §G — protection", () => {
  it("policy: POST /api/pcb/export/gerbers is authenticated, CSRF-protected, engineering-role-exact, and NOT release/qualification", () => {
    const policy = policyFor("/api/pcb/export/gerbers", "POST");
    expect(policy).toMatchObject({ requiresAuth: true, requiresCsrf: true, identitySource: "trusted-context", releaseOrQualification: false, authoritativeWrite: false });
    expect([...policy!.permittedRoles].sort()).toEqual(["pcb_editor", "project_admin", "reviewer"]);
  });

  it("anonymous → 401 BEFORE the body is read (no byte pulled, no build invoked)", async () => {
    injectIdentity(null);
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({ pull(c) { pulled += 1; c.enqueue(new TextEncoder().encode("{}")); c.close(); } }, { highWaterMark: 0 });
    const response = await POST(new Request("http://localhost/api/pcb/export/gerbers", { method: "POST", headers: { "Content-Type": "application/json", origin: "http://localhost", ...SELECTOR }, body, duplex: "half" } as RequestInit));
    expect(response.status).toBe(401);
    expect(pulled).toBe(0);
    expect(buildFabBundleMock).not.toHaveBeenCalled();
  });

  it("viewer/commenter → 403; a foreign project selector → 403 (exact-origin CSRF is covered in the CSRF suite)", async () => {
    injectAuthorizedPrincipal({ userId: "viewer-1", tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, role: "viewer" });
    expect((await POST(request(engineeringBody))).status).toBe(403);
    injectAuthorizedPrincipal({ userId: "editor-1", tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, role: "editor" });
    // a caller with no membership in the selected project is refused (foreign scope).
    expect((await POST(request(engineeringBody, { "x-sirkit-project-id": "project-other" }))).status).toBe(403);
    expect(buildFabBundleMock).not.toHaveBeenCalled();
  });
});

describe("B16.0.2 §G — truthful attribution", () => {
  it("body.actor and body.projectIdentity (and every other attribution/authority key) are REFUSED 400 with no build", async () => {
    expect([...ENGINEERING_EXPORT_FORBIDDEN_BODY_KEYS]).toEqual(expect.arrayContaining(["actor", "projectIdentity"]));
    for (const key of ENGINEERING_EXPORT_FORBIDDEN_BODY_KEYS) {
      const response = await POST(request({ ...engineeringBody, [key]: "mallory" }));
      expect(response.status, key).toBe(400);
      expect(((await response.json()) as { message: string }).message).toMatch(/derived from the authenticated session/);
    }
    expect(buildFabBundleMock).not.toHaveBeenCalled();
    expect(compileNativeMock).not.toHaveBeenCalled();
  });

  it("the attribution passed to the bundle builder is the trusted context's principal + project scope (never a body value)", async () => {
    buildFabBundleMock.mockResolvedValue(fakeResult());
    const response = await POST(request(engineeringBody));
    expect(response.status).toBe(200);
    expect(buildFabBundleMock).toHaveBeenCalledTimes(1);
    const input = buildFabBundleMock.mock.calls[0][0] as { actor: string; projectIdentity: string; releaseDisposition: string; waivers: Array<{ actor?: string }> };
    expect(input.actor).toBe("human:editor-1");
    expect(input.projectIdentity).toBe("local/project-gerbers/main");
    expect(input.releaseDisposition).toBe("engineering_prototype_export");
    for (const waiver of input.waivers) expect(waiver.actor).toBe("human:editor-1");
    // the response headers label the artifact truthfully
    expect(response.headers.get("X-Sirkit-Engineering-Export")).toBe("not-verified-release");
    expect(response.headers.get("X-Sirkit-Export-Notice")).toBe(ENGINEERING_EXPORT_NOTICE);
    expect(response.headers.get("X-Sirkit-Export-Attribution-Source")).toBe("trusted-request-context");
    expect(response.headers.get("X-Sirkit-Release-Disposition")).toBe("engineering_prototype_export");
  });

  it("the native engine receives the same server-derived attribution", async () => {
    compileNativeMock.mockResolvedValue({ zipBytes: new Uint8Array([1]), filename: "n.zip", manifest: { signoff: "s", diagnostics: { warnings: 0 } }, readiness, releaseManifest: { disposition: "engineering_prototype_export" }, packageSha256: "x", files: [], stages: [] });
    const response = await POST(request({ ...engineeringBody, engine: "native-beta" }));
    expect(response.status).toBe(200);
    const input = compileNativeMock.mock.calls[0][0] as { actor: string; projectIdentity: string };
    expect(input.actor).toBe("human:editor-1");
    expect(input.projectIdentity).toBe("local/project-gerbers/main");
  });

  it("preflight: waiver actor is the verified principal and the notice travels in body + header", async () => {
    const response = await POST(request({ ...engineeringBody, action: "preflight" }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { engineeringExportNotice: string; readiness: { waivers: Array<{ actor?: string }> } };
    expect(body.engineeringExportNotice).toBe(ENGINEERING_EXPORT_NOTICE);
    for (const waiver of body.readiness.waivers) expect(waiver.actor).toBe("human:editor-1");
    expect(response.headers.get("X-Sirkit-Engineering-Export")).toBe("not-verified-release");
  });

  it("engineeringExportAttribution is a pure projection of the trusted context", () => {
    expect(engineeringExportAttribution({ principalId: "p", tenantId: "t", projectId: "pr", branchId: "b", actor: { actorId: "p", actorKind: "human", sessionId: "s", role: "pcb_editor" } } as never)).toEqual({ actor: "human:p", projectIdentity: "t/pr/b" });
  });

  it("SOURCE: the route never reads body.actor / body.projectIdentity and the bundle/native READMEs carry the engineering notice", () => {
    const root = process.cwd();
    const raw = readFileSync(join(root, "app", "api", "pcb", "export", "gerbers", "route.ts"), "utf8");
    // strip comments so prose mentions ("`body.actor` is REFUSED") are ignored;
    // only an actual code read of body.actor / body.projectIdentity would fail.
    const route = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(/body\.actor\b/.test(route)).toBe(false);
    expect(/body\.projectIdentity\b/.test(route)).toBe(false);
    const bundle = readFileSync(join(root, "app", "lib", "pcb", "fab", "build-bundle.ts"), "utf8");
    expect(bundle).toContain("NOT a verified manufacturing release");
    expect(bundle).toContain("Attribution (server-derived from the authenticated session)");
    const native = readFileSync(join(root, "app", "lib", "pcb", "fab", "native", "compiler.ts"), "utf8");
    expect(native).toContain("NOT a verified manufacturing release");
  });
});

describe("B16.0.2 §G — the verified/engineering distinction is preserved", () => {
  it("releaseMode=verified on this legacy path is refused 409 (points at /api/pcb/release); only engineering produces an artifact", async () => {
    buildFabBundleMock.mockResolvedValue(fakeResult());
    const verified = await POST(request({ board, netlist, fabPresetId: "jlcpcb-2l" }));
    expect(verified.status).toBe(409);
    expect(((await verified.json()) as { error: string; message: string })).toMatchObject({ error: "authoritative-release-source-required" });
    expect(buildFabBundleMock).not.toHaveBeenCalled();
  });

  it("/api/pcb/release stays admin-only + release-class; the export row can never be release/qualification", () => {
    expect(policyFor("/api/pcb/release", "POST")).toMatchObject({ releaseOrQualification: true, permittedRoles: ["project_admin"] });
    expect(policyFor("/api/pcb/export/gerbers", "POST")?.releaseOrQualification).toBe(false);
  });

  it("UI: the fab-export hook never posts a verified request to the legacy path and refuses locally when no server-authoritative release flow exists", () => {
    const hook = readFileSync(join(process.cwd(), "app", "components", "pcb", "hooks", "useFabExport.ts"), "utf8");
    expect(hook.includes('releaseMode: engineeringOverride ? "engineering" : "verified"')).toBe(false);
    expect(hook).toContain('releaseMode: "engineering"');
    expect(hook).toContain("if (!engineeringOverride && !editorRef.current.verifiedRelease) {");
    expect(hook).toContain("UNVERIFIED engineering prototype export");
    // the browser never sends attribution
    expect(/\bactor:/.test(hook)).toBe(false);
    expect(/projectIdentity/.test(hook)).toBe(false);
  });
});
