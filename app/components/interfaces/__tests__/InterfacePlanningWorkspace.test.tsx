// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createInterfaceProjectState } from "@/app/lib/interfaces/project";
import { interfaceCandidate, interfaceProblem, interfaceProblemInput } from "@/app/lib/interfaces/__tests__/fixtures";
import { InterfacePlanningWorkspace } from "../InterfacePlanningWorkspace";

afterEach(cleanup);
describe("CD-4 interface planning workspace", () => {
  it("shows candidate status, typed matrix, unknown safe states, and downstream handoffs", () => { const input = interfaceProblemInput(); const problem = interfaceProblem(); const candidate = interfaceCandidate(0, problem); const state = createInterfaceProjectState({ projectId: problem.projectId, branchId: problem.branchId, upstreamSignoff: input.upstreamSignoff, problem, candidates: [candidate], selection: null }); render(<InterfacePlanningWorkspace value={state} />); expect(screen.getByText("Interface, pinmux, clock, reset, boot & debug")).toBeTruthy(); expect(screen.getAllByText("incomplete blocking unknown").length).toBeGreaterThan(0); fireEvent.click(screen.getByRole("tab", { name: "safe / states" })); expect(screen.getAllByText("unknown").length).toBeGreaterThan(0); fireEvent.click(screen.getByRole("tab", { name: "handoffs" })); expect(screen.getByText("interface power feedback")).toBeTruthy(); });
  it("keeps selection blocked when hard gates are unresolved", () => { const input = interfaceProblemInput(); const problem = interfaceProblem(); const candidate = interfaceCandidate(0, problem); const state = createInterfaceProjectState({ projectId: problem.projectId, branchId: problem.branchId, upstreamSignoff: input.upstreamSignoff, problem, candidates: [candidate], selection: null }); render(<InterfacePlanningWorkspace value={state} onSelectCandidate={() => undefined} />); expect(screen.getByRole("button", { name: "Blocked by hard gates" })).toHaveProperty("disabled", true); });
});

