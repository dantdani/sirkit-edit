"use client";

/**
 * [B23-B1] The provider panel of the manufacturing workflow (runbook B23-B :976-977; OD-166). It names the provider and the purpose,
 * shows exactly which files and fields a preview says would leave Sirkit (and what stays), and states that no provider is enabled
 * in B23. Preview and commit are two separate controls: the commit control exists only for a previewed plan and sends that exact
 * plan (its id and digest, an idempotency key and the opt-in header); one click never sends a commit, and in B23 every commit is
 * refused by the server (`provider_not_admitted`). The server decides everything; this panel shows what it answers.
 * [B23-B1 review, 2026-10-04] Beside the fields, it lists the ids whose value leaves inside file names or bytes and every metadata
 * field the files carry, and "kept in Sirkit" lists only what the plan says stays; a refused or failed preview discards the plan.
 */

import { useCallback, useState, type ChangeEvent } from "react";

/** The reviewed board-file exchanges, in the server's order (the route's `BOARD_FILE_EXCHANGES`; a B23-B1 suite pins the two equal). */
export const PROVIDER_EXCHANGE_CHOICES = Object.freeze([
  { providerId: "jlcpcb", operationId: "pcb-quote", purpose: "quote", label: "JLCPCB - quote (pcb-quote)" },
  { providerId: "oshpark", operationId: "import-upload", purpose: "quote", label: "OSH Park - quote (import-upload)" },
  { providerId: "oshpark", operationId: "api-upload", purpose: "quote", label: "OSH Park - quote (api-upload)" },
  { providerId: "macrofab", operationId: "dfm-readiness", purpose: "dfm", label: "MacroFab - DFM check (dfm-readiness)" },
  { providerId: "macrofab", operationId: "pcb-quote", purpose: "quote", label: "MacroFab - quote (pcb-quote)" },
] as const);

const ROUTE = "/api/pcb/provider-exchange";
const COMMIT_HEADER = "x-sirkit-provider-exchange-commit";
const COMMIT_OPT_IN = "send_exact_plan";
const ADMIN_ONLY = "Only a project administrator can preview or commit a provider exchange.";

/** The plan as the server answers it (only what the panel shows). */
interface PlanView {
  planId: string;
  planDigest: string;
  purpose: string;
  provider: { providerId: string; displayName: string; operationId: string; operationName: string; descriptorVersion: string; descriptorDigest: string };
  release: { releaseId: string; archiveSha256: string };
  authority: { revision: number; recordDigest: string; boardRevision: string };
  outbound: {
    files: Array<{ path: string; role: string; bytes: number; sha256: string }>;
    manifest: { path: string; bytes: number; sha256: string };
    fields: string[];
    withheldFiles: string[];
    withheldFields: string[];
    /** [B23-B1 review, 2026-10-04] the ids whose value leaves inside a file name or byte, and the metadata the file bytes carry */
    carried: Array<{ field: string; value: string; form: string; names: string[]; bytes: string[] }>;
    embedded: Array<{ field: string; value: string; paths: string[] }>;
    outboundPackageDigest: string;
  };
  requestDigest: string;
  admission: { admitted: boolean; refusal: string | null; message: string };
  expiresAt: string;
}
interface ResultView { code: string; message: string; refusal: string | null; correlationId: string | null }

export interface ProviderExchangePanelProps {
  scope: { tenantId: string; projectId: string; branchId: string; designId: string; boardId: string };
  /** the CURRENT qualification authority the administrator sees (its pins go to the server, which re-checks them) */
  authority: { revision: number; recordDigest: string };
  /** the server-derived viewer may act (a human project administrator) */
  canAct: boolean;
  /** transport override (tests) */
  fetchImpl?: typeof fetch;
  /** idempotency key for a plan's commit (tests) */
  newKey?: () => string;
}

/** The server's refusal envelope, as the panel shows it. */
const resultOf = (body: Record<string, unknown>): ResultView => ({ code: typeof body.code === "string" ? body.code : "PX_UNKNOWN", message: typeof body.error === "string" ? body.error : "The server gave no reason.", refusal: typeof body.refusal === "string" ? body.refusal : null, correlationId: typeof body.correlationId === "string" ? body.correlationId : null });

function useProviderExchange({ scope, authority, canAct, fetchImpl, newKey }: ProviderExchangePanelProps) {
  const [choice, setChoice] = useState(0);
  const [plan, setPlan] = useState<PlanView | null>(null);
  const [planKey, setPlanKey] = useState<string | null>(null);
  const [spent, setSpent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ResultView | null>(null);

  const call = useCallback(async (body: Record<string, unknown>, extraHeaders: Record<string, string> = {}): Promise<{ ok: boolean; body: Record<string, unknown> }> => {
    const doFetch = fetchImpl ?? ((url: RequestInfo | URL, init?: RequestInit) => fetch(url, init));
    try {
      const response = await doFetch(ROUTE, { method: "POST", headers: { "content-type": "application/json", "x-sirkit-tenant-id": scope.tenantId, "x-sirkit-project-id": scope.projectId, "x-sirkit-branch-id": scope.branchId, ...extraHeaders }, body: JSON.stringify(body) });
      const parsed = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      return { ok: response.ok && parsed.ok === true, body: parsed };
    } catch (cause) {
      return { ok: false, body: { code: "PX_CLIENT_TRANSPORT", error: `The request did not complete: ${cause instanceof Error ? cause.message : String(cause)}` } };
    }
  }, [fetchImpl, scope]);

  const choose = useCallback((event: ChangeEvent<HTMLSelectElement>): void => {
    setChoice(Number(event.target.value));
    setPlan(null); setPlanKey(null); setSpent(false); setResult(null);
  }, []);

  const preview = useCallback(async (): Promise<void> => {
    if (!canAct || busy) return;
    const selected = PROVIDER_EXCHANGE_CHOICES[choice] ?? PROVIDER_EXCHANGE_CHOICES[0];
    setBusy(true);
    setResult(null);
    const answer = await call({ operation: "preview", designId: scope.designId, boardId: scope.boardId, expectedAuthorityRevision: authority.revision, expectedAuthorityDigest: authority.recordDigest, providerId: selected.providerId, operationId: selected.operationId, purpose: selected.purpose });
    if (answer.ok && answer.body.plan && typeof answer.body.plan === "object") {
      setPlan(answer.body.plan as PlanView);
      setPlanKey((newKey ?? (() => crypto.randomUUID()))());
      setSpent(false);
    } else {
      setPlan(null); setPlanKey(null);
      setResult(resultOf(answer.body));
    }
    setBusy(false);
  }, [canAct, busy, choice, call, scope, authority, newKey]);

  const commit = useCallback(async (): Promise<void> => {
    if (!canAct || busy || !plan || !planKey || spent) return;
    setBusy(true);
    const answer = await call({ operation: "commit", planId: plan.planId, planDigest: plan.planDigest, idempotencyKey: planKey }, { [COMMIT_HEADER]: COMMIT_OPT_IN });
    setSpent(true);
    setResult(resultOf(answer.body));
    setBusy(false);
  }, [canAct, busy, plan, planKey, spent, call]);

  return { choice, plan, spent, busy, result, choose, preview, commit };
}

export function ProviderExchangePanel(props: ProviderExchangePanelProps) {
  const exchange = useProviderExchange(props);
  const { canAct } = props;
  const plan = exchange.plan;
  return (
    <div className="mt-2 rounded border border-zinc-700 bg-zinc-950/60 px-2 py-1.5" data-testid="p2g-provider-panel">
      <div className="font-medium text-zinc-100">Provider exchange (DFM or quote)</div>
      <div className="mt-0.5 text-amber-200/90" data-testid="p2g-provider-notice">No provider is enabled in B23: Sirkit holds no provider account, so nothing is sent. Preview shows exactly which files and fields would leave Sirkit; a commit is refused.</div>{/* [B23-C] OD-170: the fixed notice, no control (ordering-enablement.ts ORDERING_DISABLED_NOTICE, pinned equal by b23-c-ordering-disabled) */}<div className="mt-0.5 text-amber-200/90" data-testid="p2g-ordering-notice">Ordering through Sirkit is turned off. The owner has not supplied a provider account, spending and quantity limits, a billing and shipping policy, authorized roles, cancellation and refund terms, legal and compliance requirements or a sandbox path, so nothing in Sirkit can order hardware or spend money.</div>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <label className="text-zinc-400" htmlFor="p2g-provider-choice">Provider and purpose</label>
        <select id="p2g-provider-choice" data-testid="p2g-provider-choice" value={exchange.choice} onChange={exchange.choose} disabled={exchange.busy} className="rounded border border-zinc-600 bg-zinc-900 px-1 py-0.5">
          {PROVIDER_EXCHANGE_CHOICES.map((entry, index) => <option key={`${entry.providerId}:${entry.operationId}`} value={index}>{entry.label}</option>)}
        </select>
        <button type="button" data-testid="p2g-provider-preview" onClick={exchange.preview} disabled={!canAct || exchange.busy} title={canAct ? "Ask the server which files and fields would leave Sirkit for this provider and purpose (nothing is sent)" : ADMIN_ONLY} className="rounded border border-zinc-600 px-2 py-1 hover:border-teal-500 disabled:opacity-50">
          Preview what would leave
        </button>
        <button type="button" data-testid="p2g-provider-commit" onClick={exchange.commit} disabled={!canAct || exchange.busy || !plan || exchange.spent} title={!canAct ? ADMIN_ONLY : !plan ? "Preview first: a commit names one exact previewed plan" : exchange.spent ? "This plan was committed once; preview again" : "Commit exactly this plan (the server refuses: no provider is enabled in B23)"} className="rounded border border-amber-500/60 px-2 py-1 text-amber-200 hover:border-amber-400 disabled:opacity-50">
          Commit this exact plan
        </button>
      </div>
      {!canAct && <div className="mt-1 text-zinc-400" data-testid="p2g-provider-capability">{ADMIN_ONLY}</div>}
      {plan && (
        <div className="mt-1 space-y-0.5 text-zinc-300" data-testid="p2g-provider-plan">
          <div>Provider <span className="font-mono">{plan.provider.displayName} ({plan.provider.providerId})</span> · operation <span className="font-mono">{plan.provider.operationId}</span> ({plan.provider.operationName}) · purpose <span className="font-mono">{plan.purpose}</span></div>
          <div>Descriptor v{plan.provider.descriptorVersion} <span className="font-mono">{plan.provider.descriptorDigest}</span></div>
          <div>Release <span className="font-mono">{plan.release.releaseId}</span> · archive sha256 <span className="font-mono">{plan.release.archiveSha256}</span></div>
          <div>Authority r{plan.authority.revision} <span className="font-mono">{plan.authority.recordDigest}</span> · board <span className="font-mono">{plan.authority.boardRevision}</span></div>
          <div className="text-zinc-200">Files that would leave Sirkit:</div>
          <ul className="ml-3 font-mono">
            {plan.outbound.files.map((file) => <li key={file.path}>{file.path} · {file.role} · {file.bytes} bytes · {file.sha256}</li>)}
            <li>{plan.outbound.manifest.path} · provider manifest · {plan.outbound.manifest.bytes} bytes · {plan.outbound.manifest.sha256}</li>
          </ul>
          <div>Fields that would leave: <span className="font-mono">{plan.outbound.fields.join(", ")}</span></div>
          {/* [B23-B1 review, 2026-10-04] what else leaves, as the server's plan says it (security-1, coverage-1) */}
          <div className="text-zinc-200">Sirkit identifiers that would leave inside file names or file bytes:</div>
          <ul className="ml-3" data-testid="p2g-provider-carried">
            {plan.outbound.carried.length === 0 && <li>none</li>}
            {plan.outbound.carried.map((entry) => <li key={`${entry.field}:${entry.value}`}><span className="font-mono">{entry.field}</span> as <span className="font-mono">{entry.value}</span> ({entry.form}) in the names of <span className="font-mono">{entry.names.join(", ") || "no file"}</span>; in the bytes of <span className="font-mono">{entry.bytes.join(", ") || "no file"}</span></li>)}
          </ul>
          <div className="text-zinc-200">Metadata inside the files that would leave:</div>
          <ul className="ml-3 font-mono" data-testid="p2g-provider-embedded">
            {[...new Set(plan.outbound.embedded.map((entry) => entry.field))].map((field) => <li key={field}>{field}: {plan.outbound.embedded.filter((entry) => entry.field === field).map((entry) => `${entry.value} (${entry.paths.length} ${entry.paths.length === 1 ? "file" : "files"})`).join(" · ")}</li>)}
          </ul>
          <div data-testid="p2g-provider-kept">Kept in Sirkit: <span className="font-mono">{[...plan.outbound.withheldFiles, ...plan.outbound.withheldFields].join(", ")}</span></div>
          <div>Package digest <span className="font-mono">{plan.outbound.outboundPackageDigest}</span> · request digest <span className="font-mono">{plan.requestDigest}</span> · expires <span className="font-mono">{plan.expiresAt}</span></div>
          <div className="text-amber-200/90">Admission: {plan.admission.admitted ? "admitted" : `not admitted (${plan.admission.refusal ?? "refused"})`} - {plan.admission.message}</div>
        </div>
      )}
      {exchange.result && (
        <div role="alert" className="mt-1 rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-red-200" data-testid="p2g-provider-result">
          <span className="font-medium">{exchange.result.code}</span>{exchange.result.refusal ? ` (${exchange.result.refusal})` : ""} - {exchange.result.message}
          {exchange.result.correlationId && <span className="ml-2 text-red-300/80">(correlation {exchange.result.correlationId})</span>}
        </div>
      )}
    </div>
  );
}
