import type { VerdictResult } from "@/lib/verdict";
import type { CalcResult } from "@/lib/calc";
import { usd } from "@/lib/calc";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2, HelpCircle, XCircle } from "lucide-react";

const V = {
  BUY: { label: "BUY", color: "bg-emerald-600 text-white", Icon: CheckCircle2 },
  REVIEW: { label: "MAYBE", color: "bg-amber-500 text-white", Icon: AlertTriangle },
  SKIP: { label: "SKIP", color: "bg-red-600 text-white", Icon: XCircle },
  INSUFFICIENT_DATA: { label: "INSUFFICIENT DATA", color: "bg-muted text-foreground", Icon: HelpCircle },
} as const;

export function VerdictCard({ v, calc, walmartPrice, bestSupplierName, quantity, canCalc }: {
  v: VerdictResult;
  calc: CalcResult;
  walmartPrice?: number;
  bestSupplierName?: string;
  quantity?: number;
  canCalc?: boolean;
}) {
  const style = V[v.verdict];
  const Icon = style.Icon;
  const confLabel = v.confidence >= 70 ? "High" : v.confidence >= 40 ? "Medium" : "Low";
  const recTest = Math.max(5, Math.min(50, Math.round((walmartPrice ? 250 / walmartPrice : 20))));
  const na = "—";
  const showCalc = canCalc !== false;
  const showScore = v.verdict !== "INSUFFICIENT_DATA" && v.confidence > 0 && showCalc;
  return (
    <div className="rounded-2xl border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-bold ${style.color}`}>
            <Icon className="h-4 w-4" /> {style.label}
          </div>
          <div className="mt-2 text-sm text-muted-foreground">{v.nextAction}</div>
        </div>
        <div className="text-right">
          {showScore ? (
            <>
              <div className="text-3xl font-bold text-foreground">{v.opportunityScore}</div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Opportunity</div>
            </>
          ) : (
            <>
              <div className="text-lg font-semibold text-muted-foreground">Score pending</div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">More verified data required</div>
            </>
          )}
          <div className="mt-1 text-xs">
            <Badge variant="outline">{confLabel} confidence · {v.confidence}%</Badge>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 md:grid-cols-4">
        <Stat label="Walmart price" value={walmartPrice ? usd(walmartPrice) : "—"} />
        <Stat label="Landed cost" value={showCalc ? usd(calc.landedCost) : na} />
        <Stat label="Profit / unit" value={showCalc ? usd(calc.estimatedProfit) : na} tone={showCalc ? (calc.estimatedProfit >= 0 ? "good" : "bad") : undefined} />
        <Stat label="Margin" value={showCalc ? `${calc.profitMargin.toFixed(1)}%` : na} tone={showCalc ? (calc.profitMargin >= 15 ? "good" : calc.profitMargin >= 5 ? "warn" : "bad") : undefined} />
        <Stat label="ROI" value={showCalc ? `${calc.roi.toFixed(0)}%` : na} tone={showCalc ? (calc.roi >= 30 ? "good" : calc.roi >= 10 ? "warn" : "bad") : undefined} />
        <Stat label="Break-even" value={showCalc ? usd(calc.breakEvenPrice) : na} />
        <Stat label="Recommended test qty" value={String(quantity ?? recTest)} />
        <Stat label="Required cash" value={showCalc ? usd(calc.requiredCash || (calc.landedCost * (quantity ?? recTest))) : na} />
      </div>
      {!showCalc && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          Cannot calculate — missing required inputs (selling price and unit cost). Enter them manually below to see profit, margin, ROI and break-even.
        </div>
      )}

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Best supplier so far</div>
          <div className="mt-1 text-sm font-medium">{bestSupplierName ?? "None selected yet"}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Main advantages</div>
          <ul className="mt-1 space-y-0.5 text-sm">{v.reasons.slice(0, 3).map((r) => <li key={r}>• {r}</li>)}</ul>
        </div>
      </div>

      {v.risks.length > 0 && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <div className="text-xs font-semibold text-amber-900">Main risks</div>
          <ul className="mt-1 space-y-0.5 text-xs text-amber-900">{v.risks.map((r) => <li key={r}>• {r}</li>)}</ul>
        </div>
      )}

      {v.missing.length > 0 && (
        <div className="mt-3 rounded-lg border bg-muted/50 p-3">
          <div className="text-xs font-semibold">Missing information</div>
          <div className="mt-1 text-xs text-muted-foreground">{v.missing.join(" · ")}</div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "warn" | "bad" }) {
  const color = tone === "good" ? "text-emerald-700" : tone === "warn" ? "text-amber-700" : tone === "bad" ? "text-red-700" : "text-foreground";
  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 text-lg font-semibold ${color}`}>{value}</div>
    </div>
  );
}