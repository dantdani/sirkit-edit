/**
 * [B19-D I5c row 21] The SPICE HTML report escapes every value it interpolates.
 *
 * `reportToHtml` escaped every field except `projectRevision`, which the public report route takes from the request body.
 */
import { describe, expect, it } from "vitest";
import { reportToHtml } from "../report";

describe("[B19-D I5c row 21] no report field becomes markup", () => {
  it("title, project revision and model names are text", () => {
    const html = reportToHtml({
      title: "<script>alert(1)</script>", projectRevision: "<img src=x onerror=1>", projectId: "p", designRevisionId: "d", generatedAt: "t", runIds: [],
      specificationMatrix: [], testSummary: [], modelInventory: [{ name: "<img src=x onerror=2>", version: "1", status: "ok", provenance: "p", checksum: "c" }], warnings: [],
      reproducibility: { simulatorVersions: [], seeds: [], manifestIds: [] },
    } as never);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script>");
    expect(html).toContain("r&lt;img src=x onerror=1&gt;");
  });
});
