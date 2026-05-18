-- Расширяем entity_deletions_type_chk для новых сущностей:
-- 'asset' (ОС) и 'responsible_person' (МОЛ). При hard-delete этих
-- глобальных справочников запись попадает в журнал, и /sync с since
-- возвращает id в deletedIds.

ALTER TABLE entity_deletions DROP CONSTRAINT entity_deletions_type_chk;
--> statement-breakpoint

ALTER TABLE entity_deletions
  ADD CONSTRAINT entity_deletions_type_chk
  CHECK (entity_type IN (
    'delivery',
    'shipment',
    'source_document',
    'asset',
    'responsible_person'
  ));
