import { useState } from "react";
import type { ProductData } from "@/lib/walmart";
import { Badge } from "@/components/ui/badge";
import { ShoppingBag, Star } from "lucide-react";

function providerLabel(p?: string): string {
  if (!p) return "Walmart";
  if (p === "serpapi") return "SerpApi (Walmart Product)";
  if (p === "walmart_html") return "Walmart.com";
  return p;
}

function formatUpdated(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString();
}

export function ProductHero({ product }: { product: ProductData }) {
  const [imgFailed, setImgFailed] = useState(false);
  const image = product.image && !imgFailed ? product.image : null;
  const na = <span className="text-muted-foreground">Not available</span>;
  const updated = formatUpdated(product.last_updated);

  return (
    <section className="rounded-2xl border bg-card p-4 shadow-sm md:p-6">
      <div className="grid gap-4 md:grid-cols-[minmax(0,240px)_1fr] md:gap-6">
        <div className="grid aspect-square w-full place-items-center overflow-hidden rounded-xl border bg-muted/40">
          {image ? (
            <img
              src={image}
              alt={product.title || "Product image"}
              className="h-full w-full object-contain"
              loading="lazy"
              onError={() => setImgFailed(true)}
            />
          ) : (
            <div className="flex flex-col items-center gap-2 p-6 text-center text-muted-foreground">
              <ShoppingBag className="h-10 w-10" />
              <div className="text-xs">Image not available</div>
            </div>
          )}
        </div>

        <div className="min-w-0 space-y-3">
          <div>
            <h1 className="text-xl font-bold leading-tight text-foreground md:text-2xl">
              {product.title || "Product title not available"}
            </h1>
            <div className="mt-1 text-sm text-muted-foreground">
              {product.brand || "Brand not available"}
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {product.walmart_item_id && (
              <Badge variant="outline" className="font-mono text-[11px]">
                Item {product.walmart_item_id}
              </Badge>
            )}
            {product.upc_gtin && (
              <Badge variant="outline" className="font-mono text-[11px]">
                UPC {product.upc_gtin}
              </Badge>
            )}
            {product.stock_status && (
              <Badge
                variant="outline"
                className={
                  /instock/i.test(product.stock_status)
                    ? "border-emerald-300 bg-emerald-50 text-emerald-800 text-[11px]"
                    : "border-amber-300 bg-amber-50 text-amber-800 text-[11px]"
                }
              >
                {product.stock_status}
              </Badge>
            )}
          </div>

          <div className="flex flex-wrap items-baseline gap-3">
            <div className="text-3xl font-bold text-primary">
              {product.price != null ? `$${product.price.toFixed(2)}` : "Price not available"}
            </div>
            {product.previous_price != null && product.previous_price > (product.price ?? 0) && (
              <div className="text-sm text-muted-foreground line-through">
                ${product.previous_price.toFixed(2)}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-sm">
            {product.rating != null ? (
              <span className="inline-flex items-center gap-1 text-foreground">
                <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                <span className="font-medium">{product.rating.toFixed(1)}</span>
                <span className="text-muted-foreground">
                  ({product.review_count != null ? product.review_count.toLocaleString() : "0"} reviews)
                </span>
              </span>
            ) : (
              <span className="text-muted-foreground">Rating not available</span>
            )}
          </div>

          <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-2">
            <Row label="Category" value={product.category || na} />
            <Row label="Seller" value={product.seller || na} />
            <Row label="Shipped by" value={product.shipped_by || na} />
            <Row
              label="Availability"
              value={product.stock_status || na}
            />
          </dl>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span>Source: {providerLabel(product.retrieval?.provider)}</span>
            {updated && <span>· Updated {updated}</span>}
            {product.product_url && (
              <a
                href={product.product_url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="text-primary hover:underline"
              >
                View on Walmart
              </a>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="min-w-[88px] text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1 truncate text-foreground">{value}</dd>
    </div>
  );
}