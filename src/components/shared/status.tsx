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
