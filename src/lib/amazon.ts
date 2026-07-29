// Amazon product data service layer.
// Currently manual-entry only; the shape and helpers are ready for a
// real provider (Keepa, Rainforest, etc.) to drop in later without any
// UI changes.

export type AmazonProduct = {
  asin?: string;
  title?: string;
  price?: number;
  rating?: number;
  review_count?: number;
  image?: string;
  product_url?: string;
};

export type AmazonFetchResult =
  | { ok: true; product: AmazonProduct; source: "manual" | "provider" }
  | { ok: false; reason: string };

// Extract an ASIN from a pasted Amazon URL. Supports /dp/, /gp/product/,
// and bare 10-char ASINs.
export function extractAsin(input: string): string | undefined {
  const s = (input ?? "").trim();
  if (!s) return undefined;
  const m =
    s.match(/\/dp\/([A-Z0-9]{10})(?:[/?#]|$)/i) ||
    s.match(/\/gp\/product\/([A-Z0-9]{10})(?:[/?#]|$)/i) ||
    s.match(/^([A-Z0-9]{10})$/i);
  return m ? m[1].toUpperCase() : undefined;
}

export function buildAmazonUrl(asin: string): string {
  return `https://www.amazon.com/dp/${asin}`;
}

// Placeholder for a future auto-fetch integration. Kept here so the
// comparison UI can call it uniformly once a provider is wired up.
export async function fetchAmazonProduct(_input: string): Promise<AmazonFetchResult> {
  return { ok: false, reason: "manual_only" };
}