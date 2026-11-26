"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Boxes } from "lucide-react";
import { NAV_SECTIONS } from "@/components/layout/nav-config";
import { can } from "@/lib/permissions";
import type { UserRoleValue } from "@/lib/domain";
import { cn } from "@/lib/utils";

export function SidebarNav({ role, companyName, onNavigate }: { role: UserRoleValue; companyName: string; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-16 items-center gap-3 border-b border-white/10 px-5">
        <div className="grid h-9 w-9 place-content-center rounded-lg bg-primary">
          <Boxes className="h-5 w-5 text-white" />
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-white">ImmoTrack</p>
          <p className="truncate text-xs text-sidebar-muted">{companyName}</p>
        </div>
      </div>
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4 scrollbar-thin">
        {NAV_SECTIONS.map((section) => {
          const items = section.items.filter((i) => can(role, i.permission));
          if (!items.length) return null;
          return (
            <div key={section.title}>
              <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-sidebar-muted">{section.title}</p>
              <ul className="space-y-0.5">
                {items.map((item) => {
                  const active = item.exact
                    ? pathname === item.href || (pathname.startsWith(`${item.href}/`) && !items.some((o) => o !== item && pathname.startsWith(o.href)))
                    : pathname === item.href || pathname.startsWith(`${item.href}/`);
                  const Icon = item.icon;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={onNavigate}
                        className={cn(
                          "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                          active ? "bg-sidebar-accent font-medium text-white" : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-white",
                        )}
                      >
                        <Icon className={cn("h-4 w-4", active ? "text-sky-300" : "text-sidebar-muted")} />
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>
      <div className="border-t border-white/10 px-5 py-3 text-[11px] text-sidebar-muted">Historique immuable · CGNC</div>
    </div>
  );
}
