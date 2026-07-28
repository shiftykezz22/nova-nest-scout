import type { CalcResult } from "./calc";
import type { ProductData } from "./walmart";

export type Verdict = "BUY" | "REVIEW" | "SKIP" | "INSUFFICIENT_DATA";

// Centralized verdict thresholds. Adjust here to retune Buy / Maybe / Skip.
export const VERDICT_THRESHOLDS = {
  BUY: { profit: 5, roi: 30, margin: 15, confidence: 65, opportunity: 75 },
  SKIP: { roi: 10, margin: 5, maxRisks: 4 },
  MIN_CONFIDENCE: 40,
  MAX_MISSING: 3,
} as const;

export type VerdictResult = {
  verdict: Verdict;
  confidence: number;
  opportunityScore: number;
  scores: { demand: number; profit: number; competition: number; supplier: number; risk: number };
  reasons: string[];
  missing: string[];
  nextAction: string;
  risks: string[];
};

export function detectRisks(p: ProductData): string[] {
  const r: string[] = [];
  const title = (p.title || "").toLowerCase();
  const cat = (p.category || "").toLowerCase();
  const w = p.product_weight || parseFloat(String(p.shipping_weight || "").replace(/[^\d.]/g, ""));
  if (w && w > 5) r.push("Heavy product — freight and FBA fees will be higher.");
  if (/liquid|shampoo|detergent|oil|beverage/.test(title)) r.push("Liquid product — restricted shipping and hazmat review.");
  if (/glass|ceramic|fragile|mirror/.test(title)) r.push("Fragile product — expect breakage and returns.");
  if (/christmas|halloween|easter|valentine|seasonal/.test(title + cat)) r.push("Seasonal product — sell-through window is narrow.");
  if (/battery|aerosol|flammable|lithium/.test(title)) r.push("Possible hazardous material — needs classification review.");
  if (p.seller_count && p.seller_count > 15) r.push("Extreme seller competition on the listing.");
  return r;
}

export function evaluate(product: ProductData, calc: CalcResult, hasSupplier: boolean): VerdictResult {
  const missing: string[] = [];
  if (!product.price) missing.push("Selling price");
  if (!product.unit_cost) missing.push("Unit cost");
  if (!product.estimated_demand) missing.push("Estimated demand");
  if (!hasSupplier) missing.push("Supplier quote");
  if (!product.shipping_weight && !product.product_weight) missing.push("Product weight");

  const risks = detectRisks(product);

  const profitScore = Math.max(0, Math.min(100, calc.profitMargin * 4));
  const roiScore = Math.max(0, Math.min(100, calc.roi));
  const demandScore = product.estimated_demand
    ? Math.min(100, Math.log10(product.estimated_demand + 1) * 30)
    : product.review_count
      ? Math.min(100, Math.log10(product.review_count + 1) * 25)
      : 0;
  const competitionScore = product.seller_count ? Math.max(0, 100 - product.seller_count * 6) : 50;
  const supplierScore = hasSupplier ? 75 : 0;
  const riskScore = Math.max(0, 100 - risks.length * 20);

  const opportunityScore = Math.round((profitScore + roiScore + demandScore + competitionScore + supplierScore + riskScore) / 6);

  const fields = [product.title, product.price, product.unit_cost, product.estimated_demand, hasSupplier || undefined, product.rating, product.review_count, product.shipping_weight || product.product_weight];
  const filled = fields.filter(Boolean).length;
  const confidence = Math.round((filled / fields.length) * 100);

  const reasons: string[] = [];
  reasons.push(`Estimated profit is $${calc.estimatedProfit.toFixed(2)} per unit.`);
  reasons.push(`ROI is ${calc.roi.toFixed(0)}%.`);
  reasons.push(`Profit margin is ${calc.profitMargin.toFixed(0)}%.`);

  const criticalRisk = risks.some((r) => /hazardous/i.test(r));
  let verdict: Verdict;
  let nextAction: string;
  if (missing.length >= 3 || confidence < 40) {
    verdict = "INSUFFICIENT_DATA";
    nextAction = "Fill in the missing fields below to get a recommendation.";
  } else if (calc.estimatedProfit < 0 || calc.roi < 10 || calc.profitMargin < 5 || criticalRisk || risks.length >= 4) {
    verdict = "SKIP";
    nextAction = "This product does not meet minimum profit or risk requirements.";
  } else if (calc.estimatedProfit >= 5 && calc.roi >= 30 && calc.profitMargin >= 15 && hasSupplier && risks.length === 0) {
    verdict = "BUY";
    nextAction = "Order a sample from your supplier and validate shipping.";
  } else {
    verdict = "REVIEW";
    nextAction = "Confirm freight cost and demand estimate before ordering.";
  }

  return {
    verdict,
    confidence,
    opportunityScore,
    scores: {
      demand: Math.round(demandScore),
      profit: Math.round(profitScore),
      competition: Math.round(competitionScore),
      supplier: Math.round(supplierScore),
      risk: Math.round(riskScore),
    },
    reasons,
    missing,
    nextAction,
    risks,
  };
}