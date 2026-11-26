import { requirePageContext } from "@/lib/server/auth";
import { AppShell } from "@/components/layout/app-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, company, companies } = await requirePageContext();
  return (
    <AppShell
      user={{ name: user.name, email: user.email, role: user.role }}
      company={{ id: company.id, name: company.name }}
      companies={companies.map((c) => ({ id: c.id, name: c.name, code: c.code }))}
    >
      {children}
    </AppShell>
  );
}
