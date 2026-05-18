-- МОЛ как получатель в документах поставки/отгрузки.
--
-- Раньше получателем shipment (kind='contractor' | 'return' | 'transfer') мог
-- быть только counterparty (через receiver_counterparty_id) — но при отгрузках
-- собственным бригадам получатель — физлицо (МОЛ). Аналогично, обычная
-- приёмка может быть оформлена не на подрядчика, а на МОЛ собственной бригады.
--
-- Новые колонки:
--   - shipments.receiver_mol_id  (FK responsible_persons)
--   - deliveries.recipient_mol_id (FK responsible_persons)
--
-- Пересборка check shipments_kind_links_chk:
--   contractor → XOR (receiver_counterparty_id, receiver_mol_id), dest=NULL
--   return     → только counterparty (поставщику возвращаем)
--   transfer   → dest_site_id NOT NULL ≠ site_id + XOR (counterparty, mol)
--   writeoff   → все receiver/dest = NULL
--
-- Новый check deliveries_recipient_chk: не оба одновременно (допускается
-- и оба NULL — обычная приёмка от внешнего поставщика).

ALTER TABLE shipments
  ADD COLUMN receiver_mol_id uuid NULL
    REFERENCES responsible_persons(id) ON DELETE SET NULL;
--> statement-breakpoint

ALTER TABLE deliveries
  ADD COLUMN recipient_mol_id uuid NULL
    REFERENCES responsible_persons(id) ON DELETE SET NULL;
--> statement-breakpoint

ALTER TABLE shipments DROP CONSTRAINT shipments_kind_links_chk;
--> statement-breakpoint

ALTER TABLE shipments
  ADD CONSTRAINT shipments_kind_links_chk
  CHECK (
    (kind = 'contractor'
      AND ((receiver_counterparty_id IS NOT NULL) <> (receiver_mol_id IS NOT NULL))
      AND dest_site_id IS NULL)
    OR (kind = 'return'
      AND receiver_counterparty_id IS NOT NULL
      AND receiver_mol_id IS NULL
      AND dest_site_id IS NULL)
    OR (kind = 'transfer'
      AND dest_site_id IS NOT NULL
      AND dest_site_id <> site_id
      AND ((receiver_counterparty_id IS NOT NULL) <> (receiver_mol_id IS NOT NULL)))
    OR (kind = 'writeoff'
      AND receiver_counterparty_id IS NULL
      AND receiver_mol_id IS NULL
      AND dest_site_id IS NULL)
  );
--> statement-breakpoint

ALTER TABLE deliveries
  ADD CONSTRAINT deliveries_recipient_chk
  CHECK (
    NOT (contractor_id IS NOT NULL AND recipient_mol_id IS NOT NULL)
  );
--> statement-breakpoint

CREATE INDEX shipments_receiver_mol_idx
  ON shipments (receiver_mol_id)
  WHERE receiver_mol_id IS NOT NULL;
--> statement-breakpoint

CREATE INDEX deliveries_recipient_mol_idx
  ON deliveries (recipient_mol_id)
  WHERE recipient_mol_id IS NOT NULL;
