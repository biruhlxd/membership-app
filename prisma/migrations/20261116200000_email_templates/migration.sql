-- CreateTable
CREATE TABLE "EmailTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "planId" TEXT NOT NULL DEFAULT '',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "subject" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "EmailLook" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "senderName" TEXT NOT NULL DEFAULT '',
    "logoUrl" TEXT NOT NULL DEFAULT '',
    "accentColor" TEXT NOT NULL DEFAULT '',
    "buttonColor" TEXT NOT NULL DEFAULT '#1a1a1a',
    "footerHtml" TEXT,
    "signInPath" TEXT NOT NULL DEFAULT '/account'
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailTemplate_shop_kind_planId_key" ON "EmailTemplate"("shop", "kind", "planId");
