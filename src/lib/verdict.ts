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
  label: string;
  confidence: number;
  opportunityScore: number;
  scores: { demand: number; profit: number; competition: number; supplier: number; risk: number };
  reasons: string[];
  missing: string[];
  nextAction: string;
  risks: string[];
  positives: string[];
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

export type EvaluateOpts = {
  costEstimated?: boolean;
  estimateConfidence?: "low" | "medium" | "high";
};

export function evaluate(product: ProductData, calc: CalcResult, hasSupplier: boolean, opts: EvaluateOpts = {}): VerdictResult {
  const { costEstimated = false, estimateConfidence = "low" } = opts;
  const missing: string[] = [];
  if (!product.price) missing.push("Selling price");
  if (!product.unit_cost && !costEstimated) missing.push("Unit cost");
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

  const fields = [product.title, product.price, product.unit_cost || (costEstimated ? 1 : undefined), product.estimated_demand, hasSupplier || undefined, product.rating, product.review_count, product.shipping_weight || product.product_weight];
  const filled = fields.filter(Boolean).length;
  let confidence = Math.round((filled / fields.length) * 100);
  if (costEstimated) {
    const penalty = estimateConfidence === "high" ? 8 : estimateConfidence === "medium" ? 14 : 22;
    confidence = Math.max(0, confidence - penalty);
  }

  const reasons: string[] = [];
  const positives: string[] = [];
  const canCalc = (product.price ?? 0) > 0 && calc.landedCost > 0;
  if (canCalc) {
    reasons.push(`Estimated profit is $${calc.estimatedProfit.toFixed(2)} per unit.`);
    reasons.push(`ROI is ${calc.roi.toFixed(0)}%.`);
    reasons.push(`Profit margin is ${calc.profitMargin.toFixed(0)}%.`);
    if (calc.estimatedProfit > 0) positives.push(`Positive profit per unit ($${calc.estimatedProfit.toFixed(2)}).`);
    if (calc.roi >= 30) positives.push(`ROI meets 30% threshold.`);
    if (calc.profitMargin >= 15) positives.push(`Margin above 15%.`);
  } else {
    reasons.push("Profit, ROI, and margin cannot be calculated without both selling price and unit cost.");
  }
  if (product.upc_gtin) positives.push("UPC / GTIN retrieved.");
  if (product.brand && product.model) positives.push("Brand and model identified.");
  if ((product.review_count ?? 0) >= 100 && (product.rating ?? 0) >= 4) positives.push("Strong customer feedback signals.");

  const criticalRisk = risks.some((r) => /hazardous/i.test(r));
  const p = calc.estimatedProfit;
  const roi = calc.roi;
  const margin = calc.profitMargin;
  let verdict: Verdict;
  let label: string;
  let nextAction: string;
  if (missing.length >= 3 || confidence < 30) {
    verdict = "INSUFFICIENT_DATA";
    label = "Insufficient Data";
    nextAction = "Fill in the missing fields below to get a recommendation.";
  } else if (!canCalc) {
    verdict = "INSUFFICIENT_DATA";
    label = "Insufficient Data";
    nextAction = "Enter a selling price and unit cost to calculate profit.";
  } else if (costEstimated && (p < 3 || roi < 15 || margin < 8)) {
    verdict = "SKIP";
    label = "Skip — Estimate Too Thin";
    nextAction = "Even the optimistic estimate is too low. Skip this product.";
  } else if (p < 0 || roi < 10 || margin < 5 || criticalRisk || risks.length >= 4) {
    verdict = "SKIP";
    label = "High Risk";
    nextAction = "This product does not meet minimum profit or risk requirements.";
  } else if (costEstimated && p >= 5 && roi >= 30 && margin >= 15 && risks.length === 0) {
    verdict = "REVIEW";
    label = "Promising — Get Real Quote";
    nextAction = "Open the Alibaba / ThomasNet links and get a real unit cost before ordering anything.";
  } else if (costEstimated) {
    verdict = "REVIEW";
    label = "Borderline — Verify Cost First";
    nextAction = `Numbers are thin at ~${margin.toFixed(0)}% margin. Get a real supplier quote before ordering — a small cost change flips this deal.`;
  } else if (p >= 5 && roi >= 30 && margin >= 15 && hasSupplier && risks.length === 0) {
    verdict = "BUY";
    label = "Strong Buy Candidate";
    nextAction = "Numbers look strong. Order a small test quantity from your supplier and validate shipping.";
  } else if (margin < 12 || roi < 20) {
    verdict = "REVIEW";
    label = "Borderline";
    nextAction = "Margins are thin. Verify fees, shipping, and demand before ordering.";
  } else {
    verdict = "REVIEW";
    label = "Promising — Verify Supplier";
    nextAction = "Numbers look decent. Confirm real supplier cost and shipping, then order a small test quantity.";
  }

  return {
    verdict,
    label,
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
    positives,
  };
}