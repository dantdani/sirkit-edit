/**
 * [B19-D I5e row 28] A requirements source's declared kind, authority class, media type and policies are checked at runtime.
 *
 * `ingestRequirementSource` sits behind an authenticated JSON route whose body is typed only by TypeScript. Only
 * `application/json` content was checked structurally; any other media type (`application/pdf`, `image/svg+xml`, `text/html`)
 * was accepted as text, and `sourceKind`, `authorityClass`, `accessPolicy`, `privacyClassification` and `benchmarkUse` were
 * copied into the immutable artifact without a check. `validateSourceArtifact` recomputed the digest but never the unions.
 */
import { describe, expect, it } from "vitest";
import { ingestRequirementSource } from "../source";
import { validateSourceArtifact } from "../validation";
import { source } from "./fixtures";
import { requirementsDigest } from "../stable";
import { REQUIREMENTS_SOURCE_SCHEMA_VERSION } from "../types";

describe("[B19-D I5e row 28] runtime unions on ingestion", () => {
  it.each(["application/pdf", "image/svg+xml", "application/zip", "text/html"])("media type %s is refused", (mediaType) => {
    expect(() => source({ mediaType: mediaType as never })).toThrow(/media type/i);
  });

  it.each([
    ["sourceKind", { sourceKind: "bogus" }],
    ["authorityClass", { authorityClass: "bogus" }],
    ["accessPolicy", { accessPolicy: "world_readable" }],
    ["privacyClassification", { privacyClassification: "secret-ish" }],
    ["benchmarkUse", { benchmarkUse: "anything" }],
  ])("an unknown %s is refused", (_field, overrides) => {
    expect(() => source(overrides as never)).toThrow();
  });

  it("the declared unions still ingest (baselines)", () => {
    expect(source({ mediaType: "text/plain" }).mediaType).toBe("text/plain");
    expect(source({ mediaType: "text/markdown", content: "# Brief\nTrace width 0.2 mm" }).mediaType).toBe("text/markdown");
    expect(source({ mediaType: "application/json", content: '{"trace":"0.2mm"}' }).mediaType).toBe("application/json");
    expect(ingestRequirementSource).toBeTypeOf("function");
  });
});

describe("[B19-D I5e row 28] an artifact that bypassed ingestion is still refused", () => {
  it("a recomputed artifact with application/pdf and a matching digest does not validate", () => {
    const artifact = structuredClone(source());
    const forged = { ...artifact, mediaType: "application/pdf" as never, authorityClass: "bogus" as never };
    forged.immutableArtifactDigest = requirementsDigest({
      schema: REQUIREMENTS_SOURCE_SCHEMA_VERSION, tenantId: forged.tenantId, projectId: forged.projectId, sourceId: forged.sourceId, sourceKind: forged.sourceKind,
      sourceVersion: forged.sourceVersion, title: forged.title, authorOrPublisher: forged.authorOrPublisher, authorityClass: forged.authorityClass, mediaType: forged.mediaType, normalizedContent: forged.normalizedContent,
    });
    const errors = validateSourceArtifact(forged);
    expect(errors.join(" ")).toMatch(/MEDIA_TYPE/);
    expect(errors.join(" ")).toMatch(/AUTHORITY/);
    expect(validateSourceArtifact(artifact)).toEqual([]); // baseline
  });
});
