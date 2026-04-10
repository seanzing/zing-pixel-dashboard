import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pixel Dashboard — ZING",
  description: "ZING internal publishing tool",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-zing-cream text-gray-900 antialiased">
        {children}
      </body>
    </html>
  );
}
