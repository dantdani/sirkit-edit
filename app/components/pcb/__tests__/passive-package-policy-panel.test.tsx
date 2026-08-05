// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PassivePackagePolicyPanel } from "../PassivePackagePolicyPanel";
import { DeterministicPassivePolicyEvaluator } from "@/app/lib/passive-policy/evaluator";
import { contextFixture } from "@/app/lib/passive-policy/__tests__/fixtures";

afterEach(cleanup);

describe("PassivePackagePolicyPanel", () => {
  it("shows layout-only qualification and never presents it as manufacturing ready", () => {
    const onEvaluate = vi.fn(), result = new DeterministicPassivePolicyEvaluator().evaluate(contextFixture());
    render(<PassivePackagePolicyPanel state="observe" result={result} onEvaluate={onEvaluate} />);
    expect(screen.getByText("eligible characterized generic")).toBeTruthy();
    expect(screen.getByText(/Exact part, derating, availability/)).toBeTruthy();
    screen.getByRole("button", { name: /Evaluate policy/ }).click();
    expect(onEvaluate).toHaveBeenCalledOnce();
  });

  it("disables evaluation while rollout is off", () => {
    render(<PassivePackagePolicyPanel state="off" onEvaluate={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Evaluate policy/ }).hasAttribute("disabled")).toBe(true);
  });
});
