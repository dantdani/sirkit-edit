/**
 * [B23-B1] Step 3 of B23-B, "require explicit user approval for the named provider and purpose" (runbook :977; D23-7, OD-164,
 * OD-166), over steps 1 and 2: the provider exchange's `preview` and `commit`.
 *
 *  - `preview` re-runs step 1 (the release route's `revalidateReleaseAuthority`, injected as a port), regenerates the release from
 *    the head authority, finds it in the release ledger, derives the exact outbound package (step 2, `buildOutboundPackage`) and
 *    answers a sealed outbound PLAN: provider id, descriptor version and digest, purpose (`dfm` or `quote`), operation, the exact
 *    file list with bytes and sha256, every metadata field, the release and authority identity, the request digest and an expiry
 *    10 minutes ahead. It sends nothing: no provider is asked anything, and admission is stated, never acted on.
 *  - `commit` takes `planId`, `planDigest` and an idempotency key (the route adds the opt-in header), refuses an expired plan, a
 *    digest that is not the plan's, a key reused for another plan and a consumed plan, consumes the plan ONCE, re-runs step 1 and
 *    step 2, refuses any moved input (the authority, the board, the profile, the release, the package or the provider descriptor),
 *    and only then asks admission. In B23 no provider is admitted (A1), so every commit ends refused `provider_not_admitted`. [B23-B2]
 *    Only past an admitting answer, with a reviewed transfer descriptor and the durable record, does `send` reach provider-egress.ts.
 *  - Only a human project administrator acts; every other actor is refused before any port (a durable read) is called.
 *
 * The shape is B22-B's sealed computation request (`app/lib/computation/requests.ts`): server-sealed digest and nonce, a human-only
 * exact-digest approval, consumed once; here the plan also names a provider and a purpose. Plans live in memory, as B22-B's
 * requests do (OD-183): a restart forgets them and a commit then refuses `PX_PLAN_NOT_FOUND` (preview again). [B23-B2] A send's outcome is durable (exchange-ledger.ts). [B23-B2 review, 2026-10-04] tests-3: after a restart a commit whose plan is gone answers what the durable record holds under its key (`recorded`), and only a key naming nothing there answers `PX_PLAN_NOT_FOUND`.
 *
 * [B23-B1 review, 2026-10-04] The stores are bounded per project (tenant, project, branch), each with a backstop over every project
 * together, and a bound REFUSES the new plan or commit (`PX_PLAN_LIMIT_REACHED`, `PX_KEY_LIMIT_REACHED`, 429): it never evicts a
 * live plan, so one project can no longer push another's plans out (security-3). An idempotency key is kept 24 hours after its
 * commit, apart from its plan, so a reused key is refused after its plan expired too (coverage-2). A throw while the commit re-runs
 * steps 1 and 2 ends the plan with the release route's bounded envelope, recorded as the key's outcome (tests-1). The plan lists
 * the ids whose values leave inside file names and bytes, and every metadata field the bytes carry (security-1, coverage-1).
 */
import { randomBytes } from "node:crypto";
import { durableWorkflowDigest } from "../durable-workflow/stable";
import type { ManufacturingReleaseArtifact, ManufacturingReleaseLocator } from "../pcb/fab/release-gate";
import type { ManufacturingReleaseRecord } from "../pcb/fab/release-ledger";
import { boundedManufacturingFailure } from "../pcb/fab/manufacturing-errors";
import { buildOutboundPackage, OUTBOUND_FIELD_PATHS, type CarriedIdentifier, type EmbeddedMetadata, type OutboundManifest, type OutboundPackage, type SourceIdentityField } from "./outbound-package";
import { admitProviderOperation } from "./provider-admission";
import { PROVIDER_REGISTRY_VERSION, PROVIDER_ROWS, type ProviderId, type ProviderRow } from "./provider-registry"; import { PROVIDER_TRANSFER_DESCRIPTORS, sendProviderExchange, transferDescriptorFor, type ProviderEgressDeps, type ProviderTransferDescriptor } from "./provider-egress"; import { exchangeAttemptInput, type ExchangeAttempt, type ProviderExchangeLedger } from "./exchange-ledger"; // [B23-B2] appended in place: the send and its durable record

export const PROVIDER_EXCHANGE_PLAN_SCHEMA = "sirkit.provider-exchange-plan.v1" as const;
/** A plan expires this long after its preview (OD-166). */
export const PROVIDER_EXCHANGE_PLAN_TTL_MS = 10 * 60_000;
export const PROVIDER_EXCHANGE_PURPOSES = Object.freeze(["dfm", "quote"] as const);
export type ProviderExchangePurpose = (typeof PROVIDER_EXCHANGE_PURPOSES)[number];
/** The commit's opt-in header and its one accepted value (the assignment queue's `apply_exact_plan` pattern). */
export const PROVIDER_EXCHANGE_COMMIT_HEADER = "x-sirkit-provider-exchange-commit";
export const PROVIDER_EXCHANGE_COMMIT_OPT_IN = "send_exact_plan";
/** The closed request bodies, per operation (OD-183: one route, a closed `operation` field). */
export const PROVIDER_EXCHANGE_PREVIEW_KEYS: ReadonlySet<string> = new Set(["operation", "designId", "boardId", "expectedAuthorityRevision", "expectedAuthorityDigest", "providerId", "operationId", "purpose"]);
export const PROVIDER_EXCHANGE_COMMIT_KEYS: ReadonlySet<string> = new Set(["operation", "planId", "planDigest", "idempotencyKey"]);
/** Authority-shaped keys a client may never send, refused before anything else: identity and scope, content, and egress. */
export const PROVIDER_EXCHANGE_FORBIDDEN_KEYS = Object.freeze(["tenantId", "projectId", "branchId", "actor", "actorId", "actorKind", "role", "board", "snapshot", "path", "files", "archive", "manifest", "package", "bytes", "url", "host", "endpoint", "headers", "credentials"] as const);

/**
 * The reviewed board-file exchanges (OD-183): a provider's `dfm_quote_transfer` operation that takes the board's design files, with
 * the purpose it serves. PCBWay's PcbQuotation takes parameters only (no file), its SMT quotation and DigiKey's Quote-v4 take a BOM
 * (a bare board sends none), and MacroFab's `upload` is the transport step of its two operations, not a purpose of its own.
 */
export const BOARD_FILE_EXCHANGES: ReadonlyArray<{ readonly providerId: ProviderId; readonly operationId: string; readonly purpose: ProviderExchangePurpose }> = Object.freeze([
  { providerId: "jlcpcb", operationId: "pcb-quote", purpose: "quote" },
  { providerId: "oshpark", operationId: "import-upload", purpose: "quote" },
  { providerId: "oshpark", operationId: "api-upload", purpose: "quote" },
  { providerId: "macrofab", operationId: "dfm-readiness", purpose: "dfm" },
  { providerId: "macrofab", operationId: "pcb-quote", purpose: "quote" },
].map((entry) => Object.freeze(entry as { providerId: ProviderId; operationId: string; purpose: ProviderExchangePurpose })));

/** The exchange's own closed refusal vocabulary; step 1 and the release gate answer with their own `MFG_*` codes. */
export const PROVIDER_EXCHANGE_ERRORS = Object.freeze({
  PX_HUMAN_ADMIN_REQUIRED: { status: 403, message: "A provider exchange is a human project administrator's act. Nothing was sent." },
  PX_API_OPERATION_REQUIRED: { status: 400, message: "operation must be \"preview\" or \"commit\"." },
  PX_API_UNKNOWN_FIELD: { status: 400, message: "The request body carries a field this operation does not accept." },
  PX_API_SCOPE_REQUIRED: { status: 400, message: "designId and boardId are required." },
  PX_EXCHANGE_NOT_OFFERED: { status: 422, message: "This provider, operation and purpose is not a reviewed board-file exchange." },
  PX_RELEASE_NOT_LEDGERED: { status: 409, message: "The current authority's release is not in the release ledger. Release it first: only a ledgered release can leave Sirkit." },
  PX_PACKAGE_REFUSED: { status: 409, message: "The regenerated release does not match its ledger record, so no outbound package exists. Nothing was sent." },
  PX_COMMIT_OPT_IN_REQUIRED: { status: 403, message: "A commit needs the explicit opt-in header for the exact plan. Nothing was sent." },
  PX_PLAN_REQUIRED: { status: 400, message: "A commit needs planId, planDigest and idempotencyKey." },
  PX_PLAN_NOT_FOUND: { status: 404, message: "No such plan exists for this project. Preview again." },
  PX_PLAN_DIGEST_MISMATCH: { status: 409, message: "planDigest is not this plan's digest. Nothing was sent." },
  PX_PLAN_EXPIRED: { status: 409, message: "The plan expired (10 minutes after its preview). Preview again." },
  PX_PLAN_CONSUMED: { status: 409, message: "The plan was already committed once. Preview again." },
  PX_PLAN_INPUT_MOVED: { status: 409, message: "The release, its outbound package or the provider descriptor changed since the preview. Preview again. Nothing was sent." },
  PX_IDEMPOTENCY_KEY_REUSE_CONFLICT: { status: 409, message: "This idempotency key was used for another plan. Nothing was sent." },
  PX_PROVIDER_NOT_ADMITTED: { status: 409, message: "The provider is not admitted for this exchange: no provider is enabled in B23 (no owner account). Nothing was sent." },
  PX_SEND_UNAVAILABLE: { status: 409, message: "No reviewed transfer descriptor or durable exchange record exists for this provider operation (none in B23). Nothing was sent." }, // [B23-B2] was: "No transfer exists in this build."
  // [B23-B1 review, 2026-10-04] the stores' bounds refuse; they never evict (security-3, coverage-2)
  PX_PLAN_LIMIT_REACHED: { status: 429, message: "This project holds as many open plans as one project may, or the server holds as many as it may. Commit one or let one expire (10 minutes after its preview), then preview again. Nothing was sent." },
  PX_KEY_LIMIT_REACHED: { status: 429, message: "This project has recorded as many commits as one project may in 24 hours, or the server as many as it may. Try again later. Nothing was sent, and the plan was not consumed." }, /* [B23-B2] a send's outcomes (OD-167), answered in the same envelope: */ PX_EXCHANGE_ACKNOWLEDGED: { status: 200, message: "The provider acknowledged the exchange and its receipt is recorded. An acknowledgement is the provider's observation, never Sirkit proof." }, PX_EXCHANGE_REJECTED: { status: 422, message: "The provider refused the exchange; the answer's status and digest are recorded. It is never retried: preview again to send again." }, PX_EXCHANGE_UNKNOWN_PENDING_RECONCILIATION: { status: 502, message: "The files were handed to the provider but its answer is unknown (a timeout, an abort, a transport error, a server error or an unreadable answer). The exchange is UNKNOWN_PENDING_RECONCILIATION: it is never retried, and a person reconciles it with the provider." }, PX_EXCHANGE_NOT_SENT: { status: 503, message: "The exchange stopped before any byte left Sirkit. Nothing was sent. Preview again." }, PX_PROVIDER_PAUSED: { status: 429, message: "The provider is paused by its quota or its breaker. Nothing was sent. Preview again later." }, PX_EXCHANGE_IN_FLIGHT: { status: 409, message: "An exchange of this package to this provider, or under this idempotency key, is recorded without an answer. If its files may have left (state sent), it is never sent again until a person reconciles it with the provider; if it was recorded before any byte left (state prepared), it stops blocking ten minutes after it was prepared, when the next preview and commit of the package settles it not sent. Nothing was sent by this request." }, PX_EXCHANGE_CONTENDED: { status: 409, message: "The exchange record kept moving under concurrent commits, so this exchange was not recorded. Nothing was sent. Preview again." }, // [B23-B2 lead, 2026-10-04] low-2: PX_EXCHANGE_NOT_SENT no longer says the exchange was recorded (it is also the answer with recorded false); PX_EXCHANGE_IN_FLIGHT says when a prepared attempt stops blocking
} satisfies Record<string, { status: number; message: string }>);
export type ProviderExchangeErrorCode = keyof typeof PROVIDER_EXCHANGE_ERRORS;

/** The bounded refusal envelope (`manufacturingRefusal`'s shape): a fixed message per code, the correlation id, bounded extras. */
export function providerExchangeRefusal(code: ProviderExchangeErrorCode, options: { correlationId?: string; extra?: Record<string, unknown> } = {}): Response {
  const refusal = refusalBody(code, options.correlationId ?? "", options.extra);
  return Response.json(refusal.body, { status: refusal.status, headers: { "Cache-Control": "no-store", ...(options.correlationId ? { "X-Sirkit-Correlation-Id": options.correlationId } : {}) } });
}

export interface ProviderExchangeScope { readonly tenantId: string; readonly projectId: string; readonly branchId: string }
/** The SERVER-derived actor of the request (never a body claim). */
export interface ProviderExchangeActor { readonly actorId: string; readonly actorKind: string; readonly role: string }
/** A refusal the route answers as it is: its status and its whole JSON body. */
export interface ProviderExchangeRefusal { readonly status: number; readonly code: string; readonly body: Readonly<Record<string, unknown>> }

/** The durable reads and the regeneration, injected (the route composes them from the release route and the durable stores). */
export interface ProviderExchangePorts {
  /** Step 1: the release route's `revalidateReleaseAuthority`; a refusal is its own bounded Response. */
  revalidate(input: { scope: ProviderExchangeScope; designId: string; boardId: string; expectedAuthorityRevision: unknown; expectedAuthorityDigest: unknown }): Promise<
    | { ok: true; authority: { revision: number; recordDigest: string; boardRevision: string; boardDigest: string }; locator: ManufacturingReleaseLocator }
    | { ok: false; response: Response }
  >;
  /** The release gate's regeneration from the head authority (no ledger write, no archive re-read). */
  regenerate(locator: ManufacturingReleaseLocator): Promise<Pick<ManufacturingReleaseArtifact, "releaseId" | "filename" | "archiveBytes" | "archiveSha256" | "manifest" | "files">>;
  /** The release ledger's records for the board. */
  ledger(scope: ProviderExchangeScope & { designId: string; boardId: string }): Promise<readonly ManufacturingReleaseRecord[]>; /** [B23-B2] the durable exchange record (OD-167); without it nothing is sent */ exchangeLedger?: ProviderExchangeLedger;
}

export interface ProviderExchangePlan {
  readonly schema: typeof PROVIDER_EXCHANGE_PLAN_SCHEMA;
  readonly planId: string;
  /** stays in Sirkit: the project the plan belongs to */
  readonly scope: ProviderExchangeScope;
  readonly designId: string;
  readonly boardId: string;
  readonly provider: { readonly providerId: ProviderId; readonly displayName: string; readonly operationId: string; readonly operationName: string; readonly descriptorVersion: string; readonly descriptorDigest: string };
  readonly purpose: ProviderExchangePurpose;
  readonly release: { readonly releaseId: string; readonly archiveSha256: string; readonly manifestContentDigest: string; readonly filename: string };
  readonly authority: { readonly revision: number; readonly recordDigest: string; readonly boardRevision: string; readonly boardDigest: string };
  readonly outbound: {
    /** exactly the files that would leave, with their sizes and SHA-256 */
    readonly files: ReadonlyArray<{ readonly path: string; readonly role: string; readonly kind: string; readonly mediaType: string; readonly bytes: number; readonly sha256: string }>;
    /** the generated provider manifest that would leave beside them */
    readonly manifest: { readonly path: string; readonly bytes: number; readonly sha256: string };
    /** every metadata field that would leave: the provider manifest itself */
    readonly metadata: OutboundManifest;
    readonly fields: readonly string[];
    readonly withheldFiles: readonly string[];
    /** [B23-B1 review, 2026-10-04] only the identity fields whose value occurs in no outbound name or byte */
    readonly withheldFields: readonly SourceIdentityField[];
    /** [B23-B1 review, 2026-10-04] the identities whose value leaves inside a file name or byte, with every place it is (never "kept") */
    readonly carried: readonly CarriedIdentifier[];
    /** [B23-B1 review, 2026-10-04] every metadata field the outbound file bytes carry, verbatim, with the files that carry it */
    readonly embedded: readonly EmbeddedMetadata[];
    readonly outboundPackageDigest: string;
  };
  /** the identity of what would be sent where, for what */
  readonly requestDigest: string;
  /** admission as stated at preview; preview never acts on it */
  readonly admission: { readonly admitted: boolean; readonly refusal: string | null; readonly message: string };
  readonly createdBy: { readonly actorId: string };
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly planDigest: string;
}

export type ProviderExchangeAnswer = { readonly ok: true; readonly plan: ProviderExchangePlan } | { readonly ok: false; readonly refusal: ProviderExchangeRefusal };

const PLAN_KEYS = ["schema", "planId", "scope", "designId", "boardId", "provider", "purpose", "release", "authority", "outbound", "requestDigest", "admission", "createdBy", "createdAt", "expiresAt", "planDigest"] as const;
const ID_TEXT = /^[A-Za-z0-9._:@/-]{1,200}$/;
const KEY_TEXT = /^[A-Za-z0-9._:-]{1,128}$/;
const NONCE = /^[0-9a-f]{32}$/;
/** [B23-B1 review, 2026-10-04] The stores' bounds (OD-183 (d)): per project scope, and a backstop over every project together. Reaching
 *  one refuses the new plan or commit; nothing live is ever evicted (security-3). Expired plans are dropped before any count. [B23-B1 lead, 2026-10-04] low-1: the plan backstop counts open plans only, and keysPerProject is 256 (was 1,024: 16 scopes filled the key backstop), so filling either backstop takes 64 scopes each at its own bound. */
export const PROVIDER_EXCHANGE_LIMITS: Readonly<Record<"plansPerProject" | "plans" | "keysPerProject" | "keys", number>> = Object.freeze({ plansPerProject: 32, plans: 2048, keysPerProject: 256, keys: 16_384 });
/** [B23-B1 review, 2026-10-04] An idempotency key is kept this long after its commit, whatever becomes of its plan (coverage-2). */
export const PROVIDER_EXCHANGE_KEY_RETENTION_MS = 24 * 60 * 60_000;

function refusalBody(code: ProviderExchangeErrorCode, correlationId: string, extra?: Record<string, unknown>): ProviderExchangeRefusal {
  const entry = PROVIDER_EXCHANGE_ERRORS[code];
  return { status: entry.status, code, body: { ok: false, code, error: entry.message, ...(correlationId ? { correlationId } : {}), ...(extra ?? {}) } };
}
const refused = (code: ProviderExchangeErrorCode, correlationId: string, extra?: Record<string, unknown>): ProviderExchangeAnswer => ({ ok: false, refusal: refusalBody(code, correlationId, extra) });
async function fromResponse(response: Response): Promise<ProviderExchangeRefusal> {
  const body = (await response.clone().json().catch(() => ({}))) as Record<string, unknown>;
  return { status: response.status, code: typeof body.code === "string" ? body.code : `HTTP_${response.status}`, body };
}
const isHumanAdmin = (actor: ProviderExchangeActor | null | undefined): boolean => actor?.actorKind === "human" && actor.role === "project_admin";
const sameScope = (a: ProviderExchangeScope, b: ProviderExchangeScope): boolean => a.tenantId === b.tenantId && a.projectId === b.projectId && a.branchId === b.branchId;
const scopeKeyOf = (scope: ProviderExchangeScope): string => `${scope.tenantId}\0${scope.projectId}\0${scope.branchId}`;
const planDigestOf = (plan: Omit<ProviderExchangePlan, "planDigest">): string => durableWorkflowDigest(plan);

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

/** Why a value is not an intact sealed plan (empty: it is). Recomputes the digest; never throws. */
export function verifyProviderExchangePlan(plan: ProviderExchangePlan): string[] {
  try {
    const keys = Object.keys(plan);
    if (keys.length !== PLAN_KEYS.length || !PLAN_KEYS.every((key) => keys.includes(key))) return ["the plan's keys are not the closed set"];
    const { planDigest, ...body } = plan;
    return planDigestOf(body) === planDigest ? [] : ["the plan digest does not match its content"];
  } catch {
    return ["the plan cannot be read"];
  }
}

interface StoredPlan { plan: ProviderExchangePlan | null; readonly owner: ProviderExchangeScope; readonly planDigest: string; readonly expiresAt: number; readonly scope: string; consumed: boolean } // [B23-B1 lead, 2026-10-04] low-1: a consumed plan keeps only this tombstone (plan null) until it expires
/** [B23-B1 review, 2026-10-04] `scope` and `at` (the commit instant) keep the record apart from its plan's lifetime (coverage-2). */
interface KeyedOutcome { readonly planId: string; readonly planDigest: string; readonly scope: string; readonly at: number; outcome: ProviderExchangeRefusal | null }

export interface ProviderExchangeServiceOptions {
  /** the reviewed registry (a getter lets a test show a later revision moving a plan's descriptor) */
  registry?: readonly ProviderRow[] | (() => readonly ProviderRow[]);
  /** the environment admission reads (its operator switch); never a value is echoed */
  env?: Readonly<Record<string, string | undefined>>;
  now?: () => number;
  /** 32 hex characters from the server (B22-B's sealed-request nonce) */
  nonce?: () => string;
  admit?: typeof admitProviderOperation;
  /** [B23-B1 review, 2026-10-04] the stores' bounds (tests narrow them); `PROVIDER_EXCHANGE_LIMITS` otherwise */
  limits?: Partial<typeof PROVIDER_EXCHANGE_LIMITS>; /** [B23-B2] the reviewed transfer descriptors (PROVIDER_TRANSFER_DESCRIPTORS otherwise: none in B23) and the egress's injection (tests) */ transfer?: { readonly descriptors?: readonly ProviderTransferDescriptor[] | (() => readonly ProviderTransferDescriptor[]); readonly egress?: ProviderEgressDeps };
}

/** The exchange service: a module-level instance in the route holds the plans; the ports are passed per request. */
export class ProviderExchangeService {
  private readonly plans = new Map<string, StoredPlan>();
  private readonly keys = new Map<string, KeyedOutcome>();
  private readonly registry: () => readonly ProviderRow[];
  private readonly env: Readonly<Record<string, string | undefined>>;
  private readonly now: () => number;
  private readonly nonce: () => string;
  private readonly admit: typeof admitProviderOperation;
  private readonly limits: typeof PROVIDER_EXCHANGE_LIMITS; private readonly descriptors: () => readonly ProviderTransferDescriptor[]; private readonly egress: ProviderEgressDeps; // [B23-B2]

  constructor(options: ProviderExchangeServiceOptions = {}) {
    const registry = options.registry ?? PROVIDER_ROWS;
    this.registry = typeof registry === "function" ? registry : () => registry;
    this.env = options.env ?? {};
    this.now = options.now ?? (() => Date.now());
    this.nonce = options.nonce ?? (() => randomBytes(16).toString("hex"));
    this.admit = options.admit ?? admitProviderOperation;
    this.limits = Object.freeze({ ...PROVIDER_EXCHANGE_LIMITS, ...(options.limits ?? {}) }); const descriptors = options.transfer?.descriptors ?? PROVIDER_TRANSFER_DESCRIPTORS; this.descriptors = typeof descriptors === "function" ? descriptors : () => descriptors; this.egress = options.transfer?.egress ?? {}; // [B23-B2]
  }

  /** Step 1, step 2 and the sealed plan. Sends nothing. */
  async preview(input: { actor: ProviderExchangeActor; scope: ProviderExchangeScope; request: Record<string, unknown>; ports: ProviderExchangePorts; correlationId: string }): Promise<ProviderExchangeAnswer> {
    const { actor, request, ports, correlationId } = input;
    if (!isHumanAdmin(actor)) return refused("PX_HUMAN_ADMIN_REQUIRED", correlationId);
    const exchange = BOARD_FILE_EXCHANGES.find((entry) => entry.providerId === request.providerId && entry.operationId === request.operationId && entry.purpose === request.purpose);
    const row = exchange ? this.registry().find((candidate) => candidate.id === exchange.providerId) : undefined;
    const operation = row?.operations.find((candidate) => candidate.id === exchange!.operationId);
    if (!exchange || !row || operation?.tier !== "dfm_quote_transfer") return refused("PX_EXCHANGE_NOT_OFFERED", correlationId);
    const designId = request.designId, boardId = request.boardId;
    if (typeof designId !== "string" || !ID_TEXT.test(designId) || typeof boardId !== "string" || !ID_TEXT.test(boardId)) return refused("PX_API_SCOPE_REQUIRED", correlationId);
    const scope: ProviderExchangeScope = { tenantId: input.scope.tenantId, projectId: input.scope.projectId, branchId: input.scope.branchId };
    // [B23-B1 review, 2026-10-04] a project at its bound (or a full store) is refused before any port; no live plan is evicted
    if (!this.hasPlanRoom(scopeKeyOf(scope), this.now())) return refused("PX_PLAN_LIMIT_REACHED", correlationId);
    const prepared = await this.prepare({ scope, designId, boardId, expectedAuthorityRevision: request.expectedAuthorityRevision, expectedAuthorityDigest: request.expectedAuthorityDigest, ports, correlationId });
    if (!prepared.ok) return prepared;
    const descriptorDigest = durableWorkflowDigest(row);
    const admission = this.admit(this.registry(), row.id, operation.id, this.env);
    const now = this.now();
    const nonce = this.nonce();
    if (!NONCE.test(nonce) || !Number.isSafeInteger(now) || now <= 0) throw new Error("PX_PLAN_SEAL_INPUT_INVALID");
    const createdAt = new Date(now).toISOString();
    const pkg = prepared.package;
    const provider = { providerId: row.id, displayName: row.displayName, operationId: operation.id, operationName: operation.providerName, descriptorVersion: PROVIDER_REGISTRY_VERSION, descriptorDigest };
    const body: Omit<ProviderExchangePlan, "planDigest"> = {
      schema: PROVIDER_EXCHANGE_PLAN_SCHEMA,
      planId: `provider-exchange-plan:${durableWorkflowDigest({ nonce, scope, designId, boardId, createdAt }).slice(4, 36)}`,
      scope,
      designId,
      boardId,
      provider,
      purpose: exchange.purpose,
      release: { releaseId: prepared.release.releaseId, archiveSha256: prepared.release.archiveSha256, manifestContentDigest: prepared.release.manifestContentDigest, filename: prepared.release.filename },
      authority: { ...prepared.authority },
      outbound: {
        files: pkg.files.map(({ path, role, kind, mediaType, bytes, sha256 }) => ({ path, role, kind, mediaType, bytes, sha256 })),
        manifest: { path: pkg.manifest.path, bytes: pkg.manifest.bytes, sha256: pkg.manifest.sha256 },
        metadata: pkg.manifest.value,
        fields: [...OUTBOUND_FIELD_PATHS],
        withheldFiles: [...pkg.withheld.files],
        withheldFields: [...pkg.withheld.fields],
        carried: pkg.disclosure.carried.map((entry) => ({ ...entry, names: [...entry.names], bytes: [...entry.bytes] })),
        embedded: pkg.disclosure.embedded.map((entry) => ({ ...entry, paths: [...entry.paths] })),
        outboundPackageDigest: pkg.outboundPackageDigest,
      },
      requestDigest: durableWorkflowDigest({ providerId: row.id, operationId: operation.id, purpose: exchange.purpose, descriptorVersion: PROVIDER_REGISTRY_VERSION, descriptorDigest, outboundPackageDigest: pkg.outboundPackageDigest, releaseId: prepared.release.releaseId, archiveSha256: prepared.release.archiveSha256 }),
      admission: admission.admitted ? { admitted: true, refusal: null, message: `${row.displayName} ${operation.id} is admitted.` } : { admitted: false, refusal: admission.refusal, message: admission.message },
      createdBy: { actorId: actor.actorId },
      createdAt,
      expiresAt: new Date(now + PROVIDER_EXCHANGE_PLAN_TTL_MS).toISOString(),
    };
    const plan = deepFreeze({ ...structuredClone(body), planDigest: planDigestOf(body) });
    // re-checked after the awaits: concurrent previews of one project never exceed its bound
    if (!this.hasPlanRoom(scopeKeyOf(scope), now)) return refused("PX_PLAN_LIMIT_REACHED", correlationId);
    this.plans.set(plan.planId, { plan, owner: plan.scope, planDigest: plan.planDigest, expiresAt: Date.parse(plan.expiresAt), scope: scopeKeyOf(scope), consumed: false });
    return { ok: true, plan };
  }

  /** Approve the exact plan: consumed once, steps 1 and 2 re-run, then admission. In B23 it always ends refused; nothing is sent. [B23-B2] Past an admitting answer, `send`; the answer is always the recorded envelope (`refusal`): a refusal, or a send's outcome (`body.ok` only when acknowledged). */
  async commit(input: { actor: ProviderExchangeActor; scope: ProviderExchangeScope; request: Record<string, unknown>; ports: ProviderExchangePorts; correlationId: string }): Promise<ProviderExchangeAnswer> {
    const { actor, request, ports, correlationId } = input;
    if (!isHumanAdmin(actor)) return refused("PX_HUMAN_ADMIN_REQUIRED", correlationId);
    const planId = request.planId, planDigest = request.planDigest, key = request.idempotencyKey;
    if (typeof planId !== "string" || !ID_TEXT.test(planId) || typeof planDigest !== "string" || !ID_TEXT.test(planDigest) || typeof key !== "string" || !KEY_TEXT.test(key)) return refused("PX_PLAN_REQUIRED", correlationId);
    const now = this.now();
    this.sweepKeys(now);
    const scopeKey = scopeKeyOf(input.scope);
    const keyed = this.keys.get(`${scopeKey}\0${key}`);
    if (keyed) {
      if (keyed.planId !== planId || keyed.planDigest !== planDigest) return refused("PX_IDEMPOTENCY_KEY_REUSE_CONFLICT", correlationId);
      if (keyed.outcome) return { ok: false, refusal: { ...keyed.outcome, body: { ...keyed.outcome.body, ...(correlationId ? { correlationId } : {}), idempotent: true } } };
      return refused("PX_PLAN_CONSUMED", correlationId);
    }
    const stored = this.plans.get(planId);
    if (!stored || !sameScope(stored.owner, input.scope)) return this.recorded(input.scope, { planId, planDigest, key }, ports, correlationId); // [B23-B2 review, 2026-10-04] tests-3: the durable record, else PX_PLAN_NOT_FOUND
    const plan = stored.plan; // [B23-B1 lead, 2026-10-04] low-1: null once consumed; the tombstone answers in the same order as the plan did
    if (planDigest !== stored.planDigest || (plan !== null && verifyProviderExchangePlan(plan).length > 0)) return refused("PX_PLAN_DIGEST_MISMATCH", correlationId);
    if (now >= stored.expiresAt) return refused("PX_PLAN_EXPIRED", correlationId);
    if (stored.consumed || plan === null) return refused("PX_PLAN_CONSUMED", correlationId);
    // [B23-B1 review, 2026-10-04] a project at its key bound is refused BEFORE the plan is consumed: no key is ever dropped early
    if (!this.hasKeyRoom(scopeKey)) return refused("PX_KEY_LIMIT_REACHED", correlationId);
    // consumed ONCE, before any await: a second commit of this plan (another key, or a racing request) finds it consumed
    stored.consumed = true; stored.plan = null; // [B23-B1 lead, 2026-10-04] low-1: the body is dropped; the commit holds it below
    const record: KeyedOutcome = { planId, planDigest, scope: scopeKey, at: now, outcome: null };
    this.keys.set(`${scopeKey}\0${key}`, record);
    let outcome: ProviderExchangeRefusal;
    try {
      outcome = await this.approve(plan, ports, correlationId, { key, actorId: actor.actorId }); // [B23-B2] the key and the committing administrator name the durable attempt
    } catch (error) {
      // [B23-B1 review, 2026-10-04] tests-1: a thrown durable read or release-gate refusal ends this plan with the release route's
      // bounded envelope (its code, status and fixed wording), recorded as the key's outcome: a same-key retry replays it
      outcome = await fromResponse(boundedManufacturingFailure(error, "release", correlationId));
    }
    record.outcome = outcome;
    return { ok: false, refusal: outcome };
  }

  private async approve(plan: ProviderExchangePlan, ports: ProviderExchangePorts, correlationId: string, commit: { readonly key: string; readonly actorId: string }): Promise<ProviderExchangeRefusal> {
    const prepared = await this.prepare({ scope: plan.scope, designId: plan.designId, boardId: plan.boardId, expectedAuthorityRevision: plan.authority.revision, expectedAuthorityDigest: plan.authority.recordDigest, ports, correlationId });
    if (!prepared.ok) return prepared.refusal;
    const row = this.registry().find((candidate) => candidate.id === plan.provider.providerId);
    const moved = !row
      || durableWorkflowDigest(row) !== plan.provider.descriptorDigest
      || prepared.release.releaseId !== plan.release.releaseId
      || prepared.release.archiveSha256 !== plan.release.archiveSha256
      || prepared.package.outboundPackageDigest !== plan.outbound.outboundPackageDigest
      || prepared.authority.boardRevision !== plan.authority.boardRevision
      || prepared.authority.boardDigest !== plan.authority.boardDigest;
    const facts = { planId: plan.planId, requestDigest: plan.requestDigest, sent: false };
    if (moved) return refusalBody("PX_PLAN_INPUT_MOVED", correlationId, facts);
    const admission = this.admit(this.registry(), plan.provider.providerId, plan.provider.operationId, this.env);
    if (!admission.admitted) return refusalBody("PX_PROVIDER_NOT_ADMITTED", correlationId, { ...facts, refusal: admission.refusal, admission: admission.message, idempotent: false });
    // [B23-B2] past admission, and only here: the bounded send and its durable record (B23-B1 had no transport in this module)
    return this.send(plan, prepared.package, ports, correlationId, commit);
  }

  /** Steps 1 and 2 against the durable truth of the moment: revalidate, regenerate, find the ledger record, derive the package. */
  private async prepare(input: { scope: ProviderExchangeScope; designId: string; boardId: string; expectedAuthorityRevision: unknown; expectedAuthorityDigest: unknown; ports: ProviderExchangePorts; correlationId: string }) {
    const revalidated = await input.ports.revalidate({ scope: input.scope, designId: input.designId, boardId: input.boardId, expectedAuthorityRevision: input.expectedAuthorityRevision, expectedAuthorityDigest: input.expectedAuthorityDigest });
    if (!revalidated.ok) return { ok: false as const, refusal: await fromResponse(revalidated.response) };
    const release = await input.ports.regenerate(revalidated.locator);
    const records = await input.ports.ledger({ ...input.scope, designId: input.designId, boardId: input.boardId });
    const ledger = records.find((record) => record.releaseId === release.releaseId) ?? null;
    if (!ledger) return { ok: false as const, refusal: refusalBody("PX_RELEASE_NOT_LEDGERED", input.correlationId) };
    const built = buildOutboundPackage({ release, ledger });
    if (!built.ok) return { ok: false as const, refusal: refusalBody("PX_PACKAGE_REFUSED", input.correlationId, { refusal: built.refusal }) };
    return {
      ok: true as const,
      authority: revalidated.authority,
      release: { releaseId: release.releaseId, archiveSha256: release.archiveSha256, manifestContentDigest: release.manifest.manifestContentDigest, filename: release.filename },
      package: built.package,
    };
  }

  /** [B23-B1 review, 2026-10-04] Drops the expired plans (only plans: a key record outlives its plan), then whether `scope` may hold another. */
  private hasPlanRoom(scope: string, now: number): boolean {
    for (const [id, stored] of this.plans) if (now >= stored.expiresAt) this.plans.delete(id);
    let open = 0, openAll = 0; // [B23-B1 lead, 2026-10-04] low-1: the backstop counts open plans only; a consumed plan's tombstone is bounded by its key record
    for (const stored of this.plans.values()) if (!stored.consumed) { openAll += 1; if (stored.scope === scope) open += 1; }
    return open < this.limits.plansPerProject && openAll < this.limits.plans;
  }

  /** [B23-B1 review, 2026-10-04] Drops the key records older than the retention (24 hours after their commit). */
  private sweepKeys(now: number): void {
    for (const [key, record] of this.keys) if (now - record.at >= PROVIDER_EXCHANGE_KEY_RETENTION_MS) this.keys.delete(key);
  }

  /** [B23-B1 review, 2026-10-04] Whether `scope` may record another commit's key. */
  private hasKeyRoom(scope: string): boolean {
    let held = 0;
    for (const record of this.keys.values()) if (record.scope === scope) held += 1;
    return held < this.limits.keysPerProject && this.keys.size < this.limits.keys;
  }

  /** [B23-B1 review, 2026-10-04] What the stores hold, overall or for one project (a read: nothing is dropped). */
  heldCounts(scope?: ProviderExchangeScope): { plans: number; openPlans: number; keys: number } {
    const key = scope ? scopeKeyOf(scope) : null;
    const plans = [...this.plans.values()].filter((stored) => key === null || stored.scope === key);
    return { plans: plans.length, openPlans: plans.filter((stored) => !stored.consumed).length, keys: [...this.keys.values()].filter((record) => key === null || record.scope === key).length };
  }

  /**
   * [B23-B2] Steps 4 and 5 (D23-3, D23-4, D23-5; OD-165, OD-167), reached only from `approve`: the plan was consumed, steps 1 and 2
   * re-ran on the durable truth and admission admitted. A reviewed transfer descriptor and the durable record are both required. The
   * attempt is recorded `prepared` first (a repeated or concurrent commit of its key replays the record and sends nothing), `sent`
   * immediately before the hand-over, and its terminal state after. Nothing is retried and nothing goes through the outbox.
   */
  private async send(plan: ProviderExchangePlan, built: OutboundPackage, ports: ProviderExchangePorts, correlationId: string, commit: { readonly key: string; readonly actorId: string }): Promise<ProviderExchangeRefusal> {
    const facts = { planId: plan.planId, requestDigest: plan.requestDigest };
    const descriptor = transferDescriptorFor(this.descriptors(), this.registry(), plan.provider.providerId, plan.provider.operationId);
    const ledger = ports.exchangeLedger;
    if (descriptor === null || ledger === undefined) return refusalBody("PX_SEND_UNAVAILABLE", correlationId, { ...facts, sent: false, idempotent: false });
    const aggregate = { scope: plan.scope, designId: plan.designId, boardId: plan.boardId, providerId: plan.provider.providerId };
    const at = (): string => new Date(this.now()).toISOString();
    const begun = await ledger.prepare({ aggregate, at: at(), attempt: exchangeAttemptInput({ plan, key: commit.key, actorId: commit.actorId, descriptor, capabilityProfile: built.manifest.value.capabilityProfile }) });
    // [B23-B2 review, 2026-10-04] coverage-2: another attempt of this package to this provider is in flight or interrupted: nothing is sent
    if (!begun.ok && begun.code === "in_flight") return refusalBody("PX_EXCHANGE_IN_FLIGHT", correlationId, { ...facts, sent: false, inFlight: { planId: begun.attempt.planId, state: begun.attempt.state, preparedAt: begun.attempt.preparedAt, sentAt: begun.attempt.sentAt }, idempotent: false });
    if (!begun.ok) return refusalBody(begun.code === "key_reuse_conflict" ? "PX_IDEMPOTENCY_KEY_REUSE_CONFLICT" : begun.code === "contended" ? "PX_EXCHANGE_CONTENDED" : "PX_SEND_UNAVAILABLE", correlationId, { ...facts, sent: false, idempotent: false });
    if (begun.replayed) return exchangeEnvelope(begun.attempt, facts, correlationId, true);
    // [B23-B2 review, 2026-10-04] security-2: the provider sees the record's server-derived key, never the client's string
    const marking: { pending: Promise<unknown> | null } = { pending: null };
    const outcome = await sendProviderExchange({ descriptor, package: built, idempotencyKey: begun.attempt.providerIdempotencyKey, env: this.env, beforeSend: (request) => { const mark = ledger.markSent({ aggregate, idempotencyKey: commit.key, request, at: at() }); marking.pending = mark; return mark.then(() => undefined); } }, { ...this.egress, clock: this.now });
    // [B23-B2 review, 2026-10-04] regressions-1: a `sent` mark still being written when the deadline fell lands before the outcome is
    // recorded (nothing was handed over: the record settles it not_sent); never two writes of one attempt at once
    if (marking.pending !== null && !outcome.sendStarted) await marking.pending.catch(() => undefined);
    // [B23-B2 review, 2026-10-04] coverage-1: the settle is a durable write, never a send, so it is retried a bounded number of times
    for (let tries = 0; tries < PROVIDER_EXCHANGE_SETTLE_ATTEMPTS; tries += 1) {
      try {
        return exchangeEnvelope(await ledger.settle({ aggregate, idempotencyKey: commit.key, outcome, at: at() }), facts, correlationId, false);
      } catch {
        // retried below; the record still says `sent` (or `prepared`) until a settle lands
      }
    }
    // the answer could not be recorded: this request answers what the record can stand for - pending reconciliation when bytes left,
    // not sent otherwise; never a retry of the send. What the provider answered (its receipt id and the response's status, size and
    // digest; never the raw body) travels in the answer, so a person can reconcile it (coverage-1)
    const response = outcome.response === null ? null : { status: outcome.response.status, bytes: outcome.response.bytes, sha256: outcome.response.sha256 };
    return refusalBody(outcome.sendStarted ? "PX_EXCHANGE_UNKNOWN_PENDING_RECONCILIATION" : "PX_EXCHANGE_NOT_SENT", correlationId, { ...facts, sent: outcome.sendStarted, state: outcome.sendStarted ? "UNKNOWN_PENDING_RECONCILIATION" : "not_sent", observed: outcome.state, receipt: outcome.receipt, response, failure: "record_unavailable", recorded: false, idempotent: false });
  }

  /**
   * [B23-B2 review, 2026-10-04] tests-3: a commit whose plan this instance does not hold (a restart, another instance, an expired plan)
   * answers what the durable record holds under its key: the same plan id and digest replay the recorded outcome (sending nothing),
   * another plan's are a reuse of the key, and a key naming nothing there answers `PX_PLAN_NOT_FOUND` (preview again), as before.
   */
  private async recorded(scope: ProviderExchangeScope, commit: { readonly planId: string; readonly planDigest: string; readonly key: string }, ports: ProviderExchangePorts, correlationId: string): Promise<ProviderExchangeAnswer> {
    const ledger = ports.exchangeLedger;
    if (ledger === undefined) return refused("PX_PLAN_NOT_FOUND", correlationId);
    let found: Awaited<ReturnType<ProviderExchangeLedger["attemptForKey"]>>;
    try {
      found = await ledger.attemptForKey({ tenantId: scope.tenantId, projectId: scope.projectId, branchId: scope.branchId }, commit.key);
    } catch (error) {
      return { ok: false, refusal: await fromResponse(boundedManufacturingFailure(error, "release", correlationId)) };
    }
    if (found === null) return refused("PX_PLAN_NOT_FOUND", correlationId);
    if (found.attempt.planId !== commit.planId || found.attempt.planDigest !== commit.planDigest) return refused("PX_IDEMPOTENCY_KEY_REUSE_CONFLICT", correlationId);
    return { ok: false, refusal: exchangeEnvelope(found.attempt, { planId: found.attempt.planId, requestDigest: found.attempt.requestDigest }, correlationId, true) };
  }
}

/** [B23-B2 review, 2026-10-04] coverage-1: how many times a send's answer is written before the commit answers it unrecorded. */
export const PROVIDER_EXCHANGE_SETTLE_ATTEMPTS = 3;

// ─── [B23-B2] A send's answer ────────────────────────────────────────────────────────────────────────────────────────────────

/** The envelope a recorded attempt answers: its state's code and status and what the record keeps (never a raw provider body). */
function exchangeEnvelope(attempt: ExchangeAttempt, facts: { readonly planId: string; readonly requestDigest: string }, correlationId: string, idempotent: boolean): ProviderExchangeRefusal {
  const code: ProviderExchangeErrorCode = attempt.state === "acknowledged" ? "PX_EXCHANGE_ACKNOWLEDGED"
    : attempt.state === "rejected" ? "PX_EXCHANGE_REJECTED"
      : attempt.state === "UNKNOWN_PENDING_RECONCILIATION" ? "PX_EXCHANGE_UNKNOWN_PENDING_RECONCILIATION"
        : attempt.state === "not_sent" ? (attempt.failure?.startsWith("paused_") ? "PX_PROVIDER_PAUSED" : "PX_EXCHANGE_NOT_SENT")
          : "PX_EXCHANGE_IN_FLIGHT";
  const entry = PROVIDER_EXCHANGE_ERRORS[code];
  const acknowledged = attempt.state === "acknowledged";
  const response = attempt.response === null ? null : { status: attempt.response.status, bytes: attempt.response.bytes, sha256: attempt.response.sha256 };
  // [B23-B2 review, 2026-10-04] regressions-4: the sentence travels in `error` for every code, B1's envelope, where the panel reads it
  return { status: entry.status, code, body: { ok: acknowledged, code, error: entry.message, ...(correlationId ? { correlationId } : {}), ...facts, sent: attempt.sendStarted, state: attempt.state, receipt: attempt.receipt, response, failure: attempt.failure, idempotent } };
}
