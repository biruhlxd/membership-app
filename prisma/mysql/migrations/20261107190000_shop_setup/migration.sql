-- CreateTable
CREATE TABLE `ShopSetup` (
    `shop` VARCHAR(191) NOT NULL,
    `portalSeenAt` DATETIME(3) NULL,

    PRIMARY KEY (`shop`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
