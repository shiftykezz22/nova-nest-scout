import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function InfoTip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label={`About ${label}`} className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-primary hover:bg-accent">
          <Info className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="max-w-xs text-sm">
        <div className="font-semibold mb-1">{label}</div>
        <div className="text-muted-foreground">{children}</div>
      </PopoverContent>
    </Popover>
  );
}

export const DEFINITIONS: Record<string, string> = {
  "MOQ": "Minimum order quantity — the smallest number of units a supplier will sell in one order.",
  "Lead time": "How many days from placing an order to receiving product at your warehouse.",
  "Unit cost": "What you pay the supplier for one unit of the product.",
  "Landed cost": "Unit cost plus shipping, duties, prep, and inbound freight — your true per-unit cost.",
  "Referral fee": "The percentage Walmart takes from each sale, similar to a marketplace commission.",
  "Fulfillment fee": "Per-unit cost to pick, pack, and ship the order (WFS or 3PL).",
  "Storage cost": "Monthly warehouse storage cost per unit.",
  "Profit margin": "Profit divided by selling price, shown as a percentage.",
  "ROI": "Return on investment — profit divided by landed cost, shown as a percentage.",
  "Break-even price": "The lowest price you can sell at without losing money.",
  "Sales rank": "How well a product sells compared to others in its category.",
  "Estimated demand": "Your best guess of monthly units sold. Verify with real data before ordering.",
  "Match confidence": "How confident we are the supplier item matches the Walmart product.",
  "Authorized distributor": "A supplier officially approved by the brand to resell.",
  "Private label": "You sell the product under your own brand instead of the original brand.",
  "Case pack": "How many units come in one supplier case.",
};