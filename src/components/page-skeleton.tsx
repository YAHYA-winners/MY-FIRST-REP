import { Skeleton } from "@/components/ui/skeleton";

/** Route-level loading state: shown instantly on navigation while server data streams in. */
export function PageSkeleton({ tiles = 4 }: { tiles?: number }) {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Chargement…</span>
      <Skeleton className="h-4 w-28" />
      <Skeleton className="h-8 w-80" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: tiles }).map((_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
      <Skeleton className="h-72" />
    </div>
  );
}
