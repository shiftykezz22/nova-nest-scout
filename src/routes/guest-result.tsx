import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getGuestScan, updateGuestProduct } from "@/lib/guest";
import type { ProductData } from "@/lib/walmart";
import { ResultView } from "@/components/ResultView";
import { Button } from "@/components/ui/button";
import { ShoppingBag, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/guest-result")({
  ssr: false,
  head: () => ({ meta: [
    { title: "Guest Scan Result — NovaNest Scout" },
    { name: "description", content: "Your free guest scan result. Sign up to save it and run unlimited scans." },
    { property: "og:title", content: "NovaNest Scout guest scan" },
    { property: "og:description", content: "Walmart product analysis with supplier hooks and profit math." },
  ]}),
  component: GuestResult,
});

function GuestResult() {
  const router = useRouter();
  const [product, setProduct] = useState<ProductData | null>(null);
  useEffect(() => {
    const s = getGuestScan();
    if (!s) { router.navigate({ to: "/", replace: true }); return; }
    setProduct(s.product_data);
  }, [router]);
  if (!product) return null;
  function onChange(patch: Partial<ProductData>) {
    setProduct((p) => {
      const merged = { ...p, ...patch, sources: { ...(p?.sources ?? {}), ...(patch.sources ?? {}) } } as ProductData;
      updateGuestProduct(patch);
      return merged;
    });
  }
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b bg-background/90 px-4 py-3 backdrop-blur md:px-8">
        <Link to="/" className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground"><ShoppingBag className="h-4 w-4" /></div>
          <span className="font-bold">NovaNest Scout</span>
        </Link>
        <Button asChild size="sm"><Link to="/auth" search={{ mode: "signup" } as never}>Save & sign up <ArrowRight className="ml-1 h-3.5 w-3.5" /></Link></Button>
      </header>
      <div className="mx-auto max-w-6xl px-4 py-6 md:px-8">
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">You're viewing your free guest scan. Sign up to save it and run unlimited scans.</div>
        <ResultView product={product} onProductChange={onChange} />
      </div>
    </div>
  );
}