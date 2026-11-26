import { Badge } from "@/components/ui/badge";
import type { Tone } from "@/lib/constants";

export function ToneBadge({ tone, children, className }: { tone: Tone; children: React.ReactNode; className?: string }) {
  return (
    <Badge variant={tone} className={className}>
      {children}
    </Badge>
  );
}
