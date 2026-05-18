-- Справочник МОЛ (материально-ответственных лиц) — руководителей собственных
-- бригад. Параллелен справочнику подрядчиков (counterparties.isContractor):
-- материалы и ОС могут поступать/перемещаться не только подрядчикам, но и
-- собственным бригадам, ответственного представителя которой и хранит этот
-- справочник.
--
-- NB: не путать с уже существующим deliveries.confirmed_by_mol_user_id —
-- это FK на users (системный inspector_kpp, физически подтверждающий приёмку),
-- а responsible_persons — справочник получателей-физлиц, на которых
-- оформляется документ.
--
-- Обязательное поле — только full_name. Остальные поля (телефон, должность) —
-- опциональны. Признак is_active позволяет «архивировать» МОЛ при увольнении
-- без потери исторических ссылок из shipments/deliveries.

CREATE TABLE "responsible_persons" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "full_name"   text NOT NULL,
  "phone"       text,
  "position"    text,
  "is_active"   boolean NOT NULL DEFAULT true,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"  timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "responsible_persons_active_name_idx"
  ON "responsible_persons" ("full_name")
  WHERE "is_active";
