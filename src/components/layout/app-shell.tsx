"use client";

import { useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import { Building, Check, ChevronsUpDown, LogOut, Menu, UserRound } from "lucide-react";
import { toast } from "sonner";
import { logout, switchCompany } from "@/actions/auth";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ROLE_LABELS } from "@/lib/constants";
import type { UserRoleValue } from "@/lib/domain";
import { initials } from "@/lib/utils";

interface ShellProps {
  user: { name: string; email: string; role: UserRoleValue };
  company: { id: string; name: string };
  companies: { id: string; name: string; code: string }[];
  children: React.ReactNode;
}

export function AppShell({ user, company, companies, children }: ShellProps) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const pathname = usePathname();

  const onSwitch = (id: string) => {
    if (id === company.id) return;
    startTransition(async () => {
      const res = await switchCompany(id);
      if (!res.ok) toast.error(res.error);
      else toast.success("Société active modifiée.");
    });
  };

  // Field inventory mode is rendered full-screen (no sidebar / header) for one-handed mobile use.
  if (/^\/campaigns\/[^/]+\/scan\/?$/.test(pathname)) {
    return <div className="min-h-dvh bg-slate-950">{children}</div>;
  }

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[256px_1fr]">
      <aside className="sticky top-0 hidden h-dvh lg:block">
        <SidebarNav role={user.role} companyName={company.name} />
      </aside>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-72 border-none p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarNav role={user.role} companyName={company.name} onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-card/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-card/80 lg:px-6">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(true)} aria-label="Ouvrir le menu">
            <Menu className="h-5 w-5" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="max-w-[60vw] justify-between gap-2 sm:max-w-xs" disabled={pending}>
                <Building className="text-muted-foreground" />
                <span className="truncate">{company.name}</span>
                <ChevronsUpDown className="text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72">
              <DropdownMenuLabel>Société / entité active</DropdownMenuLabel>
              {companies.map((c) => (
                <DropdownMenuItem key={c.id} onSelect={() => onSwitch(c.id)}>
                  <span className="flex-1 truncate">{c.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">{c.code}</span>
                  {c.id === company.id && <Check className="text-primary" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <div className="ml-auto">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 rounded-full p-0.5 pr-2 hover:bg-muted" aria-label="Menu utilisateur">
                  <span className="grid h-8 w-8 place-content-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                    {initials(user.name)}
                  </span>
                  <span className="hidden text-left text-sm leading-tight md:block">
                    <span className="block font-medium">{user.name}</span>
                    <span className="block text-xs text-muted-foreground">{ROLE_LABELS[user.role]}</span>
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuLabel className="font-normal">
                  <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <UserRound className="h-4 w-4" /> {user.name}
                  </span>
                  <span className="mt-0.5 block truncate text-xs">{user.email}</span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => startTransition(() => logout())} className="text-destructive focus:text-destructive">
                  <LogOut /> Se déconnecter
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main className="min-w-0 flex-1 px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
