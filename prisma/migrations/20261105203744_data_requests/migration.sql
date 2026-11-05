-- CreateTable
CREATE TABLE "DataRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "downloadedAt" DATETIME
);

-- CreateIndex
CREATE UNIQUE INDEX "DataRequest_shop_requestId_key" ON "DataRequest"("shop", "requestId");
