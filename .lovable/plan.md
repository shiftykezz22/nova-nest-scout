## Root cause

Tracing the flow end-to-end against the running app and the scan history in the screenshot (two saved Logitech G305 scans with real titles/brands), the pipeline is actually working:

- `identifyInput` extracts `774459101` from `/ip/774459101?sid=...` correctly.
- `analyzeProduct` (auth) and `analyzeProductGuest` call SerpApi via `fetchSerpApiProduct`, save the row, and return the scan id.
- `dashboard.tsx` navigates to `/scans/$id`; `scans.$id.tsx` loads `product_data` from the DB and renders `<ResultView>`.

What's broken is the **result page rendering**, not the pipeline:

1. **No product image anywhere.** `ResultView` renders `VerdictCard` + `ProductEditor` + supplier sections. Neither surfaces `product.image`, even though SerpApi populates it. So even a fully retrieved scan looks empty at a glance.
2. **No consolidated product hero.** Title/brand/price/rating/review count/category/seller are scattered inside the "Product details" field grid — the required top-of-page identity block (image + title + brand + item id + price + rating + reviews + category + seller + availability + source) is missing.
3. **Guest flow saves an ad-hoc `crypto.randomUUID()` in `localStorage`** (never persisted server-side), which is intentional for the guest path but means the "refresh preserves result" check must go through the signed-in `/scans/$id` route where data is DB-backed. That already works; no change needed.

Everything else the phase spec asks for is already implemented: SerpApi is the primary provider, `retrieval.provider` is set, verdict shows `Score pending` + `Insufficient supplier data` when unit cost is missing, calc stats display `—` until cost is entered, and the analyze button is disabled while loading. Those don't need changes.

## Plan

Scope: presentation-only edits on the result view. No backend, no DB, no route changes.

1. **New component `src/components/ProductHero.tsx`**
   - Left: product image (`product.image`) with rounded card, `object-contain`, fixed aspect on mobile; graceful fallback tile with `ShoppingBag` icon when image is null or fails to load (`onError` swap).
   - Right: title, brand, small chips for Walmart Item ID and UPC, price (large, red primary) with previous_price strikethrough, rating stars + review count, category, seller / shipped_by, stock status badge, and a footer line "Source: SerpApi" (or `retrieval.provider` humanized) with the "Last updated" timestamp.
   - All fields use optional chaining and render "Not available" for missing optional fields; hide the whole right-column row only when every field in that row is null.
   - Mobile-first: single column, image on top; two columns from `md:` up.

2. **Wire `ProductHero` into `src/components/ResultView.tsx`**
   - Render it above the existing retrieval banner and `VerdictCard`.
   - Pass `product` and `retrieval` through; no other prop changes.

3. **Small polish in `VerdictCard.tsx`**
   - When `canCalc === false`, change the amber note to the exact copy from the spec: "Walmart product found. Add a supplier cost or supplier URL to calculate profitability." and label the four pending stats (Landed cost, Profit, Margin, ROI, Break-even) with "Pending supplier cost" instead of `—`. Verdict label stays `INSUFFICIENT DATA`; the `nextAction` line beneath the badge will read "Insufficient supplier data".

4. **Verification (post-implementation, in build mode)**
   - Live-test with `https://www.walmart.com/ip/774459101?sid=...` via Playwright against `localhost:8080`:
     - Submit from the landing page (guest flow) and from `/dashboard` (auth flow).
     - Assert: image renders (or fallback if SerpApi omits), title / brand / price / rating / review count / category / seller visible, "Score pending" and "Pending supplier cost" copy present.
     - Reload `/scans/$id` and confirm the same data renders (DB-backed, not React state).
   - Screenshot the result page mobile-width (393px) and desktop (1280px) and view both.

Files touched:

- `src/components/ProductHero.tsx` (new)
- `src/components/ResultView.tsx` (import + render hero)
- `src/components/VerdictCard.tsx` (copy tweaks for pending state)

No changes to `scan.functions.ts`, routes, DB schema, RLS, or the SerpApi request.

## Out of scope

- Any redesign of existing sections.
- Supplier discovery, calc engine, verdict thresholds.
- Backend response shape refactor to the exact keys in the phase spec (`currentPrice`, `mainImage`, etc.) — the existing normalized `ProductData` already carries the same data under stable names the UI reads today; renaming would ripple through DB rows, calc, and supplier code with no user-visible benefit.
