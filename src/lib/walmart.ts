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
};