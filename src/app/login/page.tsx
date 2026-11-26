import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Boxes, QrCode, ScanLine, Sparkles } from "lucide-react";
import { getAppContext } from "@/lib/server/auth";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Connexion" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const ctx = await getAppContext();
  const { next } = await searchParams;
  if (ctx) redirect(next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");

  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden flex-col justify-between overflow-hidden bg-sidebar p-12 text-sidebar-foreground lg:flex">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-content-center rounded-lg bg-primary">
            <Boxes className="h-5 w-5 text-white" />
          </div>
          <div>
            <p className="text-lg font-semibold text-white">ImmoTrack</p>
            <p className="text-xs text-sidebar-muted">Fixed Asset Inventory Platform</p>
          </div>
        </div>
        <div className="max-w-lg space-y-6">
          <h1 className="text-3xl font-semibold leading-tight text-white">
            Inventaire physique des immobilisations, du terrain jusqu&apos;au procès-verbal.
          </h1>
          <ul className="space-y-4 text-sm">
            <li className="flex gap-3">
              <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-sky-300" />
              <span>Extraction IA des factures fournisseurs et génération automatique des fiches immobilisations.</span>
            </li>
            <li className="flex gap-3">
              <QrCode className="mt-0.5 h-5 w-5 shrink-0 text-sky-300" />
              <span>Étiquetage QR sur rouleaux thermiques ou planches A4.</span>
            </li>
            <li className="flex gap-3">
              <ScanLine className="mt-0.5 h-5 w-5 shrink-0 text-sky-300" />
              <span>Comptage mobile, rapprochement physico-comptable et PV d&apos;inventaire prêt à signer.</span>
            </li>
          </ul>
        </div>
        <p className="text-xs text-sidebar-muted">Conforme aux pratiques CGNC — traçabilité intégrale des mouvements.</p>
      </section>
      <section className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-8">
          <div className="space-y-2 text-center lg:text-left">
            <div className="mx-auto grid h-11 w-11 place-content-center rounded-lg bg-primary lg:hidden">
              <Boxes className="h-5 w-5 text-white" />
            </div>
            <h2 className="text-2xl font-semibold tracking-tight">Connexion</h2>
            <p className="text-sm text-muted-foreground">Accédez à votre espace de gestion des immobilisations.</p>
          </div>
          <LoginForm next={next ?? ""} />
        </div>
      </section>
    </main>
  );
}
