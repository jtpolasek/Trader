import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GMGN Paper Trader",
  description: "A local Ethereum paper trading simulator with fee-aware PnL."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
