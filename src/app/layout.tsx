import type { Metadata, Viewport } from "next";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "ImmoTrack — Inventaire des immobilisations", template: "%s · ImmoTrack" },
  description:
    "Gestion d'inventaire physique des immobilisations : registre, extraction IA des factures, étiquetage QR, inventaire terrain et rapprochement physico-comptable.",
  applicationName: "ImmoTrack",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#13203a",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className="min-h-dvh font-sans">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
