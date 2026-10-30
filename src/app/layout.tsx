import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Epoch · Miden quotes",
  description: "Live Epoch quote availability into and out of Miden.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
