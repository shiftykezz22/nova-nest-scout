import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExternalLink, CheckCircle2, Copy } from "lucide-react";
import { toast } from "sonner";
import { assignBadges, scoreSupplier, type Supplier } from "@/lib/suppliers";
import { buildQuoteRequest } from "@/lib/suppliers";

type Props = {
  suppliers: Supplier[];
  walmartPrice?: number;
  selectedId?: string | null;
  onSelect?: (s: Supplier) => void;
  product?: { title?: string; upc_gtin?: string; model?: string };
  zip?: string;
};

const MATCH_LABEL: Record<NonNullable<Supplier["product_match"]>, string> = {
  exact: "Exact Match", likely: "Likely Match", similar: "Similar Alternative", category: "Category Supplier", weak: "Weak Match",
};

const VERIFY_LABEL: Record<NonNullable<Supplier["verification_status"]>, string> = {
  verified_public: "Verified Public", partially_verified: "Partially Verified", unverified: "Unverified", quote_required: "Quote Required",
};

export function SupplierList({ suppliers, walmartPrice, selectedId, onSelect, product, zip }: Props) {
  const [filter, setFilter] = useState<string>("all");
  const [sort, setSort] = useState<string>("score");
  const badges = useMemo(() => assignBadges(suppliers, walmartPrice), [suppliers, walmartPrice]);

  const filtered = useMemo(() => {
    let list = suppliers.slice();
    if (filter === "local") list = list.filter((s) => s.region_bucket && !["us", "international"].includes(s.region_bucket));
    if (filter === "us") list = list.filter((s) => s.region_bucket === "us");
    if (filter === "international") list = list.filter((s) => s.region_bucket === "international");
    if (filter === "exact") list = list.filter((s) => s.product_match === "exact" || s.product_match === "likely");
    if (filter === "public_price") list = list.filter((s) => typeof s.unit_cost === "number");
    if (filter === "quote") list = list.filter((s) => s.verification_status === "quote_required");
    if (filter === "manufacturer") list = list.filter((s) => s.supplier_type === "manufacturer" || s.supplier_type === "private_label");
    if (filter === "distributor") list = list.filter((s) => s.supplier_type === "distributor" || s.supplier_type === "authorized_distributor" || s.supplier_type === "wholesaler");
    return list.map((s) => ({ s, score: scoreSupplier(s, walmartPrice).total }))
      .sort((a, b) => sort === "price" ? (a.s.unit_cost ?? Infinity) - (b.s.unit_cost ?? Infinity) : sort === "moq" ? (a.s.moq ?? Infinity) - (b.s.moq ?? Infinity) : b.score - a.score);
  }, [suppliers, filter, sort, walmartPrice]);

  const filters: Array<[string, string]> = [
    ["all", "All"], ["local", "Local NY/NJ"], ["us", "USA"], ["international", "International"],
    ["exact", "Exact / Likely"], ["public_price", "Public pricing"], ["quote", "Quote required"],
    ["manufacturer", "Manufacturer"], ["distributor", "Distributor"],
  ];

  function copyQuote(s: Supplier) {
    const msg = buildQuoteRequest({ title: product?.title, identifier: product?.upc_gtin ?? product?.model, zip });
    navigator.clipboard.writeText(msg + `\n\nSupplier reference: ${s.supplier_url ?? s.supplier_name}`);
    toast.success("Quote request copied to clipboard");
  }

  if (!suppliers.length) {
    return <div className="rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground">No suppliers found yet. Try running discovery or add one manually.</div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {filters.map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)} className={`rounded-full border px-3 py-1 text-xs ${filter === k ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}>{l}</button>
        ))}
        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          Sort:
          <select value={sort} onChange={(e) => setSort(e.target.value)} className="rounded-md border bg-background px-2 py-1 text-xs">
            <option value="score">Best overall</option>
            <option value="price">Lowest price</option>
            <option value="moq">Lowest MOQ</option>
          </select>
        </div>
      </div>

      <div className="space-y-2">
        {filtered.map(({ s, score }) => {
          const key = s.id ?? `${s.supplier_name}|${s.supplier_url ?? ""}`;
          const isSelected = selectedId === (s.id ?? key);
          return (
            <div key={key} className={`rounded-xl border bg-card p-4 ${isSelected ? "ring-2 ring-primary" : ""}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <a href={s.supplier_url} target="_blank" rel="noopener noreferrer nofollow" className="truncate font-semibold text-foreground hover:text-primary inline-flex items-center gap-1">
                      {s.supplier_name} <ExternalLink className="h-3 w-3" />
                    </a>
                    {(badges[key] ?? []).map((b) => <Badge key={b} className="bg-primary/10 text-primary border-primary/20" variant="outline">{b}</Badge>)}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {s.supplier_type && <Badge variant="outline" className="text-[10px] capitalize">{s.supplier_type.replace(/_/g, " ")}</Badge>}
                    {s.region_bucket && <Badge variant="outline" className="text-[10px] capitalize">{s.region_bucket.replace(/_/g, " ")}</Badge>}
                    {s.product_match && <Badge variant="outline" className="text-[10px]">{MATCH_LABEL[s.product_match]}</Badge>}
                    {s.verification_status && <Badge variant="outline" className="text-[10px]">{VERIFY_LABEL[s.verification_status]}</Badge>}
                  </div>
                  {s.contact_data?.snippet && <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{s.contact_data.snippet}</p>}
                  {s.warnings && s.warnings.length > 0 && (
                    <ul className="mt-2 space-y-0.5 text-xs text-amber-700">
                      {s.warnings.map((w) => <li key={w}>• {w}</li>)}
                    </ul>
                  )}
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold text-foreground">{score}</div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Match score</div>
                  {typeof s.unit_cost === "number" ? (
                    <div className="mt-2 text-sm font-semibold">${s.unit_cost.toFixed(2)}<span className="text-xs text-muted-foreground">/unit</span></div>
                  ) : (
                    <div className="mt-2 text-xs text-muted-foreground">Quote required</div>
                  )}
                  {typeof s.moq === "number" && <div className="text-xs text-muted-foreground">MOQ {s.moq}</div>}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {onSelect && (
                  <Button size="sm" variant={isSelected ? "default" : "outline"} onClick={() => onSelect(s)}>
                    {isSelected ? <><CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Selected</> : "Use this supplier"}
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => copyQuote(s)}>
                  <Copy className="mr-1 h-3.5 w-3.5" /> Copy quote request
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}