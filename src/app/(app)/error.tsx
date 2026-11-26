"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-4 py-24 text-center">
      <AlertTriangle className="h-10 w-10 text-destructive" />
      <h1 className="text-xl font-semibold">Une erreur est survenue</h1>
      <p className="text-sm text-muted-foreground">
        La page n&apos;a pas pu être affichée. {error.digest ? `Référence : ${error.digest}` : ""}
      </p>
      <Button onClick={reset}>
        <RotateCcw /> Réessayer
      </Button>
    </div>
  );
}
