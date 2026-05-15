-- Расширяем фильтр статусов в v_stock_movements: помимо filled/shipped,
-- учитываем confirmed_mol (статус добавлен миграцией 0018). Без этого
-- приёмки/отгрузки, продвинутые до «Подтверждено МОЛ», выпадают из
-- остатков «На объекте» и журналов «Поступление» / «Отгрузка».
-- Структура колонок view не меняется — v_stock_balance поверх неё работает
-- без правок.

CREATE OR REPLACE VIEW "v_stock_movements" AS
-- Приходы: приёмка в статусе filled или confirmed_mol
SELECT
  'intake'::text                                       AS movement_kind,
  d.id                                                 AS operation_id,
  'delivery'::text                                     AS operation_table,
  d.site_id                                            AS site_id,
  NULL::uuid                                           AS counter_site_id,
  d.supplier_id                                        AS counterparty_id,
  di.material_id                                       AS material_id,
  di.name_raw                                          AS name_raw,
  di.unit                                              AS unit,
  COALESCE(di.qty_actual, di.qty_planned)::numeric     AS qty,
  1::integer                                           AS direction,
  COALESCE(d.arrived_at, d.updated_at)                 AS ts,
  d.updated_at                                         AS updated_at,
  di.id                                                AS item_id,
  di.line_no                                           AS line_no,
  NULL::shipment_kind                                  AS shipment_kind
FROM "deliveries" d
JOIN "delivery_items" di ON di.delivery_id = d.id
JOIN "statuses" st       ON st.id = d.status_id
WHERE st.entity_type = 'delivery' AND st.code IN ('filled', 'confirmed_mol')
  AND COALESCE(di.qty_actual, di.qty_planned) IS NOT NULL

UNION ALL

-- Расходы: отгрузка в статусе shipped или confirmed_mol, любой kind
SELECT
  'shipment'::text                                     AS movement_kind,
  s.id                                                 AS operation_id,
  'shipment'::text                                     AS operation_table,
  s.site_id                                            AS site_id,
  s.dest_site_id                                       AS counter_site_id,
  s.receiver_counterparty_id                           AS counterparty_id,
  si.material_id                                       AS material_id,
  si.name_raw                                          AS name_raw,
  si.unit                                              AS unit,
  COALESCE(si.qty_actual, si.qty_planned)::numeric     AS qty,
  -1::integer                                          AS direction,
  COALESCE(s.shipped_at, s.updated_at)                 AS ts,
  s.updated_at                                         AS updated_at,
  si.id                                                AS item_id,
  si.line_no                                           AS line_no,
  s.kind                                               AS shipment_kind
FROM "shipments" s
JOIN "shipment_items" si ON si.shipment_id = s.id
JOIN "statuses" st       ON st.id = s.status_id
WHERE st.entity_type = 'shipment' AND st.code IN ('shipped', 'confirmed_mol')
  AND COALESCE(si.qty_actual, si.qty_planned) IS NOT NULL

UNION ALL

-- Перемещение между объектами: +1 на dest_site_id (приход на объект-приёмник)
SELECT
  'transfer_in'::text                                  AS movement_kind,
  s.id                                                 AS operation_id,
  'shipment'::text                                     AS operation_table,
  s.dest_site_id                                       AS site_id,
  s.site_id                                            AS counter_site_id,
  NULL::uuid                                           AS counterparty_id,
  si.material_id                                       AS material_id,
  si.name_raw                                          AS name_raw,
  si.unit                                              AS unit,
  COALESCE(si.qty_actual, si.qty_planned)::numeric     AS qty,
  1::integer                                           AS direction,
  COALESCE(s.shipped_at, s.updated_at)                 AS ts,
  s.updated_at                                         AS updated_at,
  si.id                                                AS item_id,
  si.line_no                                           AS line_no,
  s.kind                                               AS shipment_kind
FROM "shipments" s
JOIN "shipment_items" si ON si.shipment_id = s.id
JOIN "statuses" st       ON st.id = s.status_id
WHERE st.entity_type = 'shipment' AND st.code IN ('shipped', 'confirmed_mol') AND s.kind = 'transfer'
  AND COALESCE(si.qty_actual, si.qty_planned) IS NOT NULL;
