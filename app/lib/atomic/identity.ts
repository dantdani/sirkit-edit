import { semanticHash } from "./stable";

/** Search-only normalization; never replaces the manufacturer's published MPN. */
export function normalizeMpnSearchKey(exactMpn: string): string {
  return exactMpn.normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function exactManufacturerPartId(manufacturerId: string, exactPublishedMpn: string): string {
  if (!manufacturerId.trim() || !exactPublishedMpn.trim()) throw new Error("Manufacturer and exact published MPN are required");
  return `exact_${semanticHash({ manufacturerId, exactPublishedMpn })}`;
}

export function supplierPartId(supplierId: string, supplierSku: string): string {
  if (!supplierId.trim() || !supplierSku.trim()) throw new Error("Supplier and SKU are required");
  return `supplier_part_${semanticHash({ supplierId, supplierSku })}`;
}

