-- CreateTable
CREATE TABLE `ContractImport` (
    `id` VARCHAR(191) NOT NULL,
    `shop` VARCHAR(191) NOT NULL,
    `source` VARCHAR(191) NOT NULL,
    `sourceId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NULL,
    `contractId` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL,
    `error` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ContractImport_shop_customerId_idx`(`shop`, `customerId`),
    UNIQUE INDEX `ContractImport_shop_source_sourceId_key`(`shop`, `source`, `sourceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
