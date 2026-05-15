-- Новые статусы: «Подтверждено МОЛ» для приёмки и отгрузки.
INSERT INTO "statuses" ("entity_type","code","label","color","sort_order") VALUES
  ('delivery','confirmed_mol','Подтверждено МОЛ','blue',40),
  ('shipment','confirmed_mol','Подтверждено МОЛ','blue',40);
--> statement-breakpoint
ALTER TABLE "deliveries"
  ADD COLUMN "confirmed_by_mol_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN "confirmed_by_mol_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "shipments"
  ADD COLUMN "confirmed_by_mol_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  ADD COLUMN "confirmed_by_mol_at" timestamp with time zone;
