-- AlterTable
ALTER TABLE "Membership" ADD COLUMN "currency" TEXT;
ALTER TABLE "Membership" ADD COLUMN "lastPaidAt" DATETIME;
ALTER TABLE "Membership" ADD COLUMN "nextRenewalAmount" TEXT;
ALTER TABLE "Membership" ADD COLUMN "nextRenewalAt" DATETIME;
