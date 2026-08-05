import { describe, expect, it } from "vitest";
import { ATOMIC_FIXTURE_CORPUS, ATOMIC_FIXTURE_LICENSE } from "./corpus";
import { buildMappingCertificate } from "../mapping";
import { footprintAsset, packageProof, symbolAsset, terminals } from "./fixtures";

describe("Stage 5 representative fixture corpus", () => {
  it("checks in every required fixture category with an explicit legal disposition", () => {
    expect(ATOMIC_FIXTURE_CORPUS).toHaveLength(16);
    expect(new Set(ATOMIC_FIXTURE_CORPUS.map((item) => item.id)).size).toBe(16);
    expect(ATOMIC_FIXTURE_CORPUS.every((item) => item.expectation.length > 10)).toBe(true);
    expect(ATOMIC_FIXTURE_LICENSE).toEqual({ spdxId: "MIT", author: "Sirkit", containsThirdPartyContent: false });
  });

  it("validates a representative 1,000-terminal dense mapping within the test budget", () => {
    const numbers = Array.from({ length: 1_000 }, (_, index) => `A${index + 1}`);
    const symbol = symbolAsset("symbolv_scale_1000", numbers.map((number) => ({ number })));
    const footprint = footprintAsset("footprintv_scale_1000", numbers.map((number) => ({ number })));
    const terminalList = terminals(numbers);
    const started = performance.now();
    const certificate = buildMappingCertificate({
      exactPartId: "exact_fixture",
      symbol,
      footprint,
      terminals: terminalList,
      mapping: numbers.map((number) => ({ manufacturerTerminalId: `terminal_${number}`, symbolPinNumbers: [number], logicalPadNumbers: [number], evidenceIds: ["evidence_fixture"] })),
      packageProof: packageProof(footprint.versionId, ["evidence_fixture"], 1_000),
    });
    const elapsedMs = performance.now() - started;
    expect(certificate.state).toBe("approved");
    expect(certificate.entries).toHaveLength(1_000);
    expect(elapsedMs).toBeLessThan(1_000);
  });
});
