import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ShoppingBag, Star } from "lucide-react";
import { usd } from "@/lib/calc";

export type Candidate = {
  walmart_item_id?: string;
  url?: string;
  title?: string;
  brand?: string;
  image?: string;
  price?: number;
  rating?: number;
  review_count?: number;
  seller?: string;
  model?: string;
  upc_gtin?: string;
  match_confidence: number;
  match_reasons: string[];
};

export function SearchResults({ candidates, onSelect, loading, header }: { candidates: Candidate[]; onSelect: (c: Candidate) => void; loading?: boolean; header?: ReactNode }) {
  if (!candidates.length && !loading) return null;
  return (
    <div className="rounded-2xl border bg-card p-4 md:p-6">
      {header}
      <div className="mb-3 text-sm font-semibold">Select the exact product to analyze</div>
      <p className="mb-4 text-xs text-muted-foreground">We found {candidates.length} likely match{candidates.length === 1 ? "" : "es"}. Pick the one you want scanned — we won't guess.</p>
      <div className="grid gap-3 md:grid-cols-2">
        {candidates.map((c, i) => (
          <button
            key={c.walmart_item_id ?? i}
            type="button"
            onClick={() => onSelect(c)}
            className="group flex gap-3 rounded-xl border bg-background p-3 text-left transition hover:border-primary hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <div className="h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-muted grid place-items-center">
              {c.image ? (
                <img src={c.image} alt="" className="h-full w-full object-contain" loading="lazy" />
              ) : (
                <ShoppingBag className="h-6 w-6 text-muted-foreground" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <div className="text-sm font-semibold line-clamp-2">{c.title || "Untitled product"}</div>
                <Badge variant={c.match_confidence >= 90 ? "default" : "outline"} className="shrink-0 text-[10px]">
                  {c.match_confidence >= 90 ? "Exact" : c.match_confidence >= 70 ? "Strong" : c.match_confidence >= 50 ? "Possible" : "Weak"}
                </Badge>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                {c.brand && <span>{c.brand}</span>}
                {c.model && <span>· Model {c.model}</span>}
                {c.walmart_item_id && <span>· #{c.walmart_item_id}</span>}
                {c.upc_gtin && <span>· UPC {c.upc_gtin}</span>}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                {typeof c.price === "number" && <span className="font-semibold text-foreground">{usd(c.price)}</span>}
                {typeof c.rating === "number" && (
                  <span className="inline-flex items-center gap-0.5 text-amber-600">
                    <Star className="h-3 w-3 fill-current" />{c.rating.toFixed(1)}
                    {typeof c.review_count === "number" && <span className="text-muted-foreground"> ({c.review_count.toLocaleString()})</span>}
                  </span>
                )}
                {c.seller && <span className="text-muted-foreground">Sold by {c.seller}</span>}
              </div>
              <div className="mt-2 flex items-center justify-between">
                <div className="text-[10px] text-muted-foreground">{c.match_reasons.slice(0, 2).join(" · ")}</div>
                <Button size="sm" variant="outline" className="h-7 px-2 text-xs group-hover:bg-primary group-hover:text-primary-foreground">Select</Button>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}