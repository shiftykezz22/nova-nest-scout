import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { ProductData } from "./walmart";
import { identifyInput } from "./walmart";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

type Retrieval = {
  walmart_status: "ok" | "blocked" | "empty" | "network_error";
  walmart_reason?: string;
  sources_tried: string[];
  tavily_used: boolean;
  fields_recovered: number;
  fields_missing: string[];
  provider?: string;
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

    const brand = p.brand || p.manufacturer;
    if (brand) { out.brand = String(brand); out.sources!.brand = "verified"; }

    if (p.manufacturer) { out.manufacturer = String(p.manufacturer); out.sources!.manufacturer = "verified"; }

    const upc = p.upc || p.gtin13 || p.upc_a;
    if (upc) { out.upc_gtin = String(upc); out.sources!.upc_gtin = "verified"; }
    if (p.gtin || p.gtin14) { out.gtin = String(p.gtin || p.gtin14); out.sources!.gtin = "verified"; }
    if (p.ean || p.ean13) { out.ean = String(p.ean || p.ean13); out.sources!.ean = "verified"; }

    const model = p.model || p.model_number;
    if (model) { out.model = String(model); out.sources!.model = "verified"; }
    const mpn = p.manufacturer_part_number || p.mpn || p.part_number;
    if (mpn) { out.manufacturer_part_number = String(mpn); out.sources!.manufacturer_part_number = "verified"; }
    if (p.sku) { out.sku = String(p.sku); out.sources!.sku = "verified"; }
    if (p.color) { out.color = String(p.color); out.sources!.color = "verified"; }
    if (p.size) { out.size = String(p.size); out.sources!.size = "verified"; }
    const pack = p.pack_size || p.pack_quantity || p.count_per_pack;
    if (pack) { out.pack_quantity = String(pack); out.sources!.pack_quantity = "verified"; }
    if (p.condition) { out.condition = String(p.condition); out.sources!.condition = "verified"; }
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

    // Category from breadcrumbs or category name
    let cat: string | undefined;
    if (Array.isArray(p.breadcrumbs) && p.breadcrumbs.length) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cat = p.breadcrumbs.map((b: any) => (typeof b === "string" ? b : b?.name || b?.title)).filter(Boolean).join(" / ");
    } else if (typeof p.category === "string") cat = p.category;
    else if (p.category?.name) cat = p.category.name;
    if (cat) { out.category = cat; out.sources!.category = "verified"; }

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
    // Build a real stages array reflecting what actually ran.
    const stages: NonNullable<ProductData["retrieval"]>["stages"] = [
      { name: "Identify input", status: "ok" },
      { name: "Retrieve Walmart data", status: retrieval.walmart_status === "ok" ? "ok" : retrieval.walmart_status === "blocked" ? "error" : "skipped", note: retrieval.walmart_reason },
      { name: "SerpApi verification", status: retrieval.sources_tried.includes("serpapi") ? (retrieval.provider === "serpapi" ? "ok" : "error") : "skipped" },
      { name: "Tavily fallback", status: retrieval.tavily_used ? "ok" : "skipped", note: retrieval.tavily_used ? `${retrieval.fields_recovered} fields recovered` : undefined },
      { name: "Build verdict", status: product.title && product.price != null ? "ok" : "skipped" },
    ];
    retrieval.stages = stages;
    const status = product.title ? "retrieved" : "manual_required";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (product as any).retrieval = retrieval;
    product.scanned_at = new Date().toISOString();
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
    if (scanSources.length) {
      await context.supabase.from("scan_sources").insert(scanSources);
    }
    // Log observations for each core field with a source, so the Sources panel has data.
    const obs: Array<Record<string, unknown>> = [];
    for (const [k, src] of Object.entries(product.sources ?? {})) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const v = (product as any)[k];
      if (v == null || v === "") continue;
      obs.push({
        scan_id: row.id,
        field_name: k,
        raw_value: String(v).slice(0, 500),
        normalized_value: String(v).slice(0, 500),
        source_name: retrieval.provider || "walmart_html",
        source_url: normalizedUrl,
        verification_status: src === "verified" ? "verified" : src === "public" ? "single_source" : src === "user" ? "user_entered" : src === "estimated" ? "estimated" : "unavailable",
        confidence: src === "verified" ? 90 : src === "public" ? 70 : src === "user" ? 100 : src === "estimated" ? 40 : 0,
        is_selected_value: true,
      });
    }
    if (obs.length) await context.supabase.from("product_observations").insert(obs);
    return { id: row.id, status, product, retrieval };
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