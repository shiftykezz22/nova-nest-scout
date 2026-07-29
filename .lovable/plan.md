## Scope

Two parts. Part 1 (bath towel profit scan) is a live research task — the app itself is the tool that produces those numbers from real Walmart data. I can't fabricate a market snapshot from thin air without running scans against SerpAPI/BlueCart for real 6-piece towel listings, and doing that inside this plan turn would just be invented numbers. I'll wire up part 2 and, once built, we can point the new comparison flow (plus the existing scanner) at 3–5 real 6-piece towel URLs to produce the profit scan with actual data.

Part 2 is a concrete build: an Amazon vs Walmart side-by-side comparison feature.

## Part 2 — Amazon vs Walmart Comparison

### New route
`src/routes/compare.tsx` (public, guest-accessible like `/guest-result`). Mobile-first, matches existing red/white/charcoal shell. Adds a nav entry in `__root.tsx`.

### UI flow
1. **Walmart side**: paste a Walmart URL / UPC / item ID → runs existing `resolveAndFetch` pipeline (SerpAPI → BlueCart enrichment already in place). Reuses `ProductHero`-style card.
2. **Amazon side**: two input modes in a tabbed panel:
   - **Manual entry** (default, always works): price, rating, review count, image URL, title, ASIN — small form.
   - **Auto-fetch** (disabled placeholder with tooltip "Free tier — coming soon"): wired to `src/lib/amazon.ts` so real data drops in later without UI changes.
3. **Comparison summary card** below both: price delta, rating delta, review-count delta, and a "Better value on Walmart / Amazon / Tie" verdict using a simple rule (lower price wins unless rating gap > 0.5 stars with 50+ reviews).
4. **Banner**: "Amazon data currently limited — free tier / manual mode active."

### New files
- `src/lib/amazon.ts` — typed `AmazonProduct` + `fetchAmazonProduct(input)` service layer. Returns `{ ok: false, reason: "manual_only" }` today; shape ready for Keepa/Rainforest/etc. Includes ASIN extraction from `amazon.com/dp/XXXX` and `/gp/product/XXXX` URLs.
- `src/lib/compare.ts` — pure comparison logic: `compareOffers(walmart, amazon) → { winner, priceDelta, ratingDelta, reviewsDelta, rationale }`. Unit-testable, no I/O.
- `src/components/CompareCard.tsx` — one side (image, title, price, rating, reviews, "source" badge). Reused for both retailers.
- `src/components/CompareSummary.tsx` — the "Better value on…" card.
- `src/routes/compare.tsx` — route wiring, state, head() metadata, banner.

### Reused, not rebuilt
- Walmart fetch: existing `scan.functions.ts` `resolveAndFetch` (already uses SerpAPI + BlueCart via `enrichment.ts`).
- Styling: existing tokens in `styles.css`, shadcn components (`Card`, `Input`, `Button`, `Badge`, `Tabs`).
- Guest gating: not applied — comparison is free-tier feature, no scan-quota consumption on the Amazon side (Walmart side still counts against existing guest scan if user is a guest).

### Explicitly out of scope for this pass
- Real Amazon data provider integration (structure prepared, no credentials wired).
- Persisting comparisons to the database.
- Multi-product comparison / history.
- Automatic Amazon lookup from a Walmart product (would need identifier reconciliation across marketplaces; deferred).

### Technical notes
- `amazon.ts` deliberately does NOT read `process.env` yet; when a provider is picked, it'll live behind a `createServerFn` so keys stay server-side (same pattern as SerpAPI/BlueCart).
- `compareOffers` is a pure function to keep the "Better value" rule easy to iterate.
- No DB migration needed.

## Follow-up after build

Once the comparison route is live, I'll run 3–5 real 6-piece bath towel scans through the existing scanner and the new compare page to produce the actual Part 1 profit scan with real prices, ratings, and margin math — instead of guessing.

## Open question

For the "Better value" rule, is the current heuristic (lower price wins unless rating advantage ≥ 0.5 stars with 50+ reviews) fine, or do you want price-only? I'll default to the heuristic unless you say otherwise.
