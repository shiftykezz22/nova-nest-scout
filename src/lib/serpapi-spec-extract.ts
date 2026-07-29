// Utilities to extract structured fields from SerpAPI Walmart Product
// specification arrays. SerpAPI returns two related shapes:
//   specification_highlights: [{ name, display_value } | { key, value }]
//   specifications: [{ name, value }] OR nested groups
//     [{ specifications: [{ name, value }] }]
// This module normalizes both into a Record<string,string> and maps
// well-known keys onto ProductData fields.

/* eslint-disable @typescript-eslint/no-explicit-any */

const KEY_ALIASES: Record<string, string[]> = {
  model: ["model", "model number", "model no", "item model number", "model name"],
  manufacturer_part_number: [
    "manufacturer part number",
    "mpn",
    "part number",
    "part no",
    "part #",
    "vendor part number",
    "vendor part #",
  ],
  manufacturer: ["manufacturer"],
  brand: ["brand"],
  color: ["color", "colour", "color category"],
  size: ["size"],
  pack_quantity: ["pack size", "pack quantity", "count", "count per pack", "number of pieces", "quantity"],
  condition: ["condition"],
  shipping_weight: ["shipping weight", "assembled product weight", "weight"],
  dimensions: ["assembled product dimensions", "assembled product dimensions (l x w x h)", "product dimensions", "dimensions"],
  gtin: ["gtin", "gtin-14"],
  ean: ["ean", "ean-13"],
};

function normKey(k: string): string {
  return k
    .toLowerCase()
    .replace(/[_\-\.:#]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[\(\)]/g, "")
    .trim();
}

function stringifyValue(v: any): string | undefined {
  if (v == null) return undefined;
  if (typeof v === "string") return v.trim() || undefined;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    const parts = v.map((x) => stringifyValue(x)).filter(Boolean) as string[];
    return parts.length ? parts.join(", ") : undefined;
  }
  if (typeof v === "object") {
    if (typeof v.display_value === "string") return v.display_value.trim();
    if (typeof v.value === "string") return v.value.trim();
    if (typeof v.name === "string" && v.value == null) return v.name.trim();
  }
  return undefined;
}

function collectPairs(input: any, out: Array<{ name: string; value: string }>): void {
  if (!input) return;
  if (Array.isArray(input)) {
    for (const item of input) collectPairs(item, out);
    return;
  }
  if (typeof input === "object") {
    // Nested groups: { specifications: [...] } or { items: [...] }
    if (Array.isArray(input.specifications)) collectPairs(input.specifications, out);
    if (Array.isArray(input.items)) collectPairs(input.items, out);
    const name: string | undefined =
      (typeof input.name === "string" && input.name) ||
      (typeof input.key === "string" && input.key) ||
      (typeof input.label === "string" && input.label) ||
      undefined;
    if (name) {
      const value = stringifyValue(
        input.display_value ?? input.value ?? input.text ?? input.content ?? input.description,
      );
      if (value) out.push({ name, value });
    }
  }
}

export type ExtractedSpecs = {
  specifications: Record<string, string>;
  mapped: {
    model?: string;
    manufacturer_part_number?: string;
    manufacturer?: string;
    brand?: string;
    color?: string;
    size?: string;
    pack_quantity?: string;
    condition?: string;
    shipping_weight?: string;
    dimensions?: string;
    gtin?: string;
    ean?: string;
  };
};

export function extractSpecs(...sources: any[]): ExtractedSpecs {
  const pairs: Array<{ name: string; value: string }> = [];
  for (const s of sources) collectPairs(s, pairs);
  const specs: Record<string, string> = {};
  for (const { name, value } of pairs) {
    if (!specs[name]) specs[name] = value;
  }
  const mapped: ExtractedSpecs["mapped"] = {};
  const normalizedIndex = new Map<string, string>();
  for (const [k, v] of Object.entries(specs)) normalizedIndex.set(normKey(k), v);

  for (const [targetField, aliases] of Object.entries(KEY_ALIASES)) {
    for (const alias of aliases) {
      const hit = normalizedIndex.get(normKey(alias));
      if (hit) {
        (mapped as Record<string, string>)[targetField] = hit;
        break;
      }
    }
  }
  return { specifications: specs, mapped };
}

// Regex fallback: extract Model / MPN from free-text title or description
// when structured specs are missing. Conservative — returns undefined when
// uncertain rather than inventing a value.
export function extractModelFromText(text: string | undefined, brand?: string): string | undefined {
  if (!text) return undefined;
  const explicit =
    text.match(/\bmodel(?:\s*(?:number|no|#))?\s*[:#]?\s*([A-Z0-9][A-Z0-9\-]{2,20})/i) ||
    text.match(/\bmpn\s*[:#]?\s*([A-Z0-9][A-Z0-9\-]{2,20})/i);
  if (explicit) return explicit[1].trim();
  // Brand-adjacent code token, e.g. "Logitech G305 …" or "Ninja AF101 …".
  if (brand) {
    const rx = new RegExp(`\\b${brand.replace(/[.*+?^${}()|[\\\]\\\\]/g, "\\$&")}\\s+([A-Z]{1,4}\\d{2,5}[A-Z0-9\\-]{0,4})\\b`, "i");
    const m = text.match(rx);
    if (m) return m[1].trim();
  }
  return undefined;
}

export function stripHtml(html: string | undefined): string | undefined {
  if (!html || typeof html !== "string") return undefined;
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(p|li|div|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  return text || undefined;
}

// Extract an ordered category path from SerpAPI `categories` array.
// Shapes seen: [{ name }, ...] or [{ category }, ...] or ["a", "b"].
export function extractCategoryPath(categories: any): string[] | undefined {
  if (!Array.isArray(categories) || !categories.length) return undefined;
  const path = categories
    .map((c) => (typeof c === "string" ? c : c?.name || c?.title || c?.category))
    .filter((s) => typeof s === "string" && s.trim())
    .map((s: string) => s.trim());
  return path.length ? path : undefined;
}