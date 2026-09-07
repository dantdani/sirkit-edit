/**
 * B16.1C §D/§E — bounded public error envelopes for qualification and release.
 *
 * Reproduced defect (B16.1C pre-edit probe P12): `/api/pcb/qualify` returned
 * HTTP 500 with the raw exception message as `error` (and the first token as
 * `code`), and `/api/pcb/release` returned 422 with the raw message — an
 * internal diagnostic (paths, hosts, transport codes, anything an SDK puts in
 * an Error) reached the browser verbatim.
 *
 * Every manufacturing refusal now goes through ONE closed table of public
 * codes with fixed, human-readable messages. Internal detail is kept only in
 * a redacted server-side trace keyed by the request's correlation id (never a
 * token, cookie, URL, or credential-shaped value), and the correlation id is
 * returned in a header so an operator can find the trace without the browser
 * ever seeing the internals.
 */

export interface ManufacturingPublicError {
  status: 400 | 403 | 404 | 409 | 422 | 500 | 503;
  message: string;
}

/** The CLOSED vocabulary. A code outside this table is never emitted. */
export const MANUFACTURING_PUBLIC_ERRORS = Object.freeze({
  MFG_API_SCOPE_REQUIRED: { status: 400, message: "designId and boardId are required." },
  MFG_AUTHORITATIVE_BOARD_NOT_FOUND: { status: 404, message: "No authoritative board exists for this scope." },
  MFG_AUTHORITY_NOT_FOUND: { status: 404, message: "No manufacturing authority exists for this board. Run qualification first." },
  MFG_AUTHORITY_STALE: { status: 409, message: "The manufacturing authority was qualified against an earlier board revision. Re-run qualification before releasing." },
  MFG_BOARD_REVISION_CONFLICT: { status: 409, message: "The authoritative board changed while qualification ran. Reload and re-run qualification." },
  MFG_QUALIFICATION_IN_PROGRESS: { status: 409, message: "A qualification for this board is already running. Wait for it to finish, then reload." },
  MFG_COMPONENT_AUTHORITY_INCOMPLETE: { status: 422, message: "One or more components lack complete, approved component/footprint/pin-mapping authority. Resolve every component before qualification." },
  MFG_PACKAGE_AUTHORITY_UNSUPPORTED: { status: 422, message: "A component uses a package outside the qualified two-layer bare-board vocabulary." },
  MFG_SCHEMATIC_AUTHORITY_MISSING: { status: 422, message: "The board carries no applied schematic synchronization record. Synchronize the schematic to the PCB first." },
  MFG_AUTONOMOUS_INELIGIBLE: { status: 422, message: "Design is outside the qualified autonomous capability profile." },
  MFG_AUTONOMOUS_QUALIFICATION_FAILED: { status: 422, message: "Autonomous qualification did not produce a fully verified routed layout." },
  MFG_RC01_PARITY_FAILED: { status: 422, message: "Schematic parity failed on the routed board." },
  MFG_RC02_EVIDENCE_MISSING: { status: 422, message: "The selected routed candidate carries no route evidence." },
  MFG_RULE_PROFILE_STALE_AT_RELEASE: { status: 422, message: "The manufacturing rule profile evidence is older than one year at release time. Re-verify the fabrication profile before releasing." },
  MFG_RELEASE_HUMAN_REQUIRED: { status: 403, message: "Manufacturing release requires an authenticated human project administrator." },
  MFG_AUTHORITY_CONFIRMATION_MISMATCH: { status: 409, message: "The manufacturing authority changed after the administrator's confirmation. Review the current authority and confirm again." },
  MFG_DURABLE_STORE_UNAVAILABLE: { status: 503, message: "The durable engineering store is unavailable. Nothing was changed." },
  MFG_QUALIFY_FAILED: { status: 500, message: "Qualification could not be completed. Nothing was released." },
  MFG_RELEASE_FAILED: { status: 500, message: "Release could not be completed. No artifact was published." },
  // release-gate refusals (ManufacturingReleaseGateError codes) — fixed public wording
  MFG_AUTHORITY_SCOPE_MISMATCH: { status: 422, message: "The stored authority does not match the requested scope." },
  MFG_AUTHORITY_BOARD_MISMATCH: { status: 422, message: "The stored authority does not describe the requested board revision." },
  MFG_AUTHORITY_METADATA_INCOMPLETE: { status: 422, message: "The stored authority is incomplete." },
  MFG_RC01_EVIDENCE_INVALID: { status: 422, message: "Schematic parity evidence is missing or stale." },
  MFG_RC02_EVIDENCE_INVALID: { status: 422, message: "Routing completion evidence is missing, partial, or stale." },
  MFG_RC03_EVIDENCE_INVALID: { status: 422, message: "Post-layout capability evidence is missing or stale." },
  MFG_RC03_RECOMPUTATION_MISMATCH: { status: 422, message: "Fresh capability evaluation differs from the stored evidence." },
  MFG_COMPONENT_AUTHORITY_INVALID: { status: 422, message: "Component authority evidence is incomplete or its digest is invalid." },
  MFG_ASSEMBLY_AUTHORITY_UNAVAILABLE: { status: 422, message: "Assembled release is not available." },
  MFG_ZONE_FILL_STALE: { status: 422, message: "A conductive zone lacks a current fill proof." },
  MFG_VIA_SPAN_UNSUPPORTED: { status: 422, message: "Only full through-vias are releasable." },
  MFG_OUTLINE_INVALID: { status: 422, message: "A closed non-zero board outline is required." },
  MFG_RULE_PROFILE_DIGEST_INVALID: { status: 422, message: "The manufacturing rule profile digest is invalid." },
  MFG_RULE_PROFILE_INCOMPATIBLE: { status: 422, message: "Rule, fabrication, and DRC profile identities differ." },
  MFG_RULE_PROFILE_EVIDENCE_MISSING: { status: 422, message: "The manufacturing profile lacks a controlled source and verification date." },
  MFG_RULE_PROFILE_STALE: { status: 422, message: "The manufacturing profile evidence is future-dated or older than one year." },
  MFG_RULE_PROFILE_CONSTRUCTION_MISMATCH: { status: 422, message: "Board construction is outside the two-layer manufacturing profile." },
  MFG_RULE_PROFILE_LIMIT_MISMATCH: { status: 422, message: "Declared manufacturing limits do not match the enforced DRC profile." },
  MFG_MASK_POLICY_UNSUPPORTED: { status: 422, message: "The solder mask policy is not supported." },
  MFG_SPECIAL_FEATURE_POLICY_UNSUPPORTED: { status: 422, message: "Slots, castellations, edge plating, and flex are not qualified." },
  MFG_FINAL_ELECTRICAL_GATE_FAILED: { status: 422, message: "Final connectivity or DRC verification is not complete." },
  MFG_FINAL_PLACEMENT_GATE_FAILED: { status: 422, message: "Final placement is not legal." },
  MFG_FINAL_READINESS_FAILED: { status: 422, message: "Fresh fabrication readiness denied the release." },
  MFG_SNAPSHOT_FAILED: { status: 422, message: "The manufacturing snapshot has blocking diagnostics." },
  MFG_MIR_FAILED: { status: 422, message: "The manufacturing intermediate representation has blocking diagnostics." },
  MFG_NATIVE_OUTPUT_MISSING: { status: 422, message: "The native fabrication compiler omitted a required output." },
  MFG_READBACK_FAILED: { status: 422, message: "Independent readback of the generated files failed." },
  MFG_PACKAGE_VALIDATION_FAILED: { status: 422, message: "Package validation failed." },
  MFG_EXTRACTED_REVALIDATION_FAILED: { status: 422, message: "The extracted archive does not conserve the validated package." },
  MFG_AUTHORITY_CHANGED_DURING_GENERATION: { status: 409, message: "The board authority changed during release; no artifact was published." },
} satisfies Record<string, ManufacturingPublicError>);

export type ManufacturingPublicErrorCode = keyof typeof MANUFACTURING_PUBLIC_ERRORS;

export function isManufacturingPublicErrorCode(value: unknown): value is ManufacturingPublicErrorCode {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(MANUFACTURING_PUBLIC_ERRORS, value);
}

const NO_STORE = { "Cache-Control": "no-store" } as const;

/** Build the bounded refusal. `extra` may carry ONLY bounded public evidence
 *  (blocker codes, outline traces) — never an Error, a path, or a stack. */
export function manufacturingRefusal(code: ManufacturingPublicErrorCode, options: { correlationId?: string; extra?: Record<string, unknown> } = {}): Response {
  const entry = MANUFACTURING_PUBLIC_ERRORS[code];
  const headers: Record<string, string> = { ...NO_STORE };
  if (options.correlationId) headers["X-Sirkit-Correlation-Id"] = options.correlationId;
  // The correlation id travels in the body too, so a browser can show an
  // actionable "quote this id to an operator" line without header access.
  return Response.json({ ok: false, code, error: entry.message, ...(options.correlationId ? { correlationId: options.correlationId } : {}), ...(options.extra ?? {}) }, { status: entry.status, headers });
}

/**
 * Redact an internal message for the server-side trace: credential-shaped
 * runs, URLs, mail-shaped tokens, Windows/POSIX paths, and anything beyond a
 * bounded length are removed. The trace never reaches a response.
 */
export function redactInternalDetail(input: unknown): string {
  const raw = input instanceof Error ? `${input.name}: ${input.message}` : typeof input === "string" ? input : JSON.stringify(input ?? null);
  return (raw ?? "")
    .replace(/[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s"']+/g, "[url]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g, "[addr]")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?\b/g, "[ip]")
    .replace(/\[[0-9A-Fa-f:.]+\](?::\d{1,5})?/g, "[ip]")
    .replace(/[A-Za-z]:\\[^\s"']+|\/(?:[\w.-]+\/)+[\w.-]+/g, "[path]")
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[token]")
    .replace(/\s+/g, " ")
    .slice(0, 200);
}

export interface ManufacturingTraceSink {
  (entry: { correlationId: string; operation: "qualify" | "release"; code: string; detail: string }): void;
}

let traceSink: ManufacturingTraceSink = (entry) => {
  console.error(`[mfg.${entry.operation}] correlation=${entry.correlationId} code=${entry.code} detail=${entry.detail}`);
};
export function setManufacturingTraceSinkForTests(sink: ManufacturingTraceSink | null): void {
  traceSink = sink ?? ((entry) => { console.error(`[mfg.${entry.operation}] correlation=${entry.correlationId} code=${entry.code} detail=${entry.detail}`); });
}

/**
 * Map ANY thrown value to a bounded refusal. Known release-gate codes keep
 * their public wording; durable-transport conflicts become 409/503; anything
 * else becomes the operation's generic failure. The internal detail goes to
 * the redacted trace only.
 */
export function boundedManufacturingFailure(error: unknown, operation: "qualify" | "release", correlationId: string): Response {
  const message = error instanceof Error ? error.message : String(error);
  const explicit = (error as { code?: unknown } | null)?.code;
  let code: ManufacturingPublicErrorCode;
  if (isManufacturingPublicErrorCode(explicit)) code = explicit;
  else if (/^(DW_OPTIMISTIC_REVISION_CONFLICT|PS_DURABLE_PUBLICATION_REVISION_CONFLICT|PS_BOARD_REVISION_MISMATCH|PS_SNAPSHOT_REVISION_CONFLICT)/.test(message)) code = "MFG_BOARD_REVISION_CONFLICT";
  else if (/DATABASE_URL is not set|ECONNREFUSED|ENOTFOUND|tenant\/user|Connection terminated|connect_timeout|XX000/i.test(message)) code = "MFG_DURABLE_STORE_UNAVAILABLE";
  else code = operation === "qualify" ? "MFG_QUALIFY_FAILED" : "MFG_RELEASE_FAILED";
  try { traceSink({ correlationId, operation, code, detail: redactInternalDetail(error) }); } catch { /* tracing never fails a request */ }
  return manufacturingRefusal(code, { correlationId });
}
