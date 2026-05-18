-- Поддержка ОС (основных средств) в позициях документов.
--
-- В delivery_items и shipment_items добавляется поле item_kind, которое
-- различает обычные материалы (`material`, default) и ОС (`asset`). Для
-- ОС в позицию также подтягиваются inventory_number и serial_number
-- (атрибуты конкретного экземпляра, в справочнике assets хранится только
-- тип ОС). Один документ может содержать смешанные позиции (материал + ОС).
--
-- Constraint items_kind_target_chk:
--   - item_kind='material' → asset_id IS NULL (material_id опционален: для
--     старых записей name_raw был основным источником);
--   - item_kind='asset' → asset_id IS NOT NULL И material_id IS NULL.
-- Это сохраняет существующие материальные строки (где material_id IS NULL).

CREATE TYPE "item_kind" AS ENUM ('material', 'asset');
--> statement-breakpoint

ALTER TABLE "delivery_items"
  ADD COLUMN "item_kind"        "item_kind" NOT NULL DEFAULT 'material',
  ADD COLUMN "asset_id"         uuid REFERENCES "assets"("id") ON DELETE SET NULL,
  ADD COLUMN "inventory_number" text,
  ADD COLUMN "serial_number"    text;
--> statement-breakpoint

ALTER TABLE "delivery_items"
  ADD CONSTRAINT "delivery_items_kind_target_chk"
  CHECK (
    (item_kind = 'material' AND asset_id IS NULL)
    OR (item_kind = 'asset' AND asset_id IS NOT NULL AND material_id IS NULL)
  );
--> statement-breakpoint

CREATE INDEX "delivery_items_asset_idx"
  ON "delivery_items" ("asset_id")
  WHERE "asset_id" IS NOT NULL;
--> statement-breakpoint

ALTER TABLE "shipment_items"
  ADD COLUMN "item_kind"        "item_kind" NOT NULL DEFAULT 'material',
  ADD COLUMN "asset_id"         uuid REFERENCES "assets"("id") ON DELETE SET NULL,
  ADD COLUMN "inventory_number" text,
  ADD COLUMN "serial_number"    text;
--> statement-breakpoint

ALTER TABLE "shipment_items"
  ADD CONSTRAINT "shipment_items_kind_target_chk"
  CHECK (
    (item_kind = 'material' AND asset_id IS NULL)
    OR (item_kind = 'asset' AND asset_id IS NOT NULL AND material_id IS NULL)
  );
--> statement-breakpoint

CREATE INDEX "shipment_items_asset_idx"
  ON "shipment_items" ("asset_id")
  WHERE "asset_id" IS NOT NULL;
