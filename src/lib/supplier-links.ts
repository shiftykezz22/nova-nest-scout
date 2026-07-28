import type { Supplier } from "./suppliers";
import type { ProductData } from "./walmart";

function q(s: string) {
  return encodeURIComponent(s.replace(/\s+/g, " ").trim());
}

function google(query: string): string {
  return `https://www.google.com/search?q=${q(query)}`;
}

function shortTitle(p: ProductData): string {
  const t = (p.title ?? "").split(/[,|\-–—]/)[0].trim();
  return t.split(/\s+/).slice(0, 8).join(" ");
}

function mkLink(opts: {
  name: string;
  url: string;
  query: string;
  channel: NonNullable<Supplier["channel"]>;
  note: string;
  supplier_type?: Supplier["supplier_type"];
  region_bucket?: Supplier["region_bucket"];
}): Supplier {
  return {
    supplier_name: opts.name,
    supplier_url: opts.url,
    supplier_type: opts.supplier_type ?? "unknown",
    region_bucket: opts.region_bucket ?? "us",
    product_match: "category",
    match_kind: "unverified_lead",
    match_confidence: 0,
    verification_status: "unverified",
    source: "generated_link",
    origin: "generated_link",
    channel: opts.channel,
    query: opts.query,
    contact_data: { snippet: opts.note, is_online: true, last_checked: new Date().toISOString() },
    reasons: ["Pre-filled search link — click to verify supplier and pricing."],
  };
}

export function generateSupplierLinks(product: ProductData, opts?: { location?: string; radiusMiles?: 10 | 25 | 50 }): Supplier[] {
  const brand = product.brand?.trim();
  const title = shortTitle(product);
  const model = product.model?.trim();
  const upc = product.upc_gtin?.trim();
  const pack = product.pack_count ? `${product.pack_count}-pack` : product.size?.trim();
  const cat = product.category?.split(/[/>]/).pop()?.trim();
  const generic = cat || title || brand || "";
  const brandProduct = [brand, title].filter(Boolean).join(" ").trim();
  const withPack = [brandProduct, model, pack].filter(Boolean).join(" ").trim();
  const location = opts?.location?.trim() || "Brooklyn, NY";
  const radius = opts?.radiusMiles ?? 25;

  const out: Supplier[] = [];

  // Wholesalers & Distributors
  if (brandProduct) {
    const query = `${brandProduct} wholesale OR distributor OR "authorized distributor"`;
    out.push(mkLink({ name: "Google — Wholesale & Distributors", url: google(query), query, channel: "wholesale", note: `${brandProduct} · wholesale/distributor search`, supplier_type: "distributor" }));
  }
  if (brand) {
    const query = `"${brand}" authorized distributor`;
    out.push(mkLink({ name: `Google — ${brand} authorized distributors`, url: google(query), query, channel: "wholesale", note: "Find brand-authorized distributors", supplier_type: "authorized_distributor" }));
  }
  if (upc) {
    const query = `${upc} wholesale case pack MOQ`;
    out.push(mkLink({ name: "Google — UPC wholesale search", url: google(query), query, channel: "wholesale", note: `UPC ${upc}`, supplier_type: "wholesaler" }));
  }
  if (generic) {
    const query = `${withPack || generic} bulk OR case pack supplier USA`;
    out.push(mkLink({ name: "Google — Bulk / case-pack suppliers (USA)", url: google(query), query, channel: "wholesale", note: "USA bulk supplier search", supplier_type: "wholesaler" }));
  }
  if (brandProduct) {
    const query = `site:thomasnet.com ${brandProduct}`;
    out.push(mkLink({ name: "ThomasNet — Industrial suppliers", url: google(query), query, channel: "wholesale", note: "ThomasNet directory search", supplier_type: "manufacturer" }));
  }

  // Alibaba / Overseas
  const overseasQuery = [brand, title, pack].filter(Boolean).join(" ").trim() || generic;
  if (overseasQuery) {
    out.push(mkLink({
      name: "Alibaba",
      url: `https://www.alibaba.com/trade/search?SearchText=${q(overseasQuery)}`,
      query: overseasQuery,
      channel: "overseas",
      note: "Alibaba wholesale marketplace",
      supplier_type: "manufacturer",
      region_bucket: "international",
    }));
    out.push(mkLink({
      name: "1688.com",
      url: `https://s.1688.com/selloffer/offer_search.htm?keywords=${q(overseasQuery)}`,
      query: overseasQuery,
      channel: "overseas",
      note: "1688 domestic-China wholesale",
      supplier_type: "manufacturer",
      region_bucket: "international",
    }));
    out.push(mkLink({
      name: "Made-in-China",
      url: `https://www.made-in-china.com/productdirectory.do?word=${q(overseasQuery)}`,
      query: overseasQuery,
      channel: "overseas",
      note: "Made-in-China supplier directory",
      supplier_type: "manufacturer",
      region_bucket: "international",
    }));
    out.push(mkLink({
      name: "Global Sources",
      url: `https://www.globalsources.com/manufacturers/${q(overseasQuery).replace(/%20/g, "-")}.html`,
      query: overseasQuery,
      channel: "overseas",
      note: "Global Sources verified manufacturers",
      supplier_type: "manufacturer",
      region_bucket: "international",
    }));
    const oq = `${overseasQuery} private label manufacturer`;
    out.push(mkLink({ name: "Google — Overseas private label", url: google(oq), query: oq, channel: "overseas", note: "Private-label manufacturer search", supplier_type: "private_label", region_bucket: "international" }));
  }

  // Local / Regional / U.S. Warehouses
  if (generic) {
    const local1 = `${generic} wholesale distributor near ${location}`;
    out.push(mkLink({ name: `Google — Near ${location}`, url: google(local1), query: local1, channel: "local", note: `Distributors near ${location}`, supplier_type: "distributor", region_bucket: "brooklyn" }));
    const local2 = `${generic} wholesaler within ${radius} miles of ${location}`;
    out.push(mkLink({ name: `Google — Within ${radius} miles`, url: google(local2), query: local2, channel: "local", note: `${radius}-mile radius search`, supplier_type: "wholesaler", region_bucket: "brooklyn" }));
    const local3 = `${generic} US warehouse distributor fast shipping`;
    out.push(mkLink({ name: "Google — U.S. warehouse distributors", url: google(local3), query: local3, channel: "local", note: "Domestic US warehouse suppliers", supplier_type: "distributor" }));
  }

  // Marketplaces
  if (brandProduct || generic) {
    const term = brandProduct || generic;
    out.push(mkLink({
      name: "Faire — Independent wholesale",
      url: `https://www.faire.com/search?query=${q(term)}`,
      query: term,
      channel: "marketplace",
      note: "Curated indie wholesale marketplace",
      supplier_type: "wholesaler",
    }));
    out.push(mkLink({
      name: "Google Shopping",
      url: `https://www.google.com/search?tbm=shop&q=${q(term)}`,
      query: term,
      channel: "marketplace",
      note: "Cross-retailer price comparison",
      supplier_type: "retail",
    }));
    out.push(mkLink({
      name: "eBay — Bulk lots",
      url: `https://www.ebay.com/sch/i.html?_nkw=${q(`${term} bulk lot wholesale`)}`,
      query: `${term} bulk lot wholesale`,
      channel: "marketplace",
      note: "Liquidation & bulk lots",
      supplier_type: "wholesaler",
    }));
    out.push(mkLink({
      name: "Amazon Business",
      url: `https://www.amazon.com/s?k=${q(term)}&i=business`,
      query: term,
      channel: "marketplace",
      note: "Amazon Business bulk pricing",
      supplier_type: "retail",
    }));
  }

  return out;
}