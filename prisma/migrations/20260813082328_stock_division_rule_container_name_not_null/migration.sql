/*
  Warnings:

  - Made the column `containerName` on table `StockDivisionRule` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE `StockDivisionRule` MODIFY `containerName` VARCHAR(191) NOT NULL DEFAULT '';
