-- DropIndex
DROP INDEX `Seat_email_status_idx` ON `Seat`;

-- AlterTable
ALTER TABLE `EmailLog` MODIFY `to` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `Seat` ADD COLUMN `emailHash` VARCHAR(191) NULL,
    MODIFY `email` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `Credential` MODIFY `holderName` TEXT NOT NULL;

-- CreateTable
CREATE TABLE `AccessLog` (
    `id` VARCHAR(191) NOT NULL,
    `shop` VARCHAR(191) NOT NULL,
    `actor` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `subject` VARCHAR(191) NOT NULL,
    `at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AccessLog_shop_at_idx`(`shop`, `at`),
    INDEX `AccessLog_at_idx`(`at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DataRequest` (
    `id` VARCHAR(191) NOT NULL,
    `shop` VARCHAR(191) NOT NULL,
    `requestId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `receivedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `downloadedAt` DATETIME(3) NULL,

    UNIQUE INDEX `DataRequest_shop_requestId_key`(`shop`, `requestId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Seat_emailHash_status_idx` ON `Seat`(`emailHash`, `status`);

