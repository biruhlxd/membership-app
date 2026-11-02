-- AlterTable
ALTER TABLE "Membership" ADD COLUMN "credentialIssue" TEXT;

-- CreateTable
CREATE TABLE "CredentialType" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "validityMonths" INTEGER NOT NULL DEFAULT 0,
    "requirements" TEXT NOT NULL,
    "needsApproval" BOOLEAN NOT NULL DEFAULT false,
    "renewalRule" TEXT NOT NULL DEFAULT 'none',
    "renewalPlanIds" TEXT NOT NULL,
    "nextSequence" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Credential" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "holderName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "number" TEXT,
    "verifyCode" TEXT NOT NULL,
    "issuedAt" DATETIME,
    "expiresAt" DATETIME,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Credential_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "CredentialType" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "CredentialType_shop_code_key" ON "CredentialType"("shop", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Credential_verifyCode_key" ON "Credential"("verifyCode");

-- CreateIndex
CREATE INDEX "Credential_shop_customerId_idx" ON "Credential"("shop", "customerId");

-- CreateIndex
CREATE INDEX "Credential_status_expiresAt_idx" ON "Credential"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Credential_shop_number_key" ON "Credential"("shop", "number");
