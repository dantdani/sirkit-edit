/**
 * B14.2 — total-settlement reauthorization (fake-timer hard-boundary race),
 * streaming byte bounds on both HTTP directions, honest request correlation
 * refusals, service-level timeout consequences (lease/gateway/transition
 * usable), and the permanent controller/channel import boundaries with a
 * synthetic-injection negative tripwire.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { KicadPin } from "../../kicad/types";
import type { SchematicState } from "@/lib/schematic-types";
import { kicadPinWorldPos } from "@/app/lib/geometry";
import { SchematicEditorSession } from "../../engineering/schematic-session";
import { InMemoryAtomicProjectStore } from "../../engineering/persistence";
import { SchematicGestureCoordinator } from "../../engineering/schematic-gesture-coordinator";
import { SchematicHistory } from "../schematic-history";
import { adoptCanonicalResult } from "../canonical-adoption";
import { ProjectCommitInterlock } from "../../engineering/project-commit-interlock";
import { ApprovedMutationRegistry, ApprovedMutationAuditLedger } from "../../engineering/approved-agent-mutations";
import { ApprovedMutationJournal, InMemoryApprovedMutationJournalStore } from "../../engineering/approved-mutation-journal";
import { applyApprovedReplacementProposal } from "../../engineering/approved-replacement-mutations";
import { assembleReplacementProposal } from "../../engineering/replacement-proposal-assembler";
import { issueReplacementApprovalIntent } from "../../engineering/replacement-approval.internal";
import {
  __createTestReplacementReauthorizationChannel,
  consumeReplacementReauthorization,
  REAUTHORIZATION_TRANSPORT_DEADLINE_MS,
} from "../replacement-reauthorization";
import { readBoundedStream } from "../../http/bounded-stream";
import { moduleImportOffenders } from "./_import-gate-helpers";
import { POST as REAUTH_POST } from "@/app/api/replacement-authority/route";
import { injectAuthorizedPrincipal, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import type { SealedReplacementProposal } from "../../engineering/replacement-proposals";
import { buildAuthorizationBinding } from "../../engineering/proposal-authorization";
import type { ComponentAuthorityRecord } from "../../engineering/component-authority";
import type { PublishedSymbolPinFacts } from "../../engineering/replacement-pin-facts";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const PROJECT = "p-b142";
const SCOPE = { tenantId: "local", projectId: PROJECT, branchId: "main" } as const;
const REQUEST = {
  proposalId: "rprop-aaaaaaaaaaaaaaaa",
  componentInstanceId: "u1-id",
  currentAtomicPartRevisionId: "rev-old",
  scope: SCOPE,
  headMark: { lineageId: "lin1-aaaaaaaaaaaaaaaa", headSequence: 1, canonicalStateDigest: "eng1-bbbbbbbbbbbbbbbb" },
  now: 1_000_000,
};

function echoBinding(requestBody: string): Record<string, unknown> {
  const parsed = JSON.parse(requestBody) as { nonce: string; componentInstanceId: string; scope: { projectId: string } };
  return { nonce: parsed.nonce, componentInstanceId: parsed.componentInstanceId, scope: { tenantId: "local", projectId: parsed.scope.projectId, branchId: "main" } };
}
function goodText(requestBody: string, over: Record<string, unknown> = {}): string {
  return JSON.stringify({ ok: true, records: [], candidates: [], currentPinFacts: null, targetPinFacts: null, binding: echoBinding(requestBody), ...over });
}

// ─── §A — hard total settlement (fake timers; regressions 1–5, 14) ───────────

describe("B14.2 §A — reauthorization settles exactly once within the hard bound", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.runOnlyPendingTimers(); vi.useRealTimers(); });

  it("1. a never-settling transport times out within the documented deadline (and the transport saw the abort)", async () => {
    let sawAbort = false;
    const channel = __createTestReplacementReauthorizationChannel((_body, signal) => {
      signal?.addEventListener("abort", () => { sawAbort = true; });
      return new Promise(() => {});
    });
    let settled: unknown = "PENDING";
    const pending = consumeReplacementReauthorization(channel, REQUEST).then((value) => { settled = value; });
    await vi.advanceTimersByTimeAsync(REAUTHORIZATION_TRANSPORT_DEADLINE_MS);
    await pending;
    expect(settled).toBeNull();
    expect(sawAbort).toBe(true);
    expect(vi.getTimerCount()).toBe(0); // timer cleared on the terminal path
  });

  it("2. a transport that stays pending until the internal abort times out within the bound", async () => {
    // [B14.3 R3 correction] this is a TRANSPORT-settlement case (a transport
    // promise pending until the internal signal aborts) — NOT a response-body
    // case, as its original title falsely claimed. The REAL never-settling
    // RESPONSE-BODY `ReadableStream` cases (reader cancellation received,
    // late bodies inert) are the permanent B14.3 §C suite.
    const bodyHung = __createTestReplacementReauthorizationChannel((_body, signal) =>
      new Promise((_, reject) => { signal?.addEventListener("abort", () => reject(new Error("body read aborted"))); }));
    let settled: unknown = "PENDING";
    const pending = consumeReplacementReauthorization(bodyHung, REQUEST).then((value) => { settled = value; });
    await vi.advanceTimersByTimeAsync(REAUTHORIZATION_TRANSPORT_DEADLINE_MS);
    await pending;
    expect(settled).toBeNull();
  });

  it("3/4. late success and late rejection after the timeout are discarded with no unhandled rejection", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => { unhandled.push(reason); };
    process.on("unhandledRejection", onUnhandled);
    try {
      for (const mode of ["resolve", "reject"] as const) {
        let settleLate: (() => void) | undefined;
        const channel = __createTestReplacementReauthorizationChannel((body) =>
          new Promise((resolve, reject) => {
            settleLate = () => (mode === "resolve" ? resolve({ ok: true, text: goodText(body) }) : reject(new Error("late")));
          }));
        const outcome = consumeReplacementReauthorization(channel, REQUEST);
        await vi.advanceTimersByTimeAsync(REAUTHORIZATION_TRANSPORT_DEADLINE_MS);
        expect(await outcome, mode).toBeNull();
        settleLate?.();
        await vi.advanceTimersByTimeAsync(10);
        await Promise.resolve();
      }
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
    expect(unhandled).toEqual([]);
  });

  it("5. a pre-aborted consumption never calls the transport (and still burns the channel)", async () => {
    let transportCalls = 0;
    const channel = __createTestReplacementReauthorizationChannel(async (body) => { transportCalls += 1; return { ok: true, text: goodText(body) }; });
    const controller = new AbortController();
    controller.abort();
    expect(await consumeReplacementReauthorization(channel, REQUEST, { signal: controller.signal })).toBeNull();
    expect(transportCalls).toBe(0);
    // 14. one-shot preserved: the burned channel refuses a normal retry.
    expect(await consumeReplacementReauthorization(channel, REQUEST)).toBeNull();
    expect(transportCalls).toBe(0);
  });

  it("14b. a TIMED-OUT channel stays consumed — a fresh attempt needs a fresh channel", async () => {
    const hung = __createTestReplacementReauthorizationChannel(() => new Promise(() => {}));
    const first = consumeReplacementReauthorization(hung, REQUEST);
    await vi.advanceTimersByTimeAsync(REAUTHORIZATION_TRANSPORT_DEADLINE_MS);
    expect(await first).toBeNull();
    // second tender of the SAME channel: refused without transport.
    const second = consumeReplacementReauthorization(hung, REQUEST);
    await vi.advanceTimersByTimeAsync(1);
    expect(await second).toBeNull();
  });
});

// ─── §C — honest correlation refusals (regressions 12–13) ────────────────────

describe("B14.2 §C — nonce/binding correlation refusals", () => {
  // [B16.0.3 §A] the direct-endpoint refusal case authenticates first.
  const SELECTOR = { "x-sirkit-tenant-id": "local", "x-sirkit-project-id": PROJECT, "x-sirkit-branch-id": "main" };
  beforeEach(() => { injectAuthorizedPrincipal({ userId: "reauth-editor", tenantId: "local", projectId: PROJECT, role: "editor" }); });
  afterEach(() => { resetInjectedIdentity(); });
  it("12. absent, malformed, or mismatched nonce echoes refuse", async () => {
    for (const mutate of [
      (body: string) => JSON.stringify({ ...JSON.parse(goodText(body)) as object, binding: undefined }),
      (body: string) => goodText(body, { binding: { ...echoBinding(body), nonce: "not-the-nonce-0000" } }),
      (body: string) => goodText(body, { binding: { ...echoBinding(body), nonce: 42 } }),
    ]) {
      const channel = __createTestReplacementReauthorizationChannel(async (body) => ({ ok: true, text: mutate(body) }));
      expect(await consumeReplacementReauthorization(channel, REQUEST)).toBeNull();
    }
  });

  it("13. a binding for another component or project refuses", async () => {
    const wrongComponent = __createTestReplacementReauthorizationChannel(async (body) => ({ ok: true, text: goodText(body, { binding: { ...echoBinding(body), componentInstanceId: "someone-else" } }) }));
    expect(await consumeReplacementReauthorization(wrongComponent, REQUEST)).toBeNull();
    const wrongProject = __createTestReplacementReauthorizationChannel(async (body) => ({ ok: true, text: goodText(body, { binding: { ...echoBinding(body), scope: { tenantId: "local", projectId: "other", branchId: "main" } } }) }));
    expect(await consumeReplacementReauthorization(wrongProject, REQUEST)).toBeNull();
    // the endpoint refuses an ABSENT/malformed request nonce outright:
    for (const nonce of [undefined, "short", "bad nonce!"]) {
      const response = await REAUTH_POST(new Request("http://localhost/api/replacement-authority", {
        method: "POST", headers: { "Content-Type": "application/json", ...SELECTOR },
        body: JSON.stringify({ scope: SCOPE, componentInstanceId: "u1-id", currentAtomicPartRevisionId: null, ...(nonce !== undefined ? { nonce } : {}) }),
      }));
      expect(response.status, String(nonce)).toBe(400);
    }
  });

  it("11. an oversized response stream refuses at the byte ceiling without parsing", async () => {
    // Direct primitive proof: a 3MB never-repeating stream stops at the 2MB bound.
    const chunk = new Uint8Array(64 * 1024).fill(65);
    let served = 0;
    const oversized = new ReadableStream<Uint8Array>({
      pull(controller) { served += 1; controller.enqueue(chunk); },
    });
    const bounded = await readBoundedStream(oversized, 2_000_000);
    expect(bounded).toEqual({ ok: false, reason: "over-limit" });
    expect(served).toBeLessThan(40); // stopped just past the ceiling, not the whole stream
  });
});

// ─── §B — endpoint streaming bounds (regressions 9–10) ───────────────────────

describe("B14.2 §B — streaming request bounds at the endpoint", () => {
  // [B16.0.3 §A] the route authenticates FIRST; inject an authorized editor of
  // the selected project and send the selector so the bounded-body path runs.
  const SELECTOR = { "x-sirkit-tenant-id": "local", "x-sirkit-project-id": PROJECT, "x-sirkit-branch-id": "main" };
  beforeEach(() => { injectAuthorizedPrincipal({ userId: "reauth-editor", tenantId: "local", projectId: PROJECT, role: "editor" }); });
  afterEach(() => { resetInjectedIdentity(); });
  function streamingRequest(chunks: () => Uint8Array | null, cancel?: () => Promise<void>): Request {
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        const next = chunks();
        if (next === null) controller.close();
        else controller.enqueue(next);
      },
      ...(cancel ? { cancel } : {}),
    });
    return new Request("http://localhost/api/replacement-authority", {
      method: "POST", headers: { "Content-Type": "application/json", ...SELECTOR },
      body: stream, duplex: "half",
    } as RequestInit);
  }

  it("9. an oversized streamed request stops at the byte ceiling with 413 (never fully buffered)", async () => {
    const chunk = new Uint8Array(4096).fill(120);
    let served = 0;
    const response = await REAUTH_POST(streamingRequest(() => { served += 1; return chunk; }));
    expect(response.status).toBe(413);
    expect(served).toBeLessThan(10); // 16KB bound ⇒ ~5 chunks, not endless
  });

  it("10. a never-settling request-stream cancellation cannot delay the 413", async () => {
    const chunk = new Uint8Array(8192).fill(120);
    const response = await REAUTH_POST(streamingRequest(() => chunk, () => new Promise<void>(() => {})));
    expect(response.status).toBe(413); // settled although cancel() never will
  });
});

// ─── §A service-level — timeout consequences (regressions 6–8) ───────────────

function pin(number: string, name: string, xMm: number): KicadPin {
  return { number, name, type: "passive", position: { x: xMm, y: 0 }, orientation: 0, length: 2.54 };
}
const PART_PINS: readonly KicadPin[] = [pin("1", "A", -2.5), pin("2", "B", 2.5)];
const U1 = { id: "u1-id", partId: "lib:part-a", x: 300, y: 100, rotation: 0 as const, refDes: "U1", value: "MCU", atomicPartRevisionId: "rev-old", symbolAssetVersionId: "sym-old" };
function baseState(): SchematicState {
  const pin1 = kicadPinWorldPos(U1, PART_PINS[0]!);
  return { components: [], kicadComponents: [{ ...U1 }], wires: [{ id: "w1", vertices: [{ x: pin1.x - 60, y: pin1.y }, pin1] }], netLabels: [] };
}
function record(): ComponentAuthorityRecord {
  return {
    authorityRecordId: "auth:u1-id", componentId: "u1-id", projectId: PROJECT, authorityRevision: "rev-new",
    selectedPart: { mpn: "lib:part-b", manufacturer: "Fixture Semiconductor", provenance: "physical-binding" },
    lifecycle: "selected", approval: "approved", freshness: "current", conflict: "none",
    footprintAsset: "available", mappingVerification: "verified",
    exactAuthority: { atomicPartRevisionId: "rev-new", mpn: "lib:part-b", manufacturer: "Fixture Semiconductor", symbolAssetVersionId: "sym-new", footprintAssetVersionId: "fp-new", mappingCertificateId: "cert-new", selectionRecordId: "sel-new" },
    evidenceRefs: ["binding:fixture:u1-id"],
  };
}
function pinFactsFor(rev: string, symbol: string, certificateId = "cert-new"): PublishedSymbolPinFacts {
  const ids = PART_PINS.map((entry) => `pin-${entry.number}`);
  return {
    atomicPartRevisionId: rev, symbolAssetVersionId: symbol, pins: [...PART_PINS],
    certificate: { id: certificateId, symbolVersionId: symbol, footprintVersionId: "fp-new", symbolPinIds: ids, missingTerminalIds: [], missingSymbolPinIds: [], missingPadNumbers: [], ambiguous: [], state: "approved" },
    symbolPinIds: ids,
  };
}

describe("B14.2 §A — a hung reauthorization cannot retain the lease or block transitions", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.runOnlyPendingTimers(); vi.useRealTimers(); });

  it("6/7/8. timeout ⇒ zero journal entries, zero transactions; the interlock, gateway, and retirement stay usable", async () => {
    const state = baseState();
    const editor = new SchematicEditorSession({ ...SCOPE }, { store: new InMemoryAtomicProjectStore() });
    await editor.openForProject(state, null);
    let visible = structuredClone(state);
    const history = new SchematicHistory<SchematicState>(structuredClone(state), { label: "open" });
    const coordinator = new SchematicGestureCoordinator({
      currentState: () => structuredClone(visible),
      applyPreviewFrame: () => {},
      applyCanonicalProjection: (label, next) => {
        const outcome = adoptCanonicalResult<SchematicState>({
          flushPendingRecord: () => {}, history: () => history,
          applyProjection: (authoritative) => { visible = structuredClone(authoritative); coordinator.notifyAuthoritativeProjection(authoritative); },
          snapshot: (authoritative) => structuredClone(authoritative),
          historyRecorded: () => {}, suppressEffectRecord: () => {}, scheduleAutosave: () => {},
        }, label, next);
        if (!outcome.ok) throw new Error(outcome.detail);
      },
      applyRollbackProjection: (next) => { visible = structuredClone(next); },
      execute: (base, request) => editor.execute(base, request),
      notify: () => {},
    });
    const mark = editor.headMark()!;
    const sealed = assembleReplacementProposal({
      state, componentId: "u1-id",
      authority: { records: [record()], candidates: [] },
      scope: { ...SCOPE, headMark: mark },
      // B16.0.1 §E: the sealer requires the server-verified authorization binding.
      authorization: buildAuthorizationBinding({ principalId: "user-fixture", scope: SCOPE }),
      currentPinFacts: pinFactsFor("rev-old", "sym-old", "cert-old"),
      targetPinFacts: pinFactsFor("rev-new", "sym-new"),
      provenance: { provider: "openai", note: "n", instruction: "i" },
      now: 1_000_000,
    });
    if (sealed.kind !== "sealed") throw new Error("seal failed");
    const proposal: SealedReplacementProposal = sealed.proposal;
    const interlock = new ProjectCommitInterlock();
    const journalStore = new InMemoryApprovedMutationJournalStore();
    const hungChannel = __createTestReplacementReauthorizationChannel(() => new Promise(() => {}));
    // B16.0.1 §E: the intent binds the sealed authorization identity.
    const intent = issueReplacementApprovalIntent({ proposalId: proposal.proposalId, scope: SCOPE, headMark: proposal.scope.headMark, authorization: { principalId: proposal.authorization.principalId, membershipRevision: proposal.authorization.membershipRevision }, now: 1_001_000 });

    const applyPromise = applyApprovedReplacementProposal({
      proposal, session: editor, gateway: coordinator, interlock,
      journal: new ApprovedMutationJournal(journalStore, SCOPE),
      stillCurrent: () => true, currentProjectId: PROJECT, currentBranchId: "main",
      approval: intent, reauthorization: hungChannel,
      now: () => 1_002_000,
      registry: new ApprovedMutationRegistry(), audit: new ApprovedMutationAuditLedger(),
    });
    await vi.advanceTimersByTimeAsync(REAUTHORIZATION_TRANSPORT_DEADLINE_MS + 100);
    const outcome = await applyPromise;
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("authority-unavailable");

    // 6. zero journal entries, zero canonical transactions.
    const raw = await journalStore.load(SCOPE.tenantId, SCOPE.projectId, SCOPE.branchId) as { entries?: unknown[] } | null;
    expect(raw?.entries?.length ?? 0).toBe(0);
    expect(editor.events.filter((event) => event.kind === "executed")).toHaveLength(0);

    // 7. the commit lease and serialized gateway are USABLE afterwards.
    const lease = interlock.acquireCommitLease();
    expect(lease.ok).toBe(true);
    if (lease.ok) lease.lease.release();
    const command = await editor.execute(visible, {
      commandId: "schematic.set-property", label: "edit",
      buildOperations: () => [{ operationId: "op:r1", schemaVersion: 1, units: "px", kind: "schematic_set_component_properties", family: "kicad", componentId: "u1-id", patch: { value: "22k" } }],
    });
    expect(command.ok).toBe(true);

    // 8. project retirement SETTLES despite the (already-refused) hang.
    await interlock.retire();
    expect(interlock.retired).toBe(true);
  });
});

// ─── §D — permanent import boundaries + negative tripwire (15–16) ────────────

type FileMap = Map<string, string>;

function productionFiles(): FileMap {
  const files: FileMap = new Map();
  const root = process.cwd();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      if (["node_modules", "__tests__", ".next", ".git", "vendor", "artifacts", "data", "public"].includes(entry)) continue;
      const full = join(dir, entry);
      const stats = statSync(full);
      if (stats.isDirectory()) { walk(full); continue; }
      if (!/\.(ts|tsx)$/.test(entry)) continue;
      files.set(relative(root, full).replaceAll("\\", "/"), readFileSync(full, "utf8"));
    }
  };
  walk(join(root, "app"));
  walk(join(root, "scripts"));
  walk(join(root, "lib"));
  return files;
}

function offendersFor(files: FileMap, needle: string, approved: ReadonlySet<string>): string[] {
  const offenders: string[] = [];
  for (const [relPath, source] of files) {
    if (source.includes(needle) && !approved.has(relPath)) offenders.push(relPath);
  }
  return offenders;
}

describe("B14.2 §D — permanent trusted-composition import boundaries", () => {
  const files = productionFiles();

  it("15. the authority-bearing controller is importable ONLY by the trusted UI composition root", () => {
    const approved = new Set([
      "app/lib/project/replacement-approval-controller.internal.ts",
      "app/page.tsx",
    ]);
    expect(offendersFor(files, "replacement-approval-controller.internal", approved)).toEqual([]);
    // API routes, agent runtime, gateway, loop, provider adapters, registries,
    // scripts, and barrels are all outside the approved set BY CONSTRUCTION —
    // the negative tripwire proves the gate detects a violation:
    const injected: FileMap = new Map(files);
    injected.set("app/api/evil/route.ts", 'import { approveAndApplyReplacement } from "@/app/lib/project/replacement-approval-controller.internal";');
    expect(offendersFor(injected, "replacement-approval-controller.internal", approved)).toEqual(["app/api/evil/route.ts"]);
    const injectedAgent: FileMap = new Map(files);
    injectedAgent.set("app/lib/agent/evil.ts", 'import { approveAndApplyReplacement } from "../project/replacement-approval-controller.internal";');
    expect(offendersFor(injectedAgent, "replacement-approval-controller.internal", approved)).toEqual(["app/lib/agent/evil.ts"]);
  });

  it("15b. the reauthorization channel module has its own restricted importer set", { timeout: 60_000 }, () => {
    // [B14.3 R4 correction] the original raw-substring needle
    // "project/replacement-reauthorization" was evadable by a same-directory
    // `./replacement-reauthorization` specifier. The gate now RESOLVES every
    // import specifier (relative, alias, dynamic, re-export) against the
    // importer's path; the approved importer set is UNCHANGED. Equivalent-
    // spelling tripwires live in the B14.3 §E suite.
    const approved = new Set([
      "app/lib/project/replacement-reauthorization.ts",
      "app/lib/project/replacement-approval-controller.internal.ts",
      "app/lib/engineering/approved-replacement-mutations.ts",
    ]);
    expect(moduleImportOffenders(files, "app/lib/project/replacement-reauthorization", approved)).toEqual([]);
  });

  it("16. no production file references the test-only channel factory (and an injected one trips the gate)", () => {
    const approved = new Set(["app/lib/project/replacement-reauthorization.ts"]);
    expect(offendersFor(files, "__createTestReplacementReauthorizationChannel", approved)).toEqual([]);
    const injected: FileMap = new Map(files);
    injected.set("app/lib/engineering/evil-service.ts", 'import { __createTestReplacementReauthorizationChannel } from "../project/replacement-reauthorization";');
    expect(offendersFor(injected, "__createTestReplacementReauthorizationChannel", approved)).toEqual(["app/lib/engineering/evil-service.ts"]);
  });

  it("the engineering barrel exports none of the approval/reauthorization capabilities", () => {
    const barrel = files.get("app/lib/engineering/index.ts") ?? "";
    expect(barrel).not.toContain("replacement-approval");
    expect(barrel).not.toContain("replacement-reauthorization");
    expect(barrel).not.toContain("approved-replacement-mutations");
  });
});
