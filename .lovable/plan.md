## Execution plan for Phase 2 follow-up

I'm in plan mode, so I'll lay out the exact order, then run it end-to-end once you approve.

One blocker up front: **`BLUECART_API_KEY` is not in the project secrets** (confirmed via `fetch_secrets` — only `LOVABLE_API_KEY`, `SERPAPI_API_KEY`, `SERP_API_KEY`, `TAVILY_API_KEY`, `TAV_API_KEY` exist). BlueCart is a third-party API — I cannot mint or guess it. It has to come from you via the secure secret form.

### Step 1 — Load the BlueCart API key
- Call `add_secret` for `BLUECART_API_KEY` (format hint: BlueCart keys are lowercase hex, ~40 chars, from `app.bluecartapi.com/manage-account`). You paste it into the secure form; the value never touches chat.
- Verify with `fetch_secrets` that the name now appears.
- The client already reads `process.env.BLUECART_API_KEY` (`src/lib/bluecart.ts:36-38`) and `isBlueCartConfigured()` reflects presence — no code change needed to "authenticate" beyond having the key.
- Ping-test with a bare `curl https://api.bluecartapi.com/request?api_key=…&type=product&item_id=774459101` inside a temporary server function, log status, and confirm 200.

### Step 2 — Run Phase 2 fixtures against the BlueCart path
Since BlueCart runs inside the enrichment orchestrator, I'll drive it through the real pipeline via `stack_modern--invoke-server-function` against `analyzeProductGuest`, then read `product_scans` rows for the persisted result. Fixtures:

| # | Input | Path exercised | Pass condition |
|---|-------|----------------|----------------|
| 1 | `13063753535` (item id, previously bot-blocked) | UPC lookup after Tavily UPC discovery → ItemId fallback | BlueCart returns candidate, model/mpn filled if real |
| 2 | Dove Beauty Bar `10450115` | UPC → title+brand (Jaccard ≥ 0.55) | fills or returns `bluecart_title_low_similarity`, no hallucination |
| 3 | Logitech G305 `774459101` | Phase 1 already complete → enrichment gate SHOULD NOT trigger | no BlueCart call made, values untouched |
| 4 | Great Value item (private label, no MPN in the world) | full BlueCart chain runs, returns nothing verifiable | model/mpn stay null, no LLM hallucination |
| 5 | A previously-empty branded item (e.g. `931573527` or one you name) | UPC → title | BlueCart or LLM fills real values |

For each: capture stage log entries (`[enrichment]`, `[bluecart] status`, `[llm.gateway]`) and the resulting `product.sources` / `product.source_names` maps. Failures print the exact `reason` string returned by the client (`bluecart_missing_key`, `bluecart_http_4xx`, `bluecart_title_low_similarity`, etc.).

### Step 3 — Verify source tracking
For each fixture, run `supabase--read_query` on `product_scans` and `product_observations`:
```sql
select field_name, status, source_name, confidence
from product_observations
where scan_id = '<id>'
order by field_name;
```
Assert every enriched field has `source_name ∈ {'serpapi.walmart_product', 'bluecart', 'llm.gateway', 'serpapi.reviews', 'tavily.search', ...}` and status matches:
- `bluecart` matched by UPC → `cross_checked` (95) when Phase 1 already had the field, `single_source` (70) otherwise.
- `llm.gateway` → `inferred` (60).
- Untouched Phase 1 fields → whatever status they had before.

Fail the step if any enriched field has `source_name = null` or if a `verified`/`user` field was rewritten.

### Step 4 — Before/after diff
For fixtures 1, 2, 5 (the ones where enrichment should actually fire), print two JSON blocks side-by-side per product:

```
BEFORE (Phase 1 output — captured by re-running with BLUECART_API_KEY temporarily unset via a feature flag on the enrichment stage):
{ title, brand, manufacturer, model, mpn, category_path, confidence, data_completeness_score, sources }

AFTER (Phase 1 + Phase 2):
{ …same keys… }

DELTA:
- fields filled: [...]
- source_names added: {...}
- confidence: X → Y
```

Summary table: fixture, fields filled, provider that filled each, confidence delta, any hallucination flags.

### Reporting format
For each step: `✅ PASS` / `❌ FAIL — <error> — <file:line>`. If any step fails, stop and surface the raw output.

### Assumption I need to state up front
"Use the project's existing secrets/env pattern" — the project uses Lovable managed secrets (see `.env` for public keys only; server secrets live in the platform vault). `add_secret` is that pattern. If you meant something else (e.g. you already pasted the key into a specific file or want me to `set_secret` a value you name in chat), tell me before I approve.

### Question before build mode
Do you have the BlueCart API key ready to paste into the `add_secret` form? If not, I'll pause after opening the form and won't run Steps 2–4 until the secret shows up in `fetch_secrets`.
