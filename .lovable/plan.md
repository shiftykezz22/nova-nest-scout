# Phase 4 — Complete Product Data, Matching, Profit & Source Verification

Goal: finish the Phase 4 pipeline in one Build by hardening Phase 3, filling gaps in identifier extraction, cross-checking, retail comparables, source transparency, and per-tab views — without a rewrite. Keep SerpApi + Tavily, the red/white design, guest flow, `product_scans`/`supplier_results`, and the 5-tab layout intact.

## What already exists (preserve)

- SerpApi `walmart_product` + Tavily fallback pipeline with anti-bot detection
- `identifyInput()` supporting URL / item_id / UPC / keyword
- `searchWalmartMatches()` returning up to 5 candidates (SerpApi `walmart` search)
- `product_scans`, `product_observations`, `scan_sources`, `supplier_results` tables (RLS scoped by scan ownership)
- 5-tab `ResultTabs` (Overview / Suppliers / Profit / Market / Verdict), `ProductHero`, `ProfitabilityPanel`, `SupplierDiscovery`, `SourcesPanel`, `VerdictCard`
- Guest one-scan flow, `_authenticated` gate, auth, `/scans/$id` and `/guest-result` routes
- `analyzeProduct` writes `scan_sources` + per-field `product_observations`

## Gaps this Build closes

1. **URL preview + confirmation** — direct URLs currently auto-navigate to the result page. Add a "Confirm this product" preview card on `dashboard` + `index` after retrieval, before analyze commits (dashboard already has a search picker for keywords/UPC; add a similar single-card confirmation for URL/item_id).
2. **Barcode verification (Stage 3)** — no cross-check runs against a barcode source today. Add a Tavily-powered UPC/GTIN lookup that compares title/brand/model/size and writes `product_observations` with `cross_checked` when a second source agrees, `conflicting` when it disagrees. UPCitemdb stays optional (used only if `UPCITEMDB_API_KEY` secret is present; otherwise skipped cleanly).
3. **Manufacturer verification (Stage 4)** — add a Tavily query for `{brand} {model}` restricted away from marketplace hosts; record MPN / model / specs observations; upgrade fields from `single_source` to `cross_checked` when they match Walmart values.
4. **Retail comparables (Stage 5)** — add a Tavily query (`"{upc}" OR "{brand} {model}" price -site:walmart.com`) that parses retailer name, URL, and price. Store as `product_data.retail_offers[]` (avoid a new table this pass — noted trade-off below). Reject offers whose title lacks the brand + model / pack.
5. **Product matching engine** — add `src/lib/matching.ts` with `classifyMatch(candidateFingerprint, referenceFingerprint) → exact | strong | possible | rejected` using pack/size/model/color/condition rules. Used for retail offers and supplier offers; only `exact`/`strong` feed into profit auto-fill.
6. **Real stage progress** — extend the stages array to the 10 stages in the spec, streamed through the returned scan record; `ScanProgress` reads `product.retrieval.stages`. No fake percentages; each stage is `ok | skipped | error` with a `note`.
7. **Source & confidence rollup** — expand `SourcesPanel` to show verification status (Verified / Cross-Checked / Single Source / Estimated / User Entered / Conflicting / Unavailable), retrieved-at, and source link, aggregating from `product_observations`. Add helper `src/lib/observations.ts`.
8. **Market tab honesty** — never invent monthly sales / seller counts. Add "Estimated Monthly Sales Range" (Low–High) only when review count + rating exist, with explicit method + confidence copy; show "Insufficient Data" otherwise. Separate Walmart direct offer vs marketplace vs retail offers vs supplier offers.
9. **Verdict labels** — align to `Strong Buy Candidate | Promising — Verify Supplier | Borderline | High Risk | Insufficient Data` using existing `evaluate()` output plus product confidence + data completeness thresholds. Rule-based only; no AI override.
10. **Profit engine v2** — formulas already match; add inline guidance strings, add Conservative/Base/Best scenarios (adjust supplier cost ±10%, referral fee, advertising) inside `ProfitabilityPanel`. Keep "Supplier cost required" gate.
11. **Error / empty states** — invalid URL, wrong domain, blocked scan, no candidates, expired guest, scan-not-found, provider timeouts each render a friendly card with Retry / Manual entry / Return-to-scanner CTAs instead of blank content.
12. **Freshness** — add `fetched_at` per section in `product_data` + a "Refresh" button that re-runs the pipeline against the same scan id (updates row + inserts new `product_observations`).

## Files touched

**New**
- `src/lib/matching.ts` — fingerprint + classify
- `src/lib/observations.ts` — reduce observations → verification_status/confidence per field
- `src/lib/retail.ts` — Tavily retail-offer parser (pure functions; called from server fn)
- `src/components/ScanProgress.tsx` — real-stage list
- `src/components/ConfirmProductCard.tsx` — URL/item_id preview before analyze
- `src/components/RetailOffers.tsx` — comparables list (Market tab)
- `src/components/ScenarioTable.tsx` — Conservative/Base/Best rows

**Modified**
- `src/lib/scan.functions.ts` — add `crossCheckProduct(scanId)`, `refreshScan(scanId)`, extend stages, log retail_offers, run barcode + manufacturer queries via Tavily; write richer observations (`verification_status` from cross-check)
- `src/lib/walmart.ts` — expose `productFingerprint()` and `canonicalKey()`
- `src/lib/verdict.ts` — map to new 5 labels using confidence + completeness thresholds
- `src/components/ResultTabs.tsx` — Market tab surfaces retail offers + monthly-sales range; Verdict tab uses new labels; Overview shows freshness + Refresh; Profit tab renders `ScenarioTable`
- `src/components/SourcesPanel.tsx` — read from `product_observations` (server fn `listObservations(scanId)`), render 7 statuses, retrieved-at
- `src/components/ProfitabilityPanel.tsx` — inline guidance, scenarios, keep gate
- `src/components/VerdictCard.tsx` — new label copy + next-action line
- `src/routes/_authenticated/dashboard.tsx`, `src/routes/index.tsx` — add ConfirmProductCard for URL/item_id inputs (preview → user clicks Analyze)
- `src/routes/_authenticated/scans.$id.tsx`, `src/routes/guest-result.tsx` — pass observations + retrieval stages to ResultTabs; render ScanProgress while loading; render friendly error card when scan not found

## Database

Existing tables (`product_scans`, `product_observations`, `scan_sources`, `supplier_results`, `saved_products`, `calculation_settings`, `profiles`) cover the flow. The spec's full normalization (separate `products`, `retail_offers`, `supplier_offers`, `profit_scenarios`, `market_metrics`) is intentionally deferred to a follow-up pass to avoid regressing Phase 3 surfaces — this pass keeps `product_scans.product_data` + `supplier_results` as the row stores and `product_observations` as per-field source truth. `retail_offers` live in `product_scans.product_data.retail_offers` (JSON array). Called out as an explicit trade-off in the completion report.

**Migration this Build** (rollback-safe — additive, `IF NOT EXISTS` where applicable):

```sql
ALTER TABLE public.product_scans
  ADD COLUMN IF NOT EXISTS input_type text,
  ADD COLUMN IF NOT EXISTS product_match_confidence numeric,
  ADD COLUMN IF NOT EXISTS data_completeness_score numeric,
  ADD COLUMN IF NOT EXISTS error_code text,
  ADD COLUMN IF NOT EXISTS error_message text,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

CREATE INDEX IF NOT EXISTS product_observations_scan_field_idx
  ON public.product_observations(scan_id, field_name);
```

No RLS changes, no GRANT changes (columns inherit table grants). Safe to apply without data loss.

## Data providers

| Provider | Status | Used for | Fallback |
| --- | --- | --- | --- |
| SerpApi `walmart_product` | Active (`SERPAPI_API_KEY`) | Walmart product retrieval | Tavily |
| SerpApi `walmart` search | Active | Candidate picker (keyword/UPC) | Warn + suggest URL |
| Tavily | Active (`TAVILY_API_KEY`) | Barcode / manufacturer / retail / supplier | Skip stage, mark `unavailable` |
| UPCitemdb | **Not configured** — skipped cleanly | Extra barcode source | Tavily |
| Walmart Marketplace API | **Not configured** — skipped cleanly | Verified seller count / offers | Show "unknown" |

Every stage records a `scan_sources` row (`request_status = ok | skipped | error`). No stage failure blanks the page.

## Security

- All provider calls stay in server functions using `process.env.*`. No new secrets are added to the browser bundle.
- `product_observations` and `scan_sources` RLS is already scan-scoped via `product_scans` ownership.
- Guest scans remain `guest_session_id` gated; no cross-guest access.
- `refreshScan` requires `requireSupabaseAuth` (owner-only) for authenticated scans; guest scans use `guest_session_id` verification.
- No API keys logged. Server logs redact query strings containing `api_key`.

## Anti-fabrication guarantees

- Profit / ROI / margin / break-even hidden when `unitCost` missing → verdict = `Insufficient Data`.
- Monthly-sales rendered only as a range with confidence; label "Estimated" always visible.
- Seller count only shown when retrieved; otherwise "Unknown".
- Retail offer rejected when brand + model can't both be matched in the offer title.
- Cross-checked only when ≥2 independent sources agree; else `single_source`.

## End-to-end tests (executed in Build)

1. Paste `https://www.walmart.com/ip/774459101` → Confirm card → Analyze → all 5 tabs populated with same scan id → refresh page → same data.
2. Paste same URL + `?athcpid=xxx` → same normalized item id, tracking stripped.
3. Paste `774459101` → same result as (1).
4. Paste UPC `097855155184` → 5 candidates → pick one → analyze → sources panel shows UPC as cross-checked when barcode stage confirms.
5. Search `logitech g305 wireless mouse` → 5 candidates → pick → analyze.
6. Enter blocked item id `13063753535` → SerpApi succeeds or Tavily fallback runs → no blank; retrieval banner shown.
7. Direct visit to `/scans/does-not-exist` → friendly not-found card, not blank.
8. No supplier cost → verdict = Insufficient Data; profit hidden.
9. Enter manual supplier cost → recalculates; observation logged as `user_entered`.
10. Toggle Refresh → new `scan_sources` rows + updated `fetched_at`.
11. `bunx tsgo` + `bunx vitest run` (if tests exist) + build; browser smoke via Playwright screenshots of Overview / Suppliers / Profit / Market / Verdict on desktop + mobile.
12. Grep frontend bundle for `SERPAPI_API_KEY`, `TAVILY_API_KEY` → confirm absent.

## Completion report (produced after Build)

Will list: preserved Phase 3 surfaces, new/modified files, migration applied, active vs deferred providers, identifiers extracted (walmart_item_id, upc, ean, gtin, model, mpn, sku, pack, size, color, condition), profit formulas implemented, confidence-status mapping, tests passed / failed, and explicit remaining limitations (deferred normalized schema, UPCitemdb + Walmart Marketplace still awaiting keys).
