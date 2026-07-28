import { usd } from "@/lib/calc";
import { Badge } from "@/components/ui/badge";
import { ExternalLink } from "lucide-react";

export type RetailOffer = {
  retailer_name?: string;
  offer_url?: string;
  price?: number;
  match_confidence?: number;
  match_class?: "exact" | "strong" | "possible" | "rejected";
  retrieved_at?: string;
};

export function RetailOffers({ offers }: { offers?: RetailOffer[] }) {
  const list = (offers ?? []).filter((o) => o.match_class !== "rejected").slice(0, 8);
  if (!list.length) {
    return (
      <div className="rounded-2xl border bg-card p-4 text-xs text-muted-foreground">
        No comparable retailer offers were retrieved. This can happen when the product is Walmart-exclusive, has no shared identifiers, or the search provider returned no strong matches.
      </div>
    );
  }
  return (
    <div className="rounded-2xl border bg-card p-4 md:p-6">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Comparable retailer offers</h3>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{list.length} shown</span>
      </div>
      <ul className="divide-y">
        {list.map((o, i) => (
          <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
            <div className="min-w-0 flex-1">
              <div className="font-medium">{o.retailer_name || "Unknown retailer"}</div>
              {o.offer_url && (
                <a href={o.offer_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline">
                  View offer <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
            <div className="flex items-center gap-3">
              {typeof o.price === "number" && <span className="font-semibold">{usd(o.price)}</span>}
              {o.match_class && <Badge variant="outline" className="text-[10px] capitalize">{o.match_class} match</Badge>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}