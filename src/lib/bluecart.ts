// BlueCart Walmart Product API client — Phase 2 secondary enrichment source.
// Used ONLY when SerpAPI (Phase 1) leaves Model / MPN / hierarchical category
// empty or weak. Never overwrites a high-confidence SerpAPI value; only fills
// gaps and returns raw candidate fields for the enrichment merger.
//
// Docs: https://app.bluecartapi.com/docs (endpoint: /request, type=product).
// Auth: api_key query param. We call with UPC (preferred) or title+brand.
// Missing key => the client returns { ok:false, reason:"bluecart_missing_key" }
// and the enrichment pass silently skips this stage.

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { ProductData } from "./walmart";
import { synthesizeCategoryPath } from "./category-map";

export type BlueCartCandidate = {
  title?: string;
  brand?: string;
  manufacturer?: string;
  model?: string;
  manufacturer_part_number?: string;
  upc_gtin?: string;
  gtin?: string;
  ean?: string;
  category_path?: string[];
  specifications?: Record<string, string>;
  image?: string;
  price?: number;
  raw?: unknown;
};

export type BlueCartResult =
  | { ok: true; candidate: BlueCartCandidate; matched_by: "upc" | "title"; similarity?: number }
  | { ok: false; reason: string };

function readKey(): string | undefined {
  return process.env.BLUECART_API_KEY || process.env.BLUE_CART_API_KEY;
}

// Normalize a "Category > Sub > Leaf" style path into ordered segments.
function splitCategoryPath(raw: unknown): string[] | undefined {
  if (Array.isArray(raw)) {
    const parts = raw
      .map((r) => (typeof r === "string" ? r : (r?.name ?? r?.category)))
      .filter((s: unknown): s is string => typeof s === "string" && !!s.trim())
      .map((s) => s.trim());
    return parts.length ? parts : undefined;
  }
  if (typeof raw === "string" && raw.includes(">")) {
    const parts = raw.split(">").map((s) => s.trim()).filter(Boolean);
    return parts.length ? parts : undefined;
  }
  return undefined;
}

function pickNum(v: any): number | undefined {
  if (v == null) return undefined;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v.replace(/[^\d.-]/g, ""));
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function mapSpecs(raw: any): { specifications?: Record<string, string>; model?: string; mpn?: string; manufacturer?: string } {
  const out: Record<string, string> = {};
  let model: string | undefined;
  let mpn: string | undefined;
  let manufacturer: string | undefined;
  const push = (name: unknown, value: unknown) => {
    if (typeof name !== "string" || typeof value !== "string") return;
    const n = name.trim();
    const v = value.trim();
    if (!n || !v) return;
    out[n] = v;
    const lc = n.toLowerCase();
    if (!model && /model(\s*(number|no|name|#))?$/.test(lc)) model = v;
    if (!mpn && /(manufacturer\s*part|mpn|part\s*(number|no|#))/.test(lc)) mpn = v;
    if (!manufacturer && /^manufacturer$/.test(lc)) manufacturer = v;
  };
  if (Array.isArray(raw)) {
    for (const s of raw) {
      if (!s) continue;
      if (Array.isArray(s.specifications)) for (const g of s.specifications) push(g.name, g.value);
      else push(s.name, s.value);
    }
  } else if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw)) push(k, v as any);
  }
  return {
    specifications: Object.keys(out).length ? out : undefined,
    model,
    mpn,
    manufacturer,
  };
}

function mapProduct(p: any): BlueCartCandidate {
  const c: BlueCartCandidate = { raw: p };
  if (typeof p?.title === "string") c.title = p.title.trim();
  if (typeof p?.brand === "string") c.brand = p.brand.trim();
  if (typeof p?.manufacturer === "string") c.manufacturer = p.manufacturer.trim();
  if (p?.model) c.model = String(p.model).trim();
  if (p?.model_number && !c.model) c.model = String(p.model_number).trim();
  if (p?.item_model_number && !c.model) c.model = String(p.item_model_number).trim();
  if (p?.mpn) c.manufacturer_part_number = String(p.mpn).trim();
  if (p?.manufacturer_part_number && !c.manufacturer_part_number) c.manufacturer_part_number = String(p.manufacturer_part_number).trim();
  if (p?.upc) c.upc_gtin = String(p.upc);
  if (p?.gtin) c.gtin = String(p.gtin);
  if (p?.ean) c.ean = String(p.ean);
  const path = splitCategoryPath(p?.categories) || splitCategoryPath(p?.category_path) || splitCategoryPath(p?.category);
  if (path) c.category_path = path;
  const specs = mapSpecs(p?.specifications ?? p?.specification_highlights ?? p?.attributes);
  if (specs.specifications) c.specifications = specs.specifications;
  if (!c.model && specs.model) c.model = specs.model;
  if (!c.manufacturer_part_number && specs.mpn) c.manufacturer_part_number = specs.mpn;
  if (!c.manufacturer && specs.manufacturer) c.manufacturer = specs.manufacturer;
  if (typeof p?.main_image === "string") c.image = p.main_image;
  else if (typeof p?.image === "string") c.image = p.image;
  const price = pickNum(p?.buybox_winner?.price ?? p?.price ?? p?.current_price);
  if (price && price > 0) c.price = price;
  if (!c.category_path) {
    const synth = synthesizeCategoryPath({
      title: c.title,
      manufacturer: c.manufacturer,
      brand: c.brand,
    });
    if (synth) c.category_path = synth;
  }
  return c;
}

function tokens(s: string): Set<string> {
  return new Set(
    s.toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 3),
  );
}

function jaccard(a: string, b: string): number {
  const A = tokens(a); const B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  return inter / (A.size + B.size - inter);
}

async function callBlueCart(params: Record<string, string>): Promise<{ ok: boolean; data?: any; reason?: string }> {
  const key = readKey();
  if (!key) return { ok: false, reason: "bluecart_missing_key" };
  const qs = new URLSearchParams({ api_key: key, type: "product", ...params });
  try {
    const res = await fetch(`https://api.bluecartapi.com/request?${qs.toString()}`, {
      signal: AbortSignal.timeout(12000),
    });
    console.log("[bluecart] status", res.status, "params", Object.keys(params).join(","));
    if (!res.ok) return { ok: false, reason: `bluecart_http_${res.status}` };
    const data = await res.json();
    if (data?.request_info?.success === false) {
      return { ok: false, reason: "bluecart_request_failed" };
    }
    return { ok: true, data };
  } catch (e) {
    console.log("[bluecart] network_error", String(e).slice(0, 200));
    return { ok: false, reason: "bluecart_network_error" };
  }
}

// Lookup by UPC — highest-confidence match; wins over SerpAPI for empty fields.
export async function bluecartLookupByUpc(upc: string): Promise<BlueCartResult> {
  const r = await callBlueCart({ gtin: upc });
  if (!r.ok) return { ok: false, reason: r.reason || "bluecart_upc_no_result" };
  const product = r.data?.product ?? r.data?.request_result?.product;
  if (!product) return { ok: false, reason: "bluecart_upc_no_product" };
  return { ok: true, candidate: mapProduct(product), matched_by: "upc" };
}

// Lookup by Walmart item id — also very reliable when SerpAPI missed fields.
export async function bluecartLookupByItemId(itemId: string): Promise<BlueCartResult> {
  const r = await callBlueCart({ item_id: itemId });
  if (!r.ok) return { ok: false, reason: r.reason || "bluecart_id_no_result" };
  const product = r.data?.product ?? r.data?.request_result?.product;
  if (!product) return { ok: false, reason: "bluecart_id_no_product" };
  return { ok: true, candidate: mapProduct(product), matched_by: "upc" };
}

// Lookup by title + optional brand; requires a similarity check to accept.
export async function bluecartLookupByTitle(title: string, brand?: string, minSim = 0.55): Promise<BlueCartResult> {
  const query = brand ? `${brand} ${title}` : title;
  const r = await callBlueCart({ search_term: query.slice(0, 200) });
  if (!r.ok) return { ok: false, reason: r.reason || "bluecart_title_no_result" };
  const list: any[] =
    r.data?.search_results ??
    r.data?.request_result?.search_results ??
    (r.data?.product ? [r.data.product] : []);
  let best: { c: BlueCartCandidate; sim: number } | undefined;
  for (const row of list.slice(0, 10)) {
    const c = mapProduct(row?.product ?? row);
    if (!c.title) continue;
    if (brand && c.brand && c.brand.toLowerCase() !== brand.toLowerCase()) continue;
    const sim = jaccard(title, c.title);
    if (!best || sim > best.sim) best = { c, sim };
  }
  if (!best || best.sim < minSim) return { ok: false, reason: "bluecart_title_low_similarity" };
  return { ok: true, candidate: best.c, matched_by: "title", similarity: best.sim };
}

// Rating distribution + representative reviews from SerpAPI Walmart Reviews.
// Kept alongside BlueCart so the enrichment layer owns all Phase-2 fetches.
export type ReviewEnrichment = {
  rating_breakdown?: Record<string, number>;
  top_positive?: string;
  top_negative?: string;
  total_reviews?: number;
};

export async function fetchWalmartReviews(itemId: string): Promise<ReviewEnrichment | undefined> {
  const key = process.env.SERPAPI_API_KEY || process.env.SERP_API_KEY;
  if (!key) return undefined;
  try {
    const params = new URLSearchParams({ engine: "walmart_product_reviews", product_id: itemId, api_key: key });
    const res = await fetch(`https://serpapi.com/search.json?${params.toString()}`, {
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return undefined;
    const data: any = await res.json();
    const out: ReviewEnrichment = {};
    const rb = data?.rating_breakdown || data?.reviews_meta?.rating_breakdown;
    if (rb && typeof rb === "object") {
      const norm: Record<string, number> = {};
      for (const [k, v] of Object.entries(rb)) {
        const n = pickNum(v);
        if (n != null) norm[String(k)] = n;
      }
      if (Object.keys(norm).length) out.rating_breakdown = norm;
    }
    if (typeof data?.total_reviews === "number") out.total_reviews = data.total_reviews;
    const revs: any[] = data?.reviews || [];
    const withRating = revs
      .filter((r) => typeof r?.rating === "number" && typeof (r?.text || r?.review_text) === "string")
      .map((r) => ({ rating: r.rating as number, text: String(r.text || r.review_text) }));
    const pos = withRating.filter((r) => r.rating >= 4).sort((a, b) => b.text.length - a.text.length)[0];
    const neg = withRating.filter((r) => r.rating <= 2).sort((a, b) => b.text.length - a.text.length)[0];
    if (pos) out.top_positive = pos.text.slice(0, 400);
    if (neg) out.top_negative = neg.text.slice(0, 400);
    return Object.keys(out).length ? out : undefined;
  } catch {
    return undefined;
  }
}

// Utility: expose the environment-key presence for stage reporting.
export function isBlueCartConfigured(): boolean {
  return !!readKey();
}

// Convenience shape used by the enrichment orchestrator for merge rules.
export function isHighConfidence(source: string | undefined): boolean {
  return source === "verified" || source === "user";
}

export type { ProductData };