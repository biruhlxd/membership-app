-- CreateTable
CREATE TABLE "MembershipPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sellingPlanId" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "contractStatus" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "currentCycleIndex" INTEGER,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Membership_planId_fkey" FOREIGN KEY ("planId") REFERENCES "MembershipPlan" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BillingAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "membershipId" TEXT NOT NULL,
    "cycleIndex" INTEGER NOT NULL,
    "attempt" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "shopifyAttemptId" TEXT,
    "state" TEXT NOT NULL,
    "errorCode" TEXT,
    "orderId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BillingAttempt_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "MembershipPlan_shop_sellingPlanId_key" ON "MembershipPlan"("shop", "sellingPlanId");

-- CreateIndex
CREATE UNIQUE INDEX "MembershipPlan_shop_tag_key" ON "MembershipPlan"("shop", "tag");

-- CreateIndex
CREATE INDEX "Membership_shop_customerId_idx" ON "Membership"("shop", "customerId");

-- CreateIndex
CREATE INDEX "Membership_nextAttemptAt_idx" ON "Membership"("nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_shop_contractId_key" ON "Membership"("shop", "contractId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingAttempt_idempotencyKey_key" ON "BillingAttempt"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "BillingAttempt_shopifyAttemptId_key" ON "BillingAttempt"("shopifyAttemptId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingAttempt_membershipId_cycleIndex_attempt_key" ON "BillingAttempt"("membershipId", "cycleIndex", "attempt");
