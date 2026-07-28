import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { ProductData } from "./walmart";
import { normalizeWalmartUrl, identifyInput } from "./walmart";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function resolveUpcToWalmartUrl(upc: string): Promise<{ url?: string; itemId?: string }> {
  try {
    const res = await fetch(`https://www.walmart.com/search?q=${encodeURIComponent(upc)}`, {
      headers: { "user-agent": UA, accept: "text/html", "accept-language": "en-US,en;q=0.9" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return {};
    const html = await res.text();
    const m = html.match(/\/ip\/(?:[^/"?#\s]+\/)?(\d{5,})/);
    if (!m) return {};
    const url = `https://www.walmart.com/ip/${m[1]}`;
    return { url, itemId: m[1] };
  } catch {
    return {};
  }
}

async function fetchWalmartProduct(url: string): Promise<Partial<ProductData>> {
  const out: Partial<ProductData> = { product_url: url, data_source: "walmart.com", last_updated: new Date().toISOString(), sources: {} };
  try {
    const res = await fetch(url, {
      headers: {
        "user-agent": UA,
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

// Resolves a raw user input (URL, UPC/GTIN, or item ID) into a normalized
// Walmart URL + product data. Returns product-only fields; never throws for
// missing product data — only for invalid input.
async function resolveAndFetch(rawInput: string): Promise<{
  normalizedUrl: string; itemId?: string; upc?: string; product: Partial<ProductData>;
}> {
  const id = identifyInput(rawInput);
  if (!id.ok) throw new Error(id.error);

  let normalizedUrl: string;
  let itemId: string | undefined;
  let upc: string | undefined;

  if (id.kind === "url") {
    normalizedUrl = id.url;
    itemId = id.itemId;
  } else if (id.kind === "item_id") {
    normalizedUrl = id.url;
    itemId = id.itemId;
  } else {
    upc = id.upc;
    const resolved = await resolveUpcToWalmartUrl(id.upc);
    if (!resolved.url) {
      return {
        normalizedUrl: `https://www.walmart.com/search?q=${encodeURIComponent(id.upc)}`,
        upc,
        product: {
          upc_gtin: id.upc,
          data_source: "walmart.com",
          last_updated: new Date().toISOString(),
          sources: { upc_gtin: "user" },
        },
      };
    }
    normalizedUrl = resolved.url;
    itemId = resolved.itemId;
  }

  const product = await fetchWalmartProduct(normalizedUrl);
  if (itemId) {
    product.walmart_item_id = itemId;
    product.sources = { ...(product.sources || {}), walmart_item_id: "verified" };
  }
  if (upc && !product.upc_gtin) {
    product.upc_gtin = upc;
    product.sources = { ...(product.sources || {}), upc_gtin: "user" };
  }
  return { normalizedUrl, itemId, upc, product };
}

export const analyzeProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { input?: string; url?: string }) => data)
  .handler(async ({ data, context }) => {
    const raw = (data.input ?? data.url ?? "").trim();
    if (!raw) throw new Error("Enter a Walmart URL, UPC / GTIN, or item ID.");
    const { normalizedUrl, itemId, product } = await resolveAndFetch(raw);
    const status = product.title ? "retrieved" : "manual_required";
    const { data: row, error } = await context.supabase
      .from("product_scans")
      .insert({
        user_id: context.userId,
        input_url: raw,
        normalized_url: normalizedUrl,
        walmart_item_id: itemId || null,
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
  .inputValidator((data: { input?: string; url?: string }) => data)
  .handler(async ({ data }) => {
    const raw = (data.input ?? data.url ?? "").trim();
    if (!raw) throw new Error("Enter a Walmart URL, UPC / GTIN, or item ID.");
    const { normalizedUrl, itemId, product } = await resolveAndFetch(raw);
    return { normalized_url: normalizedUrl, itemId, product };
  });