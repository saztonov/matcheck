-- УПД: явный выбор объекта при загрузке (аналогично contractor_id из 0012).
-- Привязка не каскадная: при удалении объекта поле обнуляется, документ остаётся.

ALTER TABLE "source_documents"
  ADD COLUMN "site_id" uuid REFERENCES "sites"("id") ON DELETE SET NULL;

CREATE INDEX "source_site_idx"
  ON "source_documents" ("site_id")
  WHERE "site_id" IS NOT NULL;
