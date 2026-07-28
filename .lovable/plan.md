
## Goal

Restructure the scan results page around the decision, make profitability honest, and rebuild Supplier Discovery so ZIP is optional and search auto-uses the scanned product. No changes to the working Walmart retrieval pipeline, DB schema, or auth.

## Reuse (unchanged)

- `src/lib/scan.functions.ts` (retrieval)
- `src/lib/verdict.ts`, `src/lib/calc.ts` (formulas already match spec)
- `src/lib/suppliers.functions.ts` server functions (Tavily-only, key stays server-side)
- `src/components/ProductHero.tsx`, `VerdictCard.tsx`, `ProductEditor.tsx`
- DB tables and RLS as-is

## Changes

### A. Results page hierarchy (`src/components/ResultView.tsx`)

Reorder to: ProductHero → Decision summary → Profitability workspace → Supplier discovery → collapsed "View full product details" accordion (wraps existing `ProductEditor`, closed by default, 2-col on md+, stacked on mobile).

### B. Decision summary

Keep `VerdictCard` and extend with three compact signal chips derived from already-retrieved data:
- Demand: from `rating` + `review_count` (thresholds: strong ≥500 reviews & ≥4.2, moderate ≥50, weak otherwise, unknown if missing)
- Competition: from `seller`/marketplace presence + review count (proxy only; label "estimated")
- Risk: from existing `verdict.risks` and retrieval status
Each chip shows Known vs Estimated badge. No new data sources.

### C. Profitability workspace (new component `src/components/ProfitabilityPanel.tsx`)

Cards for: Supplier unit cost, Shipping/unit, Prep/unit, Referral fee, Other costs, Landed cost, Profit/unit, Margin %, ROI %, Break-even price. Uses existing `calculate()` from `src/lib/calc.ts` (formulas already match spec).

When `sellingPrice<=0` or `unitCost<=0`: show "Cost data required" on dependent cards with a one-line explanation of the missing input. Never invent values.

"Enter or edit costs" drawer (shadcn `Sheet` on desktop, bottom sheet on mobile) with local editable state:
- Supplier unit price, Quantity/MOQ, Total supplier shipping (auto ÷ qty → per-unit), Duties (total or per-unit toggle), Prep/packaging, Referral (% or $), Other costs.
- Live recalculation via `useMemo(calculate,…)`. Values are held in `ResultView` state and flow into the existing `CalcInputs`; persistence stays as today (settings unchanged this phase).

### D. Full Product Details

Move current `ProductEditor` section into shadcn `Accordion` labeled "View full product details", `defaultValue=undefined` (collapsed). Inside: md:grid-cols-2 on desktop, stacked on mobile (styles only; no field logic change).

### E. Supplier Discovery redesign

New component `src/components/SupplierDiscovery.tsx` replacing the current inline section in `ResultView`.

Controls (auto-populated from `product`, all editable):
- Location text input (default "Brooklyn, NY")
- Radius select: 10 / 25 / 50 miles
- Type filter chips: All, Local, Online, Manufacturer, Distributor, Wholesaler
- Match filter: All / Exact / Likely / Category
- Sort: Best match, Lowest cost, Local first

Remove ZIP and Test-qty inputs from this section (qty lives in Profitability drawer).

Server-fn changes (`src/lib/suppliers.functions.ts`):
- Extend `SearchInput` with `location?: string`, `radiusMiles?: 10|25|50`.
- `buildQueries` uses `location`/radius instead of hard-coded NYC boroughs when provided; still fans out to: `[brand] [model] wholesale distributor near [location]`, `[UPC] supplier`, `[generic] wholesaler within [radius] miles of [location]`, `[brand] authorized distributor`, `[category] distributors [location + neighboring region]`. Retains international query when enabled.
- Dedupe key upgraded to combine domain + normalized business name + phone (extracted from snippet) + address line.
- Add `evidence` fields on each `Supplier`: `match_kind: "verified_exact" | "likely" | "category" | "unverified_lead"` derived from existing UPC/brand/model hit logic; keep existing `product_match` for back-compat.

Supplier card (update `src/components/SupplierList.tsx`):
- Show name, type, Local/Online badge, approximate location, website, phone (if in snippet), match evidence + confidence, source link.
- "Verify product and pricing" button (opens supplier URL in new tab).
- "Use this supplier cost" button — disabled until unit cost is entered/confirmed in a small inline input on the card; on click, sets the selected supplier + pushes cost into Profitability inputs.
- Never asserts exact stock unless `match_kind==="verified_exact"`.

States:
- Loading skeleton rows
- Partial results banner when some queries failed
- Empty state with next-action buttons: Broaden radius, Search online only, Search by UPC, Search by generic name, Add supplier manually
- API-error state with retry
- `TAVILY_API_KEY` missing → keep current manual-entry fallback and status message

### F. Non-goals / guardrails

- No Google Places / Yelp / paid APIs.
- No schema migration; new fields (`location`, `phone`, `match_kind`) ride inside existing `supplier_results.contact_data` JSONB and mapped types.
- Tavily key stays in server functions only.
- No fabricated suppliers, prices, or profitability. Existing retrieval pipeline untouched.

## Files touched

- Edit: `src/components/ResultView.tsx`, `src/components/SupplierList.tsx`, `src/lib/suppliers.functions.ts`, `src/lib/suppliers.ts` (types only)
- Add: `src/components/ProfitabilityPanel.tsx`, `src/components/SupplierDiscovery.tsx`
- No DB migrations, no changes to `scan.functions.ts`, `calc.ts`, `verdict.ts`, `ProductHero.tsx`, `ProductEditor.tsx`, auth, or routes.

## Verification

- Typecheck + build.
- Manual: run a scan (e.g. Logitech `774459101`) → verify new order, collapsed details, drawer recalculates live, supplier search runs without ZIP, filters work, empty-state actions appear when no results.
