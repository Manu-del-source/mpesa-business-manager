import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme/theme-provider";

// Self-hosted Geist fonts (copied from the `geist` npm package) so the app
// renders identically offline and doesn't depend on Google Fonts at build time.
const geistSans = localFont({
  src: "../fonts/geist-sans-variable.woff2",
  variable: "--font-geist-sans",
  display: "swap",
});

const geistMono = localFont({
  src: "../fonts/geist-mono-variable.woff2",
  variable: "--font-geist-mono",
  display: "swap",
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
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-background text-foreground">
        <ThemeProvider>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
