-- Новый статус: «Без документа» — для приёмок/отгрузок, созданных инспектором
-- на планшете без выбранной УПД (например, машина приехала, а документ не
-- успели подгрузить на портал). Диспетчер на портале затем привязывает УПД
-- вручную, и статус автоматически переходит в обычный (см. updateDelivery /
-- updateShipment в роутах).
INSERT INTO "statuses" ("entity_type","code","label","color","sort_order") VALUES
  ('delivery','no_document','Без документа','gold',15),
  ('shipment','no_document','Без документа','gold',15)
ON CONFLICT ("entity_type","code") DO NOTHING;
