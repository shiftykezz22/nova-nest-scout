export type CalcInputs = {
  sellingPrice: number;
  unitCost: number;
  shippingPerUnit: number;
  dutiesPerUnit: number;
  prepCostPerUnit: number;
  inboundShippingPerUnit: number;
  referralFeePercent: number;
  fulfillmentFee: number;
  storageCost: number;
  advertisingPercent: number;
  returnAllowancePercent: number;
  orderQuantity?: number;
};

export type CalcResult = {
  landedCost: number;
  marketplaceCosts: number;
  referralFee: number;
  advertisingAllowance: number;
  returnAllowance: number;
  estimatedProfit: number;
  profitMargin: number;
  roi: number;
  breakEvenPrice: number;
  requiredCash: number;
  estimatedOrderProfit: number;
};

const n = (v: unknown): number => {
  const x = typeof v === "number" ? v : parseFloat(String(v ?? 0));
  return Number.isFinite(x) ? x : 0;
};

export function calculate(input: Partial<CalcInputs>): CalcResult {
  const sellingPrice = n(input.sellingPrice);
  const unitCost = n(input.unitCost);
  const shipping = n(input.shippingPerUnit);
  const duties = n(input.dutiesPerUnit);
  const prep = n(input.prepCostPerUnit);
  const inbound = n(input.inboundShippingPerUnit);
  const referralPct = n(input.referralFeePercent);
  const fulfillment = n(input.fulfillmentFee);
  const storage = n(input.storageCost);
  const adPct = n(input.advertisingPercent);
  const retPct = n(input.returnAllowancePercent);
  const qty = Math.max(0, Math.floor(n(input.orderQuantity)));

  const landedCost = unitCost + shipping + duties + prep + inbound;
  const referralFee = sellingPrice * (referralPct / 100);
  const advertisingAllowance = sellingPrice * (adPct / 100);
  const returnAllowance = sellingPrice * (retPct / 100);
  const marketplaceCosts = referralFee + fulfillment + storage + advertisingAllowance + returnAllowance;
  const estimatedProfit = sellingPrice - landedCost - marketplaceCosts;
  const profitMargin = sellingPrice > 0 ? (estimatedProfit / sellingPrice) * 100 : 0;
  const roi = landedCost > 0 ? (estimatedProfit / landedCost) * 100 : 0;
  const breakEvenPrice = landedCost + marketplaceCosts;
  const requiredCash = landedCost * qty;
  const estimatedOrderProfit = estimatedProfit * qty;

  return { landedCost, marketplaceCosts, referralFee, advertisingAllowance, returnAllowance, estimatedProfit, profitMargin, roi, breakEvenPrice, requiredCash, estimatedOrderProfit };
}

export const usd = (v: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number.isFinite(v) ? v : 0);

export type Scenario = "conservative" | "expected" | "optimistic";

export function scenarioInputs(base: CalcInputs, s: Scenario): CalcInputs {
  const mult = s === "conservative" ? 0.9 : s === "optimistic" ? 1.1 : 1;
  const costMult = s === "conservative" ? 1.1 : s === "optimistic" ? 0.95 : 1;
  return { ...base, sellingPrice: base.sellingPrice * mult, unitCost: base.unitCost * costMult, shippingPerUnit: base.shippingPerUnit * costMult };
}