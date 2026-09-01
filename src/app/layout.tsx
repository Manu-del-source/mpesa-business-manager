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
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-full bg-background text-foreground font-body-md text-body-md">
        <ThemeProvider>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
