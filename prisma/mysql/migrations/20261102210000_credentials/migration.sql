-- AlterTable
ALTER TABLE `Membership` ADD COLUMN `credentialIssue` TEXT NULL;

-- CreateTable
CREATE TABLE `CredentialType` (
    `id` VARCHAR(191) NOT NULL,
    `shop` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `validityMonths` INTEGER NOT NULL DEFAULT 0,
    `requirements` TEXT NOT NULL,
    `needsApproval` BOOLEAN NOT NULL DEFAULT false,
    `renewalRule` VARCHAR(191) NOT NULL DEFAULT 'none',
    `renewalPlanIds` TEXT NOT NULL,
    `nextSequence` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `CredentialType_shop_code_key`(`shop`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Credential` (
    `id` VARCHAR(191) NOT NULL,
    `shop` VARCHAR(191) NOT NULL,
    `typeId` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `holderName` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `number` VARCHAR(191) NULL,
    `verifyCode` VARCHAR(191) NOT NULL,
    `issuedAt` DATETIME(3) NULL,
    `expiresAt` DATETIME(3) NULL,
    `note` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Credential_verifyCode_key`(`verifyCode`),
    INDEX `Credential_shop_customerId_idx`(`shop`, `customerId`),
    INDEX `Credential_status_expiresAt_idx`(`status`, `expiresAt`),
    UNIQUE INDEX `Credential_shop_number_key`(`shop`, `number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Credential` ADD CONSTRAINT `Credential_typeId_fkey` FOREIGN KEY (`typeId`) REFERENCES `CredentialType`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

