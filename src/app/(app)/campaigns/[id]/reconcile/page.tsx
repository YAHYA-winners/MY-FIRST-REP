import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requirePageContext } from "@/lib/server/auth";
import { can } from "@/lib/permissions";
import { buildReconciliationReport } from "@/lib/server/queries/reconciliation";
import { PageHeader } from "@/components/page-header";
import { ReconcileWorkspace } from "@/components/campaigns/reconcile-workspace";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CAMPAIGN_STATUS_LABELS, CAMPAIGN_STATUS_TONES } from "@/lib/constants";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Rapprochement physico-comptable" };

export default async function ReconcilePage({ params }: { params: Promise<{ id: string }> }) {
  const { user, company } = await requirePageContext("campaign:read");
  const { id } = await params;
  const report = await buildReconciliationReport(company, id);
  if (!report) notFound();
  const categories = await prisma.assetCategory.findMany({
    where: { companyId: company.id, active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  const { campaign } = report;
  return (
    <div>
      <Button variant="ghost" size="sm" asChild className="mb-2 -ml-2">
        <Link href={`/campaigns/${campaign.id}`}>
          <ArrowLeft /> {campaign.code}
        </Link>
      </Button>
      <PageHeader
        eyebrow="Rapprochement physico-comptable"
        title={campaign.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant={CAMPAIGN_STATUS_TONES[campaign.status]}>{CAMPAIGN_STATUS_LABELS[campaign.status]}</Badge>
            <span>{campaign.reconciledAt ? `Calculé le ${formatDateTime(campaign.reconciledAt)}` : "Rapprochement non encore calculé"}</span>
          </span>
        }
      />
      {campaign.status === "DRAFT" ? (
        <p className="text-sm text-muted-foreground">La campagne doit être lancée avant tout rapprochement.</p>
      ) : (
        <ReconcileWorkspace
          report={report}
          categories={categories}
          canResolve={can(user.role, "reconcile:resolve")}
          canManage={can(user.role, "campaign:manage")}
        />
      )}
    </div>
  );
}
