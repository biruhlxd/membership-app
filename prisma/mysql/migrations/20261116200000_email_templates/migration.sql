-- CreateTable
CREATE TABLE `EmailTemplate` (
    `id` VARCHAR(191) NOT NULL,
    `shop` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `planId` VARCHAR(191) NOT NULL DEFAULT '',
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `subject` VARCHAR(191) NOT NULL,
    `html` TEXT NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `EmailTemplate_shop_kind_planId_key`(`shop`, `kind`, `planId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EmailLook` (
    `shop` VARCHAR(191) NOT NULL,
    `senderName` VARCHAR(191) NOT NULL DEFAULT '',
    `logoUrl` VARCHAR(191) NOT NULL DEFAULT '',
    `accentColor` VARCHAR(191) NOT NULL DEFAULT '',
    `buttonColor` VARCHAR(191) NOT NULL DEFAULT '#1a1a1a',
    `footerHtml` TEXT NULL,
    `signInPath` VARCHAR(191) NOT NULL DEFAULT '/account',

    PRIMARY KEY (`shop`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
