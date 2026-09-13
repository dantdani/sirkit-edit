/**
 * [B19-D I5b rows 42, 43] Ingestion's own bounds: quarantined text, adapter paging, and archive budgets.
 *
 *  - row 42: `quarantineText` bounded only KiCad/s-expression media types (anything else — any size, any declared type —
 *    was quarantined), and `collectAdapterPages` had no record ceiling and never checked its own deadline between pages.
 *  - row 43: `assertArchiveBudget` compared with `>` only, so NaN, negative and infinite counts passed.
 *
 * Neither has a production caller today (recorded in the matrix); both are the entry points B19's acquisition would use.
 */
import { describe, expect, it } from "vitest";
import { collectAdapterPages, quarantineText, type SourceAdapter } from "../ingestion";
import { assertArchiveBudget, INGEST_LIMITS, IngestSecurityError } from "../security";
import { OPEN_LICENSE } from "./fixtures";

const quarantine = (content: string, mediaType: string) => quarantineText({ content, mediaType, sourceRecordId: "record", license: OPEN_LICENSE, now: new Date("2026-09-13T00:00:00Z") });

describe("[B19-D I5b row 42] quarantined text is bounded whatever it claims to be", () => {
  it("an over-deep s-expression is refused even when declared text/plain", () => {
    expect(() => quarantine(`${"(".repeat(INGEST_LIMITS.maxSExpressionDepth + 1)}${")".repeat(INGEST_LIMITS.maxSExpressionDepth + 1)}`, "text/plain")).toThrow(IngestSecurityError);
  });

  it("content over the text ceiling is refused for any media type", () => {
    expect(() => quarantine("A".repeat(INGEST_LIMITS.maxTextBytes + 1), "application/json")).toThrow(IngestSecurityError);
  });

  it.each(["application/pdf", "image/svg+xml", "application/zip", "text/html"])("%s is not an accepted text type", (mediaType) => {
    expect(() => quarantine("x", mediaType)).toThrow(/unsupported|file_type/i);
  });

  it.each(["text/plain", "application/json", "application/x-kicad-symbol"])("%s is accepted (baseline)", (mediaType) => {
    expect(quarantine(mediaType.includes("kicad") ? "(kicad_symbol_lib (version 20231120))" : "ok", mediaType).state).toBe("quarantine");
  });
});

describe("[B19-D I5b row 42] adapter paging is bounded in records and time", () => {
  it("an adapter that never stops paging is refused at the record ceiling, long before 100 pages", async () => {
    let calls = 0;
    const endless: SourceAdapter = { id: "endless", source: { id: "s", sourceClass: "manufacturer_datasheet", name: "s", officialDomains: [], licenseId: "l" }, allowedHosts: [], async fetchPage() { calls += 1; return { records: new Array(1000).fill({}), nextCursor: `c${calls}`, sourceRevision: "1" }; } };
    await expect(collectAdapterPages(endless)).rejects.toThrow(/record limit/);
    expect(calls).toBeLessThan(100);
  });

  it("an adapter that ignores the abort signal is stopped by the deadline between pages", async () => {
    let calls = 0;
    const slow: SourceAdapter = { id: "slow", source: { id: "s", sourceClass: "manufacturer_datasheet", name: "s", officialDomains: [], licenseId: "l" }, allowedHosts: [], async fetchPage() { calls += 1; await new Promise((resolve) => setTimeout(resolve, 20)); return { records: [{}], nextCursor: `c${calls}`, sourceRevision: "1" }; } };
    await expect(collectAdapterPages(slow, 50)).rejects.toThrow(/deadline|timed out|abort/i);
    expect(calls).toBeLessThan(20);
  });
});

describe("[B19-D I5b row 43] an archive budget refuses counts it cannot trust", () => {
  it.each([
    [{ entries: Number.NaN, compressedBytes: 1, decompressedBytes: Number.NaN }],
    [{ entries: -1, compressedBytes: 10, decompressedBytes: -999_999_999 }],
    [{ entries: 1, compressedBytes: Number.POSITIVE_INFINITY, decompressedBytes: 1 }],
    [{ entries: 1.5, compressedBytes: 10, decompressedBytes: 20 }],
  ])("%j", (input) => {
    expect(() => assertArchiveBudget(input)).toThrow(IngestSecurityError);
  });

  it("a normal archive passes, and an over-ratio one is refused (baselines)", () => {
    expect(() => assertArchiveBudget({ entries: 3, compressedBytes: 100, decompressedBytes: 900 })).not.toThrow();
    expect(() => assertArchiveBudget({ entries: 1, compressedBytes: 1, decompressedBytes: 101 })).toThrow(/compression ratio/);
  });
});
