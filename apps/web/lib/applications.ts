export const STATUS_LABELS = {
  DRAFT: "Draft",
  APPLIED: "Applied",
  RESPONSE: "Got a response",
  INTERVIEW: "Interview",
  OFFER: "Offer",
  REJECTED: "Rejected",
  WITHDRAWN: "Withdrawn",
} as const;

export type Status = keyof typeof STATUS_LABELS;
export const STATUSES = Object.keys(STATUS_LABELS) as Status[];

export const STATUS_STYLES: Record<Status, string> = {
  DRAFT: "bg-slate-100 text-slate-700",
  APPLIED: "bg-brand-50 text-brand-800",
  RESPONSE: "bg-violet-100 text-violet-800",
  INTERVIEW: "bg-amber-100 text-amber-900",
  OFFER: "bg-green-100 text-green-800",
  REJECTED: "bg-red-50 text-red-800",
  WITHDRAWN: "bg-slate-100 text-slate-500",
};

export function formatDay(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
}
