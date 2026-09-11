/**
 * [B18-D I1] The composer's routing (chat-execution-ux.md §3). Found in B18-C: every message beginning with "add", "set",
 * "remove", … went to the SCHEMATIC editor, so "Add silkscreen text REV B at 10, 10" never reached the assistant (the
 * browser proof had to say "Please add …"). A PCB change phrased as an edit now reaches the assistant; schematic edits,
 * design generation and the empty project's design prompt (the browser bootstrap) route exactly as before.
 */
import { describe, expect, it } from "vitest";
import { BLINKER_ACCEPTANCE_PROMPT } from "../../fixture-runtime/blinker/catalog";
import { COMPOSER_ROUTE_LABELS, routeComposerMessage } from "../composer-routing";

const route = (text: string, hasSchematic = true) => routeComposerMessage(text, hasSchematic).route;

describe("B18-D I1 — the composer routes by the first words; PCB changes reach the assistant", () => {
  it("an empty project still generates from its design prompt (the browser bootstrap); an empty message asks", () => {
    expect(route(BLINKER_ACCEPTANCE_PROMPT, false)).toBe("generate");
    expect(route("Move R3 2 mm to the right.", false)).toBe("generate"); // unchanged: nothing to edit or execute yet
    expect(route("   ", true)).toBe("ask");
  });

  it("a PCB change phrased as an edit reaches the assistant; a schematic edit stays an edit", () => {
    for (const text of ["Add silkscreen text REV B at 10, 10.", "add a via on GND", "Remove the dimension between U1 and J1", "Set the track width to 0.3 mm", "Change the copper pour clearance", "Draw a dimension from U1 to J1.", "Delete the keep-out zone", "update the DRC preset"]) {
      expect(route(text), text).toBe("ask");
    }
    for (const text of ["set R1 to 4.7k", "rename U1 to U5", "delete R3", "Add a 10k resistor between VCC and the LED", "replace C1 with 100nF", "connect R2 to GND", "make R1 10k"]) {
      expect(route(text), text).toBe("edit");
    }
  });

  it("generation, the execution verbs and everything else", () => {
    for (const text of ["Design a 555 blinker", "generate a buck converter", "make a blinker circuit", "Create a USB power input", "draw an op-amp buffer"]) {
      expect(route(text), text).toBe("generate");
    }
    for (const text of ["Move R3 2 mm to the right.", "Please move R3 1 mm up", "Rotate R3 90 degrees clockwise", "Flip R3 to the bottom.", "Undo that.", "Redo.", "Please add silkscreen text REV B at 10, 10.", "What is the LED current?", "additional decoupling?", "settings?"]) {
      expect(route(text), text).toBe("ask"); // "additional" and "settings" are not the verbs "add" and "set"
    }
  });

  it("a release / order / qualify word adds the display-only Tier 3 hint and never changes the route", () => {
    expect(routeComposerMessage("Release the board to manufacturing", true)).toMatchObject({ route: "ask", hints: ["tier3-release"] });
    expect(routeComposerMessage("set R1 to 4.7k and order it", true)).toMatchObject({ route: "edit", hints: ["tier3-release"] });
    expect(routeComposerMessage("Move R3 2 mm to the right.", true).hints).toEqual([]);
    expect(COMPOSER_ROUTE_LABELS).toEqual({ ask: "ask the assistant", edit: "edit the schematic", generate: "generate a schematic" });
  });
});
