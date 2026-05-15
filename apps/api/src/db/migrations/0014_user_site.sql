-- Привязка пользователя к объекту (site). Обязательна для inspector_kpp:
-- определяет область видимости приёмок/отгрузок/документов. Для admin/manager
-- всегда NULL.
--
-- ON DELETE SET NULL: при удалении объекта поле обнуляется. Пользователь
-- остаётся, но его списки станут пустыми, пока админ не назначит новый
-- объект (нормализация на стороне приложения).

ALTER TABLE "users"
  ADD COLUMN "site_id" uuid REFERENCES "sites"("id") ON DELETE SET NULL;

CREATE INDEX "users_site_idx"
  ON "users" ("site_id")
  WHERE "site_id" IS NOT NULL;
