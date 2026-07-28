import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Supplier } from "./suppliers";

type TavilyResult = { url: string; title: string; content: string; score?: number; raw_content?: string };
type TavilyResponse = { results?: TavilyResult[]; answer?: string };

type SearchInput = {
  title?: string;
  brand?: string;
  upc?: string;
  model?: string;
  category?: string;
  size?: string;
  pack?: string;
  color?: string;
  specs?: string;
  walmartPrice?: number;
  zip?: string;
  international?: boolean;
  location?: string;
  radiusMiles?: 10 | 25 | 50;
  onlineOnly?: boolean;
};

const NYC_TERMS: Array<{ label: string; bucket: Supplier["region_bucket"]; q: string }> = [
  { label: "Brooklyn", bucket: "brooklyn", q: "Brooklyn NY wholesaler distributor" },
  { label: "Queens", bucket: "queens", q: "Queens NY wholesaler distributor" },
  { label: "Bronx", bucket: "bronx", q: "Bronx NY wholesaler distributor" },
  { label: "Manhattan/SI", bucket: "manhattan_si", q: "Manhattan OR Staten Island NY wholesaler distributor" },
  { label: "Long Island", bucket: "long_island", q: "Long Island NY wholesale distributor" },
  { label: "Northern NJ", bucket: "north_nj", q: "Northern New Jersey wholesale distributor" },
  { label: "CT/ePA", bucket: "ct_epa", q: "Connecticut OR eastern Pennsylvania wholesale distributor" },
];

const BAD_DOMAINS = /(walmart\.com|amazon\.com|ebay\.com|target\.com|pinterest\.|reddit\.|facebook\.|instagram\.|tiktok\.|youtube\.|blogspot\.|wordpress\.com|coupon|deal|slickdeals|honey\.)/i;
const GOOD_HINTS = /(wholesale|distributor|manufacturer|bulk|pallet|case pack|MOQ|B2B|authorized dealer|importer|private label|thomasnet|alibaba|globalsources|made-in-china)/i;

function classifyType(text: string): Supplier["supplier_type"] {
  const t = text.toLowerCase();
  if (/private label/.test(t)) return "private_label";
  if (/authorized (dealer|distributor)/.test(t)) return "authorized_distributor";
  if (/manufacturer|factory/.test(t)) return "manufacturer";
  if (/importer/.test(t)) return "importer";
  if (/distributor/.test(t)) return "distributor";
  if (/wholesale|bulk|pallet|case pack|moq|b2b/.test(t)) return "wholesaler";
  return "unknown";
}

function classifyCountry(text: string, hostname: string): { country?: string; region_bucket: Supplier["region_bucket"] } {
  const t = text.toLowerCase();
  if (/alibaba|made-in-china|globalsources|\.cn(\/|$)|hong ?kong|shenzhen|guangzhou|yiwu/i.test(t) || /\.cn$|alibaba\.com|made-in-china|globalsources/i.test(hostname)) {
    return { country: "International", region_bucket: "international" };
  }
  for (const r of NYC_TERMS) {
    if (new RegExp(r.q.split(" ")[0], "i").test(text)) return { country: "USA", region_bucket: r.bucket };
  }
  if (/\busa\b|united states|\bny\b|new york|new jersey|california|texas|florida|illinois/i.test(t)) {
    return { country: "USA", region_bucket: "us" };
  }
  return { region_bucket: "us" };
}

function matchConfidence(input: SearchInput, hay: string): { pm: Supplier["product_match"]; conf: number } {
  const t = hay.toLowerCase();
  let score = 0;
  const hits: string[] = [];
  if (input.upc && t.includes(input.upc.toLowerCase())) { score += 60; hits.push("upc"); }
  if (input.model && input.model.length > 2 && t.includes(input.model.toLowerCase())) { score += 20; hits.push("model"); }
  if (input.brand && t.includes(input.brand.toLowerCase())) { score += 15; hits.push("brand"); }
  if (input.size && t.includes(input.size.toLowerCase())) { score += 5; hits.push("size"); }
  if (input.pack && t.includes(input.pack.toLowerCase())) { score += 5; hits.push("pack"); }
  if (input.color && t.includes(input.color.toLowerCase())) { score += 3; hits.push("color"); }
  score = Math.min(100, score);
  let pm: Supplier["product_match"] = "weak";
  if (hits.includes("upc")) pm = "exact";
  else if (hits.includes("model") && hits.includes("brand")) pm = "likely";
  else if (hits.includes("brand")) pm = "similar";
  else if (score >= 5) pm = "category";
  return { pm, conf: score };
}

function extractPrice(text: string): number | null {
  // Simple $x.yy extraction; only used when clearly present in snippet
  const m = text.match(/\$\s?(\d{1,4}(?:\.\d{1,2})?)\s*(?:\/(?:unit|ea|each|case)|per (?:unit|ea|each|case))?/i);
  if (!m) return null;
  const v = parseFloat(m[1]);
  if (!Number.isFinite(v) || v <= 0 || v > 10000) return null;
  return v;
}

function extractMoq(text: string): number | null {
  const m = text.match(/\bMOQ[:\s]*([0-9,]{1,7})/i) || text.match(/minimum order[^0-9]{0,20}([0-9,]{1,7})/i);
  return m ? parseInt(m[1].replace(/,/g, ""), 10) : null;
}

async function tavilySearch(apiKey: string, query: string, limit = 6): Promise<TavilyResult[]> {
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: "advanced",
        max_results: limit,
        include_answer: false,
        include_raw_content: false,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as TavilyResponse;
    return data.results ?? [];
  } catch {
    return [];
  }
}

function buildQueries(input: SearchInput): Array<{ q: string; kind: string; bucket?: Supplier["region_bucket"] }> {
  const brand = input.brand?.trim();
  const model = input.model?.trim();
  const title = input.title?.trim() || brand || "";
  const genericType = input.category?.split(/[/>]/).pop()?.trim() || title.split(" ").slice(0, 4).join(" ");
  const location = input.location?.trim() || "Brooklyn, New York";
  const radius = input.radiusMiles ?? 25;
  const online = input.onlineOnly === true;
  const q: Array<{ q: string; kind: string; bucket?: Supplier["region_bucket"] }> = [];
  if (input.upc) q.push({ q: `${input.upc} wholesale distributor case pack MOQ`, kind: "upc" });
  if (brand && model) q.push({ q: `"${brand}" "${model}" authorized distributor wholesale`, kind: "brand_model" });
  if (brand) q.push({ q: `"${brand}" manufacturer OR distributor wholesale`, kind: "brand" });
  if (genericType) {
    if (!online) {
      q.push({ q: `${brand ?? ""} ${model ?? ""} wholesale distributor near ${location}`.trim(), kind: "near_location" });
      q.push({ q: `${genericType} wholesaler within ${radius} miles of ${location}`, kind: "radius" });
      q.push({ q: `${genericType} distributors ${location}`, kind: "local_generic" });
    }
    q.push({ q: `${genericType} bulk wholesale supplier MOQ case pack`, kind: "generic_bulk" });
    q.push({ q: `${genericType} private label manufacturer wholesale`, kind: "private_label" });
    q.push({ q: `${genericType} pallet OR case wholesale distributor USA`, kind: "pallet" });
    if (brand) q.push({ q: `${brand} authorized distributor`, kind: "authorized" });
    q.push({ q: `${genericType} thomasnet supplier`, kind: "thomasnet" });
    if (input.international !== false) q.push({ q: `${genericType} alibaba OR "global sources" OR "made-in-china" manufacturer`, kind: "international" });
  }
  return q.slice(0, 12);
}

function dedupe<T>(arr: T[], key: (v: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const v of arr) {
    const k = key(v);
    if (!seen.has(k)) { seen.add(k); out.push(v); }
  }
  return out;
}

function toSupplier(r: TavilyResult, hint: { kind: string; bucket?: Supplier["region_bucket"] }, input: SearchInput): Supplier | null {
  let host = "";
  try { host = new URL(r.url).hostname; } catch { return null; }
  if (!host || BAD_DOMAINS.test(host) || BAD_DOMAINS.test(r.url)) return null;
  const hay = `${r.title}\n${r.content}\n${host}`;
  const isLegit = GOOD_HINTS.test(hay) || /wholesale|distributor|manufacturer|supplier|bulk/i.test(host);
  if (!isLegit) return null;

  const type = classifyType(hay);
  const geo = classifyCountry(hay, host);
  const region_bucket = hint.bucket ?? geo.region_bucket;
  const { pm, conf } = matchConfidence(input, hay);
  const priceInSnippet = extractPrice(r.content);
  const moq = extractMoq(r.content);
  const phone = extractPhone(r.content);
  const address = extractAddress(r.content);
  const match_kind: Supplier["match_kind"] = pm === "exact" ? "verified_exact"
    : pm === "likely" ? "likely"
    : pm === "similar" || pm === "category" ? "category"
    : "unverified_lead";
  const is_online = region_bucket === "international" || region_bucket === "us" || /shop|store|online|ecommerce/i.test(host);
  const warnings: string[] = [];
  if (pm === "weak") warnings.push("Weak product match — verify before using its price.");
  if (!priceInSnippet) warnings.push("Pricing not shown publicly — quote required.");

  const supplier: Supplier = {
    supplier_name: host.replace(/^www\./, ""),
    supplier_url: r.url,
    supplier_type: type,
    country: geo.country,
    region_bucket,
    product_match: pm,
    match_confidence: conf,
    match_kind,
    unit_cost: priceInSnippet,
    currency: "USD",
    moq,
    verification_status: priceInSnippet ? "partially_verified" : "quote_required",
    source: `tavily:${hint.kind}`,
    contact_data: {
      snippet: r.content?.slice(0, 240),
      last_checked: new Date().toISOString(),
      quote_page: r.url,
      phone: phone ?? undefined,
      address: address ?? undefined,
      approximate_location: address ?? (hint.bucket ? undefined : input.location),
      is_online,
    },
    warnings,
    reasons: [
      `Matched via ${hint.kind.replace(/_/g, " ")} search.`,
      pm === "exact" ? "UPC/GTIN present on page." : pm === "likely" ? "Brand and model both present." : pm === "similar" ? "Brand present, needs verification." : "Category-level match only.",
    ],
  };
  return supplier;
}

function extractPhone(text: string): string | null {
  const m = text.match(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/);
  return m ? m[0] : null;
}

function extractAddress(text: string): string | null {
  const m = text.match(/\b\d{1,5}\s+[A-Z][A-Za-z0-9.'\- ]{3,60},\s*[A-Z][A-Za-z .'\-]{2,30},\s*[A-Z]{2}\s*\d{5}/);
  return m ? m[0] : null;
}

function readTavilyKey(): string | undefined {
  return process.env.TAVILY_API_KEY || process.env.TAV_API_KEY;
}

export const searchSuppliersPublic = createServerFn({ method: "POST" })
  .inputValidator((data: SearchInput) => data)
  .handler(async ({ data }) => {
    const key = readTavilyKey();
    if (!key) return { configured: false as const, suppliers: [] as Supplier[], queries: [] as string[] };
    const queries = buildQueries(data);
    const bag: Array<{ s: Supplier; score?: number }> = [];
    // Run in parallel but cap concurrency
    const batches = 4;
    for (let i = 0; i < queries.length; i += batches) {
      const chunk = queries.slice(i, i + batches);
      const results = await Promise.all(chunk.map((q) => tavilySearch(key, q.q, 6).then((rs) => ({ q, rs }))));
      for (const { q, rs } of results) for (const r of rs) {
        const s = toSupplier(r, { kind: q.kind, bucket: q.bucket }, data);
        if (s) bag.push({ s, score: r.score });
      }
    }
    const unique = dedupe(bag.map((b) => b.s), (s) => (s.supplier_url ?? s.supplier_name).replace(/[#?].*$/, "").toLowerCase());
    return { configured: true as const, suppliers: unique.slice(0, 30), queries: queries.map((q) => q.q) };
  });

export const searchAndSaveSuppliers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: SearchInput & { productScanId: string }) => data)
  .handler(async ({ data, context }) => {
    const { productScanId, ...input } = data;
    // Verify ownership
    const { data: scan, error: scanErr } = await context.supabase
      .from("product_scans").select("id, user_id").eq("id", productScanId).maybeSingle();
    if (scanErr) throw new Error(scanErr.message);
    if (!scan || scan.user_id !== context.userId) throw new Error("Scan not found");

    const key = readTavilyKey();
    if (!key) return { configured: false as const, saved: 0, suppliers: [] as Supplier[] };

    const queries = buildQueries(input);
    const collected: Supplier[] = [];
    const batches = 4;
    for (let i = 0; i < queries.length; i += batches) {
      const chunk = queries.slice(i, i + batches);
      const results = await Promise.all(chunk.map((q) => tavilySearch(key, q.q, 6).then((rs) => ({ q, rs }))));
      for (const { q, rs } of results) for (const r of rs) {
        const s = toSupplier(r, { kind: q.kind, bucket: q.bucket }, input);
        if (s) collected.push(s);
      }
    }
    const unique = dedupe(collected, (s) => (s.supplier_url ?? s.supplier_name).replace(/[#?].*$/, "").toLowerCase()).slice(0, 30);

    // Wipe prior tavily results and insert fresh
    await context.supabase.from("supplier_results").delete().eq("product_scan_id", productScanId).like("source", "tavily:%");
    if (unique.length) {
      const rows = unique.map((s) => ({
        product_scan_id: productScanId,
        supplier_name: s.supplier_name,
        supplier_url: s.supplier_url,
        supplier_type: s.supplier_type,
        location: s.region_bucket,
        country: s.country,
        product_match: s.product_match,
        unit_cost: s.unit_cost ?? null,
        currency: s.currency ?? "USD",
        moq: s.moq ?? null,
        case_pack: s.case_pack ?? null,
        estimated_shipping: s.estimated_shipping ?? null,
        estimated_landed_cost: s.estimated_landed_cost ?? null,
        lead_time_days: s.lead_time_days ?? null,
        sample_available: s.sample_available ?? null,
        private_label_available: s.private_label_available ?? null,
        authorization_status: s.authorization_status ?? null,
        verification_status: s.verification_status,
        contact_data: s.contact_data ?? {},
        source: s.source ?? "tavily",
      }));
      const { error: insErr } = await context.supabase.from("supplier_results").insert(rows);
      if (insErr) throw new Error(insErr.message);
    }
    return { configured: true as const, saved: unique.length, suppliers: unique };
  });

export const tavilyStatus = createServerFn({ method: "GET" }).handler(async () => {
  return { configured: !!readTavilyKey() };
});