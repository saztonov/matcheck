-- Журнал hard-delete операций для офлайн-клиента.
--
-- Когда админ окончательно удаляет приёмку/отгрузку/документ поступления,
-- мобильное приложение (Room + WorkManager) должно узнать об этом и удалить
-- локальную копию. Простой механизм «нет записи в /sync = удалена» не работает,
-- т.к. /sync лимитирован 500/200 записями и /sync с since не покажет факт
-- удаления — только отсутствие записи в выборке за дельту.
--
-- Решение — журнал: при каждом hard-delete пишем строку (entity_type, entity_id,
-- site_id, deleted_by_user_id, deleted_at), в той же транзакции что и DELETE.
-- /sync с since возвращает массив deletedIds для всех трёх типов.
--
-- site_id хранится, чтобы фильтровать выдачу по siteId инспектора (см. /sync
-- для inspector_kpp).

CREATE TABLE entity_deletions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  site_id uuid REFERENCES sites(id) ON DELETE SET NULL,
  deleted_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  deleted_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE entity_deletions
  ADD CONSTRAINT entity_deletions_type_chk
  CHECK (entity_type IN ('delivery', 'shipment', 'source_document'));

-- Основной паттерн запроса: /sync с since фильтрует по entity_type + deleted_at,
-- и для inspector_kpp дополнительно по site_id.
CREATE INDEX entity_deletions_since_idx
  ON entity_deletions (entity_type, deleted_at);
CREATE INDEX entity_deletions_site_idx
  ON entity_deletions (entity_type, site_id, deleted_at)
  WHERE site_id IS NOT NULL;
