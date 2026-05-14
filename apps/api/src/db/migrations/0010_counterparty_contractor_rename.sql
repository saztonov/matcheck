-- Переименование роли контрагента «Перевозчик» → «Подрядчик»:
-- isCarrier/is_carrier → isContractor/is_contractor.
-- Семантически сходится с deliveries.contractor_id и shipments.kind='contractor'.

ALTER TABLE "counterparties" RENAME COLUMN "is_carrier" TO "is_contractor";
ALTER INDEX "counterparty_carrier_idx" RENAME TO "counterparty_contractor_idx";
