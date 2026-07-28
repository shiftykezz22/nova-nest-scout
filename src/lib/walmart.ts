export function normalizeWalmartUrl(raw: string): { ok: boolean; url?: string; itemId?: string; error?: string } {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { ok: false, error: "Please paste a valid URL." };
  }
  const host = u.hostname.toLowerCase();
  if (!host.endsWith("walmart.com")) {
    return { ok: false, error: "URL must be from walmart.com" };
  }
  // Strip tracking params
  const drop = /^(utm_|gclid|fbclid|athcpid|athpgid|athmt|athena|athbdg|wmlspartner|sourceid|veh|adid|wpa_bd|wpa_pg|wpa_pos|wpa_plc|wpa_cat|wpa_aud|wpa_tag|wpa_bu|wpa_pd|wl|ath|irgwc|clickid|affid|campaign|dclid|mc)/i;
  const params = new URLSearchParams();
  u.searchParams.forEach((v, k) => {
    if (!drop.test(k)) params.set(k, v);
  });
  u.search = params.toString();
  u.hash = "";
  const m = u.pathname.match(/\/ip\/(?:[^/]+\/)?(\d{5,})/);
  const itemId = m?.[1];
  return { ok: true, url: u.toString(), itemId };
}

export type InputKind = "url" | "upc" | "item_id";
export type IdentifiedInput =
  | { ok: true; kind: "url"; url: string; itemId?: string }
  | { ok: true; kind: "item_id"; url: string; itemId: string }
  | { ok: true; kind: "upc"; upc: string }
  | { ok: false; error: string };

// Detects whether raw input is a Walmart URL, a Walmart item ID (5-12 digits),
// or a UPC / GTIN (12-14 digits). Whitespace / hyphens in numeric input are ignored.
export function identifyInput(raw: string): IdentifiedInput {
  const s = (raw ?? "").trim();
  if (!s) return { ok: false, error: "Enter a Walmart URL, UPC / GTIN, or item ID." };
  if (/^https?:\/\//i.test(s) || /walmart\.com/i.test(s)) {
    const withProto = /^https?:\/\//i.test(s) ? s : `https://${s}`;
    const n = normalizeWalmartUrl(withProto);
    if (!n.ok || !n.url) return { ok: false, error: n.error || "Invalid Walmart URL." };
    return { ok: true, kind: "url", url: n.url, itemId: n.itemId };
  }
  const digits = s.replace(/[\s-]/g, "");
  if (!/^\d+$/.test(digits)) return { ok: false, error: "Paste a Walmart URL, or a numeric UPC / item ID." };
  if (digits.length >= 12 && digits.length <= 14) return { ok: true, kind: "upc", upc: digits };
  if (digits.length >= 5 && digits.length <= 11) {
    return { ok: true, kind: "item_id", url: `https://www.walmart.com/ip/${digits}`, itemId: digits };
  }
  return { ok: false, error: "Number must be a 5-11 digit Walmart item ID or 12-14 digit UPC / GTIN." };
}

export type FieldSource = "verified" | "public" | "user" | "estimated" | "unavailable";

export type ProductData = {
  title?: string;
  brand?: string;
  walmart_item_id?: string;
  upc_gtin?: string;
  model?: string;
  image?: string;
  price?: number;
  previous_price?: number;
  seller?: string;
  shipped_by?: string;
  rating?: number;
  review_count?: number;
  category?: string;
  size?: string;
  shipping_weight?: string;
  dimensions?: string;
  variants?: string;
  seller_count?: number;
  stock_status?: string;
  product_url?: string;
  data_source?: string;
  last_updated?: string;
  // manual/estimated
  estimated_demand?: number;
  unit_cost?: number;
  order_quantity?: number;
  shipping_cost?: number;
  marketplace_fees?: number;
  product_weight?: number;
  supplier_info?: string;
  // per-field source map
  sources?: Partial<Record<string, FieldSource>>;
  // retrieval diagnostics (set by scan pipeline)
  retrieval?: {
    walmart_status: "ok" | "blocked" | "empty" | "network_error";
    walmart_reason?: string;
    sources_tried: string[];
    tavily_used: boolean;
    fields_recovered: number;
    fields_missing: string[];
    provider?: string;
  };
};