-- Отгрузка материалов: симметрично приёмке (deliveries), но с разными ассоциациями
-- и четырьмя видами (kind): contractor / return / transfer / writeoff.
-- CHECK-констрейнт держит согласованность kind ↔ receiver/dest_site.

CREATE TYPE "shipment_kind" AS ENUM ('contractor', 'return', 'transfer', 'writeoff');
--> statement-breakpoint

CREATE TABLE "shipments" (
  "id"                       uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "status_id"                uuid NOT NULL REFERENCES "statuses"("id"),
  "kind"                     "shipment_kind" NOT NULL,
  "site_id"                  uuid NOT NULL REFERENCES "sites"("id") ON DELETE RESTRICT,
  "receiver_counterparty_id" uuid REFERENCES "counterparties"("id") ON DELETE SET NULL,
  "dest_site_id"             uuid REFERENCES "sites"("id") ON DELETE RESTRICT,
  "vehicle_plate"            varchar(16),
  "driver_name"              text,
  "shipped_at"               timestamp with time zone,
  "inspector_id"             uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "comment"                  text,
  "version"                  integer NOT NULL DEFAULT 1,
  "created_at"               timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"               timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "shipments_kind_links_chk" CHECK (
    (kind = 'contractor' AND receiver_counterparty_id IS NOT NULL AND dest_site_id IS NULL)
    OR (kind = 'return'    AND receiver_counterparty_id IS NOT NULL AND dest_site_id IS NULL)
    OR (kind = 'transfer'  AND receiver_counterparty_id IS NULL     AND dest_site_id IS NOT NULL AND dest_site_id <> site_id)
    OR (kind = 'writeoff'  AND receiver_counterparty_id IS NULL     AND dest_site_id IS NULL)
  )
);
--> statement-breakpoint

CREATE INDEX "shipment_site_updated_idx" ON "shipments" ("site_id", "updated_at");
--> statement-breakpoint
CREATE INDEX "shipment_kind_idx" ON "shipments" ("kind");
--> statement-breakpoint
CREATE INDEX "shipment_inspector_idx" ON "shipments" ("inspector_id");
--> statement-breakpoint
CREATE INDEX "shipment_dest_site_idx" ON "shipments" ("dest_site_id") WHERE "kind" = 'transfer';
--> statement-breakpoint
CREATE INDEX "shipment_receiver_idx" ON "shipments" ("receiver_counterparty_id")
  WHERE "receiver_counterparty_id" IS NOT NULL;
--> statement-breakpoint

CREATE TABLE "shipment_items" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "shipment_id"       uuid NOT NULL REFERENCES "shipments"("id") ON DELETE CASCADE,
  "material_id"       uuid REFERENCES "materials"("id") ON DELETE SET NULL,
  "name_raw"          text NOT NULL,
  "qty_planned"       numeric(18, 4),
  "qty_actual"        numeric(18, 4),
  "unit"              varchar(16) NOT NULL DEFAULT 'шт',
  "comment"           text,
  "line_no"           integer NOT NULL,
  "volume_m3"         numeric(10, 4),
  "mass_kg"           numeric(10, 3),
  "volume_confidence" text,
  "group_name"        text
);
--> statement-breakpoint

CREATE INDEX "shipment_items_material_idx" ON "shipment_items" ("material_id");
--> statement-breakpoint

CREATE TABLE "shipment_photos" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "shipment_id"      uuid NOT NULL REFERENCES "shipments"("id") ON DELETE CASCADE,
  "kind"             "photo_kind" NOT NULL DEFAULT 'cargo',
  "s3_key"           text NOT NULL,
  "thumb_s3_key"     text,
  "content_hash"     varchar(64),
  "idempotency_key"  uuid,
  "taken_at"         timestamp with time zone NOT NULL DEFAULT now(),
  "created_at"       timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE UNIQUE INDEX "shipment_photo_content_unique"
  ON "shipment_photos" ("shipment_id", "content_hash") WHERE "content_hash" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "shipment_photo_idempotency_unique"
  ON "shipment_photos" ("shipment_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL;
--> statement-breakpoint

CREATE TABLE "shipment_sources" (
  "shipment_id"        uuid NOT NULL REFERENCES "shipments"("id") ON DELETE CASCADE,
  "source_document_id" uuid NOT NULL REFERENCES "source_documents"("id") ON DELETE RESTRICT,
  PRIMARY KEY ("shipment_id", "source_document_id")
);
--> statement-breakpoint

-- Сидируем статусы отгрузок (entity_type='shipment').
INSERT INTO "statuses" ("entity_type", "code", "label", "color", "sort_order") VALUES
  ('shipment', 'not_filled', 'Не оформлена', 'orange', 10),
  ('shipment', 'draft',      'Черновик',     'default', 20),
  ('shipment', 'shipped',    'Отгружено',    'green',  30);
--> statement-breakpoint

-- Индекс по material_id на delivery_items (нужен для отчёта v_stock_movements,
-- сейчас отсутствует — добавляем в этой же миграции, чтобы не множить миграции).
CREATE INDEX IF NOT EXISTS "delivery_items_material_idx" ON "delivery_items" ("material_id");
