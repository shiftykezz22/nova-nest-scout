import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { ProductData } from "./walmart";
import { identifyInput } from "./walmart";
import { productFingerprint, classifyMatch } from "./matching";
import { extractSpecs, extractModelFromText, stripHtml, extractCategoryPath } from "./serpapi-spec-extract";
import { synthesizeCategoryPath, formatCategoryPath } from "./category-map";
import { runEnrichment, type EnrichmentResult } from "./enrichment";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

type Retrieval = {
  walmart_status: "ok" | "blocked" | "empty" | "network_error";
  walmart_reason?: string;
  sources_tried: string[];
  tavily_used: boolean;
  fields_recovered: number;
  fields_missing: string[];
  provider?: string;
  stages?: Array<{ name: string; status: "ok" | "skipped" | "error"; note?: string }>;
  enrichment?: EnrichmentResult;
};

const ANTIBOT_RX = /robot or human\?|are you a human|verify you are human|unusual traffic|access denied|captcha|px-captcha|perimeterx|please enable javascript and cookies|blocked by/i;

function isAntibot(html: string, title?: string): boolean {
  if (title && /^robot or human\??$/i.test(title.trim())) return true;
  const head = html.slice(0, 4000);
  return ANTIBOT_RX.test(head);
}

function sanitizeTitle(t?: string): string | undefined {
  if (!t) return undefined;
  const s = t.trim();
  if (!s) return undefined;
  if (/^robot or human\??$/i.test(s)) return undefined;
  if (ANTIBOT_RX.test(s)) return undefined;
  return s;
}

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

// ---- SerpApi (primary provider) ----
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pickNum(v: any): number | undefined {
  if (v == null) return undefined;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v.replace(/[^\d.-]/g, ""));
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pickInt(v: any): number | undefined {
  if (v == null) return undefined;
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v);
  if (typeof v === "string") {
    const n = parseInt(v.replace(/[^\d-]/g, ""), 10);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

async function fetchSerpApiProduct(itemId: string): Promise<{ product: Partial<ProductData>; ok: boolean; reason?: string }> {
  const key = process.env.SERPAPI_API_KEY || process.env.SERP_API_KEY;
  if (!key) return { product: {}, ok: false, reason: "serpapi_missing_key" };
  const params = new URLSearchParams({ engine: "walmart_product", product_id: itemId, api_key: key });
  try {
    const res = await fetch(`https://serpapi.com/search.json?${params.toString()}`, {
      signal: AbortSignal.timeout(15000),
    });
    console.log("[serpapi] status", res.status, "item", itemId);
    if (!res.ok) return { product: {}, ok: false, reason: `serpapi_http_${res.status}` };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await res.json();
    if (data?.error) {
      console.log("[serpapi] error", String(data.error).slice(0, 200));
      return { product: {}, ok: false, reason: "serpapi_error" };
    }
    console.log("[serpapi] top keys", Object.keys(data || {}).slice(0, 20).join(","));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p: any = data.product_result || data.product_results || data.product || data;
    const out: Partial<ProductData> = {
      product_url: p.product_page_url || p.link || `https://www.walmart.com/ip/${itemId}`,
      data_source: "serpapi.walmart_product",
      last_updated: new Date().toISOString(),
      sources: {},
    };
    out.walmart_item_id = itemId;
    out.sources!.walmart_item_id = "verified";

    const title = p.title || p.product_name || p.name;
    if (title && typeof title === "string") { out.title = sanitizeTitle(title) || title.trim(); out.sources!.title = "verified"; }

    // Structured spec extraction (SerpAPI returns specification_highlights[]
    // and specifications[]; both often contain the Model / MPN that top-level
    // fields miss).
    const extracted = extractSpecs(p.specification_highlights, p.specifications, p.product_highlights);
    if (Object.keys(extracted.specifications).length) {
      out.specifications = extracted.specifications;
      out.sources!.specifications = "verified";
    }
    const spec = extracted.mapped;

    const brand = p.brand || spec.brand || p.manufacturer || spec.manufacturer;
    if (brand) { out.brand = String(brand); out.sources!.brand = "verified"; }

    const manufacturer = p.manufacturer || spec.manufacturer;
    if (manufacturer) { out.manufacturer = String(manufacturer); out.sources!.manufacturer = "verified"; }

    const upc = p.upc || p.gtin13 || p.upc_a;
    if (upc) { out.upc_gtin = String(upc); out.sources!.upc_gtin = "verified"; }
    if (p.gtin || p.gtin14 || spec.gtin) { out.gtin = String(p.gtin || p.gtin14 || spec.gtin); out.sources!.gtin = "verified"; }
    if (p.ean || p.ean13 || spec.ean) { out.ean = String(p.ean || p.ean13 || spec.ean); out.sources!.ean = "verified"; }

    const model = p.model || p.model_number || spec.model;
    if (model) { out.model = String(model); out.sources!.model = "verified"; }
    const mpn = p.manufacturer_part_number || p.mpn || p.part_number || p.manufacture_number || spec.manufacturer_part_number;
    if (mpn) { out.manufacturer_part_number = String(mpn); out.sources!.manufacturer_part_number = "verified"; }
    if (p.sku) { out.sku = String(p.sku); out.sources!.sku = "verified"; }
    if (p.color || spec.color) { out.color = String(p.color || spec.color); out.sources!.color = "verified"; }
    if (p.size || spec.size) { out.size = String(p.size || spec.size); out.sources!.size = "verified"; }
    const pack = p.pack_size || p.pack_quantity || p.count_per_pack || spec.pack_quantity;
    if (pack) { out.pack_quantity = String(pack); out.sources!.pack_quantity = "verified"; }
    if (p.condition || spec.condition) { out.condition = String(p.condition || spec.condition); out.sources!.condition = "verified"; }
    if (spec.shipping_weight) { out.shipping_weight = spec.shipping_weight; out.sources!.shipping_weight = "verified"; }
    if (spec.dimensions) { out.dimensions = spec.dimensions; out.sources!.dimensions = "verified"; }
    if (typeof p.product_type === "string" && p.product_type.trim()) {
      out.product_type = p.product_type.trim();
      out.sources!.product_type = "verified";
    }
    if (p.variation || p.variant_name) { out.variation = String(p.variation || p.variant_name); out.sources!.variation = "verified"; }

    // Price: SerpApi walmart_product exposes price under several shapes
    const priceCandidates: unknown[] = [
      typeof p.price === "number" || typeof p.price === "string" ? p.price : undefined,
      p.price?.price,
      p.price?.current_price,
      p.current_price,
      p.primary_offer?.offer_price,
      p.buybox_offer?.price,
      p.buybox?.price,
      p.price_map?.price,
      p.pricing?.current_price,
      p.offers?.[0]?.price,
    ];
    let price: number | undefined;
    for (const c of priceCandidates) {
      const n = pickNum(c);
      if (n && n > 0) { price = n; break; }
    }
    if (!price && data?.product_result) {
      // last-ditch: scan any numeric-looking "price" leaf
      try {
        const s = JSON.stringify(data.product_result);
        const m = s.match(/"(?:price|current_price|offer_price)"\s*:\s*"?\$?(\d{1,5}(?:\.\d{1,2})?)"?/);
        if (m) { const n = parseFloat(m[1]); if (n > 0) price = n; }
      } catch { /* ignore */ }
    }
    if (price && price > 0) { out.price = price; out.sources!.price = "verified"; }

    const prev = pickNum(p.price?.was_price ?? p.was_price ?? p.original_price ?? p.list_price);
    if (prev && prev > 0) { out.previous_price = prev; out.sources!.previous_price = "verified"; }

    const rating = pickNum(p.rating ?? p.reviews?.rating ?? p.rating_value);
    if (rating != null && rating > 0 && rating <= 5) { out.rating = rating; out.sources!.rating = "verified"; }

    const rc = pickInt(
      typeof p.reviews === "number" ? p.reviews : (p.reviews?.count ?? p.review_count ?? p.reviews_count ?? p.rating_count ?? p.num_reviews),
    );
    if (rc != null && rc >= 0) { out.review_count = rc; out.sources!.review_count = "verified"; }

    // Image
    let img: string | undefined;
    if (typeof p.main_image === "string") img = p.main_image;
    else if (typeof p.primary_image === "string") img = p.primary_image;
    else if (typeof p.image === "string") img = p.image;
    else if (Array.isArray(p.images) && p.images.length) {
      const first = p.images[0];
      img = typeof first === "string" ? first : (first?.link || first?.url || first?.image);
    }
    if (img && /^https?:\/\//.test(img)) { out.image = img; out.sources!.image = "verified"; }

    const seller = p.seller_name || p.seller?.name || p.sold_by || p.marketplace_seller;
    if (seller) { out.seller = String(seller); out.sources!.seller = "verified"; }
    const shippedBy = p.shipped_by || p.fulfilled_by;
    if (shippedBy) { out.shipped_by = String(shippedBy); out.sources!.shipped_by = "verified"; }

    // Category — prefer SerpAPI `categories[]` (ordered path), then
    // breadcrumbs, then a deterministic keyword-based synthesis.
    let path = extractCategoryPath(p.categories);
    if (!path && Array.isArray(p.breadcrumbs) && p.breadcrumbs.length) {
      path = p.breadcrumbs
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((b: any) => (typeof b === "string" ? b : b?.name || b?.title))
        .filter((s: unknown): s is string => typeof s === "string" && !!s.trim());
    }
    if ((!path || path.length < 2)) {
      const synth = synthesizeCategoryPath({
        title: out.title,
        product_type: out.product_type,
        manufacturer: out.manufacturer,
        brand: out.brand,
      });
      if (synth && (!path || synth.length > path.length)) path = synth;
    }
    if (path && path.length) {
      out.category_path = path;
      out.category = formatCategoryPath(path);
      out.sources!.category = "verified";
      out.sources!.category_path = "verified";
    } else if (typeof p.category === "string") {
      out.category = p.category;
      out.sources!.category = "verified";
    } else if (p.category?.name) {
      out.category = p.category.name;
      out.sources!.category = "verified";
    }

    // Descriptions — strip HTML from detailed_description_html /
    // short_description_html and store as plain text.
    const desc = stripHtml(p.detailed_description_html) || stripHtml(p.short_description_html) || (typeof p.description === "string" ? p.description : undefined);
    if (desc) { out.description = desc; out.sources!.description = "verified"; }

    // Title/description regex fallback for Model / MPN when specs missed.
    if (!out.model) {
      const guessed = extractModelFromText(out.title, out.brand) || extractModelFromText(out.description, out.brand);
      if (guessed) { out.model = guessed; out.sources!.model = "public"; }
    }

    // Stock
    let stock: string | undefined;
    if (typeof p.availability_status === "string") stock = p.availability_status;
    else if (typeof p.stock_status === "string") stock = p.stock_status;
    else if (p.out_of_stock === true) stock = "OutOfStock";
    else if (p.in_stock === true || p.availability === "InStock") stock = "InStock";
    if (stock) { out.stock_status = stock; out.sources!.stock_status = "verified"; }

    const ok = !!out.title;
    console.log("[serpapi] extracted", { title: !!out.title, price: !!out.price, rating: !!out.rating, reviews: !!out.review_count, image: !!out.image });
    return { product: out, ok, reason: ok ? undefined : "serpapi_incomplete" };
  } catch (e) {
    console.log("[serpapi] network_error", String(e).slice(0, 200));
    return { product: {}, ok: false, reason: "serpapi_network_error" };
  }
}

async function fetchWalmartProduct(url: string): Promise<{ product: Partial<ProductData>; status: Retrieval["walmart_status"]; reason?: string }> {
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
    if (!res.ok) return { product: out, status: "network_error", reason: `walmart_http_${res.status}` };
    const html = await res.text();
    let bodyTitle: string | undefined;
    const tm = html.match(/<title>([^<]+)<\/title>/i);
    if (tm) bodyTitle = tm[1];
    if (isAntibot(html, bodyTitle)) {
      return { product: out, status: "blocked", reason: "walmart_antibot_challenge" };
    }
    const ldMatches = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
    let sawProduct = false;
    for (const m of ldMatches) {
      try {
        const data = JSON.parse(m[1]);
        const items = Array.isArray(data) ? data : [data];
        for (const it of items) {
          if (it["@type"] === "Product") {
            sawProduct = true;
            const cleanName = sanitizeTitle(it.name);
            if (cleanName) { out.title = cleanName; out.sources!.title = "public"; }
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
    if (!out.title && bodyTitle) {
      const cleaned = sanitizeTitle(bodyTitle.replace(/\s*[-|]\s*Walmart\.com.*$/i, "").trim());
      if (cleaned) { out.title = cleaned; out.sources!.title = "public"; }
    }
    if (!sawProduct && !out.title) {
      return { product: out, status: "empty" };
    }
    return { product: out, status: "ok" };
  } catch {
    return { product: out, status: "network_error", reason: "walmart_fetch_error" };
  }
}

// ---- Tavily fallback ----
type TavilyResult = { url: string; title: string; content: string; score?: number };

function readTavilyKey(): string | undefined {
  return process.env.TAVILY_API_KEY || process.env.TAV_API_KEY;
}

async function tavilySearch(key: string, query: string, limit = 6): Promise<TavilyResult[]> {
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        query,
        search_depth: "advanced",
        max_results: limit,
        include_answer: false,
        include_raw_content: false,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data?.results ?? []) as TavilyResult[];
  } catch {
    return [];
  }
}

function extractFromTavily(product: Partial<ProductData>, results: TavilyResult[], itemId?: string): number {
  let recovered = 0;
  const need = (k: keyof ProductData) => product[k] == null || product[k] === "";
  const setField = (k: keyof ProductData, v: unknown, kind: "publicly_retrieved" | "inferred" = "publicly_retrieved") => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (product as any)[k] = v;
    product.sources = { ...(product.sources ?? {}), [k as string]: kind === "publicly_retrieved" ? "public" : "estimated" };
    recovered += 1;
  };

  // Prefer Walmart-hosted results matching this item id
  const walmart = results.filter((r) =>
    /walmart\.com\/ip\//i.test(r.url) && (!itemId || r.url.includes(itemId)),
  );
  const ordered = [...walmart, ...results.filter((r) => !walmart.includes(r))];

  for (const r of ordered) {
    const hay = `${r.title}\n${r.content}`;
    const cleanTitle = sanitizeTitle(r.title?.replace(/\s*[-|]\s*Walmart\.com.*$/i, "").trim());
    if (need("title") && cleanTitle && /walmart\.com\/ip\//i.test(r.url)) {
      setField("title", cleanTitle);
    }
    if (need("price")) {
      const m = hay.match(/\$\s?(\d{1,4}(?:\.\d{2}))/);
      if (m) {
        const p = parseFloat(m[1]);
        if (Number.isFinite(p) && p > 0 && p < 20000) setField("price", p);
      }
    }
    if (need("rating")) {
      const m = hay.match(/([0-9](?:\.[0-9])?)\s*(?:out of|\/)\s*5\b/i);
      if (m) {
        const v = parseFloat(m[1]);
        if (v > 0 && v <= 5) setField("rating", v);
      }
    }
    if (need("review_count")) {
      const m = hay.match(/([\d,]{2,7})\s*(?:customer\s*)?reviews?\b/i)
        || hay.match(/([\d,]{2,7})\s*ratings?\b/i);
      if (m) {
        const v = parseInt(m[1].replace(/,/g, ""), 10);
        if (Number.isFinite(v) && v > 0 && v < 10_000_000) setField("review_count", v);
      }
    }
    if (need("upc_gtin")) {
      const m = hay.match(/\b(?:UPC|GTIN|EAN)[:\s]*([0-9]{12,14})\b/i);
      if (m) setField("upc_gtin", m[1]);
    }
    if (need("brand")) {
      const m = hay.match(/\bBrand[:\s]+([A-Z][\w &.'-]{1,40})/);
      if (m) setField("brand", m[1].trim(), "inferred");
    }
  }
  return recovered;
}

async function tavilyFallback(product: Partial<ProductData>, ctx: { itemId?: string; upc?: string; url: string }): Promise<{ used: boolean; recovered: number }> {
  const key = readTavilyKey();
  if (!key) return { used: false, recovered: 0 };
  const queries: string[] = [];
  if (ctx.itemId) {
    queries.push(`site:walmart.com/ip ${ctx.itemId}`);
    queries.push(`Walmart item ${ctx.itemId} price rating reviews`);
  }
  if (ctx.upc) queries.push(`"${ctx.upc}" walmart product price`);
  queries.push(ctx.url);
  const all: TavilyResult[] = [];
  for (const q of queries.slice(0, 4)) {
    const rs = await tavilySearch(key, q, 6);
    all.push(...rs);
  }
  const recovered = extractFromTavily(product, all, ctx.itemId);
  return { used: true, recovered };
}

// ---- Cross-check stages (barcode / manufacturer / retail) ----
type CrossCheckResult = {
  barcode: { status: "ok" | "skipped" | "error"; note?: string; matches?: number };
  manufacturer: { status: "ok" | "skipped" | "error"; note?: string };
  retail: { status: "ok" | "skipped" | "error"; note?: string; offers: RetailOffer[] };
  observations: Array<{ field_name: string; source_name: string; source_url?: string; value: string; verification_status: string }>;
};

export type RetailOffer = {
  retailer_name?: string;
  offer_url?: string;
  price?: number;
  match_confidence?: number;
  match_class?: "exact" | "strong" | "possible" | "rejected";
  retrieved_at?: string;
};

function retailerFromUrl(u: string): string | undefined {
  try {
    const host = new URL(u).hostname.replace(/^www\./, "").toLowerCase();
    if (!host || /walmart\.com/.test(host)) return undefined;
    const base = host.split(".")[0];
    return base.charAt(0).toUpperCase() + base.slice(1);
  } catch { return undefined; }
}

async function runCrossChecks(product: Partial<ProductData>): Promise<CrossCheckResult> {
  const key = readTavilyKey();
  const out: CrossCheckResult = {
    barcode: { status: "skipped" },
    manufacturer: { status: "skipped" },
    retail: { status: "skipped", offers: [] },
    observations: [],
  };
  if (!key) return out;
  const ref = productFingerprint(product);
  const upc = product.upc_gtin || product.gtin || product.ean;
  const brand = product.brand;
  const model = product.model || product.manufacturer_part_number;

  // Barcode verification
  if (upc) {
    const rs = await tavilySearch(key, `"${upc}" product brand model`, 5);
    let matched = 0;
    for (const r of rs.slice(0, 5)) {
      const hay = `${r.title}\n${r.content}`.toLowerCase();
      if (brand && hay.includes(brand.toLowerCase())) matched += 1;
      if (model && hay.includes(String(model).toLowerCase())) matched += 1;
    }
    if (rs.length) {
      out.barcode = { status: "ok", matches: matched, note: `${rs.length} sources · ${matched} attribute hits` };
      // Cross-check UPC observation
      if (matched >= 1) {
        out.observations.push({
          field_name: "upc_gtin",
          source_name: "tavily.barcode",
          source_url: rs[0]?.url,
          value: String(upc),
          verification_status: "cross_checked",
        });
      }
    } else {
      out.barcode = { status: "ok", matches: 0, note: "No barcode sources returned" };
    }
  }

  // Manufacturer verification
  if (brand && model) {
    const rs = await tavilySearch(key, `${brand} ${model} specifications site:${String(brand).toLowerCase()}.com OR manufacturer product page`, 4);
    if (rs.length) {
      out.manufacturer = { status: "ok", note: `${rs.length} manufacturer-side sources` };
      out.observations.push({
        field_name: "model",
        source_name: "tavily.manufacturer",
        source_url: rs[0]?.url,
        value: String(model),
        verification_status: "cross_checked",
      });
    } else {
      out.manufacturer = { status: "ok", note: "No manufacturer sources returned" };
    }
  }

  // Retail comparables (exclude walmart)
  const q = upc ? `"${upc}" price` : brand && model ? `"${brand}" "${model}" price` : product.title ? `"${product.title}" price` : undefined;
  if (q) {
    const rs = await tavilySearch(key, `${q} -site:walmart.com`, 8);
    const offers: RetailOffer[] = [];
    for (const r of rs) {
      if (/walmart\.com/i.test(r.url)) continue;
      const retailer = retailerFromUrl(r.url);
      const hay = `${r.title}\n${r.content}`;
      const priceMatch = hay.match(/\$\s?(\d{1,4}(?:\.\d{2}))/);
      const price = priceMatch ? parseFloat(priceMatch[1]) : undefined;
      // build a candidate fingerprint from title text
      const t = hay.toLowerCase();
      const cand = {
        brand: ref.brand && t.includes(ref.brand) ? ref.brand : undefined,
        model: ref.model && t.includes(ref.model) ? ref.model : undefined,
        upc: ref.upc && t.includes(ref.upc) ? ref.upc : undefined,
      };
      const { cls, reasons } = classifyMatch(cand, ref);
      if (cls === "rejected") continue;
      offers.push({
        retailer_name: retailer,
        offer_url: r.url,
        price: price && price > 0 && price < 20000 ? price : undefined,
        match_class: cls,
        match_confidence: cls === "exact" ? 100 : cls === "strong" ? 75 : 50,
        retrieved_at: new Date().toISOString(),
      });
      if (offers.length >= 8) break;
      void reasons;
    }
    out.retail = { status: "ok", note: `${offers.length} comparable offers`, offers };
  }

  return out;
}

// Resolves a raw user input (URL, UPC/GTIN, or item ID) into a normalized
// Walmart URL + product data. Returns product-only fields; never throws for
// missing product data — only for invalid input.
async function resolveAndFetch(rawInput: string): Promise<{
  normalizedUrl: string; itemId?: string; upc?: string; product: Partial<ProductData>; retrieval: Retrieval;
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
  } else if (id.kind === "upc") {
    upc = id.upc;
    const resolved = await resolveUpcToWalmartUrl(id.upc);
    if (!resolved.url) {
      const retrieval: Retrieval = {
        walmart_status: "empty",
        sources_tried: ["walmart_search"],
        tavily_used: false,
        fields_recovered: 0,
        fields_missing: ["title", "price", "brand"],
      };
      return {
        normalizedUrl: `https://www.walmart.com/search?q=${encodeURIComponent(id.upc)}`,
        upc,
        product: {
          upc_gtin: id.upc,
          data_source: "walmart.com",
          last_updated: new Date().toISOString(),
          sources: { upc_gtin: "user" },
        },
        retrieval,
      };
    }
    normalizedUrl = resolved.url;
    itemId = resolved.itemId;
  } else {
    // "query" kind should be routed through searchWalmartMatches; if it lands
    // here (legacy caller), fall back to a Walmart search page with no data.
    throw new Error("Keyword search must go through product picker.");
  }

  const sourcesTried: string[] = ["walmart"];
  const { product, status, reason } = await fetchWalmartProduct(normalizedUrl);
  if (itemId) {
    product.walmart_item_id = itemId;
    product.sources = { ...(product.sources || {}), walmart_item_id: "verified" };
  }
  if (upc && !product.upc_gtin) {
    product.upc_gtin = upc;
    product.sources = { ...(product.sources || {}), upc_gtin: "user" };
  }

  let tavilyUsed = false;
  let recovered = 0;
  let finalStatus: Retrieval["walmart_status"] = status;
  let finalReason = reason;
  let provider = "walmart_html";

  // Primary provider: SerpApi (if we have an itemId). Use before falling back to Tavily.
  if (itemId && (status !== "ok" || !product.title || product.price == null)) {
    sourcesTried.push("serpapi");
    const s = await fetchSerpApiProduct(itemId);
    if (s.ok) {
      // Merge — SerpApi values take priority over blocked walmart html
      for (const [k, v] of Object.entries(s.product)) {
        if (k === "sources") continue;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (v != null && v !== "") (product as any)[k] = v;
      }
      product.sources = { ...(product.sources || {}), ...(s.product.sources || {}) };
      finalStatus = "ok";
      finalReason = undefined;
      provider = "serpapi";
    } else if (s.reason) {
      finalReason = finalReason || s.reason;
    }
  }

  const needFallback = !product.title || product.price == null;
  if (needFallback) {
    sourcesTried.push("tavily");
    const r = await tavilyFallback(product, { itemId, upc, url: normalizedUrl });
    tavilyUsed = r.used;
    recovered = r.recovered;
  }

  const missing: string[] = [];
  const keys: (keyof ProductData)[] = ["title", "brand", "upc_gtin", "model", "category", "price", "rating", "review_count", "seller", "stock_status", "image"];
  for (const k of keys) if (product[k] == null || product[k] === "") missing.push(String(k));

  const retrieval: Retrieval = {
    walmart_status: finalStatus,
    walmart_reason: finalReason,
    sources_tried: sourcesTried,
    tavily_used: tavilyUsed,
    fields_recovered: recovered,
    fields_missing: missing,
    provider,
  };
  return { normalizedUrl, itemId, upc, product, retrieval };
}

export const analyzeProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { input?: string; url?: string }) => data)
  .handler(async ({ data, context }) => {
    const raw = (data.input ?? data.url ?? "").trim();
    if (!raw) throw new Error("Enter a Walmart URL, UPC / GTIN, or item ID.");
    const started = Date.now();
    const { normalizedUrl, itemId, product, retrieval } = await resolveAndFetch(raw);
    // Cross-check stages (barcode / manufacturer / retail) — only when Walmart identity exists.
    const cross = (product.title || product.upc_gtin || (product.brand && product.model))
      ? await runCrossChecks(product)
      : { barcode: { status: "skipped" as const }, manufacturer: { status: "skipped" as const }, retail: { status: "skipped" as const, offers: [] as RetailOffer[] }, observations: [] };
    if (cross.retail.offers.length) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (product as any).retail_offers = cross.retail.offers;
    }
    // Build the real 10-stage array.
    const stages: NonNullable<ProductData["retrieval"]>["stages"] = [
      { name: "Reading product input", status: "ok" },
      { name: "Identifying Walmart item", status: itemId ? "ok" : "skipped", note: itemId ? `Item ${itemId}` : undefined },
      { name: "Retrieving Walmart data", status: retrieval.walmart_status === "ok" ? "ok" : retrieval.walmart_status === "blocked" ? "error" : "skipped", note: retrieval.walmart_reason },
      { name: "SerpApi verification", status: retrieval.sources_tried.includes("serpapi") ? (retrieval.provider === "serpapi" ? "ok" : "error") : "skipped" },
      { name: "Tavily fallback", status: retrieval.tavily_used ? "ok" : "skipped", note: retrieval.tavily_used ? `${retrieval.fields_recovered} fields recovered` : undefined },
      { name: "Extracting barcode", status: cross.barcode.status, note: cross.barcode.note },
      { name: "Verifying manufacturer", status: cross.manufacturer.status, note: cross.manufacturer.note },
      { name: "Comparing retail prices", status: cross.retail.status, note: cross.retail.note },
      { name: "Product identity fingerprint", status: (product.brand && (product.model || product.manufacturer_part_number)) ? "ok" : "skipped" },
      { name: "Building verdict", status: product.title && product.price != null ? "ok" : "skipped" },
    ];
    retrieval.stages = stages;
    const status = product.title ? "retrieved" : "manual_required";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (product as any).retrieval = retrieval;
    product.scanned_at = new Date().toISOString();
    // Product match confidence + data completeness — expanded field set (Phase 1).
    const criticalKeys: (keyof ProductData)[] = [
      "title", "price", "brand", "model", "manufacturer_part_number", "upc_gtin",
      "category", "manufacturer", "image", "rating", "review_count",
    ];
    const filled = criticalKeys.filter((k) => product[k] != null && product[k] !== "").length;
    const specCount = product.specifications ? Object.keys(product.specifications).length : 0;
    const pathDepth = product.category_path?.length ?? (product.category ? 1 : 0);
    const completenessRaw = (filled / criticalKeys.length) * 100;
    const specBonus = Math.min(10, specCount);
    const dataCompleteness = Math.min(100, Math.round(completenessRaw + specBonus));
    let matchConfidence = 20;
    if (product.upc_gtin) matchConfidence += 20;
    if (product.brand) matchConfidence += 10;
    if (product.model) matchConfidence += 15;
    if (product.manufacturer_part_number) matchConfidence += 10;
    if (product.manufacturer) matchConfidence += 5;
    if (pathDepth >= 2) matchConfidence += 10;
    if (specCount >= 5) matchConfidence += 10;
    if (product.price != null) matchConfidence += 5;
    if (product.image) matchConfidence += 5;
    if (product.rating != null && product.review_count != null) matchConfidence += 5;
    if (cross.barcode.status === "ok" && (cross.barcode.matches ?? 0) >= 1) matchConfidence += 10;
    matchConfidence = Math.min(100, matchConfidence);
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
        input_type: (identifyInput(raw) as { kind?: string }).kind ?? null,
        product_match_confidence: matchConfidence,
        data_completeness_score: dataCompleteness,
        completed_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    // Log scan_sources per provider (best-effort; RLS scopes via product_scans owner).
    const scanSources = retrieval.sources_tried.map((p) => ({
      scan_id: row.id,
      provider_name: p,
      request_type: p === "walmart" ? "html" : "api",
      request_status: (p === "serpapi" && retrieval.provider === "serpapi") || (p === "walmart" && retrieval.walmart_status === "ok") || (p === "tavily" && retrieval.tavily_used) ? "ok" : "skipped",
      source_url: p === "walmart" ? normalizedUrl : null,
      records_returned: p === "tavily" ? retrieval.fields_recovered : (retrieval.provider === p ? 1 : 0),
      latency_ms: Date.now() - started,
      completed_at: new Date().toISOString(),
    }));
    // Add rows for cross-check stages so the sources log is complete.
    for (const [name, s] of [["tavily.barcode", cross.barcode], ["tavily.manufacturer", cross.manufacturer], ["tavily.retail", cross.retail]] as const) {
      scanSources.push({
        scan_id: row.id,
        provider_name: name,
        request_type: "api",
        request_status: s.status,
        source_url: null,
        records_returned: name === "tavily.retail" ? cross.retail.offers.length : (s.status === "ok" ? 1 : 0),
        latency_ms: Date.now() - started,
        completed_at: new Date().toISOString(),
      });
    }
    if (scanSources.length) {
      await context.supabase.from("scan_sources").insert(scanSources);
    }
    // Log observations for each core field with a source, so the Sources panel has data.
    type ObsRow = { scan_id: string; field_name: string; raw_value: string; normalized_value: string; source_name: string; source_url: string | null; verification_status: string; confidence: number; is_selected_value: boolean };
    const obs: ObsRow[] = [];
    const upgradedFields = new Map<string, { status: string; source: string; url?: string }>();
    for (const o of cross.observations) {
      upgradedFields.set(o.field_name, { status: o.verification_status, source: o.source_name, url: o.source_url });
    }
    for (const [k, src] of Object.entries(product.sources ?? {})) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const v = (product as any)[k];
      if (v == null || v === "") continue;
      const upgrade = upgradedFields.get(k);
      const baseStatus = src === "verified" ? "verified" : src === "public" ? "single_source" : src === "user" ? "user_entered" : src === "estimated" ? "estimated" : "unavailable";
      const finalStatus = upgrade?.status ?? baseStatus;
      const confidence = finalStatus === "cross_checked" ? 95 : finalStatus === "verified" ? 90 : finalStatus === "user_entered" ? 100 : finalStatus === "single_source" ? 70 : finalStatus === "estimated" ? 40 : 0;
      obs.push({
        scan_id: row.id,
        field_name: k,
        raw_value: String(v).slice(0, 500),
        normalized_value: String(v).slice(0, 500),
        source_name: retrieval.provider || "walmart_html",
        source_url: normalizedUrl,
        verification_status: finalStatus,
        confidence,
        is_selected_value: true,
      });
      if (upgrade) {
        obs.push({
          scan_id: row.id,
          field_name: k,
          raw_value: String(v).slice(0, 500),
          normalized_value: String(v).slice(0, 500),
          source_name: upgrade.source,
          source_url: upgrade.url || null,
          verification_status: "cross_checked",
          confidence: 95,
          is_selected_value: false,
        });
      }
    }
    if (obs.length) await context.supabase.from("product_observations").insert(obs);
    return { id: row.id, status, product, retrieval, matchConfidence, dataCompleteness };
  });

// Search up to 5 Walmart product candidates matching the input.
// Uses SerpApi walmart search engine (or walmart_product for a direct id).
export const searchWalmartMatches = createServerFn({ method: "POST" })
  .inputValidator((data: { input?: string }) => data)
  .handler(async ({ data }) => {
    const raw = (data.input ?? "").trim();
    if (!raw) throw new Error("Enter a search term.");
    const id = identifyInput(raw);
    if (!id.ok) throw new Error(id.error);
    // Direct product lookup — return 1 candidate immediately.
    if (id.kind === "url" || id.kind === "item_id") {
      const itemId = id.kind === "url" ? id.itemId : id.itemId;
      if (itemId) {
        const s = await fetchSerpApiProduct(itemId);
        if (s.ok && s.product.title) {
          return { kind: "direct" as const, itemId, url: id.kind === "url" ? id.url : `https://www.walmart.com/ip/${itemId}` };
        }
      }
      return { kind: "direct" as const, itemId, url: id.kind === "url" ? id.url : `https://www.walmart.com/ip/${itemId}` };
    }
    // Keyword or UPC — SerpApi walmart search engine.
    const key = process.env.SERPAPI_API_KEY || process.env.SERP_API_KEY;
    const query = id.kind === "upc" ? id.upc : id.query;
    if (!key) {
      return { kind: "candidates" as const, candidates: [], warning: "Product search is unavailable — API key is not configured. Try a Walmart URL or item ID." };
    }
    try {
      const params = new URLSearchParams({ engine: "walmart", query, api_key: key });
      const res = await fetch(`https://serpapi.com/search.json?${params.toString()}`, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) return { kind: "candidates" as const, candidates: [], warning: `Search failed (${res.status}). Try again shortly.` };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const j: any = await res.json();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows: any[] = j.organic_results || j.products || [];
      const candidates = rows.slice(0, 5).map((r) => {
        const itemId = String(r.us_item_id || r.product_id || r.item_id || "").match(/\d{5,}/)?.[0];
        const price = pickNum(r?.primary_offer?.offer_price ?? r.price ?? r?.price?.price);
        const rating = pickNum(r.rating);
        const reviews = pickInt(r.reviews ?? r.reviews_count);
        const seller = r.seller_name || r.seller?.name || r.marketplace_seller;
        // Match confidence: exact UPC bonus, title match bonus.
        const titleLc = String(r.title || "").toLowerCase();
        const qLc = query.toLowerCase();
        let match = 40;
        const reasons: string[] = [];
        if (id.kind === "upc" && String(r.upc || r.gtin || "").includes(id.upc)) { match = 100; reasons.push("UPC matched"); }
        else if (qLc.split(/\s+/).every((t) => titleLc.includes(t))) { match = 75; reasons.push("All keywords in title"); }
        else if (qLc.split(/\s+/).some((t) => t.length > 2 && titleLc.includes(t))) { match = 55; reasons.push("Partial keyword match"); }
        if (r.brand) reasons.push(`Brand: ${r.brand}`);
        return {
          walmart_item_id: itemId,
          url: r.product_page_url || r.link || (itemId ? `https://www.walmart.com/ip/${itemId}` : undefined),
          title: r.title as string | undefined,
          brand: r.brand as string | undefined,
          image: (typeof r.thumbnail === "string" ? r.thumbnail : (typeof r.image === "string" ? r.image : undefined)) as string | undefined,
          price,
          rating,
          review_count: reviews,
          seller: seller ? String(seller) : undefined,
          model: r.model as string | undefined,
          upc_gtin: r.upc || r.gtin ? String(r.upc || r.gtin) : undefined,
          match_confidence: match,
          match_reasons: reasons,
        };
      }).filter((c) => c.walmart_item_id);
      return { kind: "candidates" as const, candidates };
    } catch {
      return { kind: "candidates" as const, candidates: [], warning: "Search timed out. Try a more specific term or a Walmart URL." };
    }
  });

export const analyzeProductGuest = createServerFn({ method: "POST" })
  .inputValidator((data: { input?: string; url?: string }) => data)
  .handler(async ({ data }) => {
    const raw = (data.input ?? data.url ?? "").trim();
    if (!raw) throw new Error("Enter a Walmart URL, UPC / GTIN, or item ID.");
    const { normalizedUrl, itemId, product, retrieval } = await resolveAndFetch(raw);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (product as any).retrieval = retrieval;
    return { normalized_url: normalizedUrl, itemId, product, retrieval };
  });

// List raw observation rows for a scan; used by the sources panel to show
// retrieved-at and cross-check status per field.
export const listObservations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { scanId?: string }) => data)
  .handler(async ({ data, context }) => {
    const scanId = (data.scanId || "").trim();
    if (!scanId) return { rows: [] };
    const { data: rows, error } = await context.supabase
      .from("product_observations")
      .select("field_name, source_name, source_url, verification_status, confidence, retrieved_at, is_selected_value")
      .eq("scan_id", scanId)
      .order("retrieved_at", { ascending: false });
    if (error) return { rows: [] };
    return { rows: rows ?? [] };
  });

// Re-run the retrieval pipeline against the same scan id (owner-only).
export const refreshScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { scanId?: string }) => data)
  .handler(async ({ data, context }) => {
    const scanId = (data.scanId || "").trim();
    if (!scanId) throw new Error("Missing scan id.");
    const { data: existing, error: readErr } = await context.supabase
      .from("product_scans")
      .select("id, input_url, user_id")
      .eq("id", scanId)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!existing) throw new Error("Scan not found.");
    if (existing.user_id !== context.userId) throw new Error("Not authorized.");
    const raw = String(existing.input_url || "").trim();
    if (!raw) throw new Error("Original input missing; cannot refresh.");
    const started = Date.now();
    const { normalizedUrl, itemId, product, retrieval } = await resolveAndFetch(raw);
    const cross = (product.title || product.upc_gtin || (product.brand && product.model))
      ? await runCrossChecks(product)
      : { barcode: { status: "skipped" as const }, manufacturer: { status: "skipped" as const }, retail: { status: "skipped" as const, offers: [] as RetailOffer[] }, observations: [] };
    if (cross.retail.offers.length) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (product as any).retail_offers = cross.retail.offers;
    }
    retrieval.stages = [
      { name: "Reading product input", status: "ok" },
      { name: "Identifying Walmart item", status: itemId ? "ok" : "skipped" },
      { name: "Retrieving Walmart data", status: retrieval.walmart_status === "ok" ? "ok" : retrieval.walmart_status === "blocked" ? "error" : "skipped", note: retrieval.walmart_reason },
      { name: "SerpApi verification", status: retrieval.sources_tried.includes("serpapi") ? (retrieval.provider === "serpapi" ? "ok" : "error") : "skipped" },
      { name: "Tavily fallback", status: retrieval.tavily_used ? "ok" : "skipped" },
      { name: "Extracting barcode", status: cross.barcode.status, note: cross.barcode.note },
      { name: "Verifying manufacturer", status: cross.manufacturer.status, note: cross.manufacturer.note },
      { name: "Comparing retail prices", status: cross.retail.status, note: cross.retail.note },
      { name: "Product identity fingerprint", status: (product.brand && (product.model || product.manufacturer_part_number)) ? "ok" : "skipped" },
      { name: "Building verdict", status: product.title && product.price != null ? "ok" : "skipped" },
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (product as any).retrieval = retrieval;
    product.scanned_at = new Date().toISOString();
    const { error: updErr } = await context.supabase
      .from("product_scans")
      .update({
        normalized_url: normalizedUrl,
        walmart_item_id: itemId || null,
        title: product.title || null,
        brand: product.brand || null,
        upc_gtin: product.upc_gtin || null,
        product_data: product,
        analysis_status: product.title ? "retrieved" : "manual_required",
        completed_at: new Date().toISOString(),
      })
      .eq("id", scanId);
    if (updErr) throw new Error(updErr.message);
    await context.supabase.from("scan_sources").insert(
      retrieval.sources_tried.map((p) => ({
        scan_id: scanId,
        provider_name: p,
        request_type: p === "walmart" ? "html" : "api",
        request_status: (p === "serpapi" && retrieval.provider === "serpapi") || (p === "walmart" && retrieval.walmart_status === "ok") || (p === "tavily" && retrieval.tavily_used) ? "ok" : "skipped",
        source_url: p === "walmart" ? normalizedUrl : null,
        records_returned: p === "tavily" ? retrieval.fields_recovered : (retrieval.provider === p ? 1 : 0),
        latency_ms: Date.now() - started,
        completed_at: new Date().toISOString(),
      })),
    );
    return { id: scanId, product };
  });