-- Soft-delete для документов приёмки и отгрузки.
--
-- Менеджеры/инспекторы помечают документ на удаление (pending_deletion_at = now()),
-- админ окончательно удаляет (DELETE). Применимо только к статусам filled и
-- confirmed_mol; для draft/not_filled поведение DELETE остаётся прежним.

ALTER TABLE deliveries
  ADD COLUMN pending_deletion_at timestamptz NULL,
  ADD COLUMN pending_deletion_by_user_id uuid NULL
    REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN pending_deletion_reason text NULL;

ALTER TABLE deliveries
  ADD CONSTRAINT deliveries_pending_deletion_chk
  CHECK (
    (pending_deletion_at IS NULL AND pending_deletion_by_user_id IS NULL)
    OR (pending_deletion_at IS NOT NULL AND pending_deletion_by_user_id IS NOT NULL)
  );

CREATE INDEX deliveries_pending_deletion_idx
  ON deliveries (site_id, pending_deletion_at)
  WHERE pending_deletion_at IS NOT NULL;

ALTER TABLE shipments
  ADD COLUMN pending_deletion_at timestamptz NULL,
  ADD COLUMN pending_deletion_by_user_id uuid NULL
    REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN pending_deletion_reason text NULL;

ALTER TABLE shipments
  ADD CONSTRAINT shipments_pending_deletion_chk
  CHECK (
    (pending_deletion_at IS NULL AND pending_deletion_by_user_id IS NULL)
    OR (pending_deletion_at IS NOT NULL AND pending_deletion_by_user_id IS NOT NULL)
  );

CREATE INDEX shipments_pending_deletion_idx
  ON shipments (site_id, pending_deletion_at)
  WHERE pending_deletion_at IS NOT NULL;
