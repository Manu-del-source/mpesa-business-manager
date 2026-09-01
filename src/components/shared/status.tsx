import { Badge, type BadgeProps } from "@/components/ui/badge";

const SALE_STATUS_STYLES: Record<string, BadgeProps["variant"]> = {
  COMPLETED: "success",
  PENDING: "warning",
  REFUNDED: "secondary",
  CANCELLED: "muted",
};

export function SaleStatusBadge({ status }: { status: string }) {
  const label =
    status === "COMPLETED"
      ? "Completed"
      : status === "PENDING"
        ? "Pending"
        : status === "REFUNDED"
          ? "Refunded"
          : "Cancelled";
  return <Badge variant={SALE_STATUS_STYLES[status] ?? "secondary"}>{label}</Badge>;
}

const MPESA_STATUS_STYLES: Record<string, BadgeProps["variant"]> = {
  SUCCESS: "success",
  PENDING: "warning",
  FAILED: "destructive",
  CANCELLED: "muted",
  TIMEOUT: "muted",
};

export function MpesaStatusBadge({ status }: { status: string }) {
  const label = status.charAt(0) + status.slice(1).toLowerCase();
  return <Badge variant={MPESA_STATUS_STYLES[status] ?? "secondary"}>{label}</Badge>;
}

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  MPESA: "M-Pesa",
  CASH: "Cash",
  CARD: "Card",
  BANK_TRANSFER: "Bank transfer",
  CREDIT: "Credit",
};

export function PaymentMethodBadge({ method }: { method: string }) {
  return <Badge variant="outline">{PAYMENT_METHOD_LABELS[method] ?? method}</Badge>;
}

export const EXPENSE_CATEGORY_LABELS: Record<string, string> = {
  INVENTORY: "Inventory restock",
  RENT: "Rent",
  SALARIES: "Salaries",
  UTILITIES: "Utilities",
  MARKETING: "Marketing",
  TRANSPORT: "Transport",
  MAINTENANCE: "Maintenance",
  TAXES: "Taxes",
  SOFTWARE: "Software",
  OTHER: "Other",
};

export function ExpenseCategoryBadge({ category }: { category: string }) {
  return (
    <Badge variant="secondary">{EXPENSE_CATEGORY_LABELS[category] ?? category}</Badge>
  );
}

/**
 * Generic status badge for infrastructure resources (payments, payouts,
 * refunds, journal transactions…). Unknown statuses render neutrally rather
 * than throwing, so a new backend status never breaks the console.
 */
export function StatusBadge({ status }: { status: string }) {
  const key = (status ?? "").toUpperCase();

  const variants: Record<string, string> = {
    SUCCEEDED: "bg-emerald-100 text-emerald-800 border-emerald-200",
    COMPLETED: "bg-emerald-100 text-emerald-800 border-emerald-200",
    ACTIVE: "bg-emerald-100 text-emerald-800 border-emerald-200",
    PENDING: "bg-amber-100 text-amber-800 border-amber-200",
    PROCESSING: "bg-blue-100 text-blue-800 border-blue-200",
    FAILED: "bg-red-100 text-red-800 border-red-200",
    CANCELLED: "bg-neutral-100 text-neutral-700 border-neutral-200",
    VOIDED: "bg-neutral-100 text-neutral-700 border-neutral-200",
  };

  const className = variants[key] ?? "bg-neutral-100 text-neutral-700 border-neutral-200";
  const label = key ? key.charAt(0) + key.slice(1).toLowerCase() : "Unknown";

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${className}`}
    >
      {label}
    </span>
  );
}
