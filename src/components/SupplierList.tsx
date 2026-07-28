import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ExternalLink, CheckCircle2, Copy, Phone, MapPin } from "lucide-react";
import { toast } from "sonner";
import { assignBadges, scoreSupplier, type Supplier } from "@/lib/suppliers";
import { buildQuoteRequest } from "@/lib/suppliers";

type Props = {
  suppliers: Supplier[];
  walmartPrice?: number;
  selectedId?: string | null;
  onSelect?: (s: Supplier) => void;
  onUseCost?: (s: Supplier, unitCost: number) => void;
  product?: { title?: string; upc_gtin?: string; model?: string };
  zip?: string;
};

const MATCH_KIND_LABEL: Record<NonNullable<Supplier["match_kind"]>, { label: string; className: string }> = {
  verified_exact: { label: "Verified exact-product", className: "bg-emerald-50 text-emerald-800 border-emerald-200" },
  likely: { label: "Likely supplier", className: "bg-sky-50 text-sky-800 border-sky-200" },
  category: { label: "Category supplier", className: "bg-muted text-foreground border-muted-foreground/20" },
  unverified_lead: { label: "Unverified lead", className: "bg-amber-50 text-amber-900 border-amber-200" },
};

const VERIFY_LABEL: Record<NonNullable<Supplier["verification_status"]>, string> = {
  verified_public: "Verified Public", partially_verified: "Partially Verified", unverified: "Unverified", quote_required: "Quote Required",
};

export function SupplierList({ suppliers, walmartPrice, selectedId, onSelect, onUseCost, product, zip }: Props) {
  const badges = useMemo(() => assignBadges(suppliers, walmartPrice), [suppliers, walmartPrice]);
  const scored = useMemo(() => suppliers.map((s) => ({ s, score: scoreSupplier(s, walmartPrice).total })), [suppliers, walmartPrice]);

  function copyQuote(s: Supplier) {
    const msg = buildQuoteRequest({ title: product?.title, identifier: product?.upc_gtin ?? product?.model, zip });
    navigator.clipboard.writeText(msg + `\n\nSupplier reference: ${s.supplier_url ?? s.supplier_name}`);
    toast.success("Quote request copied to clipboard");
  }

  if (!suppliers.length) {
    return null;
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {scored.map(({ s, score }) => {
          const key = s.id ?? `${s.supplier_name}|${s.supplier_url ?? ""}`;
          const isSelected = selectedId === (s.id ?? key);
          return (
            <SupplierCard
              key={key}
              s={s}
              score={score}
              isSelected={isSelected}
              badgeList={badges[key] ?? []}
              onSelect={onSelect}
              onUseCost={onUseCost}
              onCopyQuote={() => copyQuote(s)}
            />
          );
        })}
      </div>
    </div>
  );
}

function SupplierCard({ s, score, isSelected, badgeList, onSelect, onUseCost, onCopyQuote }: {
  s: Supplier;
  score: number;
  isSelected: boolean;
  badgeList: string[];
  onSelect?: (s: Supplier) => void;
  onUseCost?: (s: Supplier, unitCost: number) => void;
  onCopyQuote: () => void;
}) {
  const [costInput, setCostInput] = useState<string>(typeof s.unit_cost === "number" ? String(s.unit_cost) : "");
  const mk = s.match_kind ?? (s.product_match === "exact" ? "verified_exact" : s.product_match === "likely" ? "likely" : "category");
  const kindMeta = MATCH_KIND_LABEL[mk];
  const isLocal = !!s.region_bucket && !["us", "international"].includes(s.region_bucket);
  const location = s.contact_data?.approximate_location || s.contact_data?.address;
  const phone = s.contact_data?.phone;
  const parsed = parseFloat(costInput);
  const canUseCost = Number.isFinite(parsed) && parsed > 0;

  return (
    <div className={`rounded-xl border bg-card p-4 ${isSelected ? "ring-2 ring-primary" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <a href={s.supplier_url} target="_blank" rel="noopener noreferrer nofollow" className="truncate font-semibold text-foreground hover:text-primary inline-flex items-center gap-1">
              {s.supplier_name} <ExternalLink className="h-3 w-3" />
            </a>
            {badgeList.map((b) => <Badge key={b} className="bg-primary/10 text-primary border-primary/20" variant="outline">{b}</Badge>)}
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <Badge variant="outline" className={`text-[10px] ${kindMeta.className}`}>{kindMeta.label} · {s.match_confidence ?? 0}%</Badge>
            {s.supplier_type && s.supplier_type !== "unknown" && <Badge variant="outline" className="text-[10px] capitalize">{s.supplier_type.replace(/_/g, " ")}</Badge>}
            <Badge variant="outline" className="text-[10px]">{isLocal ? "Local" : "Online"}</Badge>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            {location && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" /> {location}</span>}
            {phone && <a href={`tel:${phone}`} className="inline-flex items-center gap-1 hover:text-foreground"><Phone className="h-3 w-3" /> {phone}</a>}
          </div>
          {s.contact_data?.snippet && <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{s.contact_data.snippet}</p>}
          {mk !== "verified_exact" && (
            <p className="mt-2 text-[11px] text-amber-800">Product-in-stock not confirmed — verify with the supplier before ordering.</p>
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
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {s.supplier_url && (
          <Button size="sm" variant="outline" asChild>
            <a href={s.supplier_url} target="_blank" rel="noopener noreferrer nofollow"><ExternalLink className="mr-1 h-3.5 w-3.5" /> Verify product & pricing</a>
          </Button>
        )}
        {onSelect && (
          <Button size="sm" variant={isSelected ? "default" : "outline"} onClick={() => onSelect(s)}>
            {isSelected ? <><CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Selected</> : "Select supplier"}
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={onCopyQuote}>
          <Copy className="mr-1 h-3.5 w-3.5" /> Copy quote request
        </Button>
        {onUseCost && (
          <div className="ml-auto flex items-center gap-2">
            <Input inputMode="decimal" placeholder="Confirm $/unit" value={costInput} onChange={(e) => setCostInput(e.target.value)} className="h-8 w-32" />
            <Button size="sm" disabled={!canUseCost} onClick={() => canUseCost && onUseCost(s, parsed)}>Use this cost</Button>
          </div>
        )}
      </div>
    </div>
  );
}