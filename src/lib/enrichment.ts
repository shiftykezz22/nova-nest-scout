// Phase 2 — Secondary enrichment orchestrator.
//
// Runs after SerpAPI (Phase 1) and Tavily. Fills ONLY empty or low-confidence
// fields — Model #, MPN, hierarchical category — using BlueCart first, then a
// strictly constrained Lovable AI Gateway call as a last resort.
//
// Strict rules:
//   1. Never overwrite a value whose current source is "verified" or "user".
//   2. Only touch model, manufacturer_part_number, manufacturer, brand (if
//      empty), category / category_path, upc_gtin (only when currently empty),
//      and specifications (merged additively; existing keys win).
//   3. LLM must return pure JSON with null for anything it cannot verify.
//   4. Every enriched field is tagged in product.source_names with the origin
//      ("bluecart" | "llm") so the Sources panel can audit later.

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { ProductData } from "./walmart";
import {
  bluecartLookupByUpc,
  bluecartLookupByItemId,
  bluecartLookupByTitle,
  fetchWalmartReviews,
  isBlueCartConfigured,
  isHighConfidence,
  type BlueCartCandidate,
} from "./bluecart";
import { synthesizeCategoryPath, formatCategoryPath } from "./category-map";

export type EnrichmentStage = {
  name: "bluecart" | "llm" | "reviews";
  status: "ok" | "skipped" | "error";
  note?: string;
  matched_by?: "upc" | "title";
  similarity?: number;
  fields_filled?: string[];
};

export type EnrichmentResult = {
  ran: boolean;
  reason: string;
  stages: EnrichmentStage[];
  fields_filled: string[];
  llm_audit?: { input: string; output: string; error?: string };
};

function isWeakCategory(product: Partial<ProductData>): boolean {
  const path = product.category_path;
  if (path && path.length >= 2) return false;
  if (path && path.length === 1 && product.category && product.category.includes(">")) return false;
  if (product.category && product.category.split(">").filter((s) => s.trim()).length >= 2) return false;
  return true;
}

export function needsEnrichment(product: Partial<ProductData>): { need: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!product.model) reasons.push("model_missing");
  if (!product.manufacturer_part_number) reasons.push("mpn_missing");
  if (isWeakCategory(product)) reasons.push("category_weak");
  return { need: reasons.length > 0, reasons };
}

// Enforce the merge policy: only fill empty or non-high-confidence fields.
function canFill(product: Partial<ProductData>, key: keyof ProductData): boolean {
  const cur = product[key];
  if (cur == null || cur === "") return true;
  const src = product.sources?.[key as string];
  return !isHighConfidence(src);
}

function applyFill(
  product: Partial<ProductData>,
  key: keyof ProductData,
  value: unknown,
  origin: "bluecart" | "llm",
  fieldsFilled: string[],
): boolean {
  if (value == null || value === "") return false;
  if (!canFill(product, key)) return false;
  (product as any)[key] = value;
  product.sources = { ...(product.sources ?? {}), [key as string]: origin === "bluecart" ? "public" : "inferred" as any };
  // Track precise provider (used by observations / Sources panel).
  product.source_names = { ...(product.source_names ?? {}), [key as string]: origin };
  fieldsFilled.push(`${String(key)}:${origin}`);
  return true;
}

function mergeBlueCart(product: Partial<ProductData>, cand: BlueCartCandidate, fieldsFilled: string[]): void {
  applyFill(product, "model", cand.model, "bluecart", fieldsFilled);
  applyFill(product, "manufacturer_part_number", cand.manufacturer_part_number, "bluecart", fieldsFilled);
  applyFill(product, "manufacturer", cand.manufacturer, "bluecart", fieldsFilled);
  if (!product.brand) applyFill(product, "brand", cand.brand, "bluecart", fieldsFilled);
  if (!product.upc_gtin) applyFill(product, "upc_gtin", cand.upc_gtin, "bluecart", fieldsFilled);
  if (!product.gtin) applyFill(product, "gtin", cand.gtin, "bluecart", fieldsFilled);
  if (!product.ean) applyFill(product, "ean", cand.ean, "bluecart", fieldsFilled);
  if (!product.image) applyFill(product, "image", cand.image, "bluecart", fieldsFilled);

  // Category path — only fill if current is missing or weak.
  if (isWeakCategory(product) && cand.category_path && cand.category_path.length >= 2) {
    (product as any).category_path = cand.category_path;
    (product as any).category = formatCategoryPath(cand.category_path);
    product.sources = {
      ...(product.sources ?? {}),
      category: "public",
      category_path: "public",
    };
    product.source_names = {
      ...(product.source_names ?? {}),
      category: "bluecart",
      category_path: "bluecart",
    };
    fieldsFilled.push("category_path:bluecart");
  }

  // Specifications — additive merge, existing keys win.
  if (cand.specifications && Object.keys(cand.specifications).length) {
    const cur = product.specifications ?? {};
    let added = 0;
    const merged: Record<string, string> = { ...cur };
    for (const [k, v] of Object.entries(cand.specifications)) {
      if (merged[k] == null || merged[k] === "") { merged[k] = v; added += 1; }
    }
    if (added > 0) {
      product.specifications = merged;
      product.sources = { ...(product.sources ?? {}), specifications: product.sources?.specifications ?? "public" };
      product.source_names = { ...(product.source_names ?? {}), specifications: "bluecart" };
      fieldsFilled.push(`specifications+${added}:bluecart`);
    }
  }
}

// -------- Constrained LLM fallback (Lovable AI Gateway) --------

type LlmFill = {
  model: string | null;
  manufacturer_part_number: string | null;
  manufacturer: string | null;
  category_path: string[] | null;
};

function buildLlmInput(product: Partial<ProductData>): Record<string, unknown> {
  return {
    upc: product.upc_gtin ?? null,
    gtin: product.gtin ?? null,
    title: product.title ?? null,
    brand: product.brand ?? null,
    manufacturer: product.manufacturer ?? null,
    walmart_item_id: product.walmart_item_id ?? null,
    known_model: product.model ?? null,
    known_mpn: product.manufacturer_part_number ?? null,
    known_category: product.category ?? null,
    known_category_path: product.category_path ?? null,
    specifications: product.specifications ?? null,
    description: product.description ? product.description.slice(0, 800) : null,
  };
}

const LLM_SYSTEM = `You are a product identity resolver. Return ONLY strict JSON with keys: "model", "manufacturer_part_number", "manufacturer", "category_path".

RULES (non-negotiable):
- Fill a field ONLY if you can verify the value from real product knowledge tied to the exact brand + title + UPC provided. If you are not certain, return null for that field.
- Do NOT invent, guess, hallucinate, or infer plausible-sounding values.
- "model" is the manufacturer's model number/name (e.g. "G305", "AF101", "DGB-700BC"). Not a marketing name.
- "manufacturer_part_number" is the exact MPN as it appears on the manufacturer's spec sheet.
- "manufacturer" is the legal company name (e.g. "Logitech, Inc."), only if you know it.
- "category_path" is an ordered array of retail-style category segments from broad to narrow, at least 2 segments, e.g. ["Electronics","Computers","Accessories","Mice"]. Return null if you cannot produce a confident path.
- If a known_* value is provided and correct, echo it. If it is provided and clearly wrong, return null (do not correct).
- Output must be a single JSON object. No prose, no code fences, no trailing commas.`;

async function constrainedLlmFill(product: Partial<ProductData>): Promise<{ result?: LlmFill; audit: { input: string; output: string; error?: string } }> {
  const inputObj = buildLlmInput(product);
  const inputStr = JSON.stringify(inputObj);
  const audit: { input: string; output: string; error?: string } = { input: inputStr, output: "" };
  const key = process.env.LOVABLE_API_KEY;
  if (!key) { audit.error = "lovable_api_key_missing"; return { audit }; }
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", "Lovable-API-Key": key },
      body: JSON.stringify({
        model: "openai/gpt-5.6-sol",
        reasoning_effort: "none",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: LLM_SYSTEM },
          { role: "user", content: inputStr },
        ],
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      audit.error = `llm_http_${res.status}: ${text.slice(0, 200)}`;
      return { audit };
    }
    const data: any = await res.json();
    const content: string = data?.choices?.[0]?.message?.content ?? "";
    audit.output = content;
    let parsed: any;
    try { parsed = JSON.parse(content); } catch (e) { audit.error = `llm_json_parse: ${String(e).slice(0, 120)}`; return { audit }; }
    const clean = (v: unknown): string | null => (typeof v === "string" && v.trim() && v.trim().toLowerCase() !== "null" ? v.trim() : null);
    const path = Array.isArray(parsed?.category_path)
      ? parsed.category_path.filter((s: unknown) => typeof s === "string" && (s as string).trim()).map((s: string) => s.trim())
      : null;
    const result: LlmFill = {
      model: clean(parsed?.model),
      manufacturer_part_number: clean(parsed?.manufacturer_part_number),
      manufacturer: clean(parsed?.manufacturer),
      category_path: path && path.length >= 2 ? path : null,
    };
    return { result, audit };
  } catch (e) {
    audit.error = String(e).slice(0, 200);
    return { audit };
  }
}

function mergeLlm(product: Partial<ProductData>, fill: LlmFill, fieldsFilled: string[]): void {
  if (fill.model) applyFill(product, "model", fill.model, "llm", fieldsFilled);
  if (fill.manufacturer_part_number) applyFill(product, "manufacturer_part_number", fill.manufacturer_part_number, "llm", fieldsFilled);
  if (fill.manufacturer) applyFill(product, "manufacturer", fill.manufacturer, "llm", fieldsFilled);
  if (fill.category_path && isWeakCategory(product)) {
    (product as any).category_path = fill.category_path;
    (product as any).category = formatCategoryPath(fill.category_path);
    product.sources = { ...(product.sources ?? {}), category: "inferred" as any, category_path: "inferred" as any };
    product.source_names = { ...(product.source_names ?? {}), category: "llm", category_path: "llm" };
    fieldsFilled.push("category_path:llm");
  }
}

// Public entrypoint — called from resolveAndFetch after Phase 1 + Tavily.
export async function runEnrichment(
  product: Partial<ProductData>,
  ctx: { itemId?: string; upc?: string },
): Promise<EnrichmentResult> {
  const check = needsEnrichment(product);
  const stages: EnrichmentStage[] = [];
  const fieldsFilled: string[] = [];

  if (!check.need) {
    return { ran: false, reason: "no_gaps", stages, fields_filled: [] };
  }

  // Stage 1: BlueCart
  if (!isBlueCartConfigured()) {
    stages.push({ name: "bluecart", status: "skipped", note: "BLUECART_API_KEY not configured" });
  } else {
    const before = fieldsFilled.length;
    let bc: Awaited<ReturnType<typeof bluecartLookupByUpc>> | undefined;
    const upc = product.upc_gtin || product.gtin || ctx.upc;
    if (upc) bc = await bluecartLookupByUpc(upc);
    if ((!bc || !bc.ok) && ctx.itemId) bc = await bluecartLookupByItemId(ctx.itemId);
    if ((!bc || !bc.ok) && product.title) bc = await bluecartLookupByTitle(product.title, product.brand, 0.55);
    if (bc && bc.ok) {
      mergeBlueCart(product, bc.candidate, fieldsFilled);
      stages.push({
        name: "bluecart",
        status: "ok",
        matched_by: bc.matched_by,
        similarity: bc.similarity,
        fields_filled: fieldsFilled.slice(before),
        note: `${fieldsFilled.length - before} field(s) filled via ${bc.matched_by}`,
      });
    } else {
      stages.push({ name: "bluecart", status: "skipped", note: (bc && !bc.ok && bc.reason) || "no_match" });
    }
  }

  // Stage 2: constrained LLM — only if gaps remain after BlueCart.
  const stillNeed = needsEnrichment(product);
  let audit: EnrichmentResult["llm_audit"];
  if (stillNeed.need) {
    const before = fieldsFilled.length;
    const { result, audit: a } = await constrainedLlmFill(product);
    audit = a;
    if (a.error) {
      stages.push({ name: "llm", status: "error", note: a.error });
      console.log("[enrichment.llm] error", a.error);
    } else if (result) {
      mergeLlm(product, result, fieldsFilled);
      stages.push({
        name: "llm",
        status: "ok",
        fields_filled: fieldsFilled.slice(before),
        note: `${fieldsFilled.length - before} field(s) verified by LLM`,
      });
      console.log("[enrichment.llm] audit", { input: a.input, output: a.output, filled: fieldsFilled.slice(before) });
    } else {
      stages.push({ name: "llm", status: "skipped", note: "no_result" });
    }
  }

  // Stage 3: reviews (only if we have an itemId and existing review depth is thin).
  if (ctx.itemId && ((product.review_count ?? 0) < 20 || !product.rating)) {
    const reviews = await fetchWalmartReviews(ctx.itemId);
    if (reviews) {
      (product as any).review_enrichment = reviews;
      if (reviews.total_reviews != null && (product.review_count == null || product.review_count < reviews.total_reviews)) {
        applyFill(product, "review_count", reviews.total_reviews, "bluecart", fieldsFilled);
      }
      stages.push({ name: "reviews", status: "ok", note: `${reviews.total_reviews ?? "?"} total, ${reviews.rating_breakdown ? Object.keys(reviews.rating_breakdown).length + " buckets" : "no breakdown"}` });
    } else {
      stages.push({ name: "reviews", status: "skipped", note: "no_review_data" });
    }
  }

  // Weak-category last-ditch synthesis (never overwrites).
  if (isWeakCategory(product)) {
    const synth = synthesizeCategoryPath({ title: product.title, product_type: product.product_type, manufacturer: product.manufacturer, brand: product.brand });
    if (synth && synth.length >= 2) {
      (product as any).category_path = synth;
      (product as any).category = formatCategoryPath(synth);
      product.sources = { ...(product.sources ?? {}), category: "inferred" as any, category_path: "inferred" as any };
      product.source_names = { ...(product.source_names ?? {}), category: "synthesized", category_path: "synthesized" };
      fieldsFilled.push("category_path:synthesized");
    }
  }

  return { ran: true, reason: check.reasons.join(","), stages, fields_filled: fieldsFilled, llm_audit: audit };
}