// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MAPPING_POLICY } from "@/app/lib/mapping-verification/policy";
import { DeterministicMappingVerifier } from "@/app/lib/mapping-verification/verifier";
import { contextFixture, exactCandidate, request } from "@/app/lib/mapping-verification/__tests__/fixtures";
import { MappingVerificationPanel } from "../MappingVerificationPanel";

afterEach(cleanup);

describe("Stage 4 mapping verification panel", () => {
  it("shows all three identity layers and states the read-only boundary", () => {
    const context = contextFixture();
    const candidate = exactCandidate(context);
    const result = new DeterministicMappingVerifier().verify(request(context, candidate), context, candidate, structuredClone(DEFAULT_MAPPING_POLICY));
    const onVerify = vi.fn();
    render(<MappingVerificationPanel context={context} result={result} onVerify={onVerify} />);
    expect(screen.getByText("1 · Logical symbol pins")).toBeTruthy();
    expect(screen.getByText("2 · Package terminals")).toBeTruthy();
    expect(screen.getByText("3 · Exact footprint pads")).toBeTruthy();
    expect(screen.getByText(/Does not approve a mapping/)).toBeTruthy();
    expect(screen.getByText(/Schematic and PCB unchanged/)).toBeTruthy();
    expect(screen.getByText("separate review")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Verify mapping (read only)" }));
    expect(onVerify).toHaveBeenCalledTimes(1);
  });

  it("renders every blocking finding and the affected identity", () => {
    const context = contextFixture({ functions: ["positive", "negative"], risk: "polarized_two_terminal" });
    const candidate = exactCandidate(context, { pinToTerminal: [[0, 1], [1, 0]] });
    const result = new DeterministicMappingVerifier().verify(request(context, candidate), context, candidate, structuredClone(DEFAULT_MAPPING_POLICY));
    const view = render(<MappingVerificationPanel context={context} result={result} />);
    expect(screen.getByText(`All findings (${result.findings.length})`)).toBeTruthy();
    expect(screen.getAllByText("MV_POLARITY_ORIENTATION_REVERSED")).toHaveLength(2);
    expect((within(view.container).getByRole("button", { name: "Verify mapping (read only)" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
