-- CreateTable
CREATE TABLE "ShopAppPlan" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "plan" TEXT NOT NULL DEFAULT 'None',
    "updatedAt" DATETIME NOT NULL
);
