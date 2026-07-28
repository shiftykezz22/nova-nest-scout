import type { ProductData } from "@/lib/walmart";
import { Check, Loader2, MinusCircle, XCircle } from "lucide-react";

export function ScanProgress({ product }: { product: ProductData }) {
  const stages = product.retrieval?.stages ?? [];
  if (!stages.length) return null;
  return (
    <section className="rounded-2xl border bg-card p-4 md:p-6">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Pipeline stages</h3>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Real stages · no fake percent</span>
      </div>
      <ol className="space-y-1.5 text-xs">
        {stages.map((s, i) => {
          const Icon = s.status === "ok" ? Check : s.status === "error" ? XCircle : s.status === "skipped" ? MinusCircle : Loader2;
          const tone = s.status === "ok" ? "text-emerald-700" : s.status === "error" ? "text-red-700" : "text-muted-foreground";
          return (
            <li key={i} className="flex items-start gap-2">
              <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${tone}`} />
              <div className="flex-1">
                <span className="font-medium">{s.name}</span>
                {s.note && <span className="ml-2 text-muted-foreground">— {s.note}</span>}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}