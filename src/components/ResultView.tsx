import { useMemo, useState } from "react";
import type { ProductData } from "@/lib/walmart";
import type { Supplier } from "@/lib/suppliers";
import { type CalcInputs } from "@/lib/calc";
import { evaluate } from "@/lib/verdict";
import { ProductEditor } from "./ProductEditor";
import { VerdictCard } from "./VerdictCard";
import { ProductHero } from "./ProductHero";
import { ProfitabilityPanel, buildCalcInputs, type CostOverrides } from "./ProfitabilityPanel";
import { SupplierDiscovery } from "./SupplierDiscovery";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { calculate } from "@/lib/calc";
import { Badge } from "@/components/ui/badge";

type Props = {
  product: ProductData;
  onProductChange: (patch: Partial<ProductData>) => void;
  scanId?: string; // if provided we persist supplier searches
  initialSuppliers?: Supplier[];
  settings?: Partial<CalcInputs>;
};

const DEFAULTS: Omit<CalcInputs, "sellingPrice" | "unitCost"> = {
  shippingPerUnit: 0,
  dutiesPerUnit: 0,
  prepCostPerUnit: 0.75,
  inboundShippingPerUnit: 1.0,
  referralFeePercent: 15,
  fulfillmentFee: 5.5,
  storageCost: 0.5,
  advertisingPercent: 5,
  returnAllowancePercent: 2,
};

export function ResultView({ product, onProductChange, scanId, initialSuppliers, settings }: Props) {
  const [selected, setSelected] = useState<Supplier | null>(initialSuppliers?.[0] ?? null);
  const [overrides, setOverrides] = useState<CostOverrides>({
    supplierUnitCost: initialSuppliers?.[0]?.unit_cost ?? product.unit_cost ?? undefined,
    quantity: product.order_quantity ?? 20,
  });

  const base = useMemo(() => ({
    shippingPerUnit: settings?.shippingPerUnit ?? DEFAULTS.shippingPerUnit,
    dutiesPerUnit: settings?.dutiesPerUnit ?? DEFAULTS.dutiesPerUnit,
    prepCostPerUnit: settings?.prepCostPerUnit ?? DEFAULTS.prepCostPerUnit,
    inboundShippingPerUnit: settings?.inboundShippingPerUnit ?? DEFAULTS.inboundShippingPerUnit,
    referralFeePercent: settings?.referralFeePercent ?? DEFAULTS.referralFeePercent,
    fulfillmentFee: settings?.fulfillmentFee ?? DEFAULTS.fulfillmentFee,
    storageCost: settings?.storageCost ?? DEFAULTS.storageCost,
    advertisingPercent: settings?.advertisingPercent ?? DEFAULTS.advertisingPercent,
    returnAllowancePercent: settings?.returnAllowancePercent ?? DEFAULTS.returnAllowancePercent,
  }), [settings]);

  const calcInputs = useMemo(() => buildCalcInputs(product, overrides, base), [product, overrides, base]);
  const calc = useMemo(() => calculate(calcInputs), [calcInputs]);
  const canCalc = (product.price ?? 0) > 0 && (calcInputs.unitCost ?? 0) > 0;
  const verdict = useMemo(
    () => evaluate(product, calc, !!selected && (selected.product_match !== "weak" || product.sources?.unit_cost === "user")),
    [product, calc, selected],
  );
  const retrieval = product.retrieval;

  const demand = useMemo(() => signalDemand(product), [product]);
  const competition = useMemo(() => signalCompetition(product), [product]);
  const risk = useMemo(() => signalRisk(verdict.risks.length, retrieval?.walmart_status), [verdict.risks.length, retrieval?.walmart_status]);

  function handleUseCost(s: Supplier, unitCost: number) {
    setSelected(s);
    setOverrides((prev) => ({ ...prev, supplierUnitCost: unitCost }));
  }

  return (
    <div className="space-y-6">
      {/* A. Product summary header */}
      <ProductHero product={product} />
      {retrieval && (retrieval.walmart_status !== "ok" || retrieval.fields_missing.length > 0) && (
        <div className="rounded-2xl border bg-card p-4 text-sm">
          <div className="font-semibold">
            {retrieval.walmart_status === "ok"
              ? "Product found. Some optional fields were not available from the current source."
              : retrieval.walmart_status === "blocked"
                ? "Walmart blocked the direct request and the product provider did not return data."
                : retrieval.walmart_status === "empty"
                  ? "No product data was returned."
                  : "Product retrieval failed."}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Provider: {retrieval.provider ?? "walmart"}. Sources checked: {retrieval.sources_tried.join(", ") || "walmart"}.
            {retrieval.tavily_used && ` Public search fallback recovered ${retrieval.fields_recovered} field${retrieval.fields_recovered === 1 ? "" : "s"}.`}
            {retrieval.fields_missing.length > 0 && ` Unavailable optional fields: ${retrieval.fields_missing.join(", ")}.`}
          </div>
        </div>
      )}

      {/* B. Decision summary */}
      <VerdictCard
        v={verdict}
        calc={calc}
        walmartPrice={product.price}
        bestSupplierName={selected?.supplier_name}
        quantity={calcInputs.orderQuantity}
        canCalc={canCalc}
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Signal label="Demand" tone={demand.tone} value={demand.value} known={demand.known} note={demand.note} />
        <Signal label="Competition" tone={competition.tone} value={competition.value} known={competition.known} note={competition.note} />
        <Signal label="Risk" tone={risk.tone} value={risk.value} known={risk.known} note={risk.note} />
      </div>

      {/* C. Profitability workspace */}
      <ProfitabilityPanel product={product} overrides={overrides} onChange={setOverrides} baseInputs={base} />

      {/* Supplier discovery */}
      <SupplierDiscovery
        product={product}
        scanId={scanId}
        initialSuppliers={initialSuppliers}
        selected={selected}
        onSelect={setSelected}
        onUseCost={handleUseCost}
      />

      {/* D. Full product details (collapsed) */}
      <Accordion type="single" collapsible className="rounded-2xl border bg-card">
        <AccordionItem value="details" className="border-none">
          <AccordionTrigger className="px-4 md:px-6 py-4 text-base font-semibold hover:no-underline">
            View full product details
          </AccordionTrigger>
          <AccordionContent className="px-4 md:px-6 pb-6">
            <p className="mb-4 text-xs text-muted-foreground">Fields marked User Entered override public data in calculations.</p>
            <ProductEditor product={product} onChange={onProductChange} />
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}

type SigTone = "good" | "warn" | "bad" | "muted";
function Signal({ label, value, tone, known, note }: { label: string; value: string; tone: SigTone; known: boolean; note?: string }) {
  const color = tone === "good" ? "text-emerald-700 border-emerald-200 bg-emerald-50"
    : tone === "warn" ? "text-amber-800 border-amber-200 bg-amber-50"
    : tone === "bad" ? "text-red-800 border-red-200 bg-red-50"
    : "text-muted-foreground border-muted-foreground/20 bg-muted/30";
  return (
    <div className={`rounded-xl border p-3 ${color}`}>
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-wide">{label}</div>
        <Badge variant="outline" className="text-[9px] uppercase">{known ? "Known" : "Estimated"}</Badge>
      </div>
      <div className="mt-1 text-base font-semibold">{value}</div>
      {note && <div className="mt-1 text-[11px] opacity-80">{note}</div>}
    </div>
  );
}

function signalDemand(p: ProductData): { value: string; tone: SigTone; known: boolean; note?: string } {
  const rc = p.review_count ?? 0;
  const rating = p.rating ?? 0;
  if (!rc && !rating) return { value: "Unknown", tone: "muted", known: false, note: "No rating or review count retrieved." };
  if (rc >= 500 && rating >= 4.2) return { value: "Strong", tone: "good", known: true, note: `${rc.toLocaleString()} reviews · ${rating.toFixed(1)}★` };
  if (rc >= 50) return { value: "Moderate", tone: "warn", known: true, note: `${rc.toLocaleString()} reviews · ${rating ? rating.toFixed(1) + "★" : "no rating"}` };
  return { value: "Weak", tone: "bad", known: true, note: `Only ${rc} reviews retrieved.` };
}

function signalCompetition(p: ProductData): { value: string; tone: SigTone; known: boolean; note?: string } {
  const sellers = p.seller_count ?? 0;
  const isWalmart = /walmart/i.test(p.seller ?? "");
  if (!p.seller && !sellers) return { value: "Unknown", tone: "muted", known: false, note: "Seller data not retrieved." };
  if (sellers >= 5 || (isWalmart && (p.review_count ?? 0) >= 1000)) return { value: "High", tone: "bad", known: false, note: `Estimated from ${sellers || "seller"} signals.` };
  if (sellers >= 2) return { value: "Moderate", tone: "warn", known: false, note: `${sellers} sellers detected.` };
  return { value: "Low", tone: "good", known: false, note: `${p.seller ?? "Single seller"} — estimated.` };
}

function signalRisk(riskCount: number, walmartStatus?: string): { value: string; tone: SigTone; known: boolean; note?: string } {
  if (walmartStatus && walmartStatus !== "ok") return { value: "Data risk", tone: "warn", known: true, note: "Product retrieval was partial or blocked." };
  if (riskCount >= 3) return { value: "High", tone: "bad", known: true, note: `${riskCount} risk signals detected.` };
  if (riskCount >= 1) return { value: "Moderate", tone: "warn", known: true, note: `${riskCount} risk signal${riskCount === 1 ? "" : "s"}.` };
  return { value: "Low", tone: "good", known: true };
}