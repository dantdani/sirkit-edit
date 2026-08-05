// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createPowerProjectState } from "@/app/lib/power/project";
import { powerCandidate, powerProblem, powerProblemInput } from "@/app/lib/power/__tests__/fixtures";
import { PowerWorkspace } from "../PowerWorkspace";

afterEach(cleanup);
describe("CD-3 power workspace", () => {
  it("separates hard gates, budgets, objectives, and provenance", () => { const input = powerProblemInput(); const problem = powerProblem(); const candidate = powerCandidate(0, problem); const state = createPowerProjectState({ projectId: problem.projectId, branchId: problem.branchId, upstreamSignoff: input.upstreamSignoff, problem, candidates: [candidate], selection: null }); render(<PowerWorkspace value={state} />); expect(screen.getByText("CD-03 Power · Ground · Protection · Sequencing")).toBeTruthy(); expect(screen.getByText("Hard gates")).toBeTruthy(); expect(screen.getByText("Scenario budgets")).toBeTruthy(); expect(screen.getByText(/Raw objectives/)).toBeTruthy(); expect(screen.getByText(/Signoff:/)).toBeTruthy(); });
  it("does not enable human selection without a callback", () => { const input = powerProblemInput(); const problem = powerProblem(); const state = createPowerProjectState({ projectId: problem.projectId, branchId: problem.branchId, upstreamSignoff: input.upstreamSignoff, problem, candidates: [powerCandidate(0, problem)], selection: null }); render(<PowerWorkspace value={state} />); expect(screen.getByRole("button", { name: "Select with risk acknowledgement" })).toHaveProperty("disabled", true); });
});
