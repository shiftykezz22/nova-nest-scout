
# NovaNest Scout — Data Foundation Overhaul

## Executive summary of likely root causes

Inspection of `src/lib/scan.functions.ts` (the SerpAPI mapper in `fetchSerpApiProduct`, lines ~76–208) shows the current pipeline is under-using the SerpAPI Walmart Product response:

1. **Model # / MPN empty**: only reads top-level `p.model`, `p.model_number`, `p.manufacturer_part_number`, `p.mpn`, `p.part_number`. SerpAPI actually returns these inside `specification_highlights[]` and `specifications[]` (key/value pairs like "Manufacturer Part Number", "Model", "Item Model Number"). Those arrays are never parsed. There is also no fallback extraction from title/description.
2. **Category weak / non-hierarchical**: only reads `p.breadcrumbs`, `p.category`. The richer `categories[]` array (ordered, with names) and `product_type` field are ignored. When Walmart returns nothing, no deterministic fallback synthesizes a category from title + brand + product_type.
3. **Product Confidence stuck ~49**: confidence math (around line 639–645) counts a narrow key set and only adds bonuses for brand+model and MPN — both of which are usually empty because of #1. It never counts specs, manufacturer, category depth, description, or images.
4. **Opportunity Score blank**: gated correctly on supplier cost, but there is no explicit "Needs more data" surfacing tied to the exact missing inputs.
5. **Supplier breadth**: generated links + Tavily bucket is narrow (Google/Alibaba/ThomasNet/Faire only). No Abound, no beauty-specific distributors, no Amazon Business, weak dedup, no cross-bucket labeling.

Nothing here needs a new provider yet — Phase 1 is a mapping fix.

## Phase 0 — Audit (deliverable before any code)

**Test product set** (URLs / IDs):

1. Dove Beauty Bar Sensitive Skin 4-bar — `10450434` (current failure: empty MPN/model, weak category)
2. Logitech G305 Wireless Gaming Mouse — `774459101` (baseline that mostly works)
3. Great Value Purified Drinking Water 40pk — `10315395` (private label, no brand model)
4. Ninja AF101 Air Fryer — `55536898` (rich electronics case)
5. Crest 3D White Toothpaste 3-pack — `55573527` (CPG multi-pack)
6. Apple AirPods Pro (2nd gen) — `5032708142` (brand-authorized, price map)
7. Rubbermaid Brilliance 22-cup — `55581757` (housewares)
8. Fisher-Price Little People — `27408923` (toys, model number in specs)
9. Nike Men's Revolution 6 — `1440612859` (apparel, size/color variants)
10. NOW Foods Vitamin D3 — `13735983` (supplement, UPC-heavy)

**Audit steps** (`src/lib/scan.functions.ts::fetchSerpApiProduct` + a scratch admin script):

- For each ID, log the full raw SerpAPI JSON to `/tmp/audit/<id>.json` (server-side only, keys redacted).
- Produce `audit-report.md` listing per product: fields currently mapped vs. fields present. Explicitly enumerate untouched high-value keys: `categories[]`, `specification_highlights[]`, `specifications[]`, `manufacturer`, `manufacture_number`, `product_type`, `detailed_description_html`, `short_description_html`, `price_map`, `reviews`, `rating`, `images[]`, `variants`.
- Cite exact file:line of every failure point (mapping omission or fallback gap).

**Gate**: audit report reviewed before Phase 1 code lands.

## Phase 1 — Expand SerpAPI mapping (highest ROI, no new providers)

Files touched:

- `src/lib/scan.functions.ts` — `fetchSerpApiProduct` (rewrite mapping section, lines 95–202) and confidence block (lines 639–645).
- `src/lib/walmart.ts` — extend `ProductData` with `specifications?: Record<string,string>`, `product_type?`, `category_path?: string[]`, `description?: string`.
- `src/lib/matching.ts` — expand `productFingerprint` to consume `specifications`.
- `src/components/SourcesPanel.tsx`, `src/components/ProductEditor.tsx`, Overview tab in `src/components/ResultTabs.tsx` — surface Model, MPN, Manufacturer, Category path, Specs, Description.

Mapping additions:

1. **Specs → Model/MPN**: iterate `specification_highlights[]` and `specifications[]`; normalize keys (lowercase, strip punctuation) and match against a synonym table:
   - `model` ← "model", "model number", "item model number", "model name"
   - `manufacturer_part_number` ← "manufacturer part number", "mpn", "part number", "part #", "vendor part #"
   - `manufacturer` ← "manufacturer", "brand"
   - `pack_quantity`, `size`, `color`, `condition`, `assembled dimensions`, `weight`, etc.
   Persist the full spec dictionary in `product.specifications` and mark `sources.model = "verified"` only when sourced from specs.
2. **Categories**: prefer `categories[]` (already ordered) → produce `category_path: string[]` and pretty `category` = `path.join(" > ")`. Fall back to `breadcrumbs`, then to deterministic synthesis (Phase 1c).
3. **product_type**: capture verbatim.
4. **Descriptions**: strip HTML from `detailed_description_html` / `short_description_html` (regex/DOMParser-free simple stripper already used elsewhere) → `description`.
5. **Title/description regex fallback for Model/MPN** (only when specs miss): patterns like `\bModel[:# ]+([A-Z0-9\-]{3,})`, `\bMPN[:# ]+…`, `\b([A-Z]{1,3}[- ]?\d{2,5}[A-Z0-9]{0,4})\b` inside title after brand. Never overwrite an existing verified value.
6. **Deterministic hierarchical category fallback** (`src/lib/category-map.ts`, new): keyword → path table:
   - "soap|body wash|bar" → `Beauty > Bath & Body > Bar Soap`
   - "air fryer" → `Home > Kitchen > Small Appliances > Air Fryers`
   - "toothpaste" → `Health > Oral Care > Toothpaste`
   - ~40 rules covering the top Walmart trees; strictly rule-based, no LLM.
   Input: title + product_type + manufacturer. Output is only used when SerpAPI categories are missing/single-node.

## Phase 2 — Secondary enrichment (only after Phase 1 is verified)

Files: `src/lib/enrichment.functions.ts` (new server fn), invoked from `scan.functions.ts` after primary map when `!model && !manufacturer_part_number` OR `category_path.length < 2`.

- **Primary secondary**: BlueCart Walmart Product API by UPC then title. Merge rule: prefer exact UPC match; overwrite only null fields; never replace a `verified` value.
- **Fallbacks**: Oxylabs, then Unwrangle (feature-flagged, one at a time).
- **Last resort constrained LLM** (Lovable AI Gateway, `google/gemini-2.5-flash`): input = `{title, upc, brand, existing_specs}`; system prompt forces JSON `{model|null, mpn|null, category_path|null}` and forbids invention (returns null when uncertain). Tag output `source: "llm_constrained"`, confidence penalty applied.
- SerpAPI Walmart Reviews endpoint added only if review depth still insufficient after Phase 1 (deferred; decision after audit).

Add `SECONDARY_ENRICHMENT_KEY` via `secrets--add_secret` when a provider is selected — no key hardcoded.

## Phase 3 — Supplier engine upgrade (extend, do not rewrite)

Files: `src/lib/supplier-links.ts`, `src/lib/suppliers.functions.ts`, `src/components/SupplierDiscovery.tsx`, `src/components/SupplierList.tsx`.

- Add generated-link buckets: Abound, Faire (already there — expand), RangeMe, Bulk Apothecary / Essential Wholesale (beauty), McKesson & Kinray (health), Wholesale Central, Amazon Business, Global Sources, DHgate, IndiaMART, manufacturer.com direct (derive from brand domain), Liquidation.com / B-Stock.
- Parallelize live queries per bucket with `Promise.allSettled`; keep 10-min in-memory cache.
- **Dedup**: normalize by `registrable domain + product identity hash (brand+model|upc|title tokens)`.
- **Labels** (extend `assignBadges` in `src/lib/suppliers.ts`): Best Overall, Best Price, Lowest MOQ, Domestic/Fast Ship, Highest Confidence, Overseas Volume Play.
- **Coverage guarantee**: after ranking, if no supplier has `country === "US"` inject the top generated domestic link; same for overseas.

## Phase 4 — Scoring & trust signals

Files: `src/lib/verdict.ts`, `src/lib/observations.ts`, new `src/lib/confidence.ts`.

- **Product Confidence**: weighted sum over expanded field set — UPC/GTIN presence (20), brand (10), model (15), MPN (10), manufacturer (5), category_path depth ≥2 (10), specs count ≥5 (10), price (10), rating+reviews (5), image (5). Cross-source agreement adds up to +10.
- **Data Completeness %**: proportion of a fixed critical-field list populated (title, price, brand, model, MPN, upc, category_path, manufacturer, image, specs, rating, review_count).
- **Opportunity Score**: only when `product.price > 0` AND at least one supplier with real `unit_cost > 0`. Otherwise UI shows "Needs more data — add a supplier cost". Never estimated into a numeric score.
- Estimate-driven verdicts remain in `verdict.ts` but the numeric Opportunity Score stays hidden until real cost exists.

## Phase 5 — System prompt lock-in (after 0–4 planned)

New `src/lib/prompts/enrichment-agent.md` (single source of truth) covering: full SerpAPI field usage, mandatory hierarchical category, aggressive-but-truthful Model/MPN extraction (with null when unsure), enrichment cascade order, supplier labeling rules, scoring rules. Referenced by the constrained LLM call in Phase 2 and any future agent.

## Phase 6 — Test suite (mandatory gate)

New `tests/data-foundation.test.ts` (Vitest) run via `bunx vitest run`. Fixtures = recorded SerpAPI responses for the 10 audit products under `tests/fixtures/serpapi/`.

Per-product assertions:

- `model` OR `manufacturer_part_number` present when the audit report says it exists in the wild.
- `category_path.length >= 2` always.
- `confidence >= 65` when audit marks the product as "rich data".
- `opportunityScore === null` when no supplier cost; numeric only otherwise.
- ≥1 supplier with `country === "US"` AND ≥1 with `country !== "US"` when live search enabled.
- No field carries a value the fixture doesn't support (hallucination guard: snapshot compare).

Run after every phase; a phase is "done" only when the suite is green.

## Explicitly NOT in this cycle

- No custom Walmart scraper.
- No official Walmart Marketplace seller API integration.
- More than one secondary enrichment provider active at a time.
- Free-form LLM writing of product fields (only constrained, null-allowed JSON output).
- Any redesign of the 5-tab results UI, red/white theme, or auth flow.
- New database tables or migrations beyond adding nullable columns for `specifications`, `category_path`, `product_type`, `description` on `product_scans`.

## Success metrics

- Dove Beauty Bar: `model` or `mpn` populated, `category_path = ["Beauty","Bath & Body","Bar Soap"]`, confidence ≥ 65.
- Across the 10-product suite: ≥80% have non-empty Model or MPN when it exists; 100% have hierarchical category; average Product Confidence rises from ~49 to ≥70 on rich items; Opportunity Score never appears without supplier cost; ≥1 domestic + ≥1 overseas supplier surfaced on ≥80% of runs.

Begin with Phase 0 audit; no implementation code until the audit report is reviewed.
