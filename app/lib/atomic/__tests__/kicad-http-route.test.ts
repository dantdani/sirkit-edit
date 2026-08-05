import { afterEach, describe, expect, it } from "vitest";
import { GET as rootGet } from "@/app/api/kicad/v1/route";
import { GET as categoriesGet } from "@/app/api/kicad/v1/categories.json/route";

afterEach(() => delete process.env.KICAD_HTTP_LIBRARY_TOKEN);

describe("Stage 5 KiCad HTTP-library protocol/authentication", () => {
  it("fails closed when no backend token is configured", async () => {
    const response = rootGet(new Request("http://localhost/api/kicad/v1/"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "KiCad HTTP library is not configured" });
  });

  it("rejects an invalid token without exposing the configured secret", async () => {
    process.env.KICAD_HTTP_LIBRARY_TOKEN = "server-only-secret";
    const response = rootGet(new Request("http://localhost/api/kicad/v1/", { headers: { authorization: "Token wrong" } }));
    expect(response.status).toBe(401);
    expect(JSON.stringify(await response.json())).not.toContain("server-only-secret");
  });

  it("serves official endpoint discovery and category shapes to an authorized client", async () => {
    process.env.KICAD_HTTP_LIBRARY_TOKEN = "server-only-secret";
    const request = (url: string) => new Request(url, { headers: { authorization: "Token server-only-secret" } });
    const root = rootGet(request("http://localhost/api/kicad/v1/"));
    expect(await root.json()).toEqual({ categories: "categories.json", parts: "parts" });
    const categories = categoriesGet(request("http://localhost/api/kicad/v1/categories.json"));
    expect(await categories.json()).toEqual([expect.objectContaining({ id: "published", name: "Sirkit / Published Atomic Parts" })]);
  });
});

