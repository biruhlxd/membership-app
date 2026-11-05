-- AlterTable
ALTER TABLE "Credential" ADD COLUMN "expiringEmailAt" DATETIME;
ALTER TABLE "Credential" ADD COLUMN "issuedEmailAt" DATETIME;
ALTER TABLE "Credential" ADD COLUMN "pendingEmailAt" DATETIME;
