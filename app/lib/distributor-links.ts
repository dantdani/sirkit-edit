/**
 * Stable deep-links to distributor tooling (Stage 6).
 *
 * Pure string construction — no API calls. We auto-open the BOM-upload tool
 * after downloading a distributor-formatted CSV, and the procurement packet
 * embeds per-part search URLs.
 */

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
