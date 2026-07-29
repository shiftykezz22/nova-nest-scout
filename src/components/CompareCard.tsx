import type { CompareOffer } from "@/lib/compare";
import { usd } from "@/lib/compare";
import { Star, ExternalLink, ImageOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";

type Props = {
  offer: CompareOffer;
  loading?: boolean;
  empty?: boolean;
  emptyLabel?: string;
};

export function CompareCard({ offer, loading, empty, emptyLabel }: Props) {
  const isWalmart = offer.retailer === "walmart";
  const label = isWalmart ? "Walmart" : "Amazon";
  const accent = isWalmart
    ? "border-primary/30 bg-primary/5"
    : "border-amber-300/50 bg-amber-50/60";
  const badgeClass = isWalmart
    ? "bg-primary text-primary-foreground"
    : "bg-amber-500 text-white";

  return (
    <div className={`rounded-2xl border p-4 ${accent}`}>
      <div className="mb-3 flex items-center justify-between">
        <Badge className={badgeClass}>{label}</Badge>
        {offer.url && (
          <a
            href={offer.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            View <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>

      {loading ? (
        <div className="grid h-40 place-items-center rounded-lg border border-dashed bg-background/60 text-xs text-muted-foreground">
          Fetching {label}…
        </div>
      ) : empty ? (
        <div className="grid h-40 place-items-center rounded-lg border border-dashed bg-background/60 px-3 text-center text-xs text-muted-foreground">
          {emptyLabel ?? `No ${label} data yet.`}
        </div>
      ) : (
        <>
          <div className="aspect-square w-full overflow-hidden rounded-lg border bg-background">
            {offer.image ? (
              <img
                src={offer.image}
                alt={offer.title ?? label}
                className="h-full w-full object-contain"
                loading="lazy"
              />
            ) : (
              <div className="grid h-full w-full place-items-center text-muted-foreground">
                <ImageOff className="h-8 w-8" />
              </div>
            )}
          </div>
          <div className="mt-3 line-clamp-2 text-sm font-medium text-foreground">
            {offer.title ?? "Untitled product"}
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <div className="text-2xl font-bold text-foreground">{usd(offer.price)}</div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
              <span className="font-medium text-foreground">
                {offer.rating != null ? offer.rating.toFixed(1) : "—"}
              </span>
              <span>({offer.reviews != null ? offer.reviews.toLocaleString() : "—"})</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}