-- CreateTable
CREATE TABLE `TrackedStructure` (
    `id` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `structureId` BIGINT NOT NULL,
    `corporationId` INTEGER NOT NULL,
    `displayName` VARCHAR(191) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `TrackedStructure_structureId_key`(`structureId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StockTarget` (
    `id` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `structureId` BIGINT NOT NULL,
    `typeId` INTEGER NOT NULL,
    `targetQty` INTEGER NOT NULL,

    UNIQUE INDEX `StockTarget_structureId_typeId_key`(`structureId`, `typeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StockLog` (
    `id` VARCHAR(191) NOT NULL,
    `sampledAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `structureId` BIGINT NOT NULL,
    `typeId` INTEGER NOT NULL,
    `quantity` INTEGER NOT NULL,

    INDEX `StockLog_structureId_typeId_sampledAt_idx`(`structureId`, `typeId`, `sampledAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `StockTarget` ADD CONSTRAINT `StockTarget_structureId_fkey` FOREIGN KEY (`structureId`) REFERENCES `TrackedStructure`(`structureId`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockLog` ADD CONSTRAINT `StockLog_structureId_fkey` FOREIGN KEY (`structureId`) REFERENCES `TrackedStructure`(`structureId`) ON DELETE RESTRICT ON UPDATE CASCADE;
