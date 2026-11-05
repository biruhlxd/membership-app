-- DropIndex
DROP INDEX "Seat_email_status_idx";

-- AlterTable
ALTER TABLE "Seat" ADD COLUMN "emailHash" TEXT;

-- CreateTable
CREATE TABLE "AccessLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "AccessLog_shop_at_idx" ON "AccessLog"("shop", "at");

-- CreateIndex
CREATE INDEX "AccessLog_at_idx" ON "AccessLog"("at");

-- CreateIndex
CREATE INDEX "Seat_emailHash_status_idx" ON "Seat"("emailHash", "status");
