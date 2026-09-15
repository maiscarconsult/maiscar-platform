import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "Content Intelligence Platform",
  description: "Autonomous content generation, competitor intelligence and revenue attribution.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="bg-slate-950 text-slate-100 min-h-screen">{children}</body>
    </html>
  );
}
