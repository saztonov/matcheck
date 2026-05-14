-- Отчёт по материалам: VIEW поверх UNION ALL приёмок (filled) и отгрузок (shipped).
-- direction = +1 для прихода, -1 для расхода. Для kind='transfer' добавляется
-- отдельная строка transfer_in (+1 на dest_site_id), чтобы перемещение
-- увеличивало остаток на объекте-приёмнике.

CREATE OR REPLACE VIEW "v_stock_movements" AS
-- Приходы (приёмка status='filled')
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
WHERE st.entity_type = 'delivery' AND st.code = 'filled'
  AND COALESCE(di.qty_actual, di.qty_planned) IS NOT NULL

UNION ALL

-- Расходы (отгрузка status='shipped'), любой kind
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
WHERE st.entity_type = 'shipment' AND st.code = 'shipped'
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
WHERE st.entity_type = 'shipment' AND st.code = 'shipped' AND s.kind = 'transfer'
  AND COALESCE(si.qty_actual, si.qty_planned) IS NOT NULL;
--> statement-breakpoint

-- Остатки «сейчас» в разрезе материал × объект × единица измерения.
-- HAVING <> 0 убирает «нулевые остатки», но даёт минус (если расход больше прихода).
CREATE OR REPLACE VIEW "v_stock_balance" AS
SELECT
  material_id,
  site_id,
  unit,
  SUM(direction * qty)::numeric(18, 4) AS balance,
  SUM(CASE WHEN direction =  1 THEN qty ELSE 0 END)::numeric(18, 4) AS qty_in,
  SUM(CASE WHEN direction = -1 THEN qty ELSE 0 END)::numeric(18, 4) AS qty_out
FROM "v_stock_movements"
WHERE material_id IS NOT NULL
GROUP BY material_id, site_id, unit
HAVING SUM(direction * qty) <> 0;
