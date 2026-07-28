export type Supplier = {
  id?: string;
  supplier_name: string;
  supplier_url?: string;
  supplier_type?: "manufacturer" | "wholesaler" | "distributor" | "authorized_distributor" | "importer" | "private_label" | "retail" | "unknown";
  location?: string;
  country?: string;
  region_bucket?: "brooklyn" | "queens" | "bronx" | "manhattan_si" | "long_island" | "north_nj" | "ct_epa" | "us" | "international";
  product_match?: "exact" | "likely" | "similar" | "category" | "weak";
  match_confidence?: number; // 0-100
  match_kind?: "verified_exact" | "likely" | "category" | "unverified_lead";
  unit_cost?: number | null;
  currency?: string;
  moq?: number | null;
  case_pack?: number | null;
  estimated_shipping?: number | null;
  lead_time_days?: number | null;
  sample_available?: boolean | null;
  private_label_available?: boolean | null;
  authorization_status?: "authorized" | "not_confirmed" | "unauthorized" | null;
  verification_status?: "verified_public" | "partially_verified" | "unverified" | "quote_required";
  source?: string;
  contact_data?: {
    email?: string;
    phone?: string;
    quote_page?: string;
    last_checked?: string;
    snippet?: string;
    address?: string;
    approximate_location?: string;
    is_online?: boolean;
  };
  warnings?: string[];
  reasons?: string[];
  estimated_landed_cost?: number | null;
};

export type SupplierWeights = {
  cost: number; match: number; verification: number; moq: number; lead: number; local: number; sample: number; authorization: number;
};

export const DEFAULT_WEIGHTS: SupplierWeights = {
  cost: 0.30, match: 0.20, verification: 0.15, moq: 0.10, lead: 0.10, local: 0.05, sample: 0.05, authorization: 0.05,
};

export const MATCH_SCORE: Record<NonNullable<Supplier["product_match"]>, number> = {
  exact: 100, likely: 80, similar: 55, category: 35, weak: 15,
};

const VERIFY_SCORE: Record<NonNullable<Supplier["verification_status"]>, number> = {
  verified_public: 100, partially_verified: 70, unverified: 30, quote_required: 55,
};

const REGION_SCORE: Record<NonNullable<Supplier["region_bucket"]>, number> = {
  brooklyn: 100, queens: 95, bronx: 90, manhattan_si: 85, long_island: 80, north_nj: 75, ct_epa: 65, us: 50, international: 20,
};

export function scoreSupplier(s: Supplier, walmartPrice: number | undefined, w: SupplierWeights = DEFAULT_WEIGHTS): { total: number; parts: Record<string, number> } {
  const cost = s.unit_cost != null && walmartPrice
    ? Math.max(0, Math.min(100, 100 - (s.unit_cost / walmartPrice) * 100))
    : s.verification_status === "quote_required" ? 40 : 0;
  const match = s.product_match ? MATCH_SCORE[s.product_match] : 30;
  const verification = s.verification_status ? VERIFY_SCORE[s.verification_status] : 30;
  const moq = s.moq == null ? 50 : s.moq <= 10 ? 100 : s.moq <= 50 ? 80 : s.moq <= 200 ? 60 : s.moq <= 1000 ? 40 : 20;
  const lead = s.lead_time_days == null ? 50 : s.lead_time_days <= 7 ? 100 : s.lead_time_days <= 14 ? 80 : s.lead_time_days <= 30 ? 60 : 30;
  const local = s.region_bucket ? REGION_SCORE[s.region_bucket] : 30;
  const sample = s.sample_available ? 100 : s.sample_available === false ? 20 : 50;
  const authorization = s.authorization_status === "authorized" ? 100 : s.authorization_status === "not_confirmed" ? 40 : s.authorization_status === "unauthorized" ? 0 : 50;

  const parts = { cost, match, verification, moq, lead, local, sample, authorization };
  const total = Math.round(
    cost * w.cost + match * w.match + verification * w.verification + moq * w.moq +
    lead * w.lead + local * w.local + sample * w.sample + authorization * w.authorization
  );
  return { total, parts };
}

export function assignBadges(list: Supplier[], walmartPrice?: number): Record<string, string[]> {
  const badges: Record<string, string[]> = {};
  if (!list.length) return badges;
  const key = (s: Supplier) => s.id ?? `${s.supplier_name}|${s.supplier_url ?? ""}`;
  const scored = list.map((s) => ({ s, score: scoreSupplier(s, walmartPrice).total }));
  const best = scored.slice().sort((a, b) => b.score - a.score)[0];
  if (best) (badges[key(best.s)] ||= []).push("Best Overall");
  const local = scored.filter((x) => x.s.region_bucket && !["us", "international"].includes(x.s.region_bucket))
    .sort((a, b) => b.score - a.score)[0];
  if (local) (badges[key(local.s)] ||= []).push("Best Local");
  const pricedPublic = list.filter((s) => typeof s.unit_cost === "number" && s.unit_cost! > 0 && s.verification_status !== "quote_required");
  const lowest = pricedPublic.slice().sort((a, b) => (a.unit_cost as number) - (b.unit_cost as number))[0];
  if (lowest) (badges[key(lowest)] ||= []).push("Lowest Public Price");
  const lowMoq = list.filter((s) => typeof s.moq === "number").sort((a, b) => (a.moq as number) - (b.moq as number))[0];
  if (lowMoq) (badges[key(lowMoq)] ||= []).push("Lowest MOQ");
  const fastest = list.filter((s) => typeof s.lead_time_days === "number").sort((a, b) => (a.lead_time_days as number) - (b.lead_time_days as number))[0];
  if (fastest) (badges[key(fastest)] ||= []).push("Fastest Potential Delivery");
  const mostVerified = list.filter((s) => s.verification_status === "verified_public")[0];
  if (mostVerified) (badges[key(mostVerified)] ||= []).push("Most Verified");
  list.filter((s) => s.verification_status === "quote_required").forEach((s) => (badges[key(s)] ||= []).push("Quote Needed"));
  return badges;
}

export function buildQuoteRequest(opts: { title?: string; identifier?: string; zip?: string; quantity?: number }): string {
  const title = opts.title || "the referenced product";
  const id = opts.identifier || "not provided";
  const zip = opts.zip || "our warehouse";
  const qty = opts.quantity ? ` We are considering an initial quantity of approximately ${opts.quantity} units.` : "";
  return `Hello,\n\nI am requesting a wholesale quote for ${title}. The UPC/model is ${id}. Please provide your unit price, case-pack quantity, minimum order quantity, available quantity, shipping or freight cost to ${zip}, lead time, sample availability, payment terms, and any manufacturer-authorization or resale documentation.${qty}\n\nThank you,`;
}
