/**
 * [PR-C] The composer's rule 1b (PROMPT_TO_PCB_RELIABILITY_AND_SIMPLE_UI.md §C: "pure questions must not unexpectedly replace a
 * schematic"): on an EMPTY project a pure question asks the assistant instead of generating a schematic; an ordinary circuit
 * request on the empty project generates exactly as before (B18-D's bootstrap), a question-form request for a circuit ("can you
 * build a blinker?") too. And the display-only "prepare-pcb" hint: a generate route whose text names the PCB carries the intent
 * the page shows; it never changes a route and never rides on an ask or an edit.
 */
import { describe, expect, it } from "vitest";
import { BLINKER_ACCEPTANCE_PROMPT } from "../../fixture-runtime/blinker/catalog";
import { routeComposerMessage } from "../composer-routing";

const QUESTION_REASON = "a question: the assistant answers it (nothing is generated)";
const GENERATE_REASON = "the project has no schematic yet: the message describes a circuit to generate";

const QUESTIONS = [
  "What is a 555 timer?",
  "what does astable mode mean?",
  "Why does an LED need a series resistor?",
  "How do I pick the timing capacitor?",
  "When should I use a ground plane?",
  "Where does the decoupling capacitor go?",
  "Which regulator is better for 3.3 V?",
  "Who makes the NE555?",
  "Whose footprint is this?",
  "Is a 555 good for blinking an LED?",
  "Are 0805 parts hand-solderable?",
  "Does the 555 need a control-pin capacitor?",
  "Do I need a pull-up on the reset pin?",
  "Should I use a CMOS timer?",
  "Would a 7555 draw less current?",
  "Could a 3.3 V supply work here?",
  "Can you help me understand astable mode?",
  "Will a 1k resistor limit the LED current enough?",
  "  What is a 555 timer?  ",
  "Explain how a 555 astable circuit works",
  "explain the control pin",
  "Define duty cycle.",
  "Compare the NE555 and the TLC555",
  "Tell me about op-amp buffers",
  "tell me how an LED blinker works?",
  "Describe how a buck converter regulates",
  "Describe what the discharge pin does",
  "Describe why decoupling matters",
];

const REQUESTS_ON_EMPTY = [
  "Design a 555 blinker",
  BLINKER_ACCEPTANCE_PROMPT,
  "can you build a blinker?",
  "Can you please design a 555 blinker?",
  "Could you make a buck converter?",
  "Will you create a USB power input?",
  "could you please generate an op-amp buffer?",
  "Can you draw an LED blinker?",
  "Describe a circuit that blinks an LED",
  "A 5 V LED blinker with a 555",
  "Move R3 2 mm to the right.", // B18-D: unchanged on the empty project
  "What if we build a blinker", // no "?": not a question
  "Is a 555 blinker, 5 V, 1 Hz", // no "?": not a question
  "additional decoupling?", // not a question word
  "555 blinker?", // not a question word
];

describe("[PR-C] rule 1b: a pure question on an empty project asks the assistant; a circuit request still generates", () => {
  it("every question on the empty project routes to ask with the question reason (nothing is generated)", () => {
    for (const text of QUESTIONS) expect(routeComposerMessage(text, false), text).toEqual({ route: "ask", reason: QUESTION_REASON, hints: [] });
  });

  it("a circuit request on the empty project generates, unchanged: the design prompt, the blinker acceptance prompt, and a question-form request for a circuit", () => {
    for (const text of REQUESTS_ON_EMPTY) expect(routeComposerMessage(text, false), text).toMatchObject({ route: "generate", reason: GENERATE_REASON });
    expect(BLINKER_ACCEPTANCE_PROMPT.startsWith("Design ")).toBe(true);
  });

  it("with a schematic the questions reach the assistant as before (rule 9, its reason pinned by B21-E4), and the rest of the table routes as before", () => {
    for (const text of QUESTIONS) expect(routeComposerMessage(text, true), text).toMatchObject({ route: "ask", reason: "a question or request for the assistant" });
    expect(routeComposerMessage("Design a 555 blinker", true).route).toBe("generate");
    expect(routeComposerMessage("can you build a blinker?", true).route).toBe("ask"); // rule 9: with a schematic the assistant answers it
    expect(routeComposerMessage("   ", false)).toEqual({ route: "ask", reason: "nothing to send yet", hints: [] });
  });

  it("the empty-project question rule is linear on hostile text (b21-e4 case 6's shapes, without a schematic)", () => {
    const n = 150_000;
    for (const text of [`${"?".repeat(n)}x`, `what ${" ".repeat(n)}?`, `${"what ".repeat(n / 5)}?`, `explain${"!".repeat(n)}a`, `tell${" ".repeat(n)}x`]) {
      const started = performance.now();
      routeComposerMessage(text, false);
      expect(performance.now() - started, text.slice(0, 12)).toBeLessThan(1_000);
    }
  });
});

describe("[PR-C] the display-only prepare-pcb hint", () => {
  it("present on a generate route that names the PCB (word-bounded), on the empty project and with a schematic", () => {
    for (const text of [
      BLINKER_ACCEPTANCE_PROMPT, // "...two-layer PCB suitable for JLCPCB fabrication..."
      "Design a 555 blinker and prepare the PCB",
      "Create a USB power input with a board layout",
      "Design an LED driver and layout the board",
      "Generate a buck converter and the gerbers",
      "Make a blinker ready for manufacturing",
      "Design a blinker for fabrication",
      "design a blinker with PCBs for two variants",
    ]) {
      expect(routeComposerMessage(text, false), text).toMatchObject({ route: "generate", hints: ["prepare-pcb"] });
    }
    expect(routeComposerMessage("Design a 555 blinker and prepare the PCB", true)).toMatchObject({ route: "generate", hints: ["prepare-pcb"] });
    // both hints, in order, when a release word rides along (the tier-3 hint still says the assistant never releases)
    expect(routeComposerMessage("Design a blinker, make the PCB and order it", false).hints).toEqual(["tier3-release", "prepare-pcb"]);
  });

  it("absent on a generate route that names no PCB, and never on an ask or an edit however PCB-flavoured", () => {
    for (const text of ["Design a 555 blinker", BLINKER_ACCEPTANCE_PROMPT.replace(/PCB|fabrication/g, "circuit"), "Create a USB power input"]) {
      expect(routeComposerMessage(text, false), text).toMatchObject({ route: "generate", hints: [] });
    }
    // word-bounded: a run of letters around the stem is not the word
    for (const text of ["Design a blinker for the xpcb team", "Design a gerberish blinker", "Design a blinker with pcbx"]) {
      expect(routeComposerMessage(text, false), text).toMatchObject({ route: "generate", hints: [] });
    }
    expect(routeComposerMessage("What is a PCB?", false)).toEqual({ route: "ask", reason: "a question: the assistant answers it (nothing is generated)", hints: [] });
    expect(routeComposerMessage("Add silkscreen text REV B on the PCB", true)).toMatchObject({ route: "ask", hints: [] });
    expect(routeComposerMessage("set R1 to 4.7k before fabrication", true)).toMatchObject({ route: "edit", hints: [] }); // "fabrication" is a hint word, not a rule-5 PCB noun
    expect(routeComposerMessage("Release the board to manufacturing", true)).toMatchObject({ route: "ask", hints: ["tier3-release"] });
  });
});
