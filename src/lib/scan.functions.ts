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
  } else {
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
  const needFallback = status !== "ok" || !product.title || product.price == null;
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
    walmart_status: status,
    walmart_reason: reason,
    sources_tried: sourcesTried,
    tavily_used: tavilyUsed,
    fields_recovered: recovered,
    fields_missing: missing,
  };
  return { normalizedUrl, itemId, upc, product, retrieval };
}

export const analyzeProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { input?: string; url?: string }) => data)
  .handler(async ({ data, context }) => {
    const raw = (data.input ?? data.url ?? "").trim();
    if (!raw) throw new Error("Enter a Walmart URL, UPC / GTIN, or item ID.");
    const { normalizedUrl, itemId, product, retrieval } = await resolveAndFetch(raw);
    const status = product.title ? "retrieved" : "manual_required";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (product as any).retrieval = retrieval;
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
    return { id: row.id, status, product, retrieval };
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