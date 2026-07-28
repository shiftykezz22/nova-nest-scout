# Phase 4 — Product Data, Matching, Profit & Source Verification

Phase 4 is a very large spec. To ship reliably without regressing Phase 3, I'll build it in one coherent pass focused on the user-visible pipeline, while adding the storage/observation layer that unlocks the remaining pieces incrementally. I will preserve the working SerpApi + Tavily retrieval, the red/white design, guest flow, and all existing routes, also make sure when I place a url it can find the exact Walmart information.

## What already works (keep as-is)

- SerpApi `walmart_product` → Tavily fallback pipeline, anti-bot detection
- `product_scans` persistence, scan-id routing, guest one-scan flow
- Verdict engine w/ thresholds, `INSUFFICIENT_DATA` state
- Profitability panel w/ live recalculation, override sheet
- Supplier discovery (Brooklyn default, radius, Tavily-powered)
- Red/white design system, `_authenticated` gate, auth flows

## What I will build

### 1. Input identification & multi-match search

- Extend `identifyInput()` to also accept **product keywords / brand+model** (fallthrough kind = `"query"`), still rejecting empty/URL-with-wrong-host.
- New server fn `searchWalmartMatches(input)` returns **up to 5 candidates** using SerpApi `walmart` search engine for keywords/UPC, or direct product for URL/itemId. Each candidate: image, title, brand, price, rating, reviews, seller, walmart_item_id, upc, match_confidence + match_reasons.
- New route/UI: keyword or UPC → show a **candidate picker** (compact cards) on the dashboard/index; user selects → runs the existing analyze pipeline. Direct URL/itemId → skip picker (unchanged behavior).

### 2. Identifier extraction & product fingerprint

- In `fetchSerpApiProduct` + Walmart HTML parser, also capture: `model_number`, `manufacturer_part_number`, `sku`, `pack_quantity`, `size`, `color`, `condition`, `variation`, `manufacturer`.
- Add `product.fingerprint = { brand, model, pack, size, color, condition }` and a `canonical_key` string.
- Extend `ProductData` type + `ProductEditor` fields.

### 3. Source & confidence system (observations)

- New migration adds `product_observations` and `scan_sources` tables (with GRANTs + RLS scoping through `product_scans`). Skip the full multi-table schema in the spec (products, retail_offers, supplier_offers, profit_scenarios, market_metrics) for now — keep existing `product_scans`/`supplier_results` and layer observations on top. This keeps Phase 3 data intact.
- Every field write during retrieval records a `product_observations` row: `field_name, raw_value, normalized_value, source_name, source_url, verification_status, confidence, retrieved_at`.
- Compute per-field `verification_status`: `verified | cross_checked | single_source | estimated | user_entered | conflicting | unavailable` by grouping observations.
- New `SourcesPanel` component surfaces per-field source, retrieval time, status.

### 4. Cross-check stages (barcode + manufacturer + retail offers)

- New server fn `crossCheckProduct(scanId)` runs after initial retrieval:
  - **Barcode lookup** via Tavily (`"{upc}" product`) — extracts title/brand/model, compares to Walmart values, records observations.
  - **Manufacturer page** via Tavily (`{brand} {model} site:{brand-domain guess}`) — records specs observations.
  - **Retail offers** via Tavily (`"{upc}" OR "{model}" price -walmart`) — parses into new lightweight `retail_offers` shape stored in `product_scans.product_data.retail_offers` JSON array (avoids a new table this pass).
- Reject match when pack/size/model conflict; classify each result as `exact | strong | possible | rejected`.

### 5. Result page tabs

Refactor `ResultView` into 5 tabs sharing the same `scanId`:

- **Overview** — ProductHero, verdict summary chip, product-confidence + data-completeness meters, top-line stats, expandable details.
- **Suppliers** — existing `SupplierDiscovery` + ranked list; supplier row now has a "Use for Profit" button that also **persists** the selection into `product_scans.product_data.selected_supplier_id`.
- **Profit** — the existing `ProfitabilityPanel`, plus 3 scenarios (Conservative/Base/Best) using existing `scenarioInputs`, plus per-metric guidance tooltips.
- **Market** — Demand/Competition/Risk signals (existing helpers) + retail-offer count, price range, availability, review signals, and "Estimated Monthly Sales Range" with explicit method + confidence (not a fake exact number).
- **Verdict** — Large verdict card + positive signals, risks, missing info, next action.

Tabs are implemented with shadcn `Tabs`; state lives in URL search param `?tab=`.

### 6. Profit engine v2

- Ensure `calc.ts` formulas match the spec exactly (they already do; verify `ROI = profit / invested_cost`, where invested = landed cost only).
- Add per-field helper text (short plain-language) under each override in `ProfitabilityPanel` drawer.
- Guard: if `unitCost` missing → show "Supplier cost required to calculate verified profit" and hide numeric profit/ROI/margin (already partly done — extend consistently).

### 7. Loading, errors, caching

- New `ScanProgress` component with **real stage events** streamed via the server fn returning a `stages[]` array of what actually ran (input → identify → walmart → barcode → manufacturer → retail → suppliers → verdict). No fake percentages.
- Error states for: invalid URL, wrong domain, empty result, blocked, no scan found, expired guest — with retry / manual-entry CTAs on the result page.
- Cache freshness: add `fetched_at` per section in `product_data`, show "Retrieved X ago" badges; a "Refresh" button re-runs the pipeline.

### 8. Security review

- All new provider calls remain in server functions using `process.env.*`.
- RLS: new `product_observations` policy scopes via existing `product_scans` ownership (mirrors `supplier_results` policy).
- Guest scans continue to be gated by `guest_session_id` — unchanged.

## Explicit scope trade-offs (called out honestly)

The spec lists ~10 new normalized tables (products, retail_offers, supplier_offers, profit_scenarios, market_metrics, etc.). Fully normalizing right now would rewrite every existing surface and risk Phase 3 regressions. Instead I will:

- Add only `product_observations` + `scan_sources` as new tables.
- Keep `product_scans.product_data` + `supplier_results` as the canonical row stores, with the observation table providing per-field source truth.
- Leave the full split (products / retail_offers / supplier_offers / profit_scenarios / market_metrics) as an optional Phase 4.5 if you want it after this ships. I'll note this in the completion report.

Also deferred: Walmart Marketplace API (no approved creds), UPCitemdb (no key configured) — pipeline will detect and skip gracefully.

## Technical details

**Files to add**

- `src/components/SearchResults.tsx` — candidate picker (5 cards)
- `src/components/SourcesPanel.tsx` — per-field source table
- `src/components/ScanProgress.tsx` — real-stage progress
- `src/components/ResultTabs.tsx` — Tabs wrapper for the 5 tabs
- `src/lib/observations.ts` — helpers to reduce observations → verification_status/confidence
- `src/lib/matching.ts` — fingerprint + match classification (exact/strong/possible/rejected)

**Files to modify**

- `src/lib/walmart.ts` — `identifyInput()` accepts `"query"`; extend `ProductData` fields
- `src/lib/scan.functions.ts` — add `searchWalmartMatches`, `crossCheckProduct`; write observations during retrieval; return stages
- `src/lib/calc.ts` — no formula change; add guidance strings export
- `src/lib/verdict.ts` — feed product_match_confidence + data_completeness into rules; add `strong_buy | promising | borderline | high_risk | insufficient` labels mapped from existing verdict output
- `src/components/ResultView.tsx` — swap body for `ResultTabs`
- `src/components/VerdictCard.tsx` — new label set + next-action line
- `src/components/ProfitabilityPanel.tsx` — inline guidance text, 3 scenarios
- `src/routes/index.tsx`, `src/routes/_authenticated/dashboard.tsx` — call `searchWalmartMatches` first when input is keyword/UPC; render `SearchResults`
- `src/routes/_authenticated/scans.$id.tsx`, `src/routes/guest-result.tsx` — render `ResultTabs`

**Database migration**

```sql
CREATE TABLE public.product_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id uuid NOT NULL REFERENCES public.product_scans(id) ON DELETE CASCADE,
  field_name text NOT NULL,
  raw_value text,
  normalized_value text,
  source_name text NOT NULL,
  source_url text,
  verification_status text NOT NULL,
  confidence numeric NOT NULL DEFAULT 0,
  is_selected_value boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  retrieved_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_observations TO authenticated;
GRANT ALL ON public.product_observations TO service_role;
ALTER TABLE public.product_observations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own observations" ON public.product_observations FOR ALL
  USING (EXISTS (SELECT 1 FROM public.product_scans s WHERE s.id = scan_id AND s.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.product_scans s WHERE s.id = scan_id AND s.user_id = auth.uid()));

CREATE TABLE public.scan_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id uuid NOT NULL REFERENCES public.product_scans(id) ON DELETE CASCADE,
  provider_name text NOT NULL,
  request_type text NOT NULL,
  request_status text NOT NULL,
  source_url text,
  records_returned integer,
  latency_ms integer,
  error_message text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- same GRANTs + RLS via scan ownership
```

**Providers active**: SerpApi (Walmart product + Walmart search), Tavily (barcode / manufacturer / retail / supplier). Waiting on keys: Walmart Marketplace API, UPCitemdb.

## Verification before I claim done

- Run: URL, URL with tracking, itemId, UPC, keyword — confirm picker appears for keyword/UPC, direct load for URL/itemId.
- Refresh page — same scan id, all tabs load.
- Missing supplier cost → verdict = Insufficient Data, no fabricated profit.
- Sources panel shows real provider + retrieved-at for at least title/price/rating.
- Blocked scan (item 13063753535) — no blank, message shown, retry works.

I'll deliver a completion report at the end covering what shipped, deferred, and remaining limitations.