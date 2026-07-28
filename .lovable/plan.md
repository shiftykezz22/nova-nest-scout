# Hybrid Supplier Discovery Engine

Extend the existing `SupplierDiscovery` section into an always-useful, tabbed supplier workspace. Reuse the current Tavily plumbing, `Supplier` type, `SupplierList` cards, and profit-calculator wiring in `ResultTabs.tsx`. No visual redesign — keep new-york/slate cards and the current red accent.

## 1. Always-on search-link generator (no API required)

New pure module `src/lib/supplier-links.ts` that takes `ProductData` and returns categorized search links. Each link becomes a synthetic `Supplier` row with `source: "generated_link"` and `verification_status: "unverified"` so it flows through the existing `SupplierList` without special-casing.

Categories generated:
- **Wholesalers & Distributors**: Google queries `"[brand] [product] wholesale"`, `"[brand] authorized distributor"`, `"[UPC] wholesale"`, `site:thomasnet.com [brand] [product]`, `"[product] bulk case pack supplier USA"`.
- **Alibaba / Overseas**: Alibaba + 1688 + Made-in-China + Global Sources URLs built from brand/title/pack.
- **Local / Regional / US Warehouses**: Google queries scoped by `location` + `radius` (reusing the existing inputs) and `site:thomasnet.com` variants.
- **Marketplaces**: Faire, Google Shopping, eBay bulk, Amazon Business search links.

Queries include pack size, model, and UPC when present. Every link is labeled "Generated Link" in the card.

## 2. Sub-tabs inside Suppliers

Refactor `SupplierDiscovery.tsx` to render a small inner tab bar (reuse `Tabs` from shadcn already used in `ResultTabs`):

- Wholesalers & Distributors (default)
- Alibaba / Overseas
- Local / Regional / U.S. Warehouses
- Marketplaces
- My Saved / Pasted
- All

Each sub-tab filters the unified supplier array by a new `channel` field (`wholesale | overseas | local | marketplace | pasted | live`). Existing filter chips (kind/match/sort) stay, applied within the active sub-tab.

Card actions per row (added to `SupplierList` card renderer):
- Open Search (opens `supplier_url` in new tab)
- Copy Query (for generated links, copies the underlying query text stored in `contact_data.query`)
- Analyze This Link (paste-flow, see §4)
- Use in Profit Calculator (existing `onUseCost` path)
- Badge: `Generated Link` | `Live Search` | `User Pasted` | `Estimated`

## 3. Optional live results (Tavily/Serper)

Server-side only. Extend `src/lib/suppliers.functions.ts`:
- Keep existing `tavilyStatus`; add Serper detection (`SERPER_API_KEY`) and return `{ tavily, serper }`.
- Existing `searchSuppliersPublic` / `searchAndSaveSuppliers` continue to power Wholesalers, Local, Overseas via the same query buckets. Tag results with `channel` and `source: "live_search"`.
- If neither key is present, return `configured: false` and the UI shows the generated-links tabs plus a small note: "Add a free Tavily or Serper key later for live results."
- Add lightweight in-memory per-scan cache (Map keyed by `scanId + queryBucket`, 10-min TTL) to avoid repeat spend when the user switches sub-tabs.

## 4. Paste & analyze any supplier URL

New server fn `analyzeSupplierUrl` in `src/lib/suppliers.functions.ts`:
- Input: `{ url, productScanId? }`.
- Fetches the URL server-side (10s timeout, follow redirects, strip scripts) and extracts title, price hints, MOQ hints, phone/address using the same regex helpers already in the file.
- Compares against the current product using `matchConfidence` (already exported logic) — brand, model, UPC, pack.
- Returns a `Supplier` with `source: "user_pasted"`, `channel: "pasted"`, `match_kind`, `warnings`, and a short "why this matches" explanation.
- Persists to `supplier_results` when `productScanId` provided (reusing existing insert path).

New UI block above the sub-tabs: single input "Paste any supplier or product page URL" + Analyze button. On success the row appears in "My Saved / Pasted" and is auto-selected.

## 5. Persistence & calculator integration

- Store generated links as ephemeral (not written to DB) — regenerated every render from `ProductData`, so they refresh with edits.
- Live-search and pasted rows continue writing to `supplier_results` (already tagged by `source`). Add a `channel` value to `contact_data` JSON so the sub-tab filter survives reload; no schema change needed.
- "Use in Profit Calculator" already exists via `onUseCost`; extend it to pre-fill `moq` and `estimated_shipping` when the supplier row has them (small change in `ResultTabs.tsx` where `supplierUnitCost` is set).

## 6. Loading / error states

Reuse existing skeleton + toast pattern. Show staged status text under the header:
1. "Building supplier searches…" (instant, always succeeds)
2. "Checking for live results…" (only when a key is configured)
3. "Ready" or "Live search unavailable — showing generated links"

Never blank the section: generated links render even during live-search failure.

## Technical notes

- All external calls stay in `.functions.ts` (server fns).
- No new tables, no migration. `channel` lives inside `contact_data` JSON.
- Keep existing 5-tab layout in `ResultTabs.tsx` untouched.
- Mobile-first cards inherit current `SupplierList` styles.

## Files touched

- Add: `src/lib/supplier-links.ts`
- Update: `src/lib/suppliers.ts` (add `channel` to `Supplier`)
- Update: `src/lib/suppliers.functions.ts` (Serper detection, cache, `analyzeSupplierUrl`, channel tagging)
- Update: `src/components/SupplierDiscovery.tsx` (sub-tabs, paste input, staged status, generated-link merge)
- Update: `src/components/SupplierList.tsx` (Copy Query + Analyze buttons, channel badge)
- Update: `src/components/ResultTabs.tsx` (pass MOQ/shipping into overrides on `onUseCost`)

## Success criteria

- Suppliers section is never empty — generated links render for every scanned product.
- Live results merge in when Tavily/Serper is configured; graceful fallback otherwise.
- Pasted URLs return a match score and can be promoted into the calculator.
- Existing Overview / Profit / Market / Verdict tabs unchanged.
