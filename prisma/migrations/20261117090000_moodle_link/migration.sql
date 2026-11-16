-- AlterTable
ALTER TABLE "Membership" ADD COLUMN "welcomeDueAt" DATETIME;

-- CreateTable
CREATE TABLE "MoodleEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "MoodleEvent_shop_eventId_key" ON "MoodleEvent"("shop", "eventId");
