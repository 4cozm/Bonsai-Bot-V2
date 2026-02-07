-- AlterTable
ALTER TABLE `EsiRegistration` ADD COLUMN `accessToken` TEXT NULL,
    ADD COLUMN `refreshToken` TEXT NULL,
    ADD COLUMN `tokenExpiresAt` DATETIME(3) NULL;
