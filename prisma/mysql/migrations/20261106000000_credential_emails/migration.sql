-- AlterTable
ALTER TABLE `Credential` ADD COLUMN `expiringEmailAt` DATETIME(3) NULL,
    ADD COLUMN `issuedEmailAt` DATETIME(3) NULL,
    ADD COLUMN `pendingEmailAt` DATETIME(3) NULL;

