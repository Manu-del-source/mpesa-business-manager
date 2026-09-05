import React from "react";
import type { Metadata } from "next";
import { getPageContext } from "@/lib/page-context";
import { OmniPaymentDetailView } from "@/components/payments/omni-payment-detail-view";

export const metadata: Metadata = { title: "Payment Details" };
export const dynamic = "force-dynamic";

export default async function PaymentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx, permissions } = await getPageContext();

  return (
    <OmniPaymentDetailView
      paymentId={id}
      environment={ctx.environment}
      applicationName={ctx.application.name}
      canCancel={permissions.includes("payments:cancel")}
      canRefund={permissions.includes("payments:refund")}
    />
  );
}
