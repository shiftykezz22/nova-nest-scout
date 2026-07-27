import type { ProductData } from "./walmart";

const KEY = "novanest_guest_scan_v1";
const USED_KEY = "novanest_guest_used_v1";

export type GuestScan = {
  id: string;
  input_url: string;
  normalized_url?: string;
  walmart_item_id?: string;
  product_data: ProductData;
  analysis_status: string;
  created_at: string;
};

export function getGuestScan(): GuestScan | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveGuestScan(scan: GuestScan) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(scan));
  localStorage.setItem(USED_KEY, "1");
}

export function updateGuestProduct(patch: Partial<ProductData>) {
  const s = getGuestScan();
  if (!s) return;
  s.product_data = { ...s.product_data, ...patch };
  localStorage.setItem(KEY, JSON.stringify(s));
}

export function guestUsed(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(USED_KEY) === "1";
}

export function clearGuest() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(KEY);
  localStorage.removeItem(USED_KEY);
}