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
