-- AlterTable
ALTER TABLE `Membership` ADD COLUMN `welcomeDueAt` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `MoodleEvent` (
    `id` VARCHAR(191) NOT NULL,
    `shop` VARCHAR(191) NOT NULL,
    `eventId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `receivedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `MoodleEvent_shop_eventId_key`(`shop`, `eventId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
