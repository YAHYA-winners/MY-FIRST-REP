/**
 * Demo data seed — fictional companies, people and suppliers.
 *
 *   npm run db:seed        (or: npx prisma db seed)
 *
 * Creates two entities, a full location tree, CGNC asset categories, ~200 assets
 * with realistic acquisition history, custodian assignments, a validated supplier
 * invoice, a pending invoice PDF ready for AI extraction, and an inventory
 * campaign in progress (snapshot, field scans, misplaced assets, surplus items).
 */
import { randomUUID, createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient, type Prisma, type AssetStatus, type DepreciationMethod, type LocationType, type TagStatus } from "@prisma/client";
import bcrypt from "bcryptjs";
import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import { assetDepreciation } from "../src/lib/depreciation";
import { formatAssetCode } from "../src/lib/codes";

const prisma = new PrismaClient();
const STORAGE_DIR = path.resolve(process.env.STORAGE_DIR || "./storage");
const DEMO_PASSWORD = "Demo@2026!";

// ---------------------------------------------------------------------------
// Deterministic PRNG
// ---------------------------------------------------------------------------
let seedState = 20261126;
function rand(): number {
  seedState |= 0;
  seedState = (seedState + 0x6d2b79f5) | 0;
  let t = Math.imul(seedState ^ (seedState >>> 15), 1 | seedState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = <T,>(list: readonly T[]): T => list[Math.floor(rand() * list.length)];
const between = (min: number, max: number) => min + rand() * (max - min);
const roundTo = (v: number, step: number) => Math.round(v / step) * step;
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const serial = (prefix: string) => `${prefix}${Math.floor(rand() * 36 ** 6).toString(36).toUpperCase().padStart(6, "0")}`;

function storeFile(companyId: string, folder: string, ext: string, data: Buffer) {
  const key = `${companyId}/${folder}/2026/11/${randomUUID()}.${ext}`;
  const full = path.join(STORAGE_DIR, key);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, data);
  return key;
}

// ---------------------------------------------------------------------------
// Sample supplier invoice PDF (realistic Moroccan layout)
// ---------------------------------------------------------------------------
interface InvoiceLineSpec {
  designation: string;
  detail?: string;
  qty: number;
  unit: number;
}

function invoicePdf(opts: {
  supplier: { name: string; address: string; ice: string; taxId: string; rc: string; phone: string; email: string };
  client: { name: string; address: string; ice: string };
  number: string;
  date: string;
  lines: InvoiceLineSpec[];
  vatRate: number;
  amountInWords: string;
}): Buffer {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(10, 60, 120);
  doc.text(opts.supplier.name, 15, 20);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(60);
  doc.text([opts.supplier.address, `Tél : ${opts.supplier.phone} — ${opts.supplier.email}`], 15, 26);
  doc.setFontSize(20);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(20);
  doc.text("FACTURE", 195, 22, { align: "right" });
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text([`N° : ${opts.number}`, `Date : ${opts.date}`, "Mode de règlement : Virement à 60 jours"], 195, 29, { align: "right" });

  doc.setDrawColor(180);
  doc.roundedRect(120, 42, 75, 24, 2, 2);
  doc.setFont("helvetica", "bold");
  doc.text("Client", 123, 48);
  doc.setFont("helvetica", "normal");
  doc.text([opts.client.name, opts.client.address, `ICE : ${opts.client.ice}`], 123, 53);

  const fmt = (n: number) =>
    n
      .toFixed(2)
      .replace(".", ",")
      .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const body = opts.lines.map((l, i) => [
    String(i + 1),
    l.detail ? `${l.designation}\n${l.detail}` : l.designation,
    String(l.qty),
    fmt(l.unit),
    `${opts.vatRate} %`,
    fmt(l.qty * l.unit),
  ]);
  autoTable(doc, {
    startY: 74,
    head: [["#", "Désignation", "Qté", "P.U. HT (DH)", "TVA", "Montant HT (DH)"]],
    body,
    theme: "grid",
    styles: { fontSize: 8, cellPadding: 2, valign: "middle" },
    headStyles: { fillColor: [10, 60, 120] },
    columnStyles: { 0: { cellWidth: 8 }, 2: { halign: "center", cellWidth: 12 }, 3: { halign: "right", cellWidth: 26 }, 4: { halign: "center", cellWidth: 14 }, 5: { halign: "right", cellWidth: 30 } },
    margin: { left: 15, right: 15 },
  });
  const ht = opts.lines.reduce((a, l) => a + l.qty * l.unit, 0);
  const vat = Math.round(ht * opts.vatRate) / 100;
  const y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
  autoTable(doc, {
    startY: y,
    body: [
      ["Total HT", `${fmt(ht)} DH`],
      [`TVA ${opts.vatRate} %`, `${fmt(vat)} DH`],
      ["Total TTC", `${fmt(ht + vat)} DH`],
    ],
    theme: "grid",
    styles: { fontSize: 9, cellPadding: 2 },
    columnStyles: { 0: { fontStyle: "bold", cellWidth: 32 }, 1: { halign: "right", cellWidth: 40 } },
    tableWidth: "wrap",
    margin: { left: 123, right: 15 },
  });
  const y2 = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  doc.setFontSize(8.5);
  doc.text(`Arrêtée la présente facture à la somme de : ${opts.amountInWords}.`, 15, y2, { maxWidth: 180 });
  doc.setFontSize(7.5);
  doc.setTextColor(90);
  doc.text(
    `${opts.supplier.name} — ICE : ${opts.supplier.ice} — IF : ${opts.supplier.taxId} — RC : ${opts.supplier.rc} — Patente : 34521876`,
    105,
    285,
    { align: "center" },
  );
  return Buffer.from(doc.output("arraybuffer"));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log("→ Reset des tables");
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
  }

  // -------------------------------------------------------------- companies
  const atlas = await prisma.company.create({
    data: {
      code: "NVI",
      name: "Novatlas Industries",
      legalName: "Novatlas Industries SA",
      legalForm: "SA",
      ice: "002345678000091",
      taxId: "15238746",
      tradeRegister: "412587 Casablanca",
      address: "120, boulevard d'Anfa, 20050",
      city: "Casablanca",
      currency: "MAD",
      capitalizationThreshold: 1500,
    },
  });
  const logistique = await prisma.company.create({
    data: {
      code: "NVL",
      name: "Novatlas Logistique",
      legalName: "Novatlas Logistique SARL",
      legalForm: "SARL",
      ice: "003456789000072",
      taxId: "40712563",
      tradeRegister: "98745 Tanger",
      address: "Zone Franche Ksar El Majaz, lot 12",
      city: "Tanger",
      currency: "MAD",
      capitalizationThreshold: 2000,
    },
  });

  // -------------------------------------------------------------- users
  console.log("→ Utilisateurs");
  const hash = await bcrypt.hash(DEMO_PASSWORD, 12);
  const mkUser = (email: string, name: string, role: "ADMIN" | "ACCOUNTANT" | "AUDITOR" | "VIEWER", companies: string[]) =>
    prisma.user.create({
      data: { email, name, role, passwordHash: hash, memberships: { create: companies.map((companyId) => ({ companyId })) } },
    });
  const admin = await mkUser("admin@novatlas.test", "Yasmine Alaoui", "ADMIN", [atlas.id, logistique.id]);
  const accountant = await mkUser("comptable@novatlas.test", "Karim Benjelloun", "ACCOUNTANT", [atlas.id, logistique.id]);
  const auditor = await mkUser("auditeur@novatlas.test", "Salma Idrissi", "AUDITOR", [atlas.id]);
  await mkUser("lecture@novatlas.test", "Omar Tazi", "VIEWER", [atlas.id]);

  // -------------------------------------------------------------- referentials
  console.log("→ Référentiels comptables");
  const categorySpecs: {
    code: string;
    name: string;
    assetAccount: string;
    depreciationAccount: string;
    method: DepreciationMethod;
    life: number;
    coef?: number;
    track?: boolean;
    description: string;
  }[] = [
    { code: "INFO", name: "Matériel informatique", assetAccount: "2355", depreciationAccount: "28355", method: "LINEAR", life: 5, description: "Ordinateurs, portables, écrans, serveurs, imprimantes, équipements réseau, tablettes" },
    { code: "MOB", name: "Mobilier de bureau", assetAccount: "2351", depreciationAccount: "28351", method: "LINEAR", life: 10, description: "Bureaux, fauteuils, chaises, armoires, tables de réunion, rayonnages" },
    { code: "MATBUR", name: "Matériel de bureau", assetAccount: "2352", depreciationAccount: "28352", method: "LINEAR", life: 5, description: "Photocopieurs, vidéoprojecteurs, destructeurs, téléphonie, coffres-forts" },
    { code: "TRANS", name: "Matériel de transport", assetAccount: "2340", depreciationAccount: "28340", method: "LINEAR", life: 5, description: "Véhicules utilitaires et de tourisme, camions, motos" },
    { code: "OUTIL", name: "Matériel et outillage industriel", assetAccount: "2332", depreciationAccount: "28332", method: "DECLINING", life: 10, coef: 3, description: "Machines-outils, compresseurs, chariots élévateurs, postes de soudure" },
    { code: "AGEN", name: "Agencements, installations et aménagements divers", assetAccount: "2356", depreciationAccount: "28356", method: "LINEAR", life: 10, description: "Climatisation, cloisons, câblage, groupes électrogènes, installations électriques" },
    { code: "LOGI", name: "Logiciels et licences", assetAccount: "2220", depreciationAccount: "2822", method: "LINEAR", life: 3, track: false, description: "Licences perpétuelles, progiciels (hors abonnements SaaS)" },
  ];
  const categories: Record<string, Awaited<ReturnType<typeof prisma.assetCategory.create>>> = {};
  for (const company of [atlas, logistique]) {
    for (const c of categorySpecs) {
      const created = await prisma.assetCategory.create({
        data: {
          companyId: company.id,
          code: c.code,
          name: c.name,
          description: c.description,
          assetAccount: c.assetAccount,
          depreciationAccount: c.depreciationAccount,
          defaultMethod: c.method,
          defaultUsefulLifeYears: c.life,
          decliningCoefficient: c.coef ?? null,
          trackPhysically: c.track ?? true,
        },
      });
      if (company.id === atlas.id) categories[c.code] = created;
    }
  }

  const ccSpecs = [
    ["CC100", "Direction Générale"],
    ["CC200", "Finance & Comptabilité"],
    ["CC300", "Ressources Humaines"],
    ["CC400", "Systèmes d'information"],
    ["CC500", "Production"],
    ["CC600", "Logistique"],
  ] as const;
  const costCenters: Record<string, string> = {};
  for (const [code, name] of ccSpecs) {
    const cc = await prisma.costCenter.create({ data: { companyId: atlas.id, code, name } });
    costCenters[code] = cc.id;
  }
  await prisma.costCenter.create({ data: { companyId: logistique.id, code: "CC600", name: "Exploitation logistique" } });

  const deptSpecs = [
    ["DG", "Direction Générale", "CC100", "Yasmine Alaoui"],
    ["DAF", "Direction Financière", "CC200", "Karim Benjelloun"],
    ["DRH", "Direction des Ressources Humaines", "CC300", "Nadia Berrada"],
    ["DSI", "Direction des Systèmes d'Information", "CC400", "Mehdi El Fassi"],
    ["PROD", "Direction de la Production", "CC500", "Rachid Ouazzani"],
    ["LOG", "Logistique & Achats", "CC600", "Ghita Sqalli"],
  ] as const;
  const departments: Record<string, string> = {};
  for (const [code, name, cc, manager] of deptSpecs) {
    const d = await prisma.department.create({ data: { companyId: atlas.id, code, name, costCenterId: costCenters[cc], managerName: manager } });
    departments[code] = d.id;
  }

  console.log("→ Collaborateurs");
  const people = [
    ["M1001", "Imane", "Chraibi", "Contrôleuse de gestion", "DAF"],
    ["M1002", "Youssef", "Amrani", "Chef comptable", "DAF"],
    ["M1003", "Leila", "Bennani", "Trésorière", "DAF"],
    ["M1004", "Hamza", "Kettani", "Responsable paie", "DRH"],
    ["M1005", "Sara", "Lahlou", "Chargée de recrutement", "DRH"],
    ["M1006", "Anas", "Naciri", "Administrateur systèmes", "DSI"],
    ["M1007", "Kenza", "Moussaoui", "Développeuse", "DSI"],
    ["M1008", "Adil", "Mansouri", "Chef de projet IT", "DSI"],
    ["M1009", "Nora", "El Ouardi", "Assistante de direction", "DG"],
    ["M1010", "Reda", "Bouzidi", "Chef d'atelier", "PROD"],
    ["M1011", "Hind", "Saidi", "Ingénieure méthodes", "PROD"],
    ["M1012", "Tarik", "Ziani", "Responsable achats", "LOG"],
    ["M1013", "Meryem", "Haddaoui", "Gestionnaire de stock", "LOG"],
    ["M1014", "Ilyas", "Raji", "Technicien support", "DSI"],
    ["M1015", "Zineb", "Alami", "Juriste", "DG"],
  ] as const;
  const employees: { id: string; dept: string; name: string }[] = [];
  for (const [matricule, firstName, lastName, jobTitle, dept] of people) {
    const e = await prisma.employee.create({
      data: {
        companyId: atlas.id,
        matricule,
        firstName,
        lastName,
        jobTitle,
        departmentId: departments[dept],
        email: `${firstName.toLowerCase()}.${lastName.toLowerCase().replace(/\s+/g, "")}@novatlas.test`,
      },
    });
    employees.push({ id: e.id, dept, name: `${firstName} ${lastName}` });
  }

  // -------------------------------------------------------------- locations
  console.log("→ Localisations");
  const locations: Record<string, { id: string; path: string; pathIds: string; depth: number }> = {};
  async function loc(companyId: string, code: string, name: string, type: LocationType, parentCode?: string, departmentCode?: string) {
    const parent = parentCode ? locations[parentCode] : undefined;
    const created = await prisma.location.create({
      data: {
        companyId,
        code,
        name,
        type,
        parentId: parent?.id ?? null,
        departmentId: departmentCode ? departments[departmentCode] : null,
        path: parent ? `${parent.path} > ${name}` : name,
        pathIds: "",
        depth: parent ? parent.depth + 1 : 0,
      },
    });
    const pathIds = `${parent?.pathIds ?? "/"}${created.id}/`;
    await prisma.location.update({ where: { id: created.id }, data: { pathIds } });
    locations[code] = { id: created.id, path: created.path, pathIds, depth: created.depth };
    return created.id;
  }
  await loc(atlas.id, "CAS", "Siège Casablanca", "SITE");
  await loc(atlas.id, "CAS-E1", "Étage 1", "FLOOR", "CAS");
  await loc(atlas.id, "CAS-E1-ACC", "Accueil & Services généraux", "DEPARTMENT", "CAS-E1");
  await loc(atlas.id, "CAS-E1-HALL", "Hall d'accueil", "ROOM", "CAS-E1-ACC");
  await loc(atlas.id, "CAS-E1-SR1", "Salle de réunion Atlas", "ROOM", "CAS-E1-ACC");
  await loc(atlas.id, "CAS-E1-DRH", "Direction des Ressources Humaines", "DEPARTMENT", "CAS-E1", "DRH");
  await loc(atlas.id, "CAS-E1-B110", "Bureau 110", "ROOM", "CAS-E1-DRH", "DRH");
  await loc(atlas.id, "CAS-E1-B112", "Bureau 112", "ROOM", "CAS-E1-DRH", "DRH");
  await loc(atlas.id, "CAS-E2", "Étage 2", "FLOOR", "CAS");
  await loc(atlas.id, "CAS-E2-DAF", "Direction Financière", "DEPARTMENT", "CAS-E2", "DAF");
  await loc(atlas.id, "CAS-E2-B201", "Bureau 201", "ROOM", "CAS-E2-DAF", "DAF");
  await loc(atlas.id, "CAS-E2-B202", "Bureau 202", "ROOM", "CAS-E2-DAF", "DAF");
  await loc(atlas.id, "CAS-E2-B204", "Bureau 204", "ROOM", "CAS-E2-DAF", "DAF");
  await loc(atlas.id, "CAS-E2-ARCH", "Salle des archives", "ROOM", "CAS-E2-DAF", "DAF");
  await loc(atlas.id, "CAS-E2-DG", "Direction Générale", "DEPARTMENT", "CAS-E2", "DG");
  await loc(atlas.id, "CAS-E2-B210", "Bureau du Directeur Général", "ROOM", "CAS-E2-DG", "DG");
  await loc(atlas.id, "CAS-E2-SC", "Salle du conseil", "ROOM", "CAS-E2-DG", "DG");
  await loc(atlas.id, "CAS-E3", "Étage 3", "FLOOR", "CAS");
  await loc(atlas.id, "CAS-E3-DSI", "Direction des Systèmes d'Information", "DEPARTMENT", "CAS-E3", "DSI");
  await loc(atlas.id, "CAS-E3-SRV", "Salle serveurs", "ROOM", "CAS-E3-DSI", "DSI");
  await loc(atlas.id, "CAS-E3-OPEN", "Open space IT", "ROOM", "CAS-E3-DSI", "DSI");
  await loc(atlas.id, "CAS-E3-STK", "Stock informatique", "ROOM", "CAS-E3-DSI", "DSI");
  await loc(atlas.id, "TNG", "Usine Tanger Automotive", "SITE");
  await loc(atlas.id, "TNG-BP", "Bâtiment Production", "BUILDING", "TNG");
  await loc(atlas.id, "TNG-BP-RDC", "Rez-de-chaussée", "FLOOR", "TNG-BP");
  await loc(atlas.id, "TNG-USI", "Atelier Usinage", "ROOM", "TNG-BP-RDC", "PROD");
  await loc(atlas.id, "TNG-MON", "Atelier Montage", "ROOM", "TNG-BP-RDC", "PROD");
  await loc(atlas.id, "TNG-MAG", "Magasin pièces", "ROOM", "TNG-BP-RDC", "LOG");
  await loc(atlas.id, "TNG-BA", "Bâtiment Administratif", "BUILDING", "TNG");
  await loc(atlas.id, "TNG-BA-B01", "Bureau chef de site", "ROOM", "TNG-BA", "PROD");
  await loc(atlas.id, "AIN", "Entrepôt Aïn Sebaâ", "SITE");
  await loc(atlas.id, "AIN-QA", "Zone A — Quai de chargement", "ZONE", "AIN", "LOG");
  await loc(atlas.id, "AIN-PARK", "Parc véhicules", "ZONE", "AIN", "LOG");
  // Second entity
  await loc(logistique.id, "TNG-PL", "Plateforme Ksar El Majaz", "SITE");
  await loc(logistique.id, "TNG-PL-QUAI", "Quai de chargement", "ZONE", "TNG-PL");
  await loc(logistique.id, "TNG-PL-BUR", "Bureaux exploitation", "ROOM", "TNG-PL");

  // -------------------------------------------------------------- suppliers
  console.log("→ Fournisseurs");
  const supplierSpecs = [
    { key: "info", name: "Maghreb Info Distribution SARL", ice: "001528374000062", taxId: "40218753", tradeRegister: "312457 Casablanca", city: "Casablanca" },
    { key: "bureau", name: "Bureau Plus Maroc SARL", ice: "001987654000033", taxId: "33874120", tradeRegister: "87452 Rabat", city: "Rabat" },
    { key: "auto", name: "Atlas Motors Distribution SA", ice: "000876543000045", taxId: "01452369", tradeRegister: "98123 Casablanca", city: "Casablanca" },
    { key: "indus", name: "Équipements Industriels du Nord SARL", ice: "002233445000067", taxId: "45879632", tradeRegister: "45123 Tanger", city: "Tanger" },
    { key: "clim", name: "Clim Confort Services SARL", ice: "002998877000011", taxId: "47852136", tradeRegister: "501236 Casablanca", city: "Casablanca" },
  ];
  const suppliers: Record<string, string> = {};
  for (const s of supplierSpecs) {
    const created = await prisma.supplier.create({ data: { companyId: atlas.id, name: s.name, ice: s.ice, taxId: s.taxId, tradeRegister: s.tradeRegister, city: s.city } });
    suppliers[s.key] = created.id;
  }

  // -------------------------------------------------------------- assets
  console.log("→ Immobilisations");
  type Template = { cat: string; designation: string; brand: string; models: string[]; min: number; max: number; supplier: string; serialPrefix?: string; rooms: string[]; custodian?: boolean };
  const templates: Template[] = [
    { cat: "INFO", designation: "Ordinateur portable", brand: "Dell", models: ["Latitude 5440", "Latitude 7440"], min: 9800, max: 15800, supplier: "info", serialPrefix: "DL", rooms: ["CAS-E2-B201", "CAS-E2-B202", "CAS-E2-B204", "CAS-E1-B110", "CAS-E1-B112", "CAS-E3-OPEN", "CAS-E2-B210"], custodian: true },
    { cat: "INFO", designation: "Ordinateur portable", brand: "Lenovo", models: ["ThinkPad T14 Gen 4", "ThinkPad X1 Carbon"], min: 11000, max: 19500, supplier: "info", serialPrefix: "PF", rooms: ["CAS-E3-OPEN", "CAS-E2-B204", "CAS-E1-B112"], custodian: true },
    { cat: "INFO", designation: "Unité centrale", brand: "HP", models: ["EliteDesk 800 G9", "ProDesk 400 G9"], min: 6800, max: 10500, supplier: "info", serialPrefix: "CZC", rooms: ["CAS-E1-HALL", "CAS-E2-ARCH", "TNG-BA-B01", "TNG-MAG"] },
    { cat: "INFO", designation: "Écran 27 pouces", brand: "Dell", models: ["P2723DE", "U2723QE"], min: 2300, max: 5200, supplier: "info", serialPrefix: "CN0", rooms: ["CAS-E2-B201", "CAS-E2-B202", "CAS-E2-B204", "CAS-E3-OPEN", "CAS-E1-B110"] },
    { cat: "INFO", designation: "Serveur rack", brand: "Dell", models: ["PowerEdge R760", "PowerEdge R660"], min: 68000, max: 145000, supplier: "info", serialPrefix: "SVC", rooms: ["CAS-E3-SRV"] },
    { cat: "INFO", designation: "Commutateur réseau 48 ports", brand: "Cisco", models: ["Catalyst 9200L", "Catalyst 9300"], min: 14000, max: 38000, supplier: "info", serialPrefix: "FOC", rooms: ["CAS-E3-SRV", "TNG-BA-B01"] },
    { cat: "INFO", designation: "Imprimante multifonction", brand: "HP", models: ["LaserJet Pro MFP 4102", "Color LaserJet MFP M480"], min: 4200, max: 12500, supplier: "info", serialPrefix: "VNB", rooms: ["CAS-E1-HALL", "CAS-E2-ARCH", "CAS-E3-OPEN", "TNG-BA-B01"] },
    { cat: "MOB", designation: "Bureau opérateur 160 cm", brand: "Bureau Plus", models: ["Ligne Nova", "Ligne Atlas"], min: 3200, max: 6800, supplier: "bureau", rooms: ["CAS-E2-B201", "CAS-E2-B202", "CAS-E2-B204", "CAS-E1-B110", "CAS-E1-B112", "CAS-E3-OPEN"] },
    { cat: "MOB", designation: "Fauteuil ergonomique", brand: "Bureau Plus", models: ["Ergo Pro", "Ergo Max"], min: 1900, max: 5400, supplier: "bureau", rooms: ["CAS-E2-B201", "CAS-E2-B202", "CAS-E2-B204", "CAS-E1-B110", "CAS-E3-OPEN", "CAS-E2-B210"] },
    { cat: "MOB", designation: "Armoire haute à rideaux", brand: "Bureau Plus", models: ["AR-198"], min: 2600, max: 4800, supplier: "bureau", rooms: ["CAS-E2-ARCH", "CAS-E1-B110", "CAS-E2-B204"] },
    { cat: "MOB", designation: "Table de réunion 12 places", brand: "Bureau Plus", models: ["Conseil 360"], min: 14000, max: 26000, supplier: "bureau", rooms: ["CAS-E2-SC", "CAS-E1-SR1"] },
    { cat: "MATBUR", designation: "Photocopieur multifonction A3", brand: "Canon", models: ["imageRUNNER ADVANCE DX C3826i"], min: 32000, max: 58000, supplier: "info", serialPrefix: "XQG", rooms: ["CAS-E1-HALL", "CAS-E2-ARCH"] },
    { cat: "MATBUR", designation: "Vidéoprojecteur", brand: "Epson", models: ["EB-L630U", "EB-FH52"], min: 6500, max: 18500, supplier: "info", serialPrefix: "X5K", rooms: ["CAS-E2-SC", "CAS-E1-SR1"] },
    { cat: "MATBUR", designation: "Coffre-fort ignifuge", brand: "Fichet", models: ["Primo 2"], min: 9500, max: 16000, supplier: "bureau", rooms: ["CAS-E2-B204"] },
    { cat: "TRANS", designation: "Véhicule utilitaire", brand: "Renault", models: ["Kangoo Van", "Master L2H2"], min: 185000, max: 320000, supplier: "auto", serialPrefix: "VF1", rooms: ["AIN-PARK"] },
    { cat: "TRANS", designation: "Véhicule de service", brand: "Dacia", models: ["Logan", "Duster"], min: 135000, max: 210000, supplier: "auto", serialPrefix: "UU1", rooms: ["AIN-PARK"] },
    { cat: "TRANS", designation: "Pick-up double cabine", brand: "Toyota", models: ["Hilux 2.8 D-4D"], min: 340000, max: 410000, supplier: "auto", serialPrefix: "AHT", rooms: ["AIN-PARK"] },
    { cat: "OUTIL", designation: "Centre d'usinage CNC", brand: "DMG Mori", models: ["CMX 600 V"], min: 620000, max: 980000, supplier: "indus", serialPrefix: "DMG", rooms: ["TNG-USI"] },
    { cat: "OUTIL", designation: "Tour à commande numérique", brand: "Haas", models: ["ST-20"], min: 420000, max: 610000, supplier: "indus", serialPrefix: "HS", rooms: ["TNG-USI"] },
    { cat: "OUTIL", designation: "Compresseur d'air à vis", brand: "Atlas Copco", models: ["GA 22", "GA 30"], min: 78000, max: 135000, supplier: "indus", serialPrefix: "API", rooms: ["TNG-MON", "TNG-USI"] },
    { cat: "OUTIL", designation: "Chariot élévateur électrique", brand: "Toyota", models: ["Traigo 48"], min: 210000, max: 285000, supplier: "indus", serialPrefix: "TFL", rooms: ["TNG-MAG", "AIN-QA"] },
    { cat: "OUTIL", designation: "Poste à souder MIG", brand: "Lincoln Electric", models: ["Speedtec 320C"], min: 14500, max: 26000, supplier: "indus", serialPrefix: "U1", rooms: ["TNG-MON"] },
    { cat: "AGEN", designation: "Climatiseur mural inverter", brand: "LG", models: ["Dualcool 18000 BTU", "Artcool 24000 BTU"], min: 8200, max: 16500, supplier: "clim", serialPrefix: "LGM", rooms: ["CAS-E2-B201", "CAS-E2-B202", "CAS-E2-B210", "CAS-E3-SRV", "CAS-E1-SR1"] },
    { cat: "AGEN", designation: "Groupe électrogène 100 kVA", brand: "SDMO", models: ["J110K"], min: 145000, max: 190000, supplier: "clim", serialPrefix: "SDM", rooms: ["TNG-BP-RDC"] },
  ];
  const counts: Record<string, number> = { INFO: 0, MOB: 0, MATBUR: 0, TRANS: 0, OUTIL: 0, AGEN: 0 };
  const plan: { t: Template; n: number }[] = templates.map((t) => ({
    t,
    n: t.cat === "INFO" ? (t.designation.includes("portable") ? 18 : t.designation.includes("Écran") ? 16 : t.designation.includes("Serveur") ? 4 : 6) : t.cat === "MOB" ? (t.designation.includes("Table") ? 2 : 14) : t.cat === "TRANS" ? 3 : t.cat === "OUTIL" ? 3 : t.cat === "AGEN" ? (t.designation.includes("Groupe") ? 1 : 8) : 3,
  }));

  const sequences = new Map<number, number>();
  const assetRows: (Prisma.AssetCreateManyInput & { id: string })[] = [];
  const empByDept = (dept: string) => employees.filter((e) => e.dept === dept);
  const roomDept: Record<string, string> = {
    "CAS-E2-B201": "DAF",
    "CAS-E2-B202": "DAF",
    "CAS-E2-B204": "DAF",
    "CAS-E2-ARCH": "DAF",
    "CAS-E1-B110": "DRH",
    "CAS-E1-B112": "DRH",
    "CAS-E3-OPEN": "DSI",
    "CAS-E3-SRV": "DSI",
    "CAS-E2-B210": "DG",
    "CAS-E2-SC": "DG",
  };
  const ccByDept: Record<string, string> = { DG: "CC100", DAF: "CC200", DRH: "CC300", DSI: "CC400", PROD: "CC500", LOG: "CC600" };
  const usedCustodians = new Set<string>();

  for (const { t, n } of plan) {
    for (let i = 0; i < n; i++) {
      const year = pick([2019, 2020, 2021, 2022, 2023, 2023, 2024, 2024, 2025, 2025, 2026]);
      const month = year === 2026 ? 1 + Math.floor(rand() * 10) : 1 + Math.floor(rand() * 12);
      const acquisitionDate = utc(year, month, 1 + Math.floor(rand() * 27));
      const commissioningDate = new Date(acquisitionDate.getTime() + Math.floor(rand() * 20) * 86400000);
      const seq = (sequences.get(year) ?? 0) + 1;
      sequences.set(year, seq);
      const room = pick(t.rooms);
      const dept = roomDept[room] ?? (room.startsWith("TNG") ? "PROD" : room.startsWith("AIN") ? "LOG" : "DG");
      const category = categories[t.cat];
      let custodianId: string | null = null;
      if (t.custodian) {
        const candidates = empByDept(dept).filter((e) => !usedCustodians.has(e.id));
        const chosen = candidates.length ? pick(candidates) : null;
        if (chosen && rand() < 0.85) {
          custodianId = chosen.id;
          usedCustodians.add(chosen.id);
        }
      }
      const status: AssetStatus = rand() < 0.06 ? "UNDER_MAINTENANCE" : custodianId || rand() < 0.85 ? "IN_SERVICE" : "IN_STOCK";
      counts[t.cat] = (counts[t.cat] ?? 0) + 1;
      assetRows.push({
        id: randomUUID().replace(/-/g, "").slice(0, 25),
        companyId: atlas.id,
        code: formatAssetCode(year, seq),
        designation: `${t.designation} ${t.brand} ${pick(t.models)}`,
        brand: t.brand,
        model: pick(t.models),
        serialNumber: t.serialPrefix ? serial(t.serialPrefix) : null,
        categoryId: category.id,
        supplierId: suppliers[t.supplier],
        acquisitionDate,
        commissioningDate,
        acquisitionValue: roundTo(between(t.min, t.max), 10),
        vatRate: 20,
        depreciationMethod: category.defaultMethod,
        usefulLifeYears: category.defaultUsefulLifeYears,
        decliningCoefficient: category.decliningCoefficient,
        status,
        condition: status === "UNDER_MAINTENANCE" ? "TO_REPAIR" : "GOOD",
        origin: year < 2026 ? "IMPORT" : "MANUAL",
        tagStatus: (year === 2026 && rand() < 0.45 ? "UNTAGGED" : rand() < 0.08 ? "PRINTED" : "AFFIXED") as TagStatus,
        locationId: locations[room].id,
        departmentId: departments[dept],
        costCenterId: costCenters[ccByDept[dept]],
        custodianId,
        createdById: accountant.id,
        createdAt: acquisitionDate,
      });
    }
  }
  // Software licence (not physically inventoried)
  sequences.set(2024, (sequences.get(2024) ?? 0) + 1);
  assetRows.push({
    id: randomUUID().replace(/-/g, "").slice(0, 25),
    companyId: atlas.id,
    code: formatAssetCode(2024, sequences.get(2024)!),
    designation: "Licence perpétuelle ERP — module Finance (50 utilisateurs)",
    categoryId: categories.LOGI.id,
    supplierId: suppliers.info,
    acquisitionDate: utc(2024, 1, 15),
    commissioningDate: utc(2024, 3, 1),
    acquisitionValue: 285000,
    depreciationMethod: "LINEAR",
    usefulLifeYears: 3,
    status: "IN_SERVICE",
    origin: "IMPORT",
    tagStatus: "UNTAGGED",
    costCenterId: costCenters.CC400,
    createdById: accountant.id,
    createdAt: utc(2024, 1, 15),
  });
  // Disposed and missing assets
  const disposed = assetRows.find((a) => a.code.startsWith("IMM-2019") && a.categoryId === categories.INFO.id)!;
  Object.assign(disposed, { status: "DISPOSED", disposalDate: utc(2025, 12, 15), disposalType: "DESTRUCTION", disposalReason: "Matériel obsolète — PV de destruction n° 2025-14", custodianId: null, tagStatus: "AFFIXED" });
  const missing = assetRows.find((a) => a.categoryId === categories.MATBUR.id && a.locationId === locations["CAS-E1-SR1"].id) ??
    assetRows.find((a) => a.categoryId === categories.MATBUR.id)!;
  Object.assign(missing, { status: "MISSING", notes: "Non retrouvé lors de l'inventaire 2025" });

  await prisma.asset.createMany({ data: assetRows });
  for (const [year, value] of sequences) {
    await prisma.sequence.create({ data: { companyId: atlas.id, key: `ASSET-${year}`, value } });
  }

  // Audit trail: creation + assignments
  const events: Prisma.AssetEventCreateManyInput[] = [];
  const assignments: Prisma.CustodianAssignmentCreateManyInput[] = [];
  for (const a of assetRows) {
    events.push({
      companyId: atlas.id,
      assetId: a.id,
      type: "CREATED",
      summary: a.origin === "IMPORT" ? `Reprise du fichier des immobilisations (${a.code})` : `Création manuelle de la fiche ${a.code}`,
      toLocationId: a.locationId ?? null,
      toStatus: a.status ?? "IN_STOCK",
      userId: accountant.id,
      createdAt: a.acquisitionDate as Date,
    });
    if (a.custodianId) {
      const at = new Date((a.commissioningDate as Date).getTime() + 86400000);
      assignments.push({ companyId: atlas.id, assetId: a.id, employeeId: a.custodianId, assignedAt: at, notes: "Reprise de l'existant", assignedById: accountant.id });
      events.push({ companyId: atlas.id, assetId: a.id, type: "CUSTODIAN_ASSIGNED", summary: `Affecté à ${employees.find((e) => e.id === a.custodianId)?.name}`, toCustodianId: a.custodianId, userId: accountant.id, createdAt: at });
    }
    if (a.status === "DISPOSED") {
      events.push({ companyId: atlas.id, assetId: a.id, type: "DISPOSED", summary: "Destruction / Mise au rebut — matériel obsolète", fromStatus: "IN_SERVICE", toStatus: "DISPOSED", userId: accountant.id, createdAt: utc(2025, 12, 15) });
    }
    if (a.status === "MISSING") {
      events.push({ companyId: atlas.id, assetId: a.id, type: "STATUS_CHANGE", summary: "Inventaire 2025 : bien non retrouvé, déclaré disparu", fromStatus: "IN_SERVICE", toStatus: "MISSING", userId: accountant.id, createdAt: utc(2025, 12, 20) });
    }
  }
  await prisma.custodianAssignment.createMany({ data: assignments });

  // -------------------------------------------------------------- invoices
  console.log("→ Factures (PDF de démonstration)");
  const furnitureLines: InvoiceLineSpec[] = [
    { designation: "Fauteuil de direction cuir Ergo Max", detail: "Dossier haut, accoudoirs réglables", qty: 4, unit: 4850 },
    { designation: "Bureau direction 180 cm Ligne Atlas", detail: "Plateau chêne, caisson 3 tiroirs", qty: 2, unit: 7200 },
  ];
  const furniturePdf = invoicePdf({
    supplier: { name: "BUREAU PLUS MAROC SARL", address: "18, avenue Mohammed V, Rabat", ice: "001987654000033", taxId: "33874120", rc: "87452 Rabat", phone: "05 37 70 12 34", email: "facturation@bureauplus.test" },
    client: { name: "NOVATLAS INDUSTRIES SA", address: "120, bd d'Anfa, Casablanca", ice: "002345678000091" },
    number: "BPM-F-2026-1187",
    date: "02/10/2026",
    lines: furnitureLines,
    vatRate: 20,
    amountInWords: "quarante mille cinq cent soixante dirhams toutes taxes comprises",
  });
  const furnitureKey = storeFile(atlas.id, "invoices", "pdf", furniturePdf);
  const furnitureInvoice = await prisma.invoice.create({
    data: {
      companyId: atlas.id,
      supplierId: suppliers.bureau,
      number: "BPM-F-2026-1187",
      invoiceDate: utc(2026, 10, 2),
      currency: "MAD",
      totalHT: 33800,
      totalVAT: 6760,
      totalTTC: 40560,
      documentType: "INVOICE",
      status: "VALIDATED",
      fileKey: furnitureKey,
      fileName: "Facture_BPM-F-2026-1187.pdf",
      mimeType: "application/pdf",
      fileSize: furniturePdf.length,
      fileSha256: createHash("sha256").update(furniturePdf).digest("hex"),
      uploadedById: accountant.id,
      validatedById: accountant.id,
      validatedAt: utc(2026, 10, 6),
      extractionModel: "gemini-2.5-flash",
      confidence: 0.96,
      lines: {
        create: furnitureLines.map((l, i) => ({
          lineNo: i + 1,
          designation: l.designation,
          specifications: l.detail,
          brand: "Bureau Plus",
          quantity: l.qty,
          unitPriceHT: l.unit,
          vatRate: 20,
          totalHT: l.qty * l.unit,
          isFixedAsset: true,
          splitIntoUnits: true,
          categoryId: categories.MOB.id,
          aiCategoryCode: "MOB",
          aiConfidence: 0.95,
        })),
      },
    },
    include: { lines: true },
  });
  const furnitureAssets: Prisma.AssetCreateManyInput[] = [];
  let seq2026 = sequences.get(2026) ?? 0;
  furnitureInvoice.lines.forEach((line) => {
    for (let u = 0; u < Number(line.quantity); u++) {
      seq2026 += 1;
      furnitureAssets.push({
        companyId: atlas.id,
        code: formatAssetCode(2026, seq2026),
        designation: line.designation,
        description: line.specifications,
        brand: "Bureau Plus",
        categoryId: categories.MOB.id,
        supplierId: suppliers.bureau,
        invoiceId: furnitureInvoice.id,
        invoiceLineId: line.id,
        acquisitionDate: utc(2026, 10, 2),
        acquisitionValue: line.unitPriceHT,
        vatRate: 20,
        depreciationMethod: "LINEAR",
        usefulLifeYears: 10,
        status: "IN_STOCK",
        origin: "INVOICE",
        tagStatus: "UNTAGGED",
        locationId: locations["CAS-E3-STK"].id,
        createdById: accountant.id,
        createdAt: utc(2026, 10, 6),
      });
    }
  });
  const createdFurniture = await prisma.asset.createManyAndReturn({ data: furnitureAssets, select: { id: true, locationId: true } });
  for (const a of createdFurniture) {
    events.push({ companyId: atlas.id, assetId: a.id, type: "CREATED", summary: "Création depuis la facture BPM-F-2026-1187 (Bureau Plus Maroc SARL)", toLocationId: a.locationId, toStatus: "IN_STOCK", userId: accountant.id, createdAt: utc(2026, 10, 6) });
  }
  await prisma.sequence.update({ where: { companyId_key: { companyId: atlas.id, key: "ASSET-2026" } }, data: { value: seq2026 } });

  // Pending invoice ready for AI extraction
  const itLines: InvoiceLineSpec[] = [
    { designation: "Ordinateur portable Dell Latitude 5450", detail: "Intel Core Ultra 5 135U, 16 Go RAM, SSD 512 Go, 14\" FHD\nS/N : 7HXK2W3, 9JQL4B1, 3MZT8C5, 5PRV1D9, 2KWN6F4", qty: 5, unit: 12900 },
    { designation: "Écran Dell P2725H 27\" IPS Full HD", detail: "S/N : CN-0P27-58A01, CN-0P27-58A02", qty: 2, unit: 2450 },
    { designation: "Imprimante multifonction HP LaserJet Pro MFP 4102fdw", detail: "S/N : VNB3K12345", qty: 1, unit: 6800 },
    { designation: "Ramettes papier A4 80 g (carton de 5)", qty: 10, unit: 240 },
    { designation: "Toner HP 151A noir", qty: 4, unit: 890 },
    { designation: "Frais de livraison et installation", qty: 1, unit: 750 },
  ];
  const itPdf = invoicePdf({
    supplier: { name: "MAGHREB INFO DISTRIBUTION SARL", address: "45, boulevard Zerktouni, 20250 Casablanca", ice: "001528374000062", taxId: "40218753", rc: "312457 Casablanca", phone: "05 22 47 88 10", email: "factures@maghrebinfo.test" },
    client: { name: "NOVATLAS INDUSTRIES SA", address: "120, bd d'Anfa, Casablanca", ice: "002345678000091" },
    number: "FA-2026-0412",
    date: "10/11/2026",
    lines: itLines,
    vatRate: 20,
    amountInWords: "quatre-vingt-dix-neuf mille quatre cent quatre-vingt-douze dirhams toutes taxes comprises",
  });
  const itKey = storeFile(atlas.id, "invoices", "pdf", itPdf);
  await prisma.invoice.create({
    data: {
      companyId: atlas.id,
      status: "UPLOADED",
      fileKey: itKey,
      fileName: "Facture_MaghrebInfo_FA-2026-0412.pdf",
      mimeType: "application/pdf",
      fileSize: itPdf.length,
      fileSha256: createHash("sha256").update(itPdf).digest("hex"),
      currency: "MAD",
      uploadedById: accountant.id,
    },
  });
  // Also export the sample PDF at the repository root for manual upload tests.
  mkdirSync(path.resolve("samples"), { recursive: true });
  writeFileSync(path.resolve("samples/Facture_MaghrebInfo_FA-2026-0412.pdf"), itPdf);

  // -------------------------------------------------------------- campaign in progress
  console.log("→ Campagne d'inventaire en cours");
  const allAssets = await prisma.asset.findMany({
    where: { companyId: atlas.id },
    include: { category: true, location: true, custodian: true },
  });
  const casPathIds = locations.CAS.pathIds;
  const launchedAt = new Date("2026-11-17T08:30:00Z");
  const campaign = await prisma.inventoryCampaign.create({
    data: {
      companyId: atlas.id,
      code: "INV-2026-001",
      name: "Inventaire annuel 2026 — Siège Casablanca",
      description: "Comptage exhaustif des 3 étages du siège. Scanner chaque bien, photographier tout bien endommagé, saisir les biens sans étiquette comme excédents.",
      status: "IN_PROGRESS",
      plannedStartDate: utc(2026, 11, 17),
      plannedEndDate: utc(2026, 11, 28),
      launchedAt,
      createdById: accountant.id,
      scopeLocations: { create: [{ locationId: locations.CAS.id }] },
      members: { create: [{ userId: accountant.id, role: "LEAD" }, { userId: auditor.id, role: "COUNTER" }] },
    },
  });
  await prisma.inventoryCampaign.create({
    data: {
      companyId: atlas.id,
      code: "INV-2026-002",
      name: "Inventaire Usine Tanger — outillage industriel",
      status: "DRAFT",
      plannedStartDate: utc(2026, 12, 8),
      plannedEndDate: utc(2026, 12, 12),
      createdById: accountant.id,
      scopeLocations: { create: [{ locationId: locations.TNG.id }] },
      scopeCategories: { create: [{ categoryId: categories.OUTIL.id }, { categoryId: categories.INFO.id }] },
      members: { create: [{ userId: auditor.id, role: "LEAD" }] },
    },
  });
  await prisma.sequence.create({ data: { companyId: atlas.id, key: "CAMPAIGN-2026", value: 2 } });

  const inScope = allAssets.filter((a) => a.status !== "DISPOSED" && a.category.trackPhysically && a.location?.pathIds.startsWith(casPathIds));
  const snapshot = await prisma.campaignSnapshotItem.createManyAndReturn({
    data: inScope.map((a) => {
      const dep = assetDepreciation(a, launchedAt, atlas.fiscalYearStartMonth);
      return {
        campaignId: campaign.id,
        assetId: a.id,
        assetCode: a.code,
        designation: a.designation,
        serialNumber: a.serialNumber,
        categoryId: a.categoryId,
        categoryName: a.category.name,
        expectedLocationId: a.locationId,
        expectedLocationPath: a.location?.path ?? null,
        expectedCustodianName: a.custodian ? `${a.custodian.firstName} ${a.custodian.lastName}` : null,
        expectedStatus: a.status,
        acquisitionDate: a.acquisitionDate,
        grossValue: a.acquisitionValue,
        accumulatedDepreciation: dep.accumulated,
        netBookValue: dep.netBookValue,
      };
    }),
  });

  const rooms = ["CAS-E2-B201", "CAS-E2-B202", "CAS-E2-B204", "CAS-E1-B110", "CAS-E3-OPEN", "CAS-E1-SR1"];
  const scans: Prisma.CampaignScanCreateManyInput[] = [];
  const scanEvents: Prisma.AssetEventCreateManyInput[] = [];
  let minute = 0;
  for (const item of snapshot) {
    if (item.expectedStatus === "MISSING") continue; // stays missing
    if (rand() > 0.74) continue; // not yet counted
    const asset = inScope.find((a) => a.id === item.assetId)!;
    const misplaced = rand() < 0.08;
    const locationId = misplaced ? locations[pick(rooms.filter((r) => locations[r].id !== item.expectedLocationId))].id : item.expectedLocationId!;
    const condition = rand() < 0.05 ? "DAMAGED" : rand() < 0.04 ? "TO_REPAIR" : "GOOD";
    minute += 2 + Math.floor(rand() * 5);
    const scannedAt = new Date(launchedAt.getTime() + minute * 60000 + Math.floor(minute / 240) * 16 * 3600000);
    const clientId = randomUUID();
    const scanId = randomUUID().replace(/-/g, "").slice(0, 25);
    const lat = 33.5899 + (rand() - 0.5) * 0.0004;
    const lng = -7.6039 + (rand() - 0.5) * 0.0004;
    scans.push({
      id: scanId,
      campaignId: campaign.id,
      clientId,
      assetId: item.assetId,
      snapshotItemId: item.id,
      scannedCode: `http://localhost:3000/a/${item.assetCode}`,
      locationId,
      condition,
      isLocationMismatch: misplaced,
      transferProposed: misplaced,
      latitude: lat,
      longitude: lng,
      gpsAccuracy: 8,
      scannedById: auditor.id,
      scannedAt,
      deviceInfo: "Seed — Android Chrome",
    });
    scanEvents.push({
      companyId: atlas.id,
      assetId: item.assetId,
      type: "SCANNED",
      summary: `Scan INV-2026-001 à ${Object.values(locations).find((l) => l.id === locationId)?.path}${misplaced ? " — écart de localisation" : ""}`,
      campaignId: campaign.id,
      userId: auditor.id,
      latitude: lat,
      longitude: lng,
      gpsAccuracy: 8,
      data: { scanId, locationId, condition, outcome: misplaced ? "MISPLACED" : "MATCH" },
      createdAt: scannedAt,
    });
    if (condition !== "GOOD") {
      await prisma.asset.update({ where: { id: asset.id }, data: { condition } });
    }
    await prisma.asset.update({ where: { id: asset.id }, data: { lastSeenAt: scannedAt, tagStatus: "AFFIXED" } });
  }
  await prisma.campaignScan.createMany({ data: scans });

  await prisma.campaignSurplus.createMany({
    data: [
      {
        campaignId: campaign.id,
        clientId: randomUUID(),
        tempTag: "TMP-2026-00001",
        designation: "Fauteuil visiteur tissu bleu",
        brand: "Inconnue",
        estimatedValue: 950,
        condition: "GOOD",
        locationId: locations["CAS-E2-B202"].id,
        notes: "Aucune étiquette — probablement acquis hors circuit achats",
        foundById: auditor.id,
        foundAt: new Date("2026-11-18T10:12:00Z"),
      },
      {
        campaignId: campaign.id,
        clientId: randomUUID(),
        tempTag: "TMP-2026-00002",
        scannedCode: "OLD-INV-2017-0442",
        designation: "Ordinateur portable HP ProBook 450",
        brand: "HP",
        model: "ProBook 450 G5",
        serialNumber: "5CD8123XYZ",
        estimatedValue: 2500,
        condition: "TO_REPAIR",
        locationId: locations["CAS-E3-OPEN"].id,
        notes: "Ancienne étiquette (système précédent) — clavier défectueux",
        foundById: auditor.id,
        foundAt: new Date("2026-11-19T14:40:00Z"),
      },
    ],
  });
  await prisma.sequence.create({ data: { companyId: atlas.id, key: "TMP-2026", value: 2 } });

  // -------------------------------------------------------------- second entity
  const nvlCats = await prisma.assetCategory.findMany({ where: { companyId: logistique.id } });
  const nvlCat = (code: string) => nvlCats.find((c) => c.code === code)!;
  const nvlLoc = locations["TNG-PL-QUAI"].id;
  const nvlAssets: Prisma.AssetCreateManyInput[] = Array.from({ length: 12 }, (_, i) => {
    const isTruck = i < 4;
    const year = 2021 + (i % 5);
    const cat = isTruck ? nvlCat("TRANS") : nvlCat(i < 8 ? "OUTIL" : "INFO");
    return {
      companyId: logistique.id,
      code: formatAssetCode(year, 100 + i),
      designation: isTruck ? "Tracteur routier Volvo FH 460" : i < 8 ? "Transpalette électrique Jungheinrich" : "Terminal mobile Zebra TC52",
      brand: isTruck ? "Volvo" : i < 8 ? "Jungheinrich" : "Zebra",
      serialNumber: serial(isTruck ? "YV2" : i < 8 ? "JH" : "ZB"),
      categoryId: cat.id,
      acquisitionDate: utc(year, 3 + (i % 8), 10),
      commissioningDate: utc(year, 3 + (i % 8), 15),
      acquisitionValue: isTruck ? 1150000 : i < 8 ? 62000 : 9800,
      depreciationMethod: cat.defaultMethod,
      usefulLifeYears: cat.defaultUsefulLifeYears,
      decliningCoefficient: cat.decliningCoefficient,
      status: "IN_SERVICE",
      origin: "IMPORT",
      tagStatus: "AFFIXED",
      locationId: i < 8 ? nvlLoc : locations["TNG-PL-BUR"].id,
      createdById: accountant.id,
    };
  });
  const nvlCreated = await prisma.asset.createManyAndReturn({ data: nvlAssets, select: { id: true, code: true, locationId: true } });
  for (const a of nvlCreated) {
    events.push({ companyId: logistique.id, assetId: a.id, type: "CREATED", summary: `Reprise du fichier des immobilisations (${a.code})`, toLocationId: a.locationId, toStatus: "IN_SERVICE", userId: accountant.id });
  }

  await prisma.assetEvent.createMany({ data: [...events, ...scanEvents] });

  const total = await prisma.asset.count();
  console.log(`✔ Seed terminé : ${total} immobilisations, ${snapshot.length} biens au fichier théorique, ${scans.length} scans.`);
  console.log(`  Comptes de démonstration (mot de passe « ${DEMO_PASSWORD} ») :`);
  console.log(`  - ${admin.email} (administrateur)`);
  console.log(`  - ${accountant.email} (comptable)`);
  console.log(`  - ${auditor.email} (inventoriste)`);
  console.log("  - lecture@novatlas.test (lecture seule)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
