-- AlterTable
ALTER TABLE "MembershipPlan" ADD COLUMN "seatTypes" TEXT;

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "adminCustomerId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Seat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "customerId" TEXT,
    "status" TEXT NOT NULL,
    "invitedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" DATETIME,
    "endedAt" DATETIME,
    CONSTRAINT "Seat_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_membershipId_key" ON "Organization"("membershipId");

-- CreateIndex
CREATE INDEX "Organization_shop_adminCustomerId_idx" ON "Organization"("shop", "adminCustomerId");

-- CreateIndex
CREATE INDEX "Seat_organizationId_status_idx" ON "Seat"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Seat_email_status_idx" ON "Seat"("email", "status");

-- CreateIndex
CREATE INDEX "Seat_customerId_status_idx" ON "Seat"("customerId", "status");
