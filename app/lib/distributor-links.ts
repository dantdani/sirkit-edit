/**
 * Stable deep-links to distributor tooling (Stage 6).
 *
 * Pure string construction — no API calls. We auto-open the BOM-upload tool
 * after downloading a distributor-formatted CSV, and the procurement packet
 * embeds per-part search URLs.
 */

import { safeHref, VENDOR_PAGE_HOSTS } from "@/app/lib/net/href-policy";

/** Each distributor's BOM-upload tool, opened in a new tab after CSV download. */
export const DISTRIBUTOR_UPLOAD_URLS = {
  digikey: "https://www.digikey.com/en/mylists/list/upload",
  mouser: "https://www.mouser.com/Tools/Project/UploadFile",
  lcsc: "https://www.lcsc.com/bom-tool",
} as const;

export type CartDistributor = keyof typeof DISTRIBUTOR_UPLOAD_URLS;

/** DigiKey keyword search for a SKU or MPN. */
export function digiKeyProductUrl(skuOrMpn: string): string {
  return `https://www.digikey.com/short/?keywords=${encodeURIComponent(skuOrMpn)}`;
}

/** Mouser keyword search for a SKU or MPN. */
export function mouserProductUrl(skuOrMpn: string): string {
  return `https://www.mouser.com/c/?q=${encodeURIComponent(skuOrMpn)}`;
}

/** LCSC search for an MPN. */
export function lcscProductUrl(mpn: string): string {
  return `https://www.lcsc.com/search?q=${encodeURIComponent(mpn)}`;
}

/**
 * [B19-D I5c rows 09, 34, review] A stored vendor product link, shown or written only when it is an HTTPS page on a
 * distributor's own domain. One helper for the BOM view, the BOM CSV and the procurement packet, so they cannot diverge.
 */
export function vendorProductPageUrl(productUrl: unknown): string | null {
  return safeHref(productUrl, "page", VENDOR_PAGE_HOSTS);
}

/** The link for one offer: its vetted product page, else that distributor's search for the SKU or MPN, else none. */
export function offerLinkUrl(offer: { distributor: string; productUrl?: string | null; sku?: string | null; mpn?: string | null }): string | null {
  const page = vendorProductPageUrl(offer.productUrl);
  if (page) return page;
  const id = offer.sku ?? offer.mpn;
  if (!id) return null;
  if (offer.distributor === "digikey") return digiKeyProductUrl(id);
  if (offer.distributor === "mouser") return mouserProductUrl(id);
  if (offer.distributor === "lcsc") return lcscProductUrl(id);
  return null;
}
