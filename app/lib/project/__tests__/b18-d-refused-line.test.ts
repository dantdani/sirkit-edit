/**
 * [B18-D I10] The chat's line for a tool call refused before it ran: the tier tag, the title (or "Unknown tool"), the
 * code, and that nothing ran — bounded, and never throwing on any shape.
 */
import { describe, expect, it } from "vitest";
import { refusedLineLabel } from "../chat-run-view";

describe("B18-D I10 — the refused-before-running line", () => {
  it("names the tool, the code and that nothing ran", () => {
    expect(refusedLineLabel({ title: "Inspect schematic", tier: 1, status: "repeated_call" })).toBe("T1 · Inspect schematic — refused before running (repeated_call) — nothing ran");
    expect(refusedLineLabel({ title: null, tier: null, status: "unknown_tool" })).toBe("Unknown tool — refused before running (unknown_tool) — nothing ran");
  });

  it("any shape renders a bounded line and never throws", () => {
    for (const shape of [{}, { title: 42, tier: "x", status: {} }, { title: "x".repeat(500), status: "y".repeat(500) }]) {
      const line = refusedLineLabel(shape as never);
      expect(line).toMatch(/ — refused before running \(.*\) — nothing ran$/);
      expect(line.length).toBeLessThan(260);
    }
  });
});
