import { Badge } from "@/components/ui/badge";
import type { FieldSource } from "@/lib/walmart";

const LABELS: Record<FieldSource, string> = {
  verified: "Verified",
  public: "Publicly Retrieved",
  user: "User Entered",
  estimated: "Estimated",
  inferred: "Enrichment (Verified)",
  unavailable: "Unavailable",
};

const COLORS: Record<FieldSource, string> = {
  verified: "bg-emerald-100 text-emerald-800 border-emerald-200",
  public: "bg-sky-100 text-sky-800 border-sky-200",
  user: "bg-amber-100 text-amber-800 border-amber-200",
  estimated: "bg-violet-100 text-violet-800 border-violet-200",
  inferred: "bg-indigo-100 text-indigo-800 border-indigo-200",
  unavailable: "bg-muted text-muted-foreground border-border",
};

export function FieldValue({ label, value, source }: { label: string; value: React.ReactNode; source: FieldSource }) {
  const empty = value === undefined || value === null || value === "";
  const display: React.ReactNode = empty ? "Unavailable" : value;
  const s: FieldSource = empty ? "unavailable" : source;
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <Badge variant="outline" className={`text-[10px] ${COLORS[s]}`}>{LABELS[s]}</Badge>
      </div>
      <div className="mt-1 text-sm font-medium text-foreground break-words">{display}</div>
    </div>
  );
}