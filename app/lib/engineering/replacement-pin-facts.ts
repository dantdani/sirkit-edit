/**
 * B14 §B — the SERVER-OWNED pin-fact contract for exact component
 * replacement.
 *
 * `PublishedSymbolPinFacts` is the allowlisted projection of ONE published
 * atomic part revision's symbol pins plus a bounded corroboration view of its
 * APPROVED mapping certificate. It is produced ONLY by server-side cancellable
 * reads (production) or injected test sources — never by the browser, the
 * request body, a provider, or the model. Pin facts are PLANNING INPUTS: they
 * never enter the agent context, provider messages, traces, or the sealed
 * proposal beyond the bounded impact summary.
 */

import type { KicadPin } from "../kicad/types";

/** Bounded corroboration view of an APPROVED atomic mapping certificate. */
export interface ReplacementCertificateFacts {
  id: string;
  symbolVersionId: string;
  footprintVersionId: string;
  symbolPinIds: readonly string[];
  missingTerminalIds: readonly string[];
  missingSymbolPinIds: readonly string[];
  missingPadNumbers: readonly string[];
  ambiguous: readonly string[];
  state: "approved";
}

export interface PublishedSymbolPinFacts {
  atomicPartRevisionId: string;
  symbolAssetVersionId: string;
  /** The published symbol's pins in the planner's shape. */
  pins: readonly KicadPin[];
  /** The revision's approved mapping certificate (bounded projection). */
  certificate: ReplacementCertificateFacts;
  /** The symbol's pin IDS (certificate corroboration key space). */
  symbolPinIds: readonly string[];
}

/**
 * [B14 §C] Certificate corroboration for the TARGET: the approved certificate
 * must name the exact symbol version, carry no missing/ambiguous mapping
 * entries, and every certificate symbol-pin id must exist on the published
 * symbol. This is a VERIFICATION layer over the exact-pin-identity mapping —
 * it never generates an old→new mapping, and a certificate that cannot be
 * corroborated blocks the proposal.
 */
export function certificateCorroborates(facts: PublishedSymbolPinFacts, expectedCertificateId: string): boolean {
  const certificate = facts.certificate;
  if (certificate.id !== expectedCertificateId) return false;
  if (certificate.state !== "approved") return false;
  if (certificate.symbolVersionId !== facts.symbolAssetVersionId) return false;
  if (certificate.missingTerminalIds.length > 0 || certificate.missingSymbolPinIds.length > 0
    || certificate.missingPadNumbers.length > 0 || certificate.ambiguous.length > 0) return false;
  const pinIds = new Set(facts.symbolPinIds);
  return certificate.symbolPinIds.length > 0 && certificate.symbolPinIds.every((id) => pinIds.has(id));
}
