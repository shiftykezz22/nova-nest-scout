import type { ProductData } from "./walmart";

export type Fingerprint = {
  brand?: string;
  model?: string;
  mpn?: string;
  upc?: string;
  gtin?: string;
  ean?: string;
  pack?: string;
  size?: string;
  color?: string;
  condition?: string;
};

export type MatchClass = "exact" | "strong" | "possible" | "rejected";

function norm(v?: string | number | null): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim().toLowerCase().replace(/[^\w]+/g, "");
  return s || undefined;
}

export function productFingerprint(p: Partial<ProductData>): Fingerprint {
  return {
    brand: norm(p.brand),
    model: norm(p.model),
    mpn: norm(p.manufacturer_part_number),
    upc: norm(p.upc_gtin),
    gtin: norm(p.gtin),
    ean: norm(p.ean),
    pack: norm(p.pack_quantity),
    size: norm(p.size),
    color: norm(p.color),
    condition: norm(p.condition),
  };
}

export function canonicalKey(p: Partial<ProductData>): string {
  const f = productFingerprint(p);
  return [f.gtin || f.upc || f.ean, f.brand, f.model || f.mpn, f.pack, f.size, f.color].filter(Boolean).join(":") || "unknown";
}

// Classify a candidate observation against a reference fingerprint.
// Rejects on hard conflicts (different pack/size/model/condition).
export function classifyMatch(candidate: Fingerprint, reference: Fingerprint): { cls: MatchClass; reasons: string[]; conflicts: string[] } {
  const reasons: string[] = [];
  const conflicts: string[] = [];
  const idMatch =
    (reference.gtin && candidate.gtin && reference.gtin === candidate.gtin) ||
    (reference.upc && candidate.upc && reference.upc === candidate.upc) ||
    (reference.ean && candidate.ean && reference.ean === candidate.ean);
  if (idMatch) reasons.push("Barcode identifier matches");
  const modelMatch = reference.model && candidate.model && reference.model === candidate.model;
  const brandMatch = reference.brand && candidate.brand && reference.brand === candidate.brand;
  if (brandMatch) reasons.push("Brand matches");
  if (modelMatch) reasons.push("Model matches");

  const check = (key: keyof Fingerprint, label: string) => {
    if (reference[key] && candidate[key] && reference[key] !== candidate[key]) conflicts.push(`${label} differs`);
  };
  check("pack", "Pack quantity");
  check("size", "Size");
  check("color", "Color");
  check("condition", "Condition");
  if (reference.model && candidate.model && reference.model !== candidate.model) conflicts.push("Model differs");

  if (conflicts.length) return { cls: "rejected", reasons, conflicts };
  if (idMatch) return { cls: "exact", reasons, conflicts };
  if (brandMatch && modelMatch) return { cls: "strong", reasons, conflicts };
  if (brandMatch || modelMatch) return { cls: "possible", reasons, conflicts };
  return { cls: "possible", reasons: reasons.length ? reasons : ["Attributes overlap"], conflicts };
}