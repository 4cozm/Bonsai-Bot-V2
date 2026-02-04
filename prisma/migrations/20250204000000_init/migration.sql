-- CreateTable
CREATE TABLE `DiscordUser` (
    `id` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EveCharacter` (
    `id` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `discordUserId` VARCHAR(191) NOT NULL,
    `characterId` BIGINT NOT NULL,
    `characterName` VARCHAR(191) NOT NULL,
    `isMain` BOOLEAN NOT NULL DEFAULT false,
    `accessToken` TEXT NULL,
    `refreshToken` TEXT NULL,
    `tokenExpiresAt` DATETIME(3) NULL,

    UNIQUE INDEX `EveCharacter_characterId_key`(`characterId`),
    INDEX `EveCharacter_discordUserId_idx`(`discordUserId`),
    INDEX `EveCharacter_characterName_idx`(`characterName`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EsiRegistration` (
    `id` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `discordUserId` VARCHAR(191) NOT NULL,
    `stateNonce` VARCHAR(191) NOT NULL,
    `stateExpAt` DATETIME(3) NOT NULL,
    `discordNick` VARCHAR(191) NOT NULL,
    `characterId` BIGINT NULL,
    `characterName` VARCHAR(191) NULL,
    `mainCandidate` BOOLEAN NOT NULL DEFAULT false,
    `status` ENUM('PENDING', 'CONFIRMED', 'REJECTED', 'EXPIRED') NOT NULL DEFAULT 'PENDING',
    `guildId` VARCHAR(191) NULL,
    `channelId` VARCHAR(191) NULL,
    `messageId` VARCHAR(191) NULL,

    UNIQUE INDEX `EsiRegistration_stateNonce_key`(`stateNonce`),
    INDEX `EsiRegistration_discordUserId_status_idx`(`discordUserId`, `status`),
    INDEX `EsiRegistration_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TenantMeta` (
    `id` VARCHAR(191) NOT NULL,
    `tenantKey` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `TenantMeta_tenantKey_key`(`tenantKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `EveCharacter` ADD CONSTRAINT `EveCharacter_discordUserId_fkey` FOREIGN KEY (`discordUserId`) REFERENCES `DiscordUser`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EsiRegistration` ADD CONSTRAINT `EsiRegistration_discordUserId_fkey` FOREIGN KEY (`discordUserId`) REFERENCES `DiscordUser`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
