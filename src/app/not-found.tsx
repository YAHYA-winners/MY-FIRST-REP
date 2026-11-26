import Link from "next/link";
import { SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[60dvh] max-w-lg flex-col items-center justify-center gap-4 text-center">
      <SearchX className="h-10 w-10 text-muted-foreground" />
      <h1 className="text-xl font-semibold">Page ou élément introuvable</h1>
      <p className="text-sm text-muted-foreground">L&apos;élément demandé n&apos;existe pas ou n&apos;appartient pas à la société active.</p>
      <Button asChild>
        <Link href="/dashboard">Retour au tableau de bord</Link>
      </Button>
    </div>
  );
}
