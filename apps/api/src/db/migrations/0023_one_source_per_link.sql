-- Одна УПД должна быть привязана не более чем к одной приёмке и не более чем
-- к одной отгрузке. Связь обеспечивается на уровне БД через UNIQUE на
-- source_document_id в junction-таблицах delivery_sources / shipment_sources.
--
-- Если в БД уже есть дубли (одна и та же УПД в нескольких приёмках/отгрузках
-- из-за прежнего бага в фильтре «Ожидаемые»), миграция упадёт на 23505 с
-- именем нарушенного constraint — это ожидаемо: дубли нужно расчистить
-- вручную и повторить миграцию.

ALTER TABLE "delivery_sources"
  ADD CONSTRAINT "delivery_sources_source_document_id_unique"
  UNIQUE ("source_document_id");

ALTER TABLE "shipment_sources"
  ADD CONSTRAINT "shipment_sources_source_document_id_unique"
  UNIQUE ("source_document_id");
