-- M-Pesa Business Manager — manual schema bootstrap (mirrors prisma/schema.prisma).
-- Used when the Prisma schema engine binary is unavailable (e.g. offline sandboxes).
-- Identifier casing and native enum types match Prisma's generated queries exactly.

DROP TABLE IF EXISTS "Expense" CASCADE;
DROP TABLE IF EXISTS "MpesaTransaction" CASCADE;
DROP TABLE IF EXISTS "SaleItem" CASCADE;
DROP TABLE IF EXISTS "Sale" CASCADE;
DROP TABLE IF EXISTS "Customer" CASCADE;
DROP TABLE IF EXISTS "Product" CASCADE;
DROP TABLE IF EXISTS "OrganizationMember" CASCADE;
DROP TABLE IF EXISTS "Organization" CASCADE;

DROP TYPE IF EXISTS "OrganizationTier" CASCADE;
DROP TYPE IF EXISTS "MemberRole" CASCADE;
DROP TYPE IF EXISTS "SaleStatus" CASCADE;
DROP TYPE IF EXISTS "PaymentMethod" CASCADE;
DROP TYPE IF EXISTS "MpesaDirection" CASCADE;
DROP TYPE IF EXISTS "MpesaStatus" CASCADE;
DROP TYPE IF EXISTS "ExpenseCategory" CASCADE;

CREATE TYPE "OrganizationTier" AS ENUM ('FREE', 'PRO');
CREATE TYPE "MemberRole"       AS ENUM ('OWNER', 'ADMIN', 'STAFF');
CREATE TYPE "SaleStatus"       AS ENUM ('COMPLETED', 'PENDING', 'REFUNDED', 'CANCELLED');
CREATE TYPE "PaymentMethod"    AS ENUM ('MPESA', 'CASH', 'CARD', 'BANK_TRANSFER', 'CREDIT');
CREATE TYPE "MpesaDirection"   AS ENUM ('INCOMING', 'OUTGOING');
CREATE TYPE "MpesaStatus"      AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'CANCELLED', 'TIMEOUT');
CREATE TYPE "ExpenseCategory"  AS ENUM ('INVENTORY', 'RENT', 'SALARIES', 'UTILITIES', 'MARKETING', 'TRANSPORT', 'MAINTENANCE', 'TAXES', 'SOFTWARE', 'OTHER');

CREATE TABLE "Organization" (
  "id"             TEXT PRIMARY KEY,
  "name"           TEXT NOT NULL,
  "slug"           TEXT NOT NULL UNIQUE,
  "tier"           "OrganizationTier" NOT NULL DEFAULT 'FREE',
  "businessType"   TEXT NOT NULL DEFAULT 'Retail',
  "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE "OrganizationMember" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
  "userId"         TEXT NOT NULL,
  "role"           "MemberRole" NOT NULL DEFAULT 'STAFF',
  "firstName"      TEXT,
  "lastName"       TEXT,
  "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "OrganizationMember_organizationId_userId_key" UNIQUE ("organizationId", "userId")
);

CREATE TABLE "Product" (
  "id"                TEXT PRIMARY KEY,
  "organizationId"    TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
  "name"              TEXT NOT NULL,
  "sku"               TEXT,
  "category"          TEXT NOT NULL DEFAULT 'General',
  "unit"              TEXT NOT NULL DEFAULT 'pcs',
  "costPrice"         NUMERIC(12,2) NOT NULL DEFAULT 0,
  "sellingPrice"      NUMERIC(12,2) NOT NULL DEFAULT 0,
  "stock"             INTEGER NOT NULL DEFAULT 0,
  "lowStockThreshold" INTEGER NOT NULL DEFAULT 5,
  "active"            BOOLEAN NOT NULL DEFAULT true,
  "createdAt"         TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE "Customer" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
  "name"           TEXT NOT NULL,
  "phone"          TEXT,
  "email"          TEXT,
  "location"       TEXT,
  "notes"          TEXT,
  "loyaltyPoints"  INTEGER NOT NULL DEFAULT 0,
  "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE "Sale" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
  "customerId"     TEXT REFERENCES "Customer"("id") ON DELETE SET NULL,
  "receiptNo"      TEXT NOT NULL UNIQUE,
  "status"         "SaleStatus" NOT NULL DEFAULT 'COMPLETED',
  "paymentMethod"  "PaymentMethod" NOT NULL DEFAULT 'MPESA',
  "mpesaReference" TEXT,
  "subtotal"       NUMERIC(12,2) NOT NULL DEFAULT 0,
  "discount"       NUMERIC(12,2) NOT NULL DEFAULT 0,
  "total"          NUMERIC(12,2) NOT NULL DEFAULT 0,
  "notes"          TEXT,
  "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE "SaleItem" (
  "id"          TEXT PRIMARY KEY,
  "saleId"      TEXT NOT NULL REFERENCES "Sale"("id") ON DELETE CASCADE,
  "productId"   TEXT REFERENCES "Product"("id") ON DELETE SET NULL,
  "productName" TEXT NOT NULL,
  "quantity"    INTEGER NOT NULL DEFAULT 1,
  "unitPrice"   NUMERIC(12,2) NOT NULL,
  "lineTotal"   NUMERIC(12,2) NOT NULL
);

CREATE TABLE "MpesaTransaction" (
  "id"              TEXT PRIMARY KEY,
  "organizationId"  TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
  "direction"       "MpesaDirection" NOT NULL DEFAULT 'INCOMING',
  "phone"           TEXT NOT NULL,
  "accountName"     TEXT,
  "amount"          NUMERIC(12,2) NOT NULL,
  "status"          "MpesaStatus" NOT NULL DEFAULT 'PENDING',
  "reference"       TEXT,
  "receiptNo"       TEXT,
  "transactionType" TEXT NOT NULL DEFAULT 'STK_PUSH',
  "description"     TEXT,
  "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT now(),
  "completedAt"     TIMESTAMPTZ
);

CREATE TABLE "Expense" (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
  "category"       "ExpenseCategory" NOT NULL DEFAULT 'OTHER',
  "amount"         NUMERIC(12,2) NOT NULL,
  "description"    TEXT NOT NULL,
  "vendor"         TEXT,
  "expenseDate"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes (mirrors prisma/schema.prisma)
CREATE INDEX "Organization_tier_idx"                 ON "Organization"("tier");
CREATE INDEX "OrganizationMember_userId_idx"         ON "OrganizationMember"("userId");
CREATE INDEX "Product_organizationId_idx"            ON "Product"("organizationId");
CREATE INDEX "Product_organizationId_active_idx"     ON "Product"("organizationId", "active");
CREATE INDEX "Customer_organizationId_idx"           ON "Customer"("organizationId");
CREATE INDEX "Customer_organizationId_phone_idx"     ON "Customer"("organizationId", "phone");
CREATE INDEX "Sale_organizationId_createdAt_idx"     ON "Sale"("organizationId", "createdAt");
CREATE INDEX "Sale_organizationId_paymentMethod_idx" ON "Sale"("organizationId", "paymentMethod");
CREATE INDEX "SaleItem_saleId_idx"                   ON "SaleItem"("saleId");
CREATE INDEX "MpesaTransaction_organizationId_createdAt_idx" ON "MpesaTransaction"("organizationId", "createdAt");
CREATE INDEX "MpesaTransaction_organizationId_status_idx"    ON "MpesaTransaction"("organizationId", "status");
CREATE INDEX "MpesaTransaction_phone_idx"            ON "MpesaTransaction"("phone");
CREATE INDEX "Expense_organizationId_expenseDate_idx" ON "Expense"("organizationId", "expenseDate");
CREATE INDEX "Expense_organizationId_category_idx"   ON "Expense"("organizationId", "category");
