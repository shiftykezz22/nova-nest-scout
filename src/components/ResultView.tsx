import { useEffect, useMemo, useState } from "react";
import type { ProductData } from "@/lib/walmart";
import type { Supplier } from "@/lib/suppliers";
import { calculate, type CalcInputs } from "@/lib/calc";
import { evaluate } from "@/lib/verdict";
import { ProductEditor } from "./ProductEditor";
import { SupplierList } from "./SupplierList";
import { VerdictCard } from "./VerdictCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Search, Plus } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { searchSuppliersPublic, tavilyStatus, searchAndSaveSuppliers } from "@/lib/suppliers.functions";
import { toast } from "sonner";

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
  const [suppliers, setSuppliers] = useState<Supplier[]>(initialSuppliers ?? []);
  const [selected, setSelected] = useState<Supplier | null>(suppliers[0] ?? null);
  const [searching, setSearching] = useState(false);
  const [tavConfigured, setTavConfigured] = useState<boolean | null>(null);
  const [zip, setZip] = useState<string>("");
  const [qty, setQty] = useState<number>(product.order_quantity ?? 20);
  const [manualOpen, setManualOpen] = useState(false);

  const searchPublic = useServerFn(searchSuppliersPublic);
  const searchSave = useServerFn(searchAndSaveSuppliers);
  const getStatus = useServerFn(tavilyStatus);

  useEffect(() => { getStatus().then((r) => setTavConfigured(r.configured)).catch(() => setTavConfigured(false)); }, [getStatus]);

  const inputs: CalcInputs = useMemo(() => ({
    sellingPrice: product.price ?? 0,
    unitCost: selected?.unit_cost ?? product.unit_cost ?? 0,
    shippingPerUnit: settings?.shippingPerUnit ?? DEFAULTS.shippingPerUnit,
    dutiesPerUnit: settings?.dutiesPerUnit ?? DEFAULTS.dutiesPerUnit,
    prepCostPerUnit: settings?.prepCostPerUnit ?? DEFAULTS.prepCostPerUnit,
    inboundShippingPerUnit: settings?.inboundShippingPerUnit ?? DEFAULTS.inboundShippingPerUnit,
    referralFeePercent: settings?.referralFeePercent ?? DEFAULTS.referralFeePercent,
    fulfillmentFee: settings?.fulfillmentFee ?? DEFAULTS.fulfillmentFee,
    storageCost: settings?.storageCost ?? DEFAULTS.storageCost,
    advertisingPercent: settings?.advertisingPercent ?? DEFAULTS.advertisingPercent,
    returnAllowancePercent: settings?.returnAllowancePercent ?? DEFAULTS.returnAllowancePercent,
    orderQuantity: qty,
  }), [product, selected, settings, qty]);

  const calc = useMemo(() => calculate(inputs), [inputs]);
  const verdict = useMemo(() => evaluate(product, calc, !!selected && (selected.product_match !== "weak" || (product.sources?.unit_cost === "user"))), [product, calc, selected]);

  async function runSearch() {
    if (!product.title && !product.brand && !product.upc_gtin) {
      toast.error("Fill in title, brand, or UPC before searching");
      return;
    }
    setSearching(true);
    try {
      const payload = {
        title: product.title, brand: product.brand, upc: product.upc_gtin, model: product.model,
        category: product.category, size: product.size, walmartPrice: product.price, zip,
      };
      if (scanId) {
        const res = await searchSave({ data: { ...payload, productScanId: scanId } });
        setTavConfigured(res.configured);
        if (!res.configured) { toast.error("Supplier search unavailable. TAVILY_API_KEY not configured."); return; }
        setSuppliers(res.suppliers);
        toast.success(`Found ${res.suppliers.length} supplier candidates`);
      } else {
        const res = await searchPublic({ data: payload });
        setTavConfigured(res.configured);
        if (!res.configured) { toast.error("Supplier search unavailable. TAVILY_API_KEY not configured."); return; }
        setSuppliers(res.suppliers);
        toast.success(`Found ${res.suppliers.length} supplier candidates`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Search failed");
    } finally {
      setSearching(false);
    }
  }

  function addManual(m: Partial<Supplier> & { supplier_name: string }) {
    const s: Supplier = {
      supplier_name: m.supplier_name,
      supplier_url: m.supplier_url,
      unit_cost: m.unit_cost ?? null,
      moq: m.moq ?? null,
      lead_time_days: m.lead_time_days ?? null,
      estimated_shipping: m.estimated_shipping ?? null,
      product_match: m.product_match ?? "likely",
      verification_status: m.verification_status ?? (m.unit_cost ? "verified_public" : "quote_required"),
      supplier_type: m.supplier_type ?? "unknown",
      region_bucket: m.region_bucket ?? "us",
      source: "manual",
      reasons: ["Entered manually by user."],
    };
    setSuppliers((cur) => [s, ...cur]);
    setSelected(s);
    setManualOpen(false);
  }

  return (
    <div className="space-y-6">
      <VerdictCard
        v={verdict}
        calc={calc}
        walmartPrice={product.price}
        bestSupplierName={selected?.supplier_name}
        quantity={qty}
      />

      <section className="rounded-2xl border bg-card p-4 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Product details</h2>
          <span className="text-xs text-muted-foreground">Fields marked User Entered override public data in calculations.</span>
        </div>
        <div className="mt-4">
          <ProductEditor product={product} onChange={onProductChange} />
        </div>
      </section>

      <section className="rounded-2xl border bg-card p-4 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Supplier discovery</h2>
            <p className="text-xs text-muted-foreground">
              {tavConfigured === false && "Supplier search connection is not configured. You can still add suppliers manually."}
              {tavConfigured === true && "Searches real wholesale, distributor, manufacturer and local NY/NJ sources. No fake prices."}
              {tavConfigured === null && "Checking supplier search connection…"}
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <Label className="text-xs text-muted-foreground">ZIP</Label>
              <Input value={zip} onChange={(e) => setZip(e.target.value)} placeholder="11201" className="mt-1 h-9 w-24" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Test qty</Label>
              <Input type="number" value={qty} onChange={(e) => setQty(Math.max(1, parseInt(e.target.value || "1", 10)))} className="mt-1 h-9 w-20" />
            </div>
            <Button onClick={runSearch} disabled={searching || tavConfigured === false}>
              {searching ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Search className="mr-1 h-4 w-4" />}
              {suppliers.length ? "Re-run search" : "Find suppliers"}
            </Button>
            <Button variant="outline" onClick={() => setManualOpen((v) => !v)}>
              <Plus className="mr-1 h-4 w-4" /> Add manual
            </Button>
          </div>
        </div>

        {manualOpen && <ManualSupplierForm onAdd={addManual} onCancel={() => setManualOpen(false)} />}

        <div className="mt-4">
          <SupplierList
            suppliers={suppliers}
            walmartPrice={product.price}
            selectedId={selected ? (selected.id ?? `${selected.supplier_name}|${selected.supplier_url ?? ""}`) : null}
            onSelect={(s) => setSelected(s)}
            product={{ title: product.title, upc_gtin: product.upc_gtin, model: product.model }}
            zip={zip}
          />
        </div>
      </section>

      <section className="rounded-2xl border bg-card p-4 md:p-6">
        <h2 className="text-lg font-semibold">AI Supplier Recommendations</h2>
        <p className="mt-1 text-xs text-muted-foreground">Structured guidance based only on retrieved evidence — no fabricated results.</p>
        <Recommendations suppliers={suppliers} product={product} />
      </section>
    </div>
  );
}

function ManualSupplierForm({ onAdd, onCancel }: { onAdd: (s: Partial<Supplier> & { supplier_name: string }) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [price, setPrice] = useState("");
  const [moq, setMoq] = useState("");
  const [lead, setLead] = useState("");
  return (
    <div className="mt-4 grid gap-2 rounded-xl border bg-background p-3 sm:grid-cols-2">
      <Input placeholder="Supplier name" value={name} onChange={(e) => setName(e.target.value)} />
      <Input placeholder="Website (optional)" value={url} onChange={(e) => setUrl(e.target.value)} />
      <Input placeholder="Unit price (USD)" type="number" value={price} onChange={(e) => setPrice(e.target.value)} />
      <Input placeholder="MOQ" type="number" value={moq} onChange={(e) => setMoq(e.target.value)} />
      <Input placeholder="Lead time (days)" type="number" value={lead} onChange={(e) => setLead(e.target.value)} />
      <div className="flex gap-2 sm:col-span-2">
        <Button
          disabled={!name}
          onClick={() =>
            onAdd({
              supplier_name: name,
              supplier_url: url || undefined,
              unit_cost: price ? parseFloat(price) : undefined,
              moq: moq ? parseInt(moq, 10) : undefined,
              lead_time_days: lead ? parseInt(lead, 10) : undefined,
            })
          }
        >
          Add supplier
        </Button>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

function Recommendations({ suppliers, product }: { suppliers: Supplier[]; product: ProductData }) {
  if (!suppliers.length) {
    return <p className="mt-3 text-sm text-muted-foreground">Run supplier discovery to generate recommendations. Without evidence we won't make claims.</p>;
  }
  const withPrice = suppliers.filter((s) => typeof s.unit_cost === "number");
  const local = suppliers.filter((s) => s.region_bucket && !["us", "international"].includes(s.region_bucket));
  const bestLocal = local[0];
  const bestDomestic = suppliers.find((s) => s.country === "USA");
  const lowestCost = withPrice.slice().sort((a, b) => (a.unit_cost as number) - (b.unit_cost as number))[0];
  const lowestRisk = suppliers.find((s) => s.verification_status === "verified_public") ?? suppliers.find((s) => s.product_match === "exact");
  const testOrder = suppliers.find((s) => (s.moq ?? 0) <= 25 && (s.moq ?? 0) > 0) ?? lowestCost;
  const bulk = suppliers.find((s) => (s.moq ?? 0) >= 100 && typeof s.unit_cost === "number") ?? lowestCost;

  const q = (s?: Supplier) =>
    s ? (
      <a href={s.supplier_url} className="text-primary hover:underline" target="_blank" rel="noopener noreferrer nofollow">
        {s.supplier_name}
      </a>
    ) : (
      <span className="text-muted-foreground">Not enough evidence yet</span>
    );

  const missing: string[] = [];
  if (!product.upc_gtin) missing.push("UPC / GTIN");
  if (!product.brand) missing.push("Brand");
  if (!withPrice.length) missing.push("Any public unit price");
  if (!suppliers.some((s) => typeof s.moq === "number")) missing.push("MOQ from a supplier");

  return (
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      <Rec label="Contact first" value={q(bestLocal ?? lowestRisk ?? suppliers[0])} />
      <Rec label="Best local option" value={q(bestLocal)} />
      <Rec label="Best domestic option" value={q(bestDomestic)} />
      <Rec label="Lowest cost potential" value={q(lowestCost)} />
      <Rec label="Lowest risk" value={q(lowestRisk)} />
      <Rec label="Best for small test order" value={q(testOrder)} />
      <Rec label="Best for bulk order" value={q(bulk)} />
      <div className="sm:col-span-2 rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
        <div className="font-semibold text-foreground">Questions to ask suppliers</div>
        <ul className="mt-1 space-y-0.5">
          <li>• Confirm case pack, MOQ, and available inventory for {product.title || "this product"}.</li>
          <li>• Freight to your ZIP, lead time, and sample availability.</li>
          <li>• Manufacturer authorization or resale documentation.</li>
          <li>• Payment terms and return / defect policy.</li>
        </ul>
        {missing.length > 0 && <div className="mt-2">Missing facts blocking a final decision: {missing.join(", ")}.</div>}
      </div>
    </div>
  );
}

function Rec({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-medium">{value}</div>
    </div>
  );
}