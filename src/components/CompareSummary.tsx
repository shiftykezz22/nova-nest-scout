import type { CompareResult } from "@/lib/compare";
import { Trophy, Minus } from "lucide-react";

export function CompareSummary({ result }: { result: CompareResult }) {
  const { winner, priceDelta, ratingDelta, reviewsDelta, rationale } = result;

  if (winner === "insufficient") {
    return (
      <div className="rounded-2xl border border-dashed bg-muted/40 p-4 text-center text-sm text-muted-foreground">
        {rationale}
      </div>
    );
  }

  const label =
    winner === "walmart"
      ? "Better value on Walmart"
      : winner === "amazon"
        ? "Better value on Amazon"
        : "It's a tie";
  const tone =
    winner === "walmart"
      ? "border-primary/40 bg-primary/5"
      : winner === "amazon"
        ? "border-amber-300/60 bg-amber-50"
        : "border-border bg-muted/40";

  return (
    <div className={`rounded-2xl border p-4 ${tone}`}>
      <div className="flex items-center gap-2">
        {winner === "tie" ? (
          <Minus className="h-5 w-5 text-muted-foreground" />
        ) : (
          <Trophy className="h-5 w-5 text-primary" />
        )}
        <h3 className="text-lg font-semibold">{label}</h3>
      </div>
      <p className="mt-1 text-sm text-foreground">{rationale}</p>
      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <Stat
          label="Price gap"
          value={priceDelta != null ? `$${Math.abs(priceDelta).toFixed(2)}` : "—"}
          sub={
            priceDelta == null
              ? undefined
              : priceDelta < 0
                ? "Walmart cheaper"
                : priceDelta > 0
                  ? "Amazon cheaper"
                  : "even"
          }
        />
        <Stat
          label="Rating gap"
          value={ratingDelta != null ? `${Math.abs(ratingDelta).toFixed(1)}★` : "—"}
          sub={
            ratingDelta == null
              ? undefined
              : ratingDelta > 0
                ? "Walmart higher"
                : ratingDelta < 0
                  ? "Amazon higher"
                  : "even"
          }
        />
        <Stat
          label="Reviews gap"
          value={reviewsDelta != null ? Math.abs(reviewsDelta).toLocaleString() : "—"}
          sub={
            reviewsDelta == null
              ? undefined
              : reviewsDelta > 0
                ? "Walmart more"
                : reviewsDelta < 0
                  ? "Amazon more"
                  : "even"
          }
        />
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border bg-background p-2 text-center">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm font-semibold text-foreground">{value}</div>
      {sub && <div className="mt-0.5 text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}