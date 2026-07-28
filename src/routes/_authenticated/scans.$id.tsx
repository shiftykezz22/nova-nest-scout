import { createFileRoute, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { ProductData } from "@/lib/walmart";
import type { Supplier } from "@/lib/suppliers";
import { ResultView } from "@/components/ResultView";
import { PageHeader } from "@/components/AppShell";
import { ErrorPanel } from "@/components/ErrorPanel";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/scans/$id")({
  ssr: false,
  head: () => ({ meta: [
    { title: "Scan detail — NovaNest Scout" },
    { name: "description", content: "Product analysis, supplier candidates, and verdict." },
    { property: "og:title", content: "NovaNest Scout scan" },
    { property: "og:description", content: "Product analysis, supplier candidates, and verdict." },
  ]}),
  component: ScanDetail,
});

function ScanDetail() {
  const { id } = useParams({ from: "/_authenticated/scans/$id" });
  const [product, setProduct] = useState<ProductData | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [notFound, setNotFound] = useState(false);
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.from("product_scans").select("id, input_url, product_data").eq("id", id).maybeSingle();
      if (error || !data) { setNotFound(true); return; }
      setProduct((data.product_data as ProductData) ?? {});
      const { data: sup } = await supabase.from("supplier_results").select("*").eq("product_scan_id", id);
      setSuppliers((sup ?? []).map((r): Supplier => ({
        id: r.id, supplier_name: r.supplier_name, supplier_url: r.supplier_url ?? undefined,
        supplier_type: (r.supplier_type as Supplier["supplier_type"]) ?? undefined,
        country: r.country ?? undefined, region_bucket: (r.location as Supplier["region_bucket"]) ?? undefined,
        product_match: (r.product_match as Supplier["product_match"]) ?? undefined,
        unit_cost: r.unit_cost ?? null, currency: r.currency ?? "USD",
        moq: r.moq ?? null, case_pack: r.case_pack ?? null,
        estimated_shipping: r.estimated_shipping ?? null, estimated_landed_cost: r.estimated_landed_cost ?? null,
        lead_time_days: r.lead_time_days ?? null, sample_available: r.sample_available ?? null,
        private_label_available: r.private_label_available ?? null,
        authorization_status: (r.authorization_status as Supplier["authorization_status"]) ?? null,
        verification_status: (r.verification_status as Supplier["verification_status"]) ?? "unverified",
        source: r.source ?? undefined, contact_data: (r.contact_data as Supplier["contact_data"]) ?? {},
      })));
    })();
  }, [id]);
  async function onChange(patch: Partial<ProductData>) {
    setProduct((p) => {
      const merged = { ...(p ?? {}), ...patch, sources: { ...(p?.sources ?? {}), ...(patch.sources ?? {}) } } as ProductData;
      supabase.from("product_scans").update({ product_data: merged, title: merged.title ?? null, brand: merged.brand ?? null, upc_gtin: merged.upc_gtin ?? null }).eq("id", id).then(({ error }) => { if (error) toast.error(error.message); });
      return merged;
    });
  }
  if (notFound) return <ErrorPanel title="Scan not found" message="We couldn't find this scan. It may have been deleted or belongs to a different account." />;
  if (!product) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading scan…</div>;
  return (
    <>
      <PageHeader title={product.title || "Scan"} subtitle={product.brand} />
      <ResultView product={product} onProductChange={onChange} scanId={id} initialSuppliers={suppliers} />
    </>
  );
}