/**
 * B16-A (review finding F1) — the correlation id is a PER-REQUEST key.
 *
 * Reproduced defect: `deriveCorrelationId` hashed only {schema, method, path},
 * so every POST /api/pcb/qualify (and every POST /api/pcb/release) failure
 * carried the identical `X-Sirkit-Correlation-Id` and the identical
 * `correlation=` key in the redacted server trace — an operator could not find
 * one request's trace by the id the browser showed. This suite pins that two
 * requests to the same method+path get DIFFERENT ids, that the id stays
 * bounded/non-secret in shape, and that the route facet is still recognisable.
 */
import { afterEach, describe, expect, it } from "vitest";
import { injectAuthorizedPrincipal, resetInjectedIdentity } from "../test-support";
import { resolveTrustedRequestContext } from "../trusted-request-context";

const SELECTOR = { "x-sirkit-tenant-id": "local", "x-sirkit-project-id": "p1", "x-sirkit-branch-id": "main" };
function req(url = "http://localhost/api/pcb/qualify", body = "{}"): Request {
  return new Request(url, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...SELECTOR }, body });
}
async function correlationOf(request: Request): Promise<string> {
  const resolved = await resolveTrustedRequestContext(request);
  if (!resolved.ok) throw new Error(`refused: ${resolved.refusal.status}`);
  return resolved.context.correlationId;
}

afterEach(() => resetInjectedIdentity());

describe("B16-A F1 — per-request correlation ids", () => {
  it("two requests to the same method+path receive different correlation ids (never a per-route constant)", async () => {
    injectAuthorizedPrincipal({ userId: "u1", projectId: "p1", role: "editor" });
    const ids = await Promise.all([correlationOf(req()), correlationOf(req()), correlationOf(req("http://localhost/api/pcb/qualify", '{"x":1}'))]);
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) expect(id).toMatch(/^corr-[0-9a-f]{8}-[0-9a-f]{16}$/);
  });

  it("the route facet is shared by requests to the same method+path and differs across routes; the request facet is fresh entropy", async () => {
    injectAuthorizedPrincipal({ userId: "u1", projectId: "p1", role: "admin" });
    const [q1, q2, r1] = await Promise.all([correlationOf(req()), correlationOf(req()), correlationOf(req("http://localhost/api/pcb/release"))]);
    const facet = (id: string) => id.split("-")[1];
    expect(facet(q1)).toBe(facet(q2));
    expect(facet(r1)).not.toBe(facet(q1));
    expect(q1.split("-")[2]).not.toBe(q2.split("-")[2]);
  });

  it("an explicit override is honoured unchanged (worker/internal callers)", async () => {
    injectAuthorizedPrincipal({ userId: "u1", projectId: "p1", role: "admin" });
    const resolved = await resolveTrustedRequestContext(req(), { correlationId: "corr-explicit-1" });
    expect(resolved.ok && resolved.context.correlationId).toBe("corr-explicit-1");
  });
});
