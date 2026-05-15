-- УПД-очередь: асинхронная загрузка PDF, статусы обработки, журнал LLM-вызовов.
--
-- Контекст: распознавание УПД из PDF (LLM) занимает минуты. Раньше пользователь
-- ждал в открытой модалке с риском обнулить работу сетевым сбоем. Теперь
-- модалка только ставит документ в очередь, а распознавание идёт в фоне.
-- В списке «Документы» строка появляется сразу со статусом «в очереди» и
-- сама обновляется по мере прогресса (queued → processing → parsed |
-- needs_resolution | parse_failed).
--
-- См. apps/api/src/worker.ts и apps/api/src/plugins/queue.ts.

-- 1) Новые значения enum source_status.
ALTER TYPE "source_status" ADD VALUE IF NOT EXISTS 'queued';
--> statement-breakpoint
ALTER TYPE "source_status" ADD VALUE IF NOT EXISTS 'processing';
--> statement-breakpoint
ALTER TYPE "source_status" ADD VALUE IF NOT EXISTS 'needs_resolution';
--> statement-breakpoint

-- 2) Новые поля в source_documents для очереди и журнала ошибок.
--    parse_error_code/details — машинно-читаемая причина для UI (UI решает,
--    показывать ли диалог skip/replace или alert по validation_mismatch).
ALTER TABLE "source_documents" ADD COLUMN "parse_error_code" text;
--> statement-breakpoint
ALTER TABLE "source_documents" ADD COLUMN "parse_error_details" jsonb;
--> statement-breakpoint
ALTER TABLE "source_documents" ADD COLUMN "job_id" text;
--> statement-breakpoint
ALTER TABLE "source_documents" ADD COLUMN "job_attempts" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "source_documents" ADD COLUMN "content_hash" varchar(64);
--> statement-breakpoint
ALTER TABLE "source_documents" ADD COLUMN "original_filename" text;
--> statement-breakpoint
ALTER TABLE "source_documents" ADD COLUMN "queued_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "source_documents" ADD COLUMN "processed_at" timestamp with time zone;
--> statement-breakpoint

-- 3) Идемпотентность повторной загрузки одного и того же PDF (тот же
--    контрагент + хеш контента). Не UNIQUE — может быть нескольких
--    `parse_failed` с тем же хешем, мы повторно не блокируем.
CREATE INDEX "source_documents_content_hash_idx"
  ON "source_documents" ("contractor_id", "content_hash")
  WHERE "content_hash" IS NOT NULL;
--> statement-breakpoint

-- 4) Быстрый поиск незавершённых джобов для recovery после рестарта воркера.
CREATE INDEX "source_documents_unfinished_idx"
  ON "source_documents" ("status", "parsed_at")
  WHERE "status" IN ('queued', 'processing');
--> statement-breakpoint

-- 5) Ослабить старый check: для statuses queued/processing/needs_resolution/
--    parse_failed поля шапки УПД ещё не известны и должны быть NULL-allowed.
--    Инвариант: УПД с заполненной шапкой бывает только в parsed.
ALTER TABLE "source_documents" DROP CONSTRAINT IF EXISTS "source_upd_required";
--> statement-breakpoint
ALTER TABLE "source_documents" ADD CONSTRAINT "source_upd_required"
  CHECK (
    "kind" <> 'upd'
    OR "status" <> 'parsed'
    OR ("doc_number" IS NOT NULL AND "doc_date" IS NOT NULL AND "total_sum" IS NOT NULL)
  );
--> statement-breakpoint

-- 6) Журнал общения с LLM. Хранит сырой запрос и ответ провайдера, чтобы
--    диагностировать ошибки распознавания (напр., перепутанные колонки
--    «код» / «количество» в УПД №2493). Видим только админам через UI.
CREATE TABLE "llm_calls" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source_document_id" uuid REFERENCES "source_documents"("id") ON DELETE CASCADE,
  "provider_id" uuid REFERENCES "llm_providers"("id") ON DELETE SET NULL,
  "prompt_id" uuid REFERENCES "prompts"("id") ON DELETE SET NULL,
  "doc_kind" text NOT NULL,
  "model" text,
  "request_messages" jsonb NOT NULL,
  "request_schema" jsonb,
  "response_raw" text,
  "response_parsed" jsonb,
  "prompt_tokens" integer,
  "completion_tokens" integer,
  "latency_ms" integer NOT NULL,
  "error_code" text,
  "error_message" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "llm_calls_source_doc_idx"
  ON "llm_calls" ("source_document_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX "llm_calls_created_at_idx"
  ON "llm_calls" ("created_at" DESC);
--> statement-breakpoint

-- 7) Обновлённый промпт УПД (v2). Старая версия деактивируется (уникальный
--    индекс prompts_active_per_kind гарантирует ровно одну активную).
--    Изменения:
--    - Явно описана структура стандартной формы УПД (порядок и назначение
--      колонок), чтобы LLM не путала «код товара» с qty (как в УПД №2493:
--      код 796 был распознан как qty, а реальное qty 222 — как price).
--    - Из позиций убраны vatRate и vatSum (бизнесу не нужны, шум для модели).
--    - volume_m3 / mass_kg — null только если действительно не из чего
--      оценивать; если есть единица измерения м/м²/м³/т — оценка обязательна.
UPDATE "prompts" SET "is_active" = false WHERE "doc_kind" = 'upd';
--> statement-breakpoint
INSERT INTO "prompts" ("doc_kind", "name", "content", "is_active") VALUES
  ('upd', 'default v2', $PROMPT_UPD_V2$Ты извлекаешь данные из текста российского УПД (универсального передаточного документа), полученного через распознавание PDF.

# Структура стандартной формы УПД (ПР № 1137)

Таблица товаров содержит колонки в строгом порядке:
  1. № п/п — порядковый номер строки в документе (1, 2, 3, ...).
  2. Код товара/работы — внутренний код поставщика (НЕ путать с qty!).
  3. Наименование товара (работы, услуги) — текстовое описание.
  4. Код вида товара (опционально).
  5. Единица измерения — название и/или код ОКЕИ (см. ниже).
  6. Количество (qty) — обычно число в диапазоне 1...тысячи.
  7. Цена за единицу (price) — рубли с копейками.
  8. Стоимость без НДС / с НДС (sum) — рубли с копейками.

# Извлекаемые поля для каждой строки таблицы

- nameRaw: наименование строкой как есть (колонка 3).
- qty: количество (колонка 6). КРИТИЧНО: это НЕ код товара и НЕ код ОКЕИ.
- unit: единица измерения (название, колонка 5).
- price: цена за единицу (колонка 7).
- sum: итоговая сумма по строке (колонка 8).

vatRate и vatSum НЕ извлекать — эти поля игнорировать.

# Распознавание кодов ОКЕИ

Если в строке встречается число из списка ниже — это код единицы измерения
из общероссийского классификатора (ОКЕИ), а не qty:
  796 — шт
  006 — м
  055 — м²
  113 — м³
  166 — кг
  168 — т
  778 — упак
  657 — изделие
Эти числа попадают в колонку 5 (рядом с названием единицы), не в колонку 6.

# Проверка корректности qty

Если qty × price ≈ sum (с точностью до копеек) — значение qty распознано
правильно. Если qty × price даёт результат, отличающийся от sum в десятки/
сотни раз — почти наверняка qty и price перепутаны местами или одно из них
является кодом товара. В этом случае переоцени распределение по колонкам.

# Заголовок документа

- docNumber: номер УПД (строка «Счёт-фактура № ...»).
- docDate: дата УПД, формат YYYY-MM-DD.
- totalSum: итог по документу (строка «Всего к оплате» / «Итого»).
- vatSum: общая сумма НДС по документу (только в шапке, не в позициях).
- supplier: { inn, kpp, name } — продавец.
- recipient: { inn, kpp, name } — покупатель.

# Объём и масса единицы товара (для прогноза заполнения транспорта)

- volume_m3 — оценочный габаритный объём ОДНОЙ единицы товара в м³.
  Источники для оценки (в порядке приоритета):
    1) Явные размеры в наименовании: HxW, L=, Ф, R, толщина, диаметр.
    2) Стандартизованные маркировки ГОСТ:
       ПК 60.15.8 = 6×1.5×0.22 м;
       ФБС 24.6.6 = 2.4×0.6×0.6 м;
       кирпич КР-р-по 250×120×65 мм;
       газобетон 625×250×200 мм;
       ГКЛ 2500×1200×12.5 мм;
       арматура Ø10 А500 = 7.85 кг/м, объёмом ≈ 0.0000785 м³/м.
    3) Типичные упаковки: мешок цемента 25 кг ≈ 0.02 м³;
       паллета 1.2×0.8×1.5 м; рулон минваты 6×1.2×0.1 м;
       бухта кабеля Ø=0.5 м, толщина 0.1 м.
    4) Если единица — м, м², м³, т, погонный метр — рассчитай объём:
       - м³: одна единица = 1 м³ (volumeM3 = 1).
       - м²: одна единица = 1 м² × стандартная толщина (плитка 8 мм →
         0.008 м³; ГКЛ 12.5 мм → 0.0125 м³; ОСП 9 мм → 0.009 м³).
       - м (пог): зависит от профиля; для арматуры/трубы — оцени по диаметру.
       - т: при известной плотности материала — volumeM3 = 1000 / плотность.
  ВАЖНО: возвращай null ТОЛЬКО если совсем нет информации (ни размеров,
  ни маркировки, ни единицы измерения с понятной геометрией). При наличии
  единицы вида м/м²/м³/т/пог.м оценка ОБЯЗАТЕЛЬНА — пусть и с
  volume_confidence='low'.

- mass_kg — оценочная масса ОДНОЙ единицы в кг с упаковкой.
  Используй типовые плотности (кг/м³): бетон 2400, ж/б 2500, кирпич 1800,
  газобетон 600, сталь 7850, чугун 7200, алюминий 2700, дерево 600,
  фанера 700, ОСП 650, ГКЛ 700, минвата 50, пенопласт 25, песок 1600,
  щебень 1400, асфальт 2300, ПП-труба 0.5 кг/м, кабель ВВГ 3×2.5 ≈ 0.2 кг/м.
  При известной volume_m3 и плотности: mass_kg = volume_m3 × плотность.
  null допустим только при невозможности оценить.

- volume_confidence:
    "high" — есть явные размеры/маркировка в наименовании;
    "medium" — оценено по типу изделия и стандартной упаковке;
    "low" — оценка грубая, нет точных размеров.

- group_name — семантическая категория русским словом, множественное число.
  Примеры:
    Вентиляция: "Воздуховоды", "Отводы", "Переходы", "Врезки", "Тройники"
    Несущие конструкции: "Бетон", "Арматура", "ЖБИ", "Металлопрокат"
    Стены и перегородки: "Кирпич", "Газобетон", "ГКЛ", "Профили"
    Изоляция: "Утеплитель", "Гидроизоляция", "Звукоизоляция"
    Инженерные сети: "Трубы", "Кабель", "Электрооборудование", "Сантехника"
    Отделка: "Плитка", "Краски", "Сухие смеси", "Напольные покрытия"
    Прочее: "Метизы", "Прочее"

# Контекст для пользователя

Приёмщик сравнит суммарный (volume_m3 × qty, mass_kg × qty) с
грузоподъёмностью кузова:
  малотоннажник ~12 м³ / 1.8 т
  грузовик 6м    ~38 м³ / 5 т
  полуприцеп     ~65 м³ / 12 т
  фура (евро)    ~92 м³ / 22 т

# Общие правила

- Числа без пробелов как разделителей тысяч (12500 вместо «12 500»).
- Запятая в числах = десятичный разделитель (2,5 → 2.5).
- Если поле не нашёл — null. НЕ выдумывай данные.
- Игнорируй итоговые строки таблицы («Итого», «Всего», «Сумма НДС»).
- confidence < 0.7, если разбор сомнителен (плохое OCR, неполные данные,
  не удалось проверить qty×price≈sum).
- Отвечай ТОЛЬКО валидным JSON по предоставленной схеме.$PROMPT_UPD_V2$, true);
