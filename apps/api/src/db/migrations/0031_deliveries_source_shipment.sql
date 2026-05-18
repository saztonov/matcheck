-- Парный delivery для межобъектного перемещения (shipment.kind='transfer').
--
-- Когда инспектор объекта-источника оформляет transfer, сервер автоматически
-- создаёт «зеркальный» документ приёмки на объекте-получателе. Связь —
-- через deliveries.source_shipment_id. Этот delivery виден инспектору
-- destSiteId в обычном списке приёмок и принимается тем же потоком, что
-- и приёмки по УПД. Идемпотентность auto-create — по UNIQUE partial-индексу
-- на source_shipment_id.
--
-- ON DELETE RESTRICT: hard-delete shipment с непустым парным delivery
-- запрещён в БД (сервис routes/shipments.ts отдельно решает, удалять ли
-- каскадно или вернуть 409, опираясь на статус парного delivery).
--
-- Также добавляем индексы на фактические даты документов для сортировок
-- и фильтрации (shippedFrom/To, arrivedFrom/To).

ALTER TABLE deliveries
  ADD COLUMN source_shipment_id uuid NULL
    REFERENCES shipments(id) ON DELETE RESTRICT;
--> statement-breakpoint

CREATE UNIQUE INDEX deliveries_source_shipment_unique
  ON deliveries (source_shipment_id)
  WHERE source_shipment_id IS NOT NULL;
--> statement-breakpoint

CREATE INDEX deliveries_arrived_at_idx
  ON deliveries (site_id, arrived_at DESC)
  WHERE arrived_at IS NOT NULL;
--> statement-breakpoint

CREATE INDEX shipments_shipped_at_idx
  ON shipments (site_id, shipped_at DESC)
  WHERE shipped_at IS NOT NULL;
