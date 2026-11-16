-- CreateTable
CREATE TABLE "ContractImport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "customerId" TEXT,
    "contractId" TEXT,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "ContractImport_shop_customerId_idx" ON "ContractImport"("shop", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "ContractImport_shop_source_sourceId_key" ON "ContractImport"("shop", "source", "sourceId");
