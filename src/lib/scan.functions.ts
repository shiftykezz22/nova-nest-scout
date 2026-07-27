import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { ProductData } from "./walmart";
import { normalizeWalmartUrl } from "./walmart";

async function fetchWalmartProduct(url: string): Promise<Partial<ProductData>> {
  const out: Partial<ProductData> = { product_url: url, data_source: "walmart.com", last_updated: new Date().toISOString(), sources: {} };
  try {
    const res = await fetch(url, {
      headers: {
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return out;
    const html = await res.text();
    const ldMatches = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
    for (const m of ldMatches) {
      try {
        const data = JSON.parse(m[1]);
        const items = Array.isArray(data) ? data : [data];
        for (const it of items) {
          if (it["@type"] === "Product") {
            if (it.name) { out.title = it.name; out.sources!.title = "public"; }
            if (it.brand?.name) { out.brand = it.brand.name; out.sources!.brand = "public"; }
            if (it.gtin13 || it.gtin || it.gtin14) { out.upc_gtin = it.gtin13 || it.gtin || it.gtin14; out.sources!.upc_gtin = "public"; }
            if (it.model) { out.model = it.model; out.sources!.model = "public"; }
            if (it.image) { out.image = Array.isArray(it.image) ? it.image[0] : it.image; out.sources!.image = "public"; }
            if (it.aggregateRating?.ratingValue) { out.rating = parseFloat(it.aggregateRating.ratingValue); out.sources!.rating = "public"; }
            if (it.aggregateRating?.reviewCount) { out.review_count = parseInt(it.aggregateRating.reviewCount, 10); out.sources!.review_count = "public"; }
            const offer = Array.isArray(it.offers) ? it.offers[0] : it.offers;
            if (offer?.price) { out.price = parseFloat(offer.price); out.sources!.price = "public"; }
            if (offer?.availability) { out.stock_status = String(offer.availability).replace(/^https?:\/\/schema.org\//, ""); out.sources!.stock_status = "public"; }
            if (offer?.seller?.name) { out.seller = offer.seller.name; out.sources!.seller = "public"; }
            if (it.category) { out.category = it.category; out.sources!.category = "public"; }
          }
        }
      } catch { /* ignore */ }
    }
    if (!out.title) {
      const t = html.match(/<title>([^<]+)<\/title>/i);
      if (t) { out.title = t[1].replace(/\s*[-|]\s*Walmart\.com.*$/i, "").trim(); out.sources!.title = "public"; }
    }
  } catch { /* network */ }
  return out;
}

export const analyzeProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { url: string }) => data)
  .handler(async ({ data, context }) => {
    const norm = normalizeWalmartUrl(data.url);
    if (!norm.ok || !norm.url) throw new Error(norm.error || "Invalid URL");
    const product = await fetchWalmartProduct(norm.url);
    product.walmart_item_id = norm.itemId;
    if (norm.itemId) product.sources = { ...(product.sources || {}), walmart_item_id: "verified" };
    const status = product.title ? "retrieved" : "manual_required";
    const { data: row, error } = await context.supabase
      .from("product_scans")
      .insert({
        user_id: context.userId,
        input_url: data.url,
        normalized_url: norm.url,
        walmart_item_id: norm.itemId || null,
        title: product.title || null,
        brand: product.brand || null,
        upc_gtin: product.upc_gtin || null,
        product_data: product,
        analysis_status: status,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id, status, product };
  });

export const analyzeProductGuest = createServerFn({ method: "POST" })
  .inputValidator((data: { url: string }) => data)
  .handler(async ({ data }) => {
    const norm = normalizeWalmartUrl(data.url);
    if (!norm.ok || !norm.url) throw new Error(norm.error || "Invalid URL");
    const product = await fetchWalmartProduct(norm.url);
    product.walmart_item_id = norm.itemId;
    if (norm.itemId) product.sources = { ...(product.sources || {}), walmart_item_id: "verified" };
    return { normalized_url: norm.url, itemId: norm.itemId, product };
  });