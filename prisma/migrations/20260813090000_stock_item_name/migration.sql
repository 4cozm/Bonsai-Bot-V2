-- AlterTable
ALTER TABLE `StockLog` ADD COLUMN `itemName` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `StockTarget` ADD COLUMN `itemName` VARCHAR(191) NOT NULL DEFAULT '';

-- CreateIndex
-- 새 3컬럼 유니크 인덱스를 먼저 만든다 — structureId를 접두어로 갖고 있어서
-- 기존 FK(StockTarget_structureId_fkey)의 지지 인덱스 역할을 이어받을 수 있다.
-- 순서를 바꿔서 기존 인덱스를 먼저 지우면 그 순간 FK가 지지 인덱스를 잃어서
-- MySQL이 DROP을 거부한다(또는 FK를 먼저 내렸다 다시 올려야 하는데, 그러면
-- 불필요하게 위험이 커진다) — 새 인덱스를 먼저 만들어서 이 문제를 피한다.
CREATE UNIQUE INDEX `StockTarget_structureId_typeId_itemName_key` ON `StockTarget`(`structureId`, `typeId`, `itemName`);

-- DropIndex
DROP INDEX `StockTarget_structureId_typeId_key` ON `StockTarget`;
