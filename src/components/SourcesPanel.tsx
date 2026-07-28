import type { ProductData } from "@/lib/walmart";
import { CORE_FIELDS } from "@/lib/walmart";
import { Badge } from "@/components/ui/badge";
import { statusMeta, type VerificationStatus } from "@/lib/observations";

export type ObservationRow = {
  field_name: string;
  source_name: string;
  source_url?: string | null;
  verification_status: string;
  retrieved_at?: string;
  is_selected_value?: boolean;
};

function baseStatus(src?: string): VerificationStatus {
  switch (src) {
    case "verified": return "verified";
    case "public": return "single_source";
    case "user": return "user_entered";
    case "estimated": return "estimated";
    default: return "unavailable";
  }
}

export function SourcesPanel({ product, observations }: { product: ProductData; observations?: ObservationRow[] }) {
  const provider = product.retrieval?.provider ?? "walmart_html";
  const retrievedAt = product.scanned_at ? new Date(product.scanned_at).toLocaleString() : product.last_updated ? new Date(product.last_updated).toLocaleString() : "—";
  // Group observations per field so we can promote cross-checked / conflicting values.
  const byField = new Map<string, ObservationRow[]>();
  for (const o of observations ?? []) {
    const arr = byField.get(o.field_name) ?? [];
    arr.push(o);
    byField.set(o.field_name, arr);
  }
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
              const rows = byField.get(String(key));
              const srcMap = product.sources?.[key as string];
              let status: VerificationStatus | undefined;
              let source = provider;
              let retrievedTxt: string | undefined;
              if (val == null || val === "") {
                status = "unavailable";
              } else if (rows && rows.length) {
                const statuses = new Set(rows.map((r) => r.verification_status));
                if (statuses.has("cross_checked") || (statuses.has("verified") && statuses.size > 1)) status = "cross_checked";
                else if (statuses.has("user_entered")) status = "user_entered";
                else status = (rows[0].verification_status as VerificationStatus) || baseStatus(srcMap);
                source = rows.map((r) => r.source_name).join(", ");
                const latest = rows[0].retrieved_at;
                if (latest) retrievedTxt = new Date(latest).toLocaleString();
              } else {
                status = baseStatus(srcMap);
              }
              const m = statusMeta(status);
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
                  <td className="py-2 text-[11px] text-muted-foreground">
                    {val == null || val === "" ? "—" : (<><span>{source}</span>{retrievedTxt && <span className="ml-1 opacity-70">· {retrievedTxt}</span>}</>)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}