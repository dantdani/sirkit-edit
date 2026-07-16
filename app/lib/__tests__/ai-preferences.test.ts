// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadAiBrainPreference, saveAiBrainPreference } from "../ai-preferences";

describe("AI brain preferences", () => {
  beforeEach(() => localStorage.clear());

  it("persists the global selection across sessions", () => {
    saveAiBrainPreference("anthropic");
    expect(loadAiBrainPreference()).toBe("anthropic");
    expect(localStorage.getItem("sirkit:aiBrain")).toBe("anthropic");
  });

  it("records a project metadata event without changing design state", () => {
    const project = {
      id: "project-1",
      name: "Board",
      createdAt: 1,
      updatedAt: 1,
      state: { components: [{ id: "R1" }], wires: [] },
      pcb: { tracks: [{ id: "track-1" }] },
    };
    localStorage.setItem("sirkit:currentProjectId", project.id);
    localStorage.setItem(`sirkit:project:${project.id}`, JSON.stringify(project));
    vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000001");

    saveAiBrainPreference("anthropic");

    const saved = JSON.parse(localStorage.getItem(`sirkit:project:${project.id}`)!) as typeof project & {
      ai: { brain: string; embeddings: string; providerHistory: Array<{ from: string; to: string }> };
    };
    expect(saved.state).toEqual(project.state);
    expect(saved.pcb).toEqual(project.pcb);
    expect(saved.ai.brain).toBe("anthropic");
    expect(saved.ai.embeddings).toBe("openai");
    expect(saved.ai.providerHistory).toEqual([
      expect.objectContaining({ from: "openai", to: "anthropic" }),
    ]);
  });
});
