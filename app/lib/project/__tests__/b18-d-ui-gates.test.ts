/**
 * [B18-D §2 R1-1] There is exactly one Confirm surface — the confirmation card's Confirm — and the chat has no Confirm
 * and no Apply. A source scan over the production files: exactly one `tenderConfirmedExecution(` call (outside its
 * definition) and exactly one `runGrantedExecution("confirm")`, both in the PCB composition root; and no file under
 * `app/components/chat/**` imports the trusted controller, the ritual, the transport or the journal — with an injected
 * offender that trips every one of those gates (the b18-b import-gate engine and pattern).
 */
import { describe, expect, it } from "vitest";
import { collectProductionFiles, moduleImportOffenders } from "./_import-gate-helpers";

const files = collectProductionFiles();
const TARGETS: Readonly<Record<string, string>> = {
  controller: "app/lib/project/granted-execution-controller.internal",
  ritual: "app/lib/engineering/granted-executions",
  transport: "app/lib/project/execution-grant-client",
  journal: "app/lib/engineering/agent-execution-journal",
};
const chatFiles = (): Map<string, string> => new Map([...files].filter(([path]) => path.startsWith("app/components/chat/")));
const callSites = (pattern: RegExp): string[] => [...files].flatMap(([path, source]) => [...source.matchAll(pattern)].map(() => path));
/** [B18-D review 2] The wiring each chat-entry fix depends on — the fixes themselves are pure reducers, tested alone, so a lost
 *  prop or branch would otherwise break no test. Every wire must be present exactly once. */
const WIRES: ReadonlyArray<{ name: string; path: string; pattern: RegExp }> = [
  { name: "a transiently refused Confirm reaches the entry", path: "app/page.tsx", pattern: /onExecutionGrantAttemptRefused=\{[^\n]*entryAttemptRefused\(/g },
  { name: "the editor starting a change reaches the entry", path: "app/page.tsx", pattern: /onExecutionGrantProgress=\{[^\n]*entryExecuting\(/g },
  { name: "a recovery result reaches the entry", path: "app/page.tsx", pattern: /onExecutionRecovery=\{[^\n]*entryRecovery\(/g },
  { name: "the edit route's answer is the page's own sentence", path: "app/page.tsx", pattern: /const editMessages = editProposalMessages\(data\.note\);/g },
  { name: "the edit route's chat content is that sentence", path: "app/page.tsx", pattern: /content: editMessages\.answer,/g },
  { name: "the edit route's note goes to the run log only, labelled", path: "app/page.tsx", pattern: /if \(editMessages\.note\) appendActivityStep\(logId, editMessages\.note, "done"\);/g },
  { name: "the edit route seals the page's own note", path: "app/page.tsx", pattern: /note: editRouteProvenanceNote\(data\.note\)/g },
  { name: "a dropped grant is the page's decision in the run view", path: "app/page.tsx", pattern: /runView = runViewGrantDropped\(runView\);/g },
  { name: "a received grant is the page's decision in the run view", path: "app/page.tsx", pattern: /runView = runViewGrantReceived\(runView\);/g },
  { name: "the one-shot Undo reason reads the timeline", path: "app/page.tsx", pattern: /entryUndoAvailability\(entry, newest, inFlight, projectTimelineEntries\)/g },
  { name: "the chat Undo keeps the seq it undid", path: "app/page.tsx", pattern: /entryUndoResult\(current, \{ ok: true, afterSeq: decision\.operation\.seq \}\)/g },
  { name: "the editor reports a transient refusal", path: "app/components/pcb/PcbEditor.tsx", pattern: /\bonExecutionGrantAttemptRefused\?\.\(/g },
  { name: "the editor keeps a card only by the ritual's rule", path: "app/components/pcb/PcbEditor.tsx", pattern: /const transient = refusalKeepsPreviewCard\(outcome\);/g },
  { name: "the live pre-check names its reason", path: "app/components/pcb/PcbEditor.tsx", pattern: /code: "precheck-refused", message: reason/g },
  { name: "the editor records the timeline through the shared step", path: "app/components/pcb/PcbEditor.tsx", pattern: /const next = pcbHistoryStep\(history, previousMark\);/g },
];
const wireCount = (sources: ReadonlyMap<string, string>, wire: (typeof WIRES)[number]): number => [...(sources.get(wire.path) ?? "").matchAll(wire.pattern)].length;

describe("B18-D R1-1 — exactly one Confirm surface; the chat has none", () => {
  it("one tenderConfirmedExecution( call and one runGrantedExecution(\"confirm\"), both in PcbEditor", () => {
    expect(callSites(/(?<!function )\btenderConfirmedExecution\(/g)).toEqual(["app/components/pcb/PcbEditor.tsx"]);
    expect(callSites(/\brunGrantedExecution\("confirm"\)/g)).toEqual(["app/components/pcb/PcbEditor.tsx"]);
  });

  it("nothing under app/components/chat imports the controller, the ritual, the transport or the journal", { timeout: 120_000 }, () => {
    const chat = chatFiles();
    expect([...chat.keys()]).toEqual(expect.arrayContaining(["app/components/chat/ExecutionEntryActions.tsx", "app/components/chat/AutonomyModeControl.tsx"]));
    for (const [name, target] of Object.entries(TARGETS)) expect(moduleImportOffenders(chat, target, new Set()), name).toEqual([]);
  });

  it("[B18-D review 2] the chat-entry fixes are wired: every wire present exactly once; the edit route never seals the model's note", () => {
    for (const wire of WIRES) expect(wireCount(files, wire), wire.name).toBe(1);
    expect(files.get("app/page.tsx") ?? "").not.toMatch(/note: data\.note/);
  });

  it("[B18-D review 2] NEGATIVE tripwire: removing any wire trips its gate", () => {
    for (const wire of WIRES) {
      const mutated = new Map(files);
      mutated.set(wire.path, (files.get(wire.path) ?? "").replace(wire.pattern, "/* removed */"));
      expect(wireCount(mutated, wire), wire.name).toBe(0);
    }
  });

  it("NEGATIVE tripwire: a chat component importing any of them trips every gate", { timeout: 120_000 }, () => {
    const injected = chatFiles();
    injected.set("app/components/chat/EvilConfirm.tsx", [
      'import { tenderConfirmedExecution } from "@/app/lib/project/granted-execution-controller.internal";',
      'import { executeGrantedOperation } from "../../lib/engineering/granted-executions";',
      'import { createExecutionGrantTransport } from "@/app/lib/project/execution-grant-client";',
      'import { openAgentExecutionJournal } from "@/app/lib/engineering/agent-execution-journal";',
    ].join("\n"));
    for (const [name, target] of Object.entries(TARGETS)) expect(moduleImportOffenders(injected, target, new Set()), name).toEqual(["app/components/chat/EvilConfirm.tsx"]);
  });
});
