import type { ProductData } from "./walmart";

export type CategoryBucket = "high_margin" | "medium_margin" | "low_margin" | "unknown";
export type EstimateConfidence = "low" | "medium" | "high";

export type CostEstimate = {
  unitCost: number;
  cogsPercent: number; // 0-100
  confidence: EstimateConfidence;
  categoryBucket: CategoryBucket;
  rationale: string;
};

const HIGH_MARGIN = [
  "beauty", "cosmetic", "makeup", "skincare", "fragrance", "perfume",
  "jewelry", "necklace", "bracelet", "earring", "ring ",
  "accessor", "handbag", "wallet", "sunglasses", "watch",
  "supplement", "vitamin", "protein", "collagen",
  "candle", "diffuser", "essential oil",
  "toy", "plush", "hobby", "craft", "board game", "puzzle", "collectible",
];

const MEDIUM_MARGIN = [
  "home", "decor", "bedding", "bath", "kitchen", "cookware", "utensil", "storage",
  "pet", "dog", "cat", "aquarium",
  "fitness", "yoga", "exercise", "athletic",
  "apparel", "cloth", "shirt", "pant", "dress", "shoe", "sneaker", "sock",
  "furniture", "office", "desk", "chair",
];

const LOW_MARGIN = [
  "electronic", "laptop", "computer", "monitor", "tv", "television",
  "phone", "smartphone", "tablet", "camera", "console", "gaming",
  "headphone", "earbud", "speaker", "router", "cable", "charger", "battery",
  "printer", "appliance", "refrigerator", "microwave", "vacuum",
  "tool", "drill", "grocery", "food", "beverage", "commodit",
];

function classify(product: ProductData): CategoryBucket {
  const hay = [
    product.title,
    product.brand,
    product.category,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (product as any).breadcrumb,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (!hay) return "unknown";
  if (LOW_MARGIN.some((k) => hay.includes(k))) return "low_margin";
  if (HIGH_MARGIN.some((k) => hay.includes(k))) return "high_margin";
  if (MEDIUM_MARGIN.some((k) => hay.includes(k))) return "medium_margin";
  return "unknown";
}

function bucketRange(bucket: CategoryBucket): { lo: number; hi: number; mid: number } {
  switch (bucket) {
    case "high_margin": return { lo: 28, hi: 38, mid: 33 };
    case "medium_margin": return { lo: 42, hi: 55, mid: 48 };
    case "low_margin": return { lo: 58, hi: 72, mid: 65 };
    default: return { lo: 45, hi: 60, mid: 52 };
  }
}

const KNOWN_BRANDS = [
  "apple", "samsung", "sony", "lg", "dell", "hp", "lenovo", "microsoft", "google",
  "nintendo", "logitech", "bose", "jbl", "dyson", "kitchenaid", "cuisinart", "ninja",
  "instant pot", "keurig", "nespresso", "nike", "adidas", "under armour", "levi",
  "carhartt", "columbia", "north face", "patagonia", "coach", "michael kors", "ray-ban",
  "oakley", "fitbit", "garmin", "gopro", "canon", "nikon", "philips", "panasonic",
  "black & decker", "dewalt", "milwaukee", "craftsman", "shark", "roomba", "irobot",
  "hasbro", "mattel", "lego", "fisher-price",
];

function isKnownBrand(product: ProductData): boolean {
  const brand = (product.brand || "").toLowerCase();
  if (!brand) return false;
  return KNOWN_BRANDS.some((b) => brand.includes(b));
}

function parseWeight(product: ProductData): number {
  if (typeof product.product_weight === "number" && Number.isFinite(product.product_weight)) return product.product_weight;
  const raw = product.shipping_weight;
  if (!raw) return 0;
  const n = parseFloat(String(raw).replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function estimateUnitCost(product: ProductData): CostEstimate {
  const price = Number(product.price ?? 0);
  if (!price || price <= 0) {
    return {
      unitCost: 0,
      cogsPercent: 0,
      confidence: "low",
      categoryBucket: "unknown",
      rationale: "Selling price unavailable — cannot estimate supplier cost.",
    };
  }

  const bucket = classify(product);
  const { lo, hi, mid } = bucketRange(bucket);
  let cogsPct = mid;
  const notes: string[] = [];

  switch (bucket) {
    case "high_margin": notes.push("high-margin category (beauty / accessory / hobby)"); break;
    case "medium_margin": notes.push("mid-margin category (home / apparel / fitness)"); break;
    case "low_margin": notes.push("low-margin category (electronics / commodity)"); break;
    default: notes.push("category unclear — assumed mid-range");
  }

  // Known brand → less headroom for wholesaler → cost pushed higher
  const known = isKnownBrand(product);
  if (known) {
    cogsPct += 5;
    notes.push(`known brand "${product.brand}" — tighter wholesale`);
  } else if (product.brand) {
    cogsPct -= 3;
    notes.push("generic / lesser-known brand — more headroom");
  }

  // Pack size — bulk pushes per-unit cost down
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pack = Number((product as any).pack_size ?? (product as any).case_pack ?? 0);
  if (pack >= 6) { cogsPct -= 5; notes.push(`multi-pack of ${pack} — bulk discount`); }
  else if (pack >= 2) { cogsPct -= 2; notes.push(`${pack}-pack — small bulk discount`); }

  // Weight — heavy items usually low margin
  const wt = parseWeight(product);
  if (wt >= 20) { cogsPct += 4; notes.push(`heavy (${wt} lb) — freight compresses margin`); }
  else if (wt >= 8) { cogsPct += 2; notes.push(`${wt} lb — moderate freight impact`); }

  // Retail price extremes
  if (price < 8) { cogsPct += 4; notes.push("very low retail price — thin absolute margin"); }
  else if (price >= 150) { cogsPct -= 3; notes.push("premium retail price — more margin headroom"); }

  // Clamp within +/-10 of category range so we stay reasonable
  cogsPct = Math.max(lo - 5, Math.min(hi + 5, cogsPct));

  const unitCost = +(price * (cogsPct / 100)).toFixed(2);

  // Confidence
  let confidence: EstimateConfidence = "low";
  const signals = [bucket !== "unknown", !!product.brand, !!product.category, wt > 0, pack > 0].filter(Boolean).length;
  if (bucket !== "unknown" && signals >= 3) confidence = "high";
  else if (bucket !== "unknown" && signals >= 2) confidence = "medium";

  const rationale = `Est. ${cogsPct.toFixed(0)}% of retail — ${notes.join("; ")}.`;

  return { unitCost, cogsPercent: +cogsPct.toFixed(1), confidence, categoryBucket: bucket, rationale };
}