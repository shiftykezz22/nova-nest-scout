import type { ProductData } from "@/lib/walmart";
import { CORE_FIELDS } from "@/lib/walmart";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, HelpCircle, User, AlertTriangle } from "lucide-react";

function statusMeta(src?: string) {
  switch (src) {
    case "verified": return { label: "Verified", tone: "text-emerald-700 border-emerald-200 bg-emerald-50", Icon: CheckCircle2 };
    case "public": return { label: "Publicly Retrieved", tone: "text-sky-700 border-sky-200 bg-sky-50", Icon: CheckCircle2 };
    case "user": return { label: "User Entered", tone: "text-primary border-primary/20 bg-primary/5", Icon: User };
    case "estimated": return { label: "Estimated", tone: "text-amber-700 border-amber-200 bg-amber-50", Icon: AlertTriangle };
    default: return { label: "Unavailable", tone: "text-muted-foreground border-muted-foreground/20 bg-muted/30", Icon: HelpCircle };
  }
}

export function SourcesPanel({ product }: { product: ProductData }) {
  const provider = product.retrieval?.provider ?? "walmart_html";
  const retrievedAt = product.scanned_at ? new Date(product.scanned_at).toLocaleString() : product.last_updated ? new Date(product.last_updated).toLocaleString() : "—";
  return (
    <section className="rounded-2xl border bg-card p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Sources & data quality</h2>
          <p className="text-xs text-muted-foreground">Every value shows where we got it and how strongly we trust it.</p>
        </div>
        <div className="text-right text-[11px] text-muted-foreground">
          <div>Primary provider: <span className="font-semibold text-foreground">{provider}</span></div>
          <div>Retrieved: {retrievedAt}</div>
        </div>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
              <th className="py-2 pr-3">Field</th>
              <th className="py-2 pr-3">Value</th>
              <th className="py-2 pr-3">Status</th>
              <th className="py-2">Source</th>
            </tr>
          </thead>
          <tbody>
            {CORE_FIELDS.map(({ key, label }) => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const val = (product as any)[key];
              const src = product.sources?.[key as string];
              const m = statusMeta(val == null || val === "" ? undefined : src);
              const Icon = m.Icon;
              return (
                <tr key={String(key)} className="border-t">
                  <td className="py-2 pr-3 text-xs font-medium text-muted-foreground">{label}</td>
                  <td className="py-2 pr-3 text-xs">
                    {val == null || val === "" ? <span className="text-muted-foreground">—</span> : <span className="font-medium text-foreground">{String(val).slice(0, 80)}</span>}
                  </td>
                  <td className="py-2 pr-3">
                    <Badge variant="outline" className={`gap-1 text-[10px] ${m.tone}`}><Icon className="h-3 w-3" />{m.label}</Badge>
                  </td>
                  <td className="py-2 text-[11px] text-muted-foreground">{val == null || val === "" ? "—" : provider}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}