import { useState } from "react";
import type { ProductData } from "@/lib/walmart";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldValue } from "./FieldValue";

type Props = {
  product: ProductData;
  onChange: (patch: Partial<ProductData>) => void;
};

function num(v: string): number | undefined {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : undefined;
}

export function ProductEditor({ product, onChange }: Props) {
  const [expanded, setExpanded] = useState(false);
  const s = product.sources ?? {};
  const src = (k: keyof ProductData) => (s[k as string] ?? (product[k] != null ? "public" : "unavailable")) as never;

  function update<K extends keyof ProductData>(key: K, value: ProductData[K]) {
    onChange({ [key]: value, sources: { ...(product.sources ?? {}), [key as string]: "user" } } as Partial<ProductData>);
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <FieldValue label="Title" value={product.title} source={src("title")} />
        <FieldValue label="Brand" value={product.brand} source={src("brand")} />
        <FieldValue label="Walmart Item ID" value={product.walmart_item_id} source={src("walmart_item_id")} />
        <FieldValue label="UPC / GTIN" value={product.upc_gtin} source={src("upc_gtin")} />
        <FieldValue label="Model" value={product.model} source={src("model")} />
        <FieldValue label="Category" value={product.category} source={src("category")} />
        <FieldValue label="Price" value={product.price != null ? `$${product.price.toFixed(2)}` : undefined} source={src("price")} />
        <FieldValue label="Rating" value={product.rating ? `${product.rating} ★ (${product.review_count ?? 0} reviews)` : undefined} source={src("rating")} />
        <FieldValue label="Seller" value={product.seller} source={src("seller")} />
        <FieldValue label="Stock status" value={product.stock_status} source={src("stock_status")} />
      </div>

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="text-sm font-medium text-primary hover:underline"
      >
        {expanded ? "Hide manual fields" : "Add / edit fields manually"}
      </button>

      {expanded && (
        <div className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2">
          <Field label="Title" v={product.title ?? ""} onChange={(v) => update("title", v)} />
          <Field label="Brand" v={product.brand ?? ""} onChange={(v) => update("brand", v)} />
          <Field label="UPC / GTIN" v={product.upc_gtin ?? ""} onChange={(v) => update("upc_gtin", v)} />
          <Field label="Model" v={product.model ?? ""} onChange={(v) => update("model", v)} />
          <Field label="Category" v={product.category ?? ""} onChange={(v) => update("category", v)} />
          <Field label="Size" v={product.size ?? ""} onChange={(v) => update("size", v)} />
          <Field label="Shipping weight" v={product.shipping_weight ?? ""} onChange={(v) => update("shipping_weight", v)} />
          <Field label="Product weight (lb)" v={product.product_weight?.toString() ?? ""} onChange={(v) => update("product_weight", num(v))} type="number" />
          <Field label="Selling price (USD)" v={product.price?.toString() ?? ""} onChange={(v) => update("price", num(v))} type="number" />
          <Field label="Unit cost from supplier (USD)" v={product.unit_cost?.toString() ?? ""} onChange={(v) => update("unit_cost", num(v))} type="number" />
          <Field label="Estimated demand / month" v={product.estimated_demand?.toString() ?? ""} onChange={(v) => update("estimated_demand", num(v))} type="number" />
          <Field label="Order quantity for cash calc" v={product.order_quantity?.toString() ?? ""} onChange={(v) => update("order_quantity", num(v))} type="number" />
          <Field label="Number of sellers on listing" v={product.seller_count?.toString() ?? ""} onChange={(v) => update("seller_count", num(v))} type="number" />
        </div>
      )}
    </div>
  );
}

function Field({ label, v, onChange, type }: { label: string; v: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input value={v} onChange={(e) => onChange(e.target.value)} type={type ?? "text"} className="mt-1" inputMode={type === "number" ? "decimal" : undefined} />
    </div>
  );
}