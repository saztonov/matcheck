-- Справочник ОС (основных средств) — оборудования, инструмента, техники.
-- Параллелен справочнику материалов (materials), но используется в позициях
-- документов как отдельный «тип» (см. миграцию 0029_items_asset_kind).
--
-- code — опциональный артикул (как у materials); name обязателен; unit по
-- умолчанию «шт» (ОС обычно учитывается поштучно). is_active позволяет
-- архивировать списанные позиции без удаления.

CREATE TABLE "assets" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code"        varchar(64),
  "name"        text NOT NULL,
  "unit"        varchar(16) NOT NULL DEFAULT 'шт',
  "is_active"   boolean NOT NULL DEFAULT true,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"  timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "asset_code_unique"
  ON "assets" ("code")
  WHERE "code" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "asset_active_name_idx"
  ON "assets" ("name")
  WHERE "is_active";
