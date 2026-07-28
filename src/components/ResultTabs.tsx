import { useMemo, useState } from "react";
import type { ProductData } from "@/lib/walmart";
import type { Supplier } from "@/lib/suppliers";
import type { CalcInputs } from "@/lib/calc";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ProductHero } from "./ProductHero";
import { VerdictCard } from "./VerdictCard";
import { ProfitabilityPanel, buildCalcInputs, type CostOverrides } from "./ProfitabilityPanel";
import { SupplierDiscovery } from "./SupplierDiscovery";
import { ProductEditor } from "./ProductEditor";
import { SourcesPanel } from "./SourcesPanel";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { calculate } from "@/lib/calc";
import { evaluate } from "@/lib/verdict";

type Props = {
  product: ProductData;
  onProductChange: (patch: Partial<ProductData>) => void;
  scanId?: string;
  initialSuppliers?: Supplier[];
  settings?: Partial<CalcInputs>;
};

const DEFAULTS: Omit<CalcInputs, "sellingPrice" | "unitCost"> = {
  shippingPerUnit: 0, dutiesPerUnit: 0, prepCostPerUnit: 0.75, inboundShippingPerUnit: 1.0,
  referralFeePercent: 15, fulfillmentFee: 5.5, storageCost: 0.5, advertisingPercent: 5, returnAllowancePercent: 2,
};

type SigTone = "good" | "warn" | "bad" | "muted";

export function ResultTabs({ product, onProductChange, scanId, initialSuppliers, settings }: Props) {
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

  const fieldsFilled = [product.title, product.price, product.brand, product.image, product.rating, product.review_count, product.upc_gtin, product.model].filter(Boolean).length;
  const completeness = Math.round((fieldsFilled / 8) * 100);

  return (
    <div className="space-y-4">
      <ProductHero product={product} />
      {retrieval && (retrieval.walmart_status !== "ok" || retrieval.fields_missing.length > 0) && (
        <div className="rounded-2xl border bg-card p-3 text-xs">
          <span className="font-semibold">Retrieval:</span>{" "}
          {retrieval.walmart_status === "ok" ? "Product found." : retrieval.walmart_status === "blocked" ? "Walmart blocked the direct request; SerpApi / Tavily fallback used." : retrieval.walmart_status === "empty" ? "No product data returned." : "Retrieval failed."}
          <span className="text-muted-foreground"> · Provider: {retrieval.provider ?? "walmart_html"} · {retrieval.fields_missing.length} field{retrieval.fields_missing.length === 1 ? "" : "s"} missing.</span>
        </div>
      )}

      <Tabs defaultValue="overview">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="suppliers">Suppliers</TabsTrigger>
          <TabsTrigger value="profit">Profit</TabsTrigger>
          <TabsTrigger value="market">Market</TabsTrigger>
          <TabsTrigger value="verdict">Verdict</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <MeterCard label="Product confidence" value={verdict.confidence} />
            <MeterCard label="Data completeness" value={completeness} />
            <MeterCard label="Opportunity score" value={verdict.verdict === "INSUFFICIENT_DATA" ? null : verdict.opportunityScore} />
          </div>
          <SourcesPanel product={product} />
          <Accordion type="single" collapsible className="rounded-2xl border bg-card">
            <AccordionItem value="details" className="border-none">
              <AccordionTrigger className="px-4 md:px-6 py-4 text-base font-semibold hover:no-underline">View & edit full product details</AccordionTrigger>
              <AccordionContent className="px-4 md:px-6 pb-6">
                <p className="mb-4 text-xs text-muted-foreground">Fields marked User Entered override public data in calculations.</p>
                <ProductEditor product={product} onChange={onProductChange} />
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </TabsContent>

        <TabsContent value="suppliers" className="mt-4">
          <SupplierDiscovery
            product={product}
            scanId={scanId}
            initialSuppliers={initialSuppliers}
            selected={selected}
            onSelect={setSelected}
            onUseCost={handleUseCost}
          />
        </TabsContent>

        <TabsContent value="profit" className="mt-4 space-y-4">
          <ProfitabilityPanel product={product} overrides={overrides} onChange={setOverrides} baseInputs={base} />
          <div className="rounded-2xl border bg-card p-4 md:p-6">
            <div className="mb-2 text-sm font-semibold">What these numbers mean</div>
            <dl className="grid gap-3 text-xs sm:grid-cols-2">
              <div><dt className="font-semibold">Profit / unit</dt><dd className="text-muted-foreground">Dollar amount left after all included costs for one unit.</dd></div>
              <div><dt className="font-semibold">Margin</dt><dd className="text-muted-foreground">Percent of the sale price that remains as profit.</dd></div>
              <div><dt className="font-semibold">ROI</dt><dd className="text-muted-foreground">Return compared with the money invested in one unit.</dd></div>
              <div><dt className="font-semibold">Landed cost</dt><dd className="text-muted-foreground">Product cost plus costs required to receive and prep one unit.</dd></div>
              <div><dt className="font-semibold">Break-even price</dt><dd className="text-muted-foreground">Minimum sale price to avoid losing money on included costs.</dd></div>
            </dl>
          </div>
        </TabsContent>

        <TabsContent value="market" className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Signal label="Demand" tone={demand.tone} value={demand.value} known={demand.known} note={demand.note} />
            <Signal label="Competition" tone={competition.tone} value={competition.value} known={competition.known} note={competition.note} />
            <Signal label="Risk" tone={risk.tone} value={risk.value} known={risk.known} note={risk.note} />
          </div>
          <div className="rounded-2xl border bg-card p-4 md:p-6">
            <div className="text-sm font-semibold">Market observations</div>
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              <li>Rating: {product.rating ? `${product.rating.toFixed(1)} / 5` : "unknown"} · Reviews: {product.review_count?.toLocaleString() ?? "unknown"}</li>
              <li>Seller: {product.seller ?? "unknown"} · Stock: {product.stock_status ?? "unknown"}</li>
              <li>Category: {product.category ?? "unknown"}</li>
            </ul>
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-900">
              We do not fabricate monthly sales, seller counts, or price history. When those aren't provided by a data source we say "unknown" instead of guessing.
            </div>
          </div>
        </TabsContent>

        <TabsContent value="verdict" className="mt-4">
          <VerdictCard v={verdict} calc={calc} walmartPrice={product.price} bestSupplierName={selected?.supplier_name} quantity={calcInputs.orderQuantity} canCalc={canCalc} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function MeterCard({ label, value }: { label: string; value: number | null }) {
  const v = value ?? 0;
  const color = value == null ? "bg-muted" : v >= 70 ? "bg-emerald-500" : v >= 40 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="text-2xl font-bold">{value == null ? "—" : value}</span>
        {value != null && <span className="text-xs text-muted-foreground">/ 100</span>}
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className={`h-full ${color}`} style={{ width: `${Math.min(100, v)}%` }} />
      </div>
    </div>
  );
}

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
  if (!rc && !rating) return { value: "Insufficient data", tone: "muted", known: false, note: "No rating or review count retrieved." };
  if (rc >= 500 && rating >= 4.2) return { value: "Strong", tone: "good", known: true, note: `${rc.toLocaleString()} reviews · ${rating.toFixed(1)}★` };
  if (rc >= 50) return { value: "Moderate", tone: "warn", known: true, note: `${rc.toLocaleString()} reviews · ${rating ? rating.toFixed(1) + "★" : "no rating"}` };
  return { value: "Low", tone: "bad", known: true, note: `Only ${rc} reviews retrieved.` };
}
function signalCompetition(p: ProductData): { value: string; tone: SigTone; known: boolean; note?: string } {
  const sellers = p.seller_count ?? 0;
  const isWalmart = /walmart/i.test(p.seller ?? "");
  if (!p.seller && !sellers) return { value: "Insufficient data", tone: "muted", known: false, note: "Seller data not retrieved." };
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