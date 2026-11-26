import {
  Building2,
  ClipboardCheck,
  FileSpreadsheet,
  FileText,
  History,
  LayoutDashboard,
  Package,
  QrCode,
  Settings,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import type { Permission } from "@/lib/permissions";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  permission: Permission;
  exact?: boolean;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    title: "Pilotage",
    items: [{ href: "/dashboard", label: "Tableau de bord", icon: LayoutDashboard, permission: "asset:read" }],
  },
  {
    title: "Registre",
    items: [
      { href: "/assets", label: "Immobilisations", icon: Package, permission: "asset:read", exact: true },
      { href: "/assets/labels", label: "Étiquetage QR", icon: QrCode, permission: "label:print" },
      { href: "/assets/import", label: "Import du registre", icon: FileSpreadsheet, permission: "asset:import" },
    ],
  },
  {
    title: "Achats",
    items: [
      { href: "/invoices/import", label: "Import IA factures", icon: Sparkles, permission: "invoice:import" },
      { href: "/invoices", label: "Factures", icon: FileText, permission: "invoice:read", exact: true },
    ],
  },
  {
    title: "Inventaire",
    items: [{ href: "/campaigns", label: "Campagnes", icon: ClipboardCheck, permission: "campaign:read" }],
  },
  {
    title: "Référentiel",
    items: [
      { href: "/locations", label: "Localisations", icon: Building2, permission: "asset:read" },
      { href: "/settings", label: "Paramètres", icon: Settings, permission: "asset:read" },
    ],
  },
  {
    title: "Contrôle",
    items: [{ href: "/audit", label: "Journal d'audit", icon: History, permission: "audit:read" }],
  },
];
