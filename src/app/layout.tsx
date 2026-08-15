import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "M-Pesa Business Manager — Sales, M-Pesa & Inventory for Kenyan SMEs",
    template: "%s · M-Pesa Business Manager",
  },
  description:
    "Run your Kenyan business from one dashboard — sales, M-Pesa transactions, expenses, inventory, customers and financial reports.",
  keywords: ["M-Pesa", "SME", "Kenya", "point of sale", "inventory", "bookkeeping"],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full bg-background text-foreground">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
