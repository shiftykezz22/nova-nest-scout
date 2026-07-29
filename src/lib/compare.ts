import type { ProductData } from "./walmart";
import type { AmazonProduct } from "./amazon";

export type CompareOffer = {
  retailer: "walmart" | "amazon";
  title?: string;
  price?: number;
  rating?: number;
  reviews?: number;
  image?: string;
  url?: string;
};

export type CompareResult = {
  winner: "walmart" | "amazon" | "tie" | "insufficient";
  priceDelta?: number; // walmart - amazon
  ratingDelta?: number;
  reviewsDelta?: number;
  rationale: string;
};

export function walmartToOffer(p: ProductData | null | undefined): CompareOffer {
  return {
    retailer: "walmart",
    title: p?.title,
    price: p?.price,
    rating: p?.rating,
    reviews: p?.review_count,
    image: p?.image,
    url: p?.product_url,
  };
}

export function amazonToOffer(p: AmazonProduct | null | undefined): CompareOffer {
  return {
    retailer: "amazon",
    title: p?.title,
    price: p?.price,
    rating: p?.rating,
    reviews: p?.review_count,
    image: p?.image,
    url: p?.product_url,
  };
}

// Simple heuristic: lower price wins, unless the other side has a rating
// advantage >= 0.5 stars backed by at least 50 reviews.
export function compareOffers(w: CompareOffer, a: CompareOffer): CompareResult {
  if (w.price == null || a.price == null) {
    return { winner: "insufficient", rationale: "Enter prices on both sides to compare." };
  }
  const priceDelta = +(w.price - a.price).toFixed(2);
  const ratingDelta =
    w.rating != null && a.rating != null ? +(w.rating - a.rating).toFixed(2) : undefined;
  const reviewsDelta =
    w.reviews != null && a.reviews != null ? w.reviews - a.reviews : undefined;

  const cheaper: "walmart" | "amazon" | "tie" =
    priceDelta < -0.01 ? "walmart" : priceDelta > 0.01 ? "amazon" : "tie";

  // Rating override: strong rating gap with meaningful review volume
  if (ratingDelta != null) {
    if (ratingDelta >= 0.5 && (w.reviews ?? 0) >= 50) {
      return {
        winner: "walmart",
        priceDelta,
        ratingDelta,
        reviewsDelta,
        rationale: `Walmart rates ${ratingDelta.toFixed(1)}★ higher with ${w.reviews} reviews — worth the ${priceDelta > 0 ? `$${priceDelta.toFixed(2)} premium` : "similar price"}.`,
      };
    }
    if (ratingDelta <= -0.5 && (a.reviews ?? 0) >= 50) {
      return {
        winner: "amazon",
        priceDelta,
        ratingDelta,
        reviewsDelta,
        rationale: `Amazon rates ${Math.abs(ratingDelta).toFixed(1)}★ higher with ${a.reviews} reviews — worth the ${priceDelta < 0 ? `$${Math.abs(priceDelta).toFixed(2)} premium` : "similar price"}.`,
      };
    }
  }

  if (cheaper === "tie") {
    return {
      winner: "tie",
      priceDelta,
      ratingDelta,
      reviewsDelta,
      rationale: "Prices are within a dollar — pick the retailer you trust more.",
    };
  }
  const diff = Math.abs(priceDelta).toFixed(2);
  return {
    winner: cheaper,
    priceDelta,
    ratingDelta,
    reviewsDelta,
    rationale: `${cheaper === "walmart" ? "Walmart" : "Amazon"} is $${diff} cheaper.`,
  };
}

export function usd(n?: number): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `$${n.toFixed(2)}`;
}