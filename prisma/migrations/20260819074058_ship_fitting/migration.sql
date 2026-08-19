-- CreateTable
CREATE TABLE `ShipFitting` (
    `id` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `structureId` BIGINT NOT NULL,
    `typeId` INTEGER NOT NULL,
    `itemName` VARCHAR(191) NOT NULL,
    `items` JSON NOT NULL,

    UNIQUE INDEX `ShipFitting_structureId_typeId_itemName_key`(`structureId`, `typeId`, `itemName`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ShipFitting` ADD CONSTRAINT `ShipFitting_structureId_fkey` FOREIGN KEY (`structureId`) REFERENCES `TrackedStructure`(`structureId`) ON DELETE RESTRICT ON UPDATE CASCADE;
