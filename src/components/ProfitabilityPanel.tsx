import { useMemo, useState } from "react";
import type { ProductData } from "@/lib/walmart";
import { calculate, usd, type CalcInputs, type CalcResult } from "@/lib/calc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetFooter, SheetClose } from "@/components/ui/sheet";
import { AlertTriangle, Pencil } from "lucide-react";

export type CostOverrides = {
  supplierUnitCost?: number;
  quantity?: number;
  totalSupplierShipping?: number;
  dutiesPerUnit?: number;
  prepPerUnit?: number;
  referralPercent?: number;
  referralFlat?: number;
  otherPerUnit?: number;
};

type Props = {
  product: ProductData;
  overrides: CostOverrides;
  onChange: (next: CostOverrides) => void;
  baseInputs: Omit<CalcInputs, "sellingPrice" | "unitCost">;
};

export function buildCalcInputs(product: ProductData, overrides: CostOverrides, base: Omit<CalcInputs, "sellingPrice" | "unitCost">): CalcInputs {
  const qty = Math.max(1, Math.floor(overrides.quantity ?? 20));
  const shippingPerUnit = overrides.totalSupplierShipping != null
    ? overrides.totalSupplierShipping / qty
    : base.shippingPerUnit;
  const referralPercent = overrides.referralFlat != null && (product.price ?? 0) > 0
    ? (overrides.referralFlat / (product.price as number)) * 100
    : overrides.referralPercent ?? base.referralFeePercent;
  return {
    sellingPrice: product.price ?? 0,
    unitCost: overrides.supplierUnitCost ?? product.unit_cost ?? 0,
    shippingPerUnit,
    dutiesPerUnit: overrides.dutiesPerUnit ?? base.dutiesPerUnit,
    prepCostPerUnit: overrides.prepPerUnit ?? base.prepCostPerUnit,
    inboundShippingPerUnit: base.inboundShippingPerUnit,
    referralFeePercent: referralPercent,
    fulfillmentFee: base.fulfillmentFee,
    storageCost: base.storageCost,
    advertisingPercent: base.advertisingPercent,
    returnAllowancePercent: base.returnAllowancePercent,
    orderQuantity: qty,
  };
}

export function ProfitabilityPanel({ product, overrides, onChange, baseInputs }: Props) {
  const [open, setOpen] = useState(false);
  const inputs = useMemo(() => buildCalcInputs(product, overrides, baseInputs), [product, overrides, baseInputs]);
  const calc = useMemo(() => calculate(inputs), [inputs]);
  const hasPrice = (product.price ?? 0) > 0;
  const hasCost = (inputs.unitCost ?? 0) > 0;
  const otherPerUnit = overrides.otherPerUnit ?? 0;

  return (
    <section className="rounded-2xl border bg-card p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Profitability workspace</h2>
          <p className="text-xs text-muted-foreground">
            {!hasPrice && "Walmart selling price is missing — cost data required to calculate."}
            {hasPrice && !hasCost && "Add a supplier unit cost to unlock profit, margin, ROI and break-even."}
            {hasPrice && hasCost && "Live values based on your entered costs. Change anything to recalculate instantly."}
          </p>
        </div>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" size="sm"><Pencil className="mr-1 h-4 w-4" /> Enter or edit costs</Button>
          </SheetTrigger>
          <CostSheet product={product} overrides={overrides} onChange={onChange} onClose={() => setOpen(false)} />
        </Sheet>
      </div>

      {(!hasPrice || !hasCost) && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {(!hasPrice ? "Missing Walmart selling price. " : "")}
            {(!hasCost ? "Missing supplier unit cost. Enter one via 'Enter or edit costs' or select a supplier with a public price." : "")}
          </span>
        </div>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
        <Card label="Supplier unit cost" value={hasCost ? usd(inputs.unitCost) : "Cost data required"} pending={!hasCost} />
        <Card label="Shipping / unit" value={hasCost ? usd(inputs.shippingPerUnit) : "—"} />
        <Card label="Prep / packaging" value={usd(inputs.prepCostPerUnit)} />
        <Card label="Walmart referral fee" value={hasPrice ? usd(calc.referralFee) : "—"} pending={!hasPrice} sub={`${inputs.referralFeePercent.toFixed(1)}%`} />
        <Card label="Other costs / unit" value={usd(otherPerUnit + inputs.dutiesPerUnit)} />
        <Card label="Landed cost" value={hasCost ? usd(calc.landedCost + otherPerUnit) : "Cost data required"} pending={!hasCost} strong />
        <Card label="Profit / unit" value={hasPrice && hasCost ? usd(calc.estimatedProfit - otherPerUnit) : "Cost data required"} pending={!hasPrice || !hasCost} tone={hasPrice && hasCost ? ((calc.estimatedProfit - otherPerUnit) >= 0 ? "good" : "bad") : undefined} strong />
        <Card label="Margin" value={hasPrice && hasCost ? `${((calc.estimatedProfit - otherPerUnit) / (product.price ?? 1) * 100).toFixed(1)}%` : "—"} pending={!hasPrice || !hasCost} />
        <Card label="ROI" value={hasPrice && hasCost && (calc.landedCost + otherPerUnit) > 0 ? `${((calc.estimatedProfit - otherPerUnit) / (calc.landedCost + otherPerUnit) * 100).toFixed(0)}%` : "—"} pending={!hasPrice || !hasCost} />
        <Card label="Break-even price" value={hasCost ? usd(calc.breakEvenPrice + otherPerUnit) : "Cost data required"} pending={!hasCost} />
      </div>
    </section>
  );
}

function Card({ label, value, sub, pending, tone, strong }: { label: string; value: string; sub?: string; pending?: boolean; tone?: "good" | "bad"; strong?: boolean }) {
  const color = pending ? "text-muted-foreground" : tone === "good" ? "text-emerald-700" : tone === "bad" ? "text-red-700" : "text-foreground";
  return (
    <div className={`rounded-lg border p-3 ${strong ? "bg-primary/5 border-primary/20" : "bg-background"}`}>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 ${pending ? "text-xs" : "text-lg"} font-semibold ${color}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function CostSheet({ product, overrides, onChange, onClose }: { product: ProductData; overrides: CostOverrides; onChange: (o: CostOverrides) => void; onClose: () => void }) {
  const [local, setLocal] = useState<CostOverrides>(overrides);
  function set<K extends keyof CostOverrides>(key: K, val: CostOverrides[K]) {
    const next = { ...local, [key]: val };
    setLocal(next);
    onChange(next); // live recalc
  }
  function num(v: string): number | undefined {
    if (v === "") return undefined;
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return (
    <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
      <SheetHeader>
        <SheetTitle>Enter or edit costs</SheetTitle>
      </SheetHeader>
      <div className="mt-4 space-y-3 text-sm">
        <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
          Walmart selling price: <span className="font-semibold text-foreground">{product.price ? usd(product.price) : "unknown"}</span>
        </div>
        <Field label="Supplier unit price ($)"><Input inputMode="decimal" value={local.supplierUnitCost ?? ""} onChange={(e) => set("supplierUnitCost", num(e.target.value))} placeholder="e.g. 8.50" /></Field>
        <Field label="Quantity / MOQ"><Input inputMode="numeric" value={local.quantity ?? ""} onChange={(e) => set("quantity", num(e.target.value))} placeholder="e.g. 20" /></Field>
        <Field label="Total supplier shipping ($)" hint="Divided evenly across quantity."><Input inputMode="decimal" value={local.totalSupplierShipping ?? ""} onChange={(e) => set("totalSupplierShipping", num(e.target.value))} placeholder="e.g. 45" /></Field>
        <Field label="Duties / unit ($)"><Input inputMode="decimal" value={local.dutiesPerUnit ?? ""} onChange={(e) => set("dutiesPerUnit", num(e.target.value))} /></Field>
        <Field label="Prep / packaging / unit ($)"><Input inputMode="decimal" value={local.prepPerUnit ?? ""} onChange={(e) => set("prepPerUnit", num(e.target.value))} placeholder="0.75" /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Referral fee (%)"><Input inputMode="decimal" value={local.referralPercent ?? ""} onChange={(e) => set("referralPercent", num(e.target.value))} placeholder="15" /></Field>
          <Field label="Or referral fee ($)"><Input inputMode="decimal" value={local.referralFlat ?? ""} onChange={(e) => set("referralFlat", num(e.target.value))} /></Field>
        </div>
        <Field label="Other costs / unit ($)"><Input inputMode="decimal" value={local.otherPerUnit ?? ""} onChange={(e) => set("otherPerUnit", num(e.target.value))} /></Field>
      </div>
      <SheetFooter className="mt-6">
        <SheetClose asChild><Button onClick={onClose}>Done</Button></SheetClose>
      </SheetFooter>
    </SheetContent>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="mt-1">{children}</div>
      {hint && <div className="mt-1 text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}