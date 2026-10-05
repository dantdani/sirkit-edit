/**
 * [B23-C] How ordering could ever be enabled, and the fixed notice that says it is not (runbook B23-C :984-994: "Ordering stays
 * feature-disabled until the owner separately supplies:" seven inputs; D23-10; OD-170, OD-171).
 *
 * `orderingEnablement()` is pure: disabled, with the closed list of missing prerequisites, unless an owner record carries all seven
 * runbook inputs AND a reviewed code change wires a submission port. Its one environment input is the operator's switch, which only
 * turns ordering off (any value at all; no variable turns it on); it reads only the environment it is given, and the stores' default,
 * `orderingEnablementFromProcess()`, gives it that one switch from the process. In B23 no owner record exists (`ORDERING_OWNER_RECORD`
 * is null) and no port is wired (`ORDER_SUBMISSION_PORT_WIRING` is "none"), so every answer is disabled; enabling needs the owner's
 * record (an OD) and a separately reviewed change wiring a provider port in a composition root (b23-c-order-contract case 7: none does).
 */

/** The seven runbook inputs (:988-994), in the runbook's order. */
export const ORDERING_PREREQUISITES = Object.freeze(["account_reference", "spend_and_quantity_limits", "billing_shipping_policy", "authorized_roles", "cancellation_refund_behaviour", "legal_compliance", "sandbox_path"] as const);
export type OrderingPrerequisite = (typeof ORDERING_PREREQUISITES)[number];
/** Each prerequisite in the runbook's own words (:988-994). */
export const ORDERING_PREREQUISITE_RUNBOOK: Readonly<Record<OrderingPrerequisite, string>> = Object.freeze({
  account_reference: "a supported account",
  spend_and_quantity_limits: "spending and quantity limits",
  billing_shipping_policy: "billing/shipping policy",
  authorized_roles: "authorized human roles",
  cancellation_refund_behaviour: "cancellation/refund behavior",
  legal_compliance: "legal/compliance requirements",
  sandbox_path: "a staging/sandbox provider path",
});

/**
 * The owner's record (OD-171): the owner decision that records it and, per prerequisite, a reference to what the owner supplied (an
 * account reference, never a credential; a policy document's reference). A value that is empty or "UNKNOWN" supplies nothing.
 */
export interface OrderingOwnerRecord {
  readonly ownerDecision: string;
  readonly prerequisites: Readonly<Partial<Record<OrderingPrerequisite, string>>>;
}
/** [B23-C] No owner record exists in B23 (OD-171). */
export const ORDERING_OWNER_RECORD: OrderingOwnerRecord | null = null;
export type OrderSubmissionPortWiring = "none" | "wired";
/** [B23-C] No composition root wires a submission port in B23; the reviewed change that wires one changes this constant with it. */
export const ORDER_SUBMISSION_PORT_WIRING: OrderSubmissionPortWiring = "none";
/** The operator's off-only switch: set to any non-blank value, ordering is turned off. */
export const ORDERING_OPERATOR_DISABLE_ENV = "SIRKIT_ORDERING_DISABLED";
/** The fixed notice the provider panel shows (OD-170): worded outside B19-E's purchase phrases, with no control beside it. */
export const ORDERING_DISABLED_NOTICE = "Ordering through Sirkit is turned off. The owner has not supplied a provider account, spending and quantity limits, a billing and shipping policy, authorized roles, cancellation and refund terms, legal and compliance requirements or a sandbox path, so nothing in Sirkit can order hardware or spend money.";

export const ORDERING_DISABLED_REASONS = Object.freeze(["owner_record_absent", "owner_record_invalid", "prerequisites_missing", "submission_port_not_wired", "operator_disabled"] as const);
export type OrderingDisabledReason = (typeof ORDERING_DISABLED_REASONS)[number];
export type OrderingEnablement =
  | { readonly enabled: false; readonly reasons: readonly OrderingDisabledReason[]; readonly missing: readonly OrderingPrerequisite[]; readonly ownerDecision: string | null; readonly notice: string }
  | { readonly enabled: true; readonly reasons: readonly []; readonly missing: readonly []; readonly ownerDecision: string; readonly notice: null };

const OWNER_DECISION = /^OD-[0-9]{1,4}$/;
const RECORD_KEYS = ["ownerDecision", "prerequisites"] as const;
const REFERENCE_MAX = 200;
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
/** A reference text: 1..200 printable characters, no control character (a line break included). */
function referenceText(value: string): boolean {
  if (value.length > REFERENCE_MAX) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return false;
  }
  return true;
}
/** Whether a prerequisite's value supplies it: a reference that is not blank and not "UNKNOWN". */
const supplied = (value: unknown): boolean => typeof value === "string" && value.trim() !== "" && value.trim().toUpperCase() !== "UNKNOWN";

/** The record's shape: closed keys, a reviewed owner decision id, and prerequisite values that are reference texts. Null when invalid. */
function readRecord(value: unknown): { readonly ownerDecision: string; readonly prerequisites: Readonly<Record<string, unknown>> } | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== RECORD_KEYS.length || !RECORD_KEYS.every((key) => keys.includes(key))) return null;
  const { ownerDecision, prerequisites } = value;
  if (typeof ownerDecision !== "string" || !OWNER_DECISION.test(ownerDecision) || !isRecord(prerequisites)) return null;
  for (const [key, entry] of Object.entries(prerequisites)) {
    if (!(ORDERING_PREREQUISITES as readonly string[]).includes(key)) return null;
    if (entry !== undefined && (typeof entry !== "string" || !referenceText(entry))) return null;
  }
  return { ownerDecision, prerequisites };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

/**
 * Whether ordering is enabled. Disabled unless `ownerRecord` is a valid record supplying all seven prerequisites, `submissionPort` is
 * "wired" and the operator switch is not set. The defaults are B23's: no record, no wired port, an empty environment.
 */
export function orderingEnablement(input: { readonly ownerRecord?: unknown; readonly submissionPort?: OrderSubmissionPortWiring; readonly env?: Readonly<Record<string, string | undefined>> } = {}): OrderingEnablement {
  const reasons: OrderingDisabledReason[] = [];
  const given = "ownerRecord" in input ? input.ownerRecord : ORDERING_OWNER_RECORD;
  const parsed = given === null || given === undefined ? null : readRecord(given);
  if (given === null || given === undefined) reasons.push("owner_record_absent");
  else if (parsed === null) reasons.push("owner_record_invalid");
  const missing = parsed === null ? [...ORDERING_PREREQUISITES] : ORDERING_PREREQUISITES.filter((prerequisite) => !supplied(parsed.prerequisites[prerequisite]));
  if (parsed !== null && missing.length > 0) reasons.push("prerequisites_missing");
  // an invalid record enables nothing whatever else holds; it is the one reason given
  if (parsed !== null || given === null || given === undefined) {
    if ((input.submissionPort ?? ORDER_SUBMISSION_PORT_WIRING) !== "wired") reasons.push("submission_port_not_wired");
    const switched = (input.env ?? {})[ORDERING_OPERATOR_DISABLE_ENV];
    if (typeof switched === "string" && switched.trim() !== "") reasons.push("operator_disabled");
  }
  if (reasons.length === 0 && parsed !== null) return deepFreeze({ enabled: true, reasons: [], missing: [], ownerDecision: parsed.ownerDecision, notice: null });
  return deepFreeze({ enabled: false, reasons, missing, ownerDecision: parsed?.ownerDecision ?? null, notice: ORDERING_DISABLED_NOTICE });
}

/**
 * [B23-C fix, 2026-10-04] The production answer, the stores' default (security-1: before, the defaults read no environment, so the switch
 * did nothing on the production path). B23's facts, and the operator's switch read from the PROCESS environment at each call: exactly that
 * one variable is read, and only to turn ordering off; nothing in the process can turn it on.
 */
export function orderingEnablementFromProcess(input: { readonly ownerRecord?: unknown; readonly submissionPort?: OrderSubmissionPortWiring } = {}): OrderingEnablement {
  return orderingEnablement({ ...input, env: { [ORDERING_OPERATOR_DISABLE_ENV]: process.env[ORDERING_OPERATOR_DISABLE_ENV] } });
}
