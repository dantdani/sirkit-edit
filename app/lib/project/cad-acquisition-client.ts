/**
 * [PR-M, 2026-10-18] Section M2 (design M2.1, page parity): the page's client of the durable CAD acquisition task - the SAME
 * `/api/parts/acquisitions` route (and so the same `ComponentResolutionService`) the agent's `sirkit.parts.acquisition-start` and
 * `sirkit.parts.acquisition-status` answer from. Browser-safe: fetch over the project selector headers, no server import.
 *
 *  - `startCadAcquisition`: start (or attach to) the task for catalog instances of ONE catalog part, with the verified sheet the page
 *    holds (the server verifies it again and derives every source, byte and fact itself);
 *  - `readCadAcquisition` / `listCadAcquisitions`: the task's public view;
 *  - `controlCadAcquisition`: cancel / resume / recheck ("Check again");
 *  - `sendCadAcquisitionForReview`: "Send for component review" - a PERSON's action (the server refuses an agent);
 *  - `noteResolutionApplied`: after the page's review dialog applied a resolution batch (its real receipt), every task of the project
 *    whose offered replacement that batch applied records the receipt and the updated preflight (computed by the server over the sheet
 *    sent). Best effort: a failure here never undoes or blocks the apply; the task keeps waiting for the receipt.
 *
 * Nothing here approves, publishes, binds or applies anything.
 */
import type { SchematicState } from "@/lib/schematic-types";
import { projectSelectorHeaders, type ProjectSelectorScope } from "./project-selector";
import { CAD_ACQUISITION_ROUTE, CAD_ACQUISITION_TERMINAL_STATES, type CadAcquisitionRequirement, type CadAcquisitionTaskView, type CadAssetRequestKind } from "../acquisition/cad-acquisition-contract";

export type CadAcquisitionAnswer = { ok: true; task: CadAcquisitionTaskView; attached?: boolean; handoffId?: string } | { ok: false; status: number; code: string; error: string };
export type CadAcquisitionListAnswer = { ok: true; tasks: CadAcquisitionTaskView[] } | { ok: false; status: number; code: string; error: string };

const FAILED = "The acquisition service could not be reached.";
let actionCounter = 0;
/** A fresh client action id (the server's idempotency key for one click). */
export function cadAcquisitionActionId(prefix: string): string {
  actionCounter += 1;
  const random = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${actionCounter}`;
  return `${prefix}:${random}`.replace(/[^A-Za-z0-9:._-]/g, "-").slice(0, 128);
}

async function call(scope: ProjectSelectorScope, init: { method: "GET"; query?: string } | { method: "POST"; body: Record<string, unknown> }): Promise<{ status: number; body: Record<string, unknown> }> {
  try {
    const response = init.method === "GET"
      ? await fetch(`${CAD_ACQUISITION_ROUTE}${init.query ? `?${init.query}` : ""}`, { method: "GET", headers: projectSelectorHeaders(scope), cache: "no-store" })
      : await fetch(CAD_ACQUISITION_ROUTE, { method: "POST", headers: { "Content-Type": "application/json", ...projectSelectorHeaders(scope) }, body: JSON.stringify(init.body) });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: response.status, body: typeof body === "object" && body !== null ? body : {} };
  } catch {
    return { status: 0, body: { ok: false, code: "NETWORK", error: FAILED } };
  }
}

const refusal = (status: number, body: Record<string, unknown>): { ok: false; status: number; code: string; error: string } => ({ ok: false, status, code: typeof body.code === "string" ? body.code : "REFUSED", error: typeof body.error === "string" ? body.error.slice(0, 400) : FAILED });

function taskAnswer(status: number, body: Record<string, unknown>): CadAcquisitionAnswer {
  if (body.ok === true && body.task && typeof body.task === "object") return { ok: true, task: body.task as CadAcquisitionTaskView, ...(typeof body.attached === "boolean" ? { attached: body.attached } : {}), ...(typeof body.handoffId === "string" ? { handoffId: body.handoffId } : {}) };
  return refusal(status, body);
}

export async function startCadAcquisition(scope: ProjectSelectorScope, input: { componentIds: string[]; requirement?: CadAcquisitionRequirement; assetKinds?: CadAssetRequestKind[]; schematic: SchematicState }): Promise<CadAcquisitionAnswer> {
  const { status, body } = await call(scope, { method: "POST", body: { operation: "start", request: { componentIds: input.componentIds, ...(input.requirement ? { requirement: input.requirement } : {}), ...(input.assetKinds ? { assetKinds: input.assetKinds } : {}) }, schematic: input.schematic } });
  return taskAnswer(status, body);
}

export async function readCadAcquisition(scope: ProjectSelectorScope, taskId: string): Promise<CadAcquisitionAnswer> {
  const { status, body } = await call(scope, { method: "GET", query: new URLSearchParams({ taskId }).toString() });
  return taskAnswer(status, body);
}

export async function listCadAcquisitions(scope: ProjectSelectorScope): Promise<CadAcquisitionListAnswer> {
  const { status, body } = await call(scope, { method: "GET" });
  if (body.ok === true && Array.isArray(body.tasks)) return { ok: true, tasks: body.tasks as CadAcquisitionTaskView[] };
  return refusal(status, body);
}

export async function controlCadAcquisition(scope: ProjectSelectorScope, taskId: string, action: "cancel" | "resume" | "recheck"): Promise<CadAcquisitionAnswer> {
  const { status, body } = await call(scope, { method: "POST", body: { operation: "control", taskId, action, clientActionId: cadAcquisitionActionId(action) } });
  return taskAnswer(status, body);
}

export async function sendCadAcquisitionForReview(scope: ProjectSelectorScope, taskId: string): Promise<CadAcquisitionAnswer> {
  const { status, body } = await call(scope, { method: "POST", body: { operation: "handoff", taskId, clientActionId: cadAcquisitionActionId("handoff") } });
  return taskAnswer(status, body);
}

/** The receipt fields `noteResolutionApplied` reads (the page's ResolutionMutationReceipt carries them). */
export interface AppliedResolutionReceipt { receiptId: string; schematicDigestAfter: string; items: ReadonlyArray<{ componentInstanceId: string; target: { atomicPartRevisionId: string } }> }

/** Which tasks a committed resolution batch completes: every task whose offered replacement names instances the batch bound to that revision. */
export function tasksAppliedBy(tasks: readonly CadAcquisitionTaskView[], receipt: AppliedResolutionReceipt): CadAcquisitionTaskView[] {
  const bound = new Map(receipt.items.map((item) => [item.componentInstanceId, item.target.atomicPartRevisionId] as const));
  return tasks.filter((task) => !CAD_ACQUISITION_TERMINAL_STATES.includes(task.state) && task.proposal !== null && task.applied === null && task.proposal.componentIds.length > 0 && task.proposal.componentIds.every((id) => bound.get(id) === task.proposal!.atomicPartRevisionId)); // [PR-L/M integration, 2026-10-18] M2-SEC-2: a stopped or ended task is not sent a receipt (the store refuses it too)
}

/** After the review dialog's apply: record the receipt (and the server-computed preflight) on every task it completes. Never throws. */
export async function noteResolutionApplied(scope: ProjectSelectorScope | null, receipt: AppliedResolutionReceipt, schematic: SchematicState): Promise<number> {
  if (!scope) return 0;
  try {
    const listed = await listCadAcquisitions(scope);
    if (!listed.ok) return 0;
    let recorded = 0;
    for (const task of tasksAppliedBy(listed.tasks, receipt)) {
      const { body } = await call(scope, { method: "POST", body: { operation: "record-applied", taskId: task.taskId, clientActionId: cadAcquisitionActionId("applied"), receiptId: receipt.receiptId, schematicDigestAfter: receipt.schematicDigestAfter, schematic } });
      if (body.ok === true) recorded += 1;
    }
    return recorded;
  } catch {
    return 0;
  }
}
