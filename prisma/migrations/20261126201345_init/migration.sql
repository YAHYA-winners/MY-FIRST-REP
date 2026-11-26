-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'ACCOUNTANT', 'AUDITOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "LocationType" AS ENUM ('SITE', 'BUILDING', 'FLOOR', 'DEPARTMENT', 'ZONE', 'ROOM');

-- CreateEnum
CREATE TYPE "DepreciationMethod" AS ENUM ('LINEAR', 'DECLINING', 'NONE');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('IN_SERVICE', 'IN_STOCK', 'UNDER_MAINTENANCE', 'DISPOSED', 'MISSING');

-- CreateEnum
CREATE TYPE "AssetCondition" AS ENUM ('GOOD', 'DAMAGED', 'TO_REPAIR');

-- CreateEnum
CREATE TYPE "TagStatus" AS ENUM ('UNTAGGED', 'PRINTED', 'AFFIXED');

-- CreateEnum
CREATE TYPE "AssetOrigin" AS ENUM ('INVOICE', 'MANUAL', 'IMPORT', 'SURPLUS');

-- CreateEnum
CREATE TYPE "DisposalType" AS ENUM ('SALE', 'DESTRUCTION', 'DONATION', 'THEFT_LOSS');

-- CreateEnum
CREATE TYPE "AssetEventType" AS ENUM ('CREATED', 'UPDATED', 'INVOICE_LINKED', 'LOCATION_TRANSFER', 'CUSTODIAN_ASSIGNED', 'CUSTODIAN_RETURNED', 'STATUS_CHANGE', 'CONDITION_CHANGE', 'TAG_PRINTED', 'TAG_AFFIXED', 'SCANNED', 'DISPOSED', 'RECONCILIATION_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('UPLOADED', 'EXTRACTING', 'EXTRACTED', 'FAILED', 'VALIDATED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'COUNT_CLOSED', 'VALIDATED');

-- CreateEnum
CREATE TYPE "ReconciliationCategory" AS ENUM ('MATCH', 'MISPLACED', 'MISSING', 'SURPLUS');

-- CreateEnum
CREATE TYPE "ResolutionStatus" AS ENUM ('OPEN', 'RESOLVED', 'IGNORED');

-- CreateEnum
CREATE TYPE "SurplusStatus" AS ENUM ('PENDING', 'INTEGRATED', 'REJECTED');

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "legalForm" TEXT,
    "ice" TEXT,
    "taxId" TEXT,
    "tradeRegister" TEXT,
    "address" TEXT,
    "city" TEXT,
    "country" TEXT NOT NULL DEFAULT 'MA',
    "currency" TEXT NOT NULL DEFAULT 'MAD',
    "capitalizationThreshold" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "fiscalYearStartMonth" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'VIEWER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserCompany" (
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserCompany_pkey" PRIMARY KEY ("userId","companyId")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "parentId" TEXT,
    "type" "LocationType" NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "pathIds" TEXT NOT NULL,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "departmentId" TEXT,
    "address" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostCenter" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CostCenter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "costCenterId" TEXT,
    "managerName" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "matricule" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "jobTitle" TEXT,
    "departmentId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetCategory" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "assetAccount" TEXT NOT NULL,
    "depreciationAccount" TEXT,
    "defaultMethod" "DepreciationMethod" NOT NULL DEFAULT 'LINEAR',
    "defaultUsefulLifeYears" INTEGER NOT NULL DEFAULT 5,
    "decliningCoefficient" DECIMAL(4,2),
    "trackPhysically" BOOLEAN NOT NULL DEFAULT true,
    "color" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssetCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ice" TEXT,
    "taxId" TEXT,
    "tradeRegister" TEXT,
    "address" TEXT,
    "city" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "supplierId" TEXT,
    "number" TEXT,
    "invoiceDate" DATE,
    "dueDate" DATE,
    "currency" TEXT NOT NULL DEFAULT 'MAD',
    "totalHT" DECIMAL(18,2),
    "totalVAT" DECIMAL(18,2),
    "totalTTC" DECIMAL(18,2),
    "documentType" TEXT,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'UPLOADED',
    "fileKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "fileSha256" TEXT NOT NULL,
    "extractedData" JSONB,
    "extractionModel" TEXT,
    "extractionStartedAt" TIMESTAMP(3),
    "extractionCompletedAt" TIMESTAMP(3),
    "extractionDurationMs" INTEGER,
    "extractionError" TEXT,
    "extractionWarnings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "confidence" DOUBLE PRECISION,
    "uploadedById" TEXT NOT NULL,
    "validatedById" TEXT,
    "validatedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "designation" TEXT NOT NULL,
    "specifications" TEXT,
    "brand" TEXT,
    "model" TEXT,
    "serialNumbers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "quantity" DECIMAL(12,3) NOT NULL,
    "unitPriceHT" DECIMAL(18,2) NOT NULL,
    "vatRate" DECIMAL(5,2) NOT NULL,
    "totalHT" DECIMAL(18,2) NOT NULL,
    "isFixedAsset" BOOLEAN NOT NULL DEFAULT true,
    "splitIntoUnits" BOOLEAN NOT NULL DEFAULT true,
    "categoryId" TEXT,
    "aiCategoryCode" TEXT,
    "aiConfidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "designation" TEXT NOT NULL,
    "description" TEXT,
    "brand" TEXT,
    "model" TEXT,
    "serialNumber" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "categoryId" TEXT NOT NULL,
    "supplierId" TEXT,
    "invoiceId" TEXT,
    "invoiceLineId" TEXT,
    "acquisitionDate" DATE NOT NULL,
    "commissioningDate" DATE,
    "acquisitionValue" DECIMAL(18,2) NOT NULL,
    "vatRate" DECIMAL(5,2),
    "currency" TEXT NOT NULL DEFAULT 'MAD',
    "depreciationMethod" "DepreciationMethod" NOT NULL DEFAULT 'LINEAR',
    "usefulLifeYears" INTEGER NOT NULL DEFAULT 5,
    "decliningCoefficient" DECIMAL(4,2),
    "residualValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" "AssetStatus" NOT NULL DEFAULT 'IN_STOCK',
    "condition" "AssetCondition" NOT NULL DEFAULT 'GOOD',
    "origin" "AssetOrigin" NOT NULL DEFAULT 'MANUAL',
    "tagStatus" "TagStatus" NOT NULL DEFAULT 'UNTAGGED',
    "tagPrintedAt" TIMESTAMP(3),
    "tagAffixedAt" TIMESTAMP(3),
    "locationId" TEXT,
    "departmentId" TEXT,
    "costCenterId" TEXT,
    "custodianId" TEXT,
    "photoKey" TEXT,
    "warrantyEndDate" DATE,
    "disposalDate" DATE,
    "disposalType" "DisposalType",
    "disposalValue" DECIMAL(18,2),
    "disposalReason" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetEvent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "type" "AssetEventType" NOT NULL,
    "summary" TEXT NOT NULL,
    "fromLocationId" TEXT,
    "toLocationId" TEXT,
    "fromCustodianId" TEXT,
    "toCustodianId" TEXT,
    "fromStatus" "AssetStatus",
    "toStatus" "AssetStatus",
    "data" JSONB,
    "campaignId" TEXT,
    "userId" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "gpsAccuracy" DOUBLE PRECISION,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustodianAssignment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "returnedAt" TIMESTAMP(3),
    "conditionAtHandover" "AssetCondition" NOT NULL DEFAULT 'GOOD',
    "conditionAtReturn" "AssetCondition",
    "signatureKey" TEXT,
    "signerName" TEXT,
    "signedAt" TIMESTAMP(3),
    "signerIp" TEXT,
    "notes" TEXT,
    "assignedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustodianAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabelPrintJob" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "labelCount" INTEGER NOT NULL,
    "assetIds" TEXT[],
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LabelPrintJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryCampaign" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "plannedStartDate" DATE,
    "plannedEndDate" DATE,
    "launchedAt" TIMESTAMP(3),
    "countClosedAt" TIMESTAMP(3),
    "reconciledAt" TIMESTAMP(3),
    "validatedAt" TIMESTAMP(3),
    "pvNumber" TEXT,
    "pvObservations" TEXT,
    "createdById" TEXT NOT NULL,
    "validatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignMember" (
    "campaignId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'COUNTER',

    CONSTRAINT "CampaignMember_pkey" PRIMARY KEY ("campaignId","userId")
);

-- CreateTable
CREATE TABLE "CampaignScopeLocation" (
    "campaignId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,

    CONSTRAINT "CampaignScopeLocation_pkey" PRIMARY KEY ("campaignId","locationId")
);

-- CreateTable
CREATE TABLE "CampaignScopeCategory" (
    "campaignId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,

    CONSTRAINT "CampaignScopeCategory_pkey" PRIMARY KEY ("campaignId","categoryId")
);

-- CreateTable
CREATE TABLE "CampaignSnapshotItem" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "assetCode" TEXT NOT NULL,
    "designation" TEXT NOT NULL,
    "serialNumber" TEXT,
    "categoryId" TEXT NOT NULL,
    "categoryName" TEXT NOT NULL,
    "expectedLocationId" TEXT,
    "expectedLocationPath" TEXT,
    "expectedCustodianName" TEXT,
    "expectedStatus" "AssetStatus" NOT NULL,
    "acquisitionDate" DATE NOT NULL,
    "grossValue" DECIMAL(18,2) NOT NULL,
    "accumulatedDepreciation" DECIMAL(18,2) NOT NULL,
    "netBookValue" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignSnapshotItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignScan" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "snapshotItemId" TEXT,
    "scannedCode" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "condition" "AssetCondition" NOT NULL DEFAULT 'GOOD',
    "isLocationMismatch" BOOLEAN NOT NULL DEFAULT false,
    "transferProposed" BOOLEAN NOT NULL DEFAULT false,
    "manualEntry" BOOLEAN NOT NULL DEFAULT false,
    "photoKey" TEXT,
    "notes" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "gpsAccuracy" DOUBLE PRECISION,
    "deviceInfo" TEXT,
    "scannedById" TEXT NOT NULL,
    "scannedAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignScan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignSurplus" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "tempTag" TEXT NOT NULL,
    "scannedCode" TEXT,
    "designation" TEXT NOT NULL,
    "description" TEXT,
    "brand" TEXT,
    "model" TEXT,
    "serialNumber" TEXT,
    "categoryId" TEXT,
    "estimatedValue" DECIMAL(18,2),
    "condition" "AssetCondition" NOT NULL DEFAULT 'GOOD',
    "locationId" TEXT NOT NULL,
    "photoKey" TEXT,
    "notes" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "gpsAccuracy" DOUBLE PRECISION,
    "foundById" TEXT NOT NULL,
    "foundAt" TIMESTAMP(3) NOT NULL,
    "status" "SurplusStatus" NOT NULL DEFAULT 'PENDING',
    "resolvedAssetId" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignSurplus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationResult" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "category" "ReconciliationCategory" NOT NULL,
    "assetId" TEXT,
    "snapshotItemId" TEXT,
    "scanId" TEXT,
    "surplusId" TEXT,
    "assetCode" TEXT NOT NULL,
    "designation" TEXT NOT NULL,
    "categoryName" TEXT,
    "serialNumber" TEXT,
    "expectedLocationId" TEXT,
    "expectedLocationPath" TEXT,
    "foundLocationId" TEXT,
    "foundLocationPath" TEXT,
    "expectedStatus" "AssetStatus",
    "condition" "AssetCondition",
    "grossValue" DECIMAL(18,2) NOT NULL,
    "netBookValue" DECIMAL(18,2) NOT NULL,
    "reasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "resolution" "ResolutionStatus" NOT NULL DEFAULT 'OPEN',
    "resolutionAction" TEXT,
    "resolutionNote" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReconciliationResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sequence" (
    "companyId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Sequence_pkey" PRIMARY KEY ("companyId","key")
);

-- CreateIndex
CREATE UNIQUE INDEX "Company_code_key" ON "Company"("code");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "UserCompany_companyId_idx" ON "UserCompany"("companyId");

-- CreateIndex
CREATE INDEX "Location_companyId_pathIds_idx" ON "Location"("companyId", "pathIds");

-- CreateIndex
CREATE INDEX "Location_parentId_idx" ON "Location"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "Location_companyId_code_key" ON "Location"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "CostCenter_companyId_code_key" ON "CostCenter"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Department_companyId_code_key" ON "Department"("companyId", "code");

-- CreateIndex
CREATE INDEX "Employee_companyId_lastName_idx" ON "Employee"("companyId", "lastName");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_companyId_matricule_key" ON "Employee"("companyId", "matricule");

-- CreateIndex
CREATE UNIQUE INDEX "AssetCategory_companyId_code_key" ON "AssetCategory"("companyId", "code");

-- CreateIndex
CREATE INDEX "Supplier_companyId_name_idx" ON "Supplier"("companyId", "name");

-- CreateIndex
CREATE INDEX "Supplier_companyId_ice_idx" ON "Supplier"("companyId", "ice");

-- CreateIndex
CREATE INDEX "Invoice_companyId_status_idx" ON "Invoice"("companyId", "status");

-- CreateIndex
CREATE INDEX "Invoice_companyId_fileSha256_idx" ON "Invoice"("companyId", "fileSha256");

-- CreateIndex
CREATE INDEX "Invoice_companyId_supplierId_number_idx" ON "Invoice"("companyId", "supplierId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceLine_invoiceId_lineNo_key" ON "InvoiceLine"("invoiceId", "lineNo");

-- CreateIndex
CREATE INDEX "Asset_companyId_status_idx" ON "Asset"("companyId", "status");

-- CreateIndex
CREATE INDEX "Asset_companyId_categoryId_idx" ON "Asset"("companyId", "categoryId");

-- CreateIndex
CREATE INDEX "Asset_companyId_locationId_idx" ON "Asset"("companyId", "locationId");

-- CreateIndex
CREATE INDEX "Asset_companyId_tagStatus_idx" ON "Asset"("companyId", "tagStatus");

-- CreateIndex
CREATE INDEX "Asset_companyId_acquisitionDate_idx" ON "Asset"("companyId", "acquisitionDate");

-- CreateIndex
CREATE INDEX "Asset_companyId_serialNumber_idx" ON "Asset"("companyId", "serialNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_companyId_code_key" ON "Asset"("companyId", "code");

-- CreateIndex
CREATE INDEX "AssetEvent_assetId_createdAt_idx" ON "AssetEvent"("assetId", "createdAt");

-- CreateIndex
CREATE INDEX "AssetEvent_companyId_createdAt_idx" ON "AssetEvent"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "AssetEvent_companyId_type_idx" ON "AssetEvent"("companyId", "type");

-- CreateIndex
CREATE INDEX "AssetEvent_campaignId_idx" ON "AssetEvent"("campaignId");

-- CreateIndex
CREATE INDEX "CustodianAssignment_assetId_assignedAt_idx" ON "CustodianAssignment"("assetId", "assignedAt");

-- CreateIndex
CREATE INDEX "CustodianAssignment_employeeId_idx" ON "CustodianAssignment"("employeeId");

-- CreateIndex
CREATE INDEX "LabelPrintJob_companyId_createdAt_idx" ON "LabelPrintJob"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryCampaign_companyId_status_idx" ON "InventoryCampaign"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryCampaign_companyId_code_key" ON "InventoryCampaign"("companyId", "code");

-- CreateIndex
CREATE INDEX "CampaignSnapshotItem_campaignId_expectedLocationId_idx" ON "CampaignSnapshotItem"("campaignId", "expectedLocationId");

-- CreateIndex
CREATE INDEX "CampaignSnapshotItem_campaignId_assetCode_idx" ON "CampaignSnapshotItem"("campaignId", "assetCode");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignSnapshotItem_campaignId_assetId_key" ON "CampaignSnapshotItem"("campaignId", "assetId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignScan_clientId_key" ON "CampaignScan"("clientId");

-- CreateIndex
CREATE INDEX "CampaignScan_campaignId_assetId_scannedAt_idx" ON "CampaignScan"("campaignId", "assetId", "scannedAt");

-- CreateIndex
CREATE INDEX "CampaignScan_campaignId_locationId_idx" ON "CampaignScan"("campaignId", "locationId");

-- CreateIndex
CREATE INDEX "CampaignScan_campaignId_scannedAt_idx" ON "CampaignScan"("campaignId", "scannedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignSurplus_clientId_key" ON "CampaignSurplus"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignSurplus_resolvedAssetId_key" ON "CampaignSurplus"("resolvedAssetId");

-- CreateIndex
CREATE INDEX "CampaignSurplus_campaignId_status_idx" ON "CampaignSurplus"("campaignId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignSurplus_campaignId_tempTag_key" ON "CampaignSurplus"("campaignId", "tempTag");

-- CreateIndex
CREATE INDEX "ReconciliationResult_campaignId_category_idx" ON "ReconciliationResult"("campaignId", "category");

-- CreateIndex
CREATE INDEX "ReconciliationResult_campaignId_resolution_idx" ON "ReconciliationResult"("campaignId", "resolution");

-- AddForeignKey
ALTER TABLE "UserCompany" ADD CONSTRAINT "UserCompany_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserCompany" ADD CONSTRAINT "UserCompany_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostCenter" ADD CONSTRAINT "CostCenter_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetCategory" ADD CONSTRAINT "AssetCategory_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_validatedById_fkey" FOREIGN KEY ("validatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "AssetCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "AssetCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_invoiceLineId_fkey" FOREIGN KEY ("invoiceLineId") REFERENCES "InvoiceLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_custodianId_fkey" FOREIGN KEY ("custodianId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetEvent" ADD CONSTRAINT "AssetEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetEvent" ADD CONSTRAINT "AssetEvent_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetEvent" ADD CONSTRAINT "AssetEvent_fromLocationId_fkey" FOREIGN KEY ("fromLocationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetEvent" ADD CONSTRAINT "AssetEvent_toLocationId_fkey" FOREIGN KEY ("toLocationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetEvent" ADD CONSTRAINT "AssetEvent_fromCustodianId_fkey" FOREIGN KEY ("fromCustodianId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetEvent" ADD CONSTRAINT "AssetEvent_toCustodianId_fkey" FOREIGN KEY ("toCustodianId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetEvent" ADD CONSTRAINT "AssetEvent_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "InventoryCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetEvent" ADD CONSTRAINT "AssetEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustodianAssignment" ADD CONSTRAINT "CustodianAssignment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustodianAssignment" ADD CONSTRAINT "CustodianAssignment_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustodianAssignment" ADD CONSTRAINT "CustodianAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustodianAssignment" ADD CONSTRAINT "CustodianAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabelPrintJob" ADD CONSTRAINT "LabelPrintJob_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabelPrintJob" ADD CONSTRAINT "LabelPrintJob_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCampaign" ADD CONSTRAINT "InventoryCampaign_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCampaign" ADD CONSTRAINT "InventoryCampaign_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryCampaign" ADD CONSTRAINT "InventoryCampaign_validatedById_fkey" FOREIGN KEY ("validatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignMember" ADD CONSTRAINT "CampaignMember_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "InventoryCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignMember" ADD CONSTRAINT "CampaignMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignScopeLocation" ADD CONSTRAINT "CampaignScopeLocation_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "InventoryCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignScopeLocation" ADD CONSTRAINT "CampaignScopeLocation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignScopeCategory" ADD CONSTRAINT "CampaignScopeCategory_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "InventoryCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignScopeCategory" ADD CONSTRAINT "CampaignScopeCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "AssetCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignSnapshotItem" ADD CONSTRAINT "CampaignSnapshotItem_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "InventoryCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignSnapshotItem" ADD CONSTRAINT "CampaignSnapshotItem_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignSnapshotItem" ADD CONSTRAINT "CampaignSnapshotItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "AssetCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignSnapshotItem" ADD CONSTRAINT "CampaignSnapshotItem_expectedLocationId_fkey" FOREIGN KEY ("expectedLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignScan" ADD CONSTRAINT "CampaignScan_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "InventoryCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignScan" ADD CONSTRAINT "CampaignScan_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignScan" ADD CONSTRAINT "CampaignScan_snapshotItemId_fkey" FOREIGN KEY ("snapshotItemId") REFERENCES "CampaignSnapshotItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignScan" ADD CONSTRAINT "CampaignScan_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignScan" ADD CONSTRAINT "CampaignScan_scannedById_fkey" FOREIGN KEY ("scannedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignSurplus" ADD CONSTRAINT "CampaignSurplus_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "InventoryCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignSurplus" ADD CONSTRAINT "CampaignSurplus_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "AssetCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignSurplus" ADD CONSTRAINT "CampaignSurplus_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignSurplus" ADD CONSTRAINT "CampaignSurplus_foundById_fkey" FOREIGN KEY ("foundById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignSurplus" ADD CONSTRAINT "CampaignSurplus_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignSurplus" ADD CONSTRAINT "CampaignSurplus_resolvedAssetId_fkey" FOREIGN KEY ("resolvedAssetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationResult" ADD CONSTRAINT "ReconciliationResult_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "InventoryCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationResult" ADD CONSTRAINT "ReconciliationResult_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationResult" ADD CONSTRAINT "ReconciliationResult_snapshotItemId_fkey" FOREIGN KEY ("snapshotItemId") REFERENCES "CampaignSnapshotItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationResult" ADD CONSTRAINT "ReconciliationResult_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "CampaignScan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationResult" ADD CONSTRAINT "ReconciliationResult_surplusId_fkey" FOREIGN KEY ("surplusId") REFERENCES "CampaignSurplus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationResult" ADD CONSTRAINT "ReconciliationResult_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sequence" ADD CONSTRAINT "Sequence_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =============================================================================
-- Immutable audit trail ("historique immuable")
-- AssetEvent and CampaignScan are append-only: any UPDATE or DELETE is rejected
-- at database level, whatever the client (application, SQL console, ORM bug).
-- Note: TRUNCATE (administrative reset) is a distinct privilege and remains
-- available to the database owner only.
-- =============================================================================

CREATE OR REPLACE FUNCTION immotrack_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'La table % est en ajout seul (historique immuable) : % interdit.', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER asset_event_append_only
  BEFORE UPDATE OR DELETE ON "AssetEvent"
  FOR EACH ROW EXECUTE FUNCTION immotrack_reject_mutation();

CREATE TRIGGER campaign_scan_append_only
  BEFORE UPDATE OR DELETE ON "CampaignScan"
  FOR EACH ROW EXECUTE FUNCTION immotrack_reject_mutation();
