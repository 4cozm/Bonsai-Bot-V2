-- AlterTable
ALTER TABLE `StockLog` ADD COLUMN `containerName` VARCHAR(191) NULL,
    ADD COLUMN `division` INTEGER NULL;

-- CreateTable
CREATE TABLE `StockDivisionRule` (
    `id` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `structureId` BIGINT NOT NULL,
    `division` INTEGER NOT NULL,
    `containerName` VARCHAR(191) NULL,
    `tracked` BOOLEAN NOT NULL DEFAULT true,
    `displayName` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `StockDivisionRule_structureId_division_containerName_key`(`structureId`, `division`, `containerName`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `StockLog_structureId_division_sampledAt_idx` ON `StockLog`(`structureId`, `division`, `sampledAt`);

-- AddForeignKey
ALTER TABLE `StockDivisionRule` ADD CONSTRAINT `StockDivisionRule_structureId_fkey` FOREIGN KEY (`structureId`) REFERENCES `TrackedStructure`(`structureId`) ON DELETE RESTRICT ON UPDATE CASCADE;
