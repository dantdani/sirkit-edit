import { semanticHash } from "./stable";

/** Search-only normalization; never replaces the manufacturer's published MPN. */
export function normalizeMpnSearchKey(exactMpn: string): string {
  return exactMpn.normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export class MpnIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MpnIdentityError";
  }
}

/**
 * [B19-D I5b rows 01, 27] The canonical form of an EXACT published MPN, for identity — not for search.
 *
 * Only surrounding whitespace is trimmed and ASCII letters are upper-cased; every other character, including the suffix
 * characters that name a different orderable part (`+`, `#`, `/`, `-`, `.`), is significant. An MPN containing anything
 * outside printable ASCII — a zero-width or bidirectional character, a Cyrillic or Greek homoglyph, a long s that
 * upper-cases to S, a full-width digit — is refused as confusable rather than folded into a plain spelling (OD-34).
 */
export function canonicalExactMpn(mpn: string): string {
  const trimmed = mpn.trim();
  if (trimmed === "") throw new MpnIdentityError("An exact MPN is required");
  if (!/^[\x20-\x7e]+$/.test(trimmed)) throw new MpnIdentityError(`The MPN contains characters outside printable ASCII (confusable identity): ${JSON.stringify(trimmed).slice(0, 80)}`);
  return trimmed.replace(/[a-z]/g, (letter) => letter.toUpperCase());
}

/** True only when both are exact MPNs with the same canonical form; a confusable spelling never matches. */
export function sameExactMpn(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  try {
    return canonicalExactMpn(a) === canonicalExactMpn(b);
  } catch {
    return false;
  }
}

export function exactManufacturerPartId(manufacturerId: string, exactPublishedMpn: string): string {
  if (!manufacturerId.trim() || !exactPublishedMpn.trim()) throw new Error("Manufacturer and exact published MPN are required");
  return `exact_${semanticHash({ manufacturerId, exactPublishedMpn })}`;
}

export function supplierPartId(supplierId: string, supplierSku: string): string {
  if (!supplierId.trim() || !supplierSku.trim()) throw new Error("Supplier and SKU are required");
  return `supplier_part_${semanticHash({ supplierId, supplierSku })}`;
}

