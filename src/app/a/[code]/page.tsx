import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requirePageContext } from "@/lib/server/auth";

/** Deep link encoded in the QR labels: any phone camera opens the asset card. */
export default async function QrLandingPage({ params }: { params: Promise<{ code: string }> }) {
  const { companies } = await requirePageContext("asset:read");
  const { code } = await params;
  const asset = await prisma.asset.findFirst({
    where: { code: decodeURIComponent(code).toUpperCase(), companyId: { in: companies.map((c) => c.id) } },
    select: { id: true },
  });
  if (!asset) notFound();
  redirect(`/assets/${asset.id}`);
}
