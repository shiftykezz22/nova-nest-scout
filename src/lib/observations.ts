// Verification status labels used across the sources panel and observation rows.
export type VerificationStatus =
  | "verified"
  | "cross_checked"
  | "single_source"
  | "estimated"
  | "user_entered"
  | "conflicting"
  | "unavailable";

export const STATUS_LABEL: Record<VerificationStatus, string> = {
  verified: "Verified",
  cross_checked: "Cross-Checked",
  single_source: "Single Source",
  estimated: "Estimated",
  user_entered: "User Entered",
  conflicting: "Conflicting",
  unavailable: "Unavailable",
};

export const STATUS_TONE: Record<VerificationStatus, string> = {
  verified: "text-emerald-700 border-emerald-200 bg-emerald-50",
  cross_checked: "text-emerald-800 border-emerald-300 bg-emerald-100",
  single_source: "text-sky-700 border-sky-200 bg-sky-50",
  estimated: "text-amber-700 border-amber-200 bg-amber-50",
  user_entered: "text-primary border-primary/20 bg-primary/5",
  conflicting: "text-red-800 border-red-200 bg-red-50",
  unavailable: "text-muted-foreground border-muted-foreground/20 bg-muted/30",
};

// Legacy FieldSource → new VerificationStatus.
export function statusFromLegacy(src?: string): VerificationStatus {
  switch (src) {
    case "verified": return "verified";
    case "public": return "single_source";
    case "user": return "user_entered";
    case "estimated": return "estimated";
    case "unavailable": return "unavailable";
    default: return "unavailable";
  }
}

export function statusConfidence(s: VerificationStatus): number {
  switch (s) {
    case "verified": return 90;
    case "cross_checked": return 95;
    case "single_source": return 65;
    case "estimated": return 40;
    case "user_entered": return 100;
    case "conflicting": return 30;
    case "unavailable": return 0;
  }
}