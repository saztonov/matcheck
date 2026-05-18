# README-шаблон для мобильного приложения matcheck (Android Kotlin)

Этот файл — шаблон для `README.md` репозитория мобильного приложения
(https://github.com/hoperlex/matcheck.mobile). Скопируй его содержимое в свой
README и адаптируй под конкретный проект. Он отражает фактическое состояние
портала `matcheck` после полной интеграции с mobile API (24 эндпоинта,
48 schemas, OpenAPI 3.1).

При крупных изменениях API:
- актуальный контракт — `packages/contracts/openapi.json` в репозитории
  `matcheck`;
- подробная документация — [docs/MOBILE_API.md](MOBILE_API.md);
- этот README обновляется по факту breaking-changes (раз в N релизов).

---

## Скоуп приложения

Нативное Android-приложение для роли `inspector_kpp` (инспектор КПП). Работает
offline-first на полевых планшетах: оператор принимает машину, фотографирует
груз, отгружает, заполняет приёмку даже без сети. При появлении сети — синхронизирует.

Роли `admin` и `manager` в мобильном клиенте не поддерживаются — для них есть
веб-портал.

## Источник правды контракта

- **openapi.json** — `packages/contracts/openapi.json` в репо `matcheck`,
  ветка `main`. Не пиши клиентский код вручную — сгенерируй Retrofit/Kotlinx
  клиент:
  ```bash
  npm install -g @openapitools/openapi-generator-cli
  openapi-generator-cli generate \
    -i openapi.json -g kotlin \
    -o ./generated/matcheck-api \
    --additional-properties=library=jvm-retrofit2,\
  serializationLibrary=kotlinx_serialization,dateLibrary=java8,\
  useCoroutines=true,packageName=ru.matcheck.api
  ```
- Получишь модули `ru.matcheck.api.{apis,models,infrastructure}`.
  Подключи как Gradle-модуль `:api` в Android-проект.
- Любые изменения контракта приходят через bump `openapi.json` — пересборка
  клиента через CI. Никакой ручной правки сгенерированных классов.

## Базовые URL и обязательные заголовки

| Среда | URL |
|---|---|
| Production | `https://matcheck.fvds.ru` |
| Local dev (для тестов) | `http://localhost:3001` |

Все пути префиксированы `/api/v1/`. На каждый запрос с мобилы:
- `X-Client-Type: mobile` — обязательно, активирует mobile auth flow (refresh
  в теле ответа вместо cookies);
- `User-Agent: matcheck-android/<version> (Build <code>; Android <api>)` —
  для серверных логов;
- `Authorization: Bearer <accessToken>` — на все эндпоинты, кроме `/auth/login`
  и `/auth/refresh`.

## Аутентификация и токены

JWT Ed25519 (EdDSA), payload `{ sub, role, sid, aal }`. Клиент не валидирует
подпись — это делает сервер. Храни как непрозрачные строки.

- **Access-token:** TTL 15 минут. Хранить в памяти (Singleton/Hilt); опционально
  в `EncryptedSharedPreferences` чтобы пережить рестарт процесса.
- **Refresh-token:** TTL 14 дней, общая длина сессии 90 дней. Хранить
  **обязательно** в `EncryptedSharedPreferences` (Jetpack Security) или
  DataStore + Tink AEAD. Никогда в plain SharedPreferences.

Никогда не логируй токены в Crashlytics/Sentry/Timber — настрой фильтры на
поля `accessToken`, `refreshToken`.

### Login

```http
POST /api/v1/auth/login
Host: matcheck.fvds.ru
X-Client-Type: mobile
Content-Type: application/json

{"email": "inspector@example.ru", "password": "..."}
```

Ответ:
```json
{
  "accessToken": "...",
  "expiresIn": 900,
  "refreshToken": "...",
  "refreshExpiresIn": 1209600,
  "user": {
    "id": "uuid",
    "email": "inspector@example.ru",
    "role": "inspector_kpp",
    "isActive": true,
    "siteId": "uuid-объекта-строительства",
    "createdAt": "..."
  }
}
```

**Сохрани `user.siteId`** — это единственный объект инспектора. Селект объекта
в UI отключи: даже если клиент пришлёт другой siteId в upsert, сервер его
перезапишет на свой.

### Refresh на 401

Любой 401 на бизнес-эндпоинте → попробуй `/auth/refresh`:
```http
POST /api/v1/auth/refresh
X-Client-Type: mobile
Authorization: Bearer <refreshToken>
```

Ответ 200: новые `accessToken` + `refreshToken` (ротация). Сохрани новые
токены **до** повтора исходного запроса.

Параллельные 401 не должны вызывать гонку: оберни `/auth/refresh` в
`Mutex`/`SingleFlight` — все запросы ждут одного refresh и потом повторяются
с новым access.

Если refresh упал с 401 (`invalid_refresh` / `no_refresh`) — старый refresh
был уже использован или истёк. Выкидывай пользователя на login и стирай
локальные данные.

### Logout

```http
POST /api/v1/auth/logout
Authorization: Bearer <accessToken>
```

Сервер инвалидирует сессию по `sid` из JWT.

## Видимость данных (роль inspector_kpp)

| Что | Что видит инспектор |
|---|---|
| `deliveries`/`shipments` | Все записи своего объекта (по `siteId`), включая записи других инспекторов на том же siteId. |
| `sourceDocuments` (УПД) | Свой `siteId`, **только не привязанные** к приёмке/отгрузке (это inbox «Ожидаемые УПД»). Привязанные приходят в `delivery.sourceDocumentIds` / `shipment.sourceDocumentIds`. |
| `counterparties`, `materials`, `sites`, `statuses` | Полностью (справочники нужны всем). |
| `deletedIds` | id записей, физически удалённых после `since`, по своему `siteId`. |

Серверная фильтрация — клиенту делать её не нужно.

## Offline-first архитектура

Главное правило: **UI никогда не делает прямой `POST /deliveries`/`/shipments`
из view-модели**. Сохранение всегда идёт через Room и очередь мутаций.

```
[UI «Сохранить»]
      ↓ применить optimistic-изменение
      ↓ записать в Room: delivery + mutation в queue
[Sync Worker (WorkManager)]
      ↓ периодически или по триггеру
      ↓ забрать pending mutations из queue
      ↓ POST /api/v1/deliveries
      ├ 200 → удалить mutation, обновить delivery из ответа
      ├ 409 conflict → флаг conflictPending=true, ждать UI-разрешения
      ├ 409 pending_deletion → перевести в read-only, разрешить только unmark
      ├ 5xx → retry с exponential backoff (max 6 попыток)
      └ 4xx (кроме 409) → drop (логирование ошибки)
[SSE Listener]
      ↓ при invalidation-событии → запустить sync-pull
```

Образец TS-логики (один-в-один переносится на Kotlin/Coroutines + Room):

- `apps/web/src/services/sync.ts` — push/pull цикл с cursor;
- `apps/web/src/services/conflictResolver.ts` — стратегии разрешения 409 conflict;
- `apps/web/src/services/photoPipeline.ts` — двухэтапный photo pipeline;
- `apps/web/src/lib/db.ts` — IndexedDB schema (на Kotlin → Room с аналогичными
  таблицами `deliveries`, `shipments`, `mutations`, `photos`, `source_documents`,
  `references`, `settings`).

## Дельта-синхронизация

```http
GET /api/v1/sync?since={ISO-8601}&windowDays={N}
Authorization: Bearer <accessToken>
```

- `since` (опц.) — ISO-8601. Если не задан — initial-sync, окно ограничивается `windowDays`.
- `windowDays` (опц., default 90, 1..365) — окно для initial-sync:
  `deliveries`/`shipments`/`sourceDocuments` отдаются за последние N дней.
  При `since != null` параметр игнорируется (дельта-sync захватывает старые
  записи, если они менялись).

Ответ:
```json
{
  "cursor": "2026-05-18T10:30:00.000Z",
  "serverNow": "2026-05-18T10:30:01.000Z",
  "counterparties": [...],
  "materials": [...],
  "sites": [...],
  "statuses": [...],
  "sourceDocuments": [...],
  "deliveries": [...],
  "shipments": [...],
  "deletedIds": {
    "deliveries": ["uuid", ...],
    "shipments": ["uuid", ...],
    "sourceDocuments": ["uuid", ...]
  }
}
```

### Лимиты

| Тип | Лимит за запрос |
|---|---|
| `counterparties` | 500 |
| `materials` | 500 |
| `sites` | 500 |
| `sourceDocuments` | 200 |
| `deliveries` | 500 |
| `shipments` | 500 |

Если в каком-то массиве пришло **ровно лимит** — возможно, есть ещё. Повторяй
с `since = response.cursor`. `cursor` — это серверное время, не client clock.

### Обработка ответа

1. Upsert всех записей `deliveries[]/shipments[]/sourceDocuments[]/...` в Room
   (по id).
2. Обработать `deletedIds.{deliveries,shipments,sourceDocuments}[]` — удалить
   локальные записи с этими id.
3. Сохранить `cursor` для следующего вызова.

### Когда вызывать sync

- При старте приложения (initial без `since`).
- Каждые 60 сек на фоне (WorkManager `PeriodicWorkRequest`).
- После каждой успешной локальной мутации (push-then-pull).
- При получении SSE-события.
- При возврате сети после офлайна (NetworkCallback).

## SSE — real-time уведомления

```kotlin
val request = Request.Builder()
    .url("https://matcheck.fvds.ru/api/v1/events")
    .header("Authorization", "Bearer $accessToken")
    .header("X-Client-Type", "mobile")
    .build()
val factory = EventSources.createFactory(client)
val listener = object : EventSourceListener() {
    override fun onEvent(es: EventSource, id: String?, type: String?, data: String) {
        val payload = json.decodeFromString<SseEvent>(data)
        when (type) {
            "delivery_updated", "shipment_updated",
            "source_document_updated", "counterparty_updated",
            "material_updated", "site_updated" -> triggerSync()
            "delivery_deleted", "shipment_deleted", "source_document_deleted" -> {
                // entityId обязателен — удаляем локально без вызова /sync
                payload.entityId?.let { localDb.delete(it) }
            }
            "ping" -> markConnectionAlive()
        }
    }
    override fun onFailure(es: EventSource, t: Throwable?, response: Response?) {
        // 401 → попробуй /auth/refresh и переподключись
        // network error → reconnect через 2..10 сек с jitter
    }
}
factory.newEventSource(request, listener)
```

**Формат события:**
```
event: delivery_updated
data: {"type":"delivery_updated","entityId":"<uuid>","ts":"2026-05-18T10:00:00.000Z"}
```

**Event types:** `delivery_updated`, `delivery_deleted`, `shipment_updated`,
`shipment_deleted`, `source_document_updated`, `source_document_deleted`,
`counterparty_updated`, `material_updated`, `site_updated`, `ping`.

**Ping:** каждые 25 сек. Если ping молчит дольше 60 сек — соединение мёртвое,
переподключайся (jitter 2..10 сек).

`entityId` — обязательное поле для всех `*_updated`/`*_deleted` событий
(только `ping` без него). На `*_deleted` можно удалить локально без вызова
`/sync` — это эффективнее, чем полная ресинхронизация.

## OCC (optimistic concurrency control)

`POST /api/v1/deliveries` / `/shipments` принимают `baseVersion: number` —
версия, на которой клиент основывал свои локальные изменения.

- Совпадает с серверной → upsert, версия `+1`, ответ 200 с новым DTO.
- Не совпадает → **409 Conflict + ConflictResponse**:
  ```json
  {
    "error": "conflict",
    "serverVersion": 7,
    "server": { /* полный snapshot Delivery/Shipment на сервере */ }
  }
  ```

**Клиент:**
1. Покажи UI разрешения (server_win / local_win / merge).
2. Примени стратегию локально.
3. Повтори POST с `baseVersion = serverVersion` из ответа 409.

Образец: `apps/web/src/services/conflictResolver.ts`.

Идемпотентности через `Idempotency-Key` нет — используй OCC.

## Двухэтапное удаление (soft-delete)

Бизнес-правило: оформленные и подтверждённые МОЛ приёмки/отгрузки нельзя
удалить напрямую. Сначала пометка («корзина»), окончательно удаляет **только
admin** с портала. На планшете кнопка «удалить окончательно» **не показывается**.

### Эндпоинты

| Статус документа | Действие | Эндпоинт | Кто |
|---|---|---|---|
| `draft`/`not_filled` | «Удалить» | `DELETE /deliveries\|shipments/{id}` | inspector_kpp своего siteId |
| `filled`/`confirmed_mol`/`shipped` | «Пометить на удаление» (запросить причину) | `POST /…/{id}/mark-deletion` body `{reason?: string}` | inspector_kpp своего siteId |
| Помеченный | «Снять пометку» | `POST /…/{id}/unmark-deletion` | автор пометки или admin |
| Помеченный | Окончательно удалить | `DELETE /…/{id}` | **только admin** — скрой в UI |
| Корзина | `GET /…?trash=1` | inspector видит корзину своего siteId |

### Поля DTO

После пометки `Delivery`/`Shipment` содержит:
```json
{
  "pendingDeletionAt": "2026-05-18T10:00:00.000Z",
  "pendingDeletionByUserId": "uuid",
  "pendingDeletionByUserEmail": "user@example.ru",
  "pendingDeletionReason": "ошибка ввода"
}
```

**Важно:** в ответе `/sync` поле `pendingDeletionByUserEmail` всегда `null`
(намеренное упрощение — без дополнительного join). Реальный email
подтягивается при открытии деталей через `GET /deliveries|shipments/{id}`.

### Семантика кодов 409 / 400

| Код | Когда | Что делать |
|---|---|---|
| 409 `must_mark_first` | DELETE filled/confirmed_mol без пометки | Сначала вызови `mark-deletion`, потом повтори DELETE (только admin) |
| 409 `already_pending` | mark по уже помеченному | Обнови локальную копию из server-snapshot |
| 409 `not_pending` | unmark по не помеченному | Обнови локальную копию |
| 409 `pending_deletion` | upsert / photo presign / photo delete по помеченному | UI в read-only, разрешить только unmark |
| 400 `cannot_mark_status` | mark по draft/not_filled | Используй обычный DELETE |

### Read-only режим клиента

При `pendingDeletionAt != null`:
- блокировать редактирование полей;
- скрыть кнопку камеры (сервер вернёт 409 на `POST /photos/presign`);
- показать бейдж «На удалении» (`pendingDeletionAt`, `pendingDeletionByUserEmail`, `pendingDeletionReason`);
- доступна только кнопка «Снять пометку» (→ `unmark-deletion`).

## Photo pipeline (двухэтапный + опц. confirm)

1. **Захват и сжатие.** Bitmap + InSampleSize. Формат — **любой**: JPEG, PNG,
   HEIC/HEIF, WebP (что прислал — то и сохранится в S3). Рекомендация
   сжатия — до ~1.5 МБ ради экономии 4G:
   - main: max side 2048 px, цель ~1.5 МБ;
   - thumb (опц.): max side 320 px, цель ~0.1 МБ.

2. **SHA-256** от main-байтов + UUID `idempotencyKey`. Сохрани в Room с
   `uploaded=false`.

3. **POST /api/v1/photos/presign**
   ```json
   {
     "operationKind": "delivery",
     "operationId": "uuid-приёмки",
     "kind": "cargo",
     "contentHash": "<sha256-hex>",
     "idempotencyKey": "<uuid>",
     "contentType": "image/jpeg",
     "thumbContentHash": "<опц-sha256-hex>"
   }
   ```
   - `operationKind`: `'delivery'` | `'shipment'`. Не используй legacy `deliveryId`.
   - `kind`: `'cargo'` | `'vehicle'` | `'document'` | `'other'`.
     Бумажный УПД на КПП = `'document'`.
   - `contentType`: реальный MIME — `image/jpeg`, `image/heic`, `image/webp`
     и т.д. Не оставляй default.

4. **Ответ.**
   - `alreadyExists: true` → PUT в S3 пропускается, фото уже было загружено
     с этим contentHash. Локально пометить как uploaded.
   - `alreadyExists: false` → выданы `uploadUrl` и опц. `thumbUploadUrl`
     (TTL 5 мин). PUT напрямую в S3, **без** Authorization-заголовка (URL
     уже подписан).

5. **PUT в S3.**
   ```http
   PUT <uploadUrl>
   Content-Type: image/jpeg

   <binary body>
   ```

6. **POST /api/v1/photos/{id}/confirm** — после успешного PUT (HTTP 200).
   Сервер делает S3.HEAD и проставляет `uploaded_at = now()`. Это защищает
   запись от автоматической очистки orphan-задачей (раз в час). Idempotent:
   повторный вызов вернёт прежний `uploadedAt`.

   Без confirm фото всё равно «дозреет» через час (cleanup-job увидит
   объект в S3 и подтвердит сам), но клиент **не должен** пытаться открыть
   фото с `uploadedAt: null` — `GET /url` может вернуть 404, если запись
   orphan'нулась.

7. **TTL и retry.** Presigned URL живёт 300 сек. Упустил окно → повторно
   `/photos/presign` с тем же `idempotencyKey` — сервер выдаст новый URL
   для того же s3Key. WorkManager `Worker` пытается загрузить когда есть сеть.

### Просмотр фото

```http
GET /api/v1/photos/{id}/url?thumb=false
Authorization: Bearer <accessToken>
```

Ответ: `{ url, expiresIn }` — presigned GET URL (TTL 5 мин). Кешируется на
клиенте до истечения.

**Inspector_kpp** может открывать только фото своего объекта (сервер проверяет
parentSiteId; иначе 404).

### Запрет загрузки УПД с мобилы

Электронные УПД (PDF/XML) загружаются **только на портале** (admin/manager).
С мобилы:
- **просмотр:** `GET /api/v1/source-documents` (через `/sync`), `GET /api/v1/source-documents/{id}`;
- **скачивание оригинала:** `GET /api/v1/source-documents/{id}/file` → presigned URL;
- **привязка к приёмке:** `POST /api/v1/deliveries` с `sourceDocumentIds: ["<id>"]`.

Бумажный УПД на КПП → фотографируй через photo pipeline с `kind='document'`.
LLM-распознавание для таких фото не запускается (это можно сделать менеджером
с десктопа).

## Безопасность транспорта (production)

КПП работают на полевых Wi-Fi (стройплощадки, общие сети) — типичный сценарий
MITM. Cert pinning обязателен:

```kotlin
// Для Let's Encrypt пиннить нужно intermediate (R10/R11/E5/E6), не leaf —
// leaf обновляется каждые 60–90 дней.
val pinner = CertificatePinner.Builder()
    .add("matcheck.fvds.ru", "sha256/<base64-SPKI-hash-intermediate>")
    .add("matcheck.fvds.ru", "sha256/<base64-SPKI-hash-backup-intermediate>")
    .build()

val client = OkHttpClient.Builder()
    .certificatePinner(pinner)
    .build()
```

Минимум 2 хеша (текущий + резерв) чтобы не положить приложение при ротации CA.

Извлечь SPKI hash:
```bash
openssl s_client -connect matcheck.fvds.ru:443 -servername matcheck.fvds.ru < /dev/null 2>/dev/null \
  | openssl x509 -pubkey -noout \
  | openssl pkey -pubin -outform DER \
  | openssl dgst -sha256 -binary \
  | openssl enc -base64
```

## Чек-лист первого запуска приложения

1. `POST /auth/login` (с `X-Client-Type: mobile`) → сохранить `accessToken`,
   `refreshToken` (encrypted), `user.siteId`.
2. `GET /sync` (без `since`, с `windowDays=90`) → залить всё в Room:
   - `sites`, `counterparties`, `materials`, `statuses` — справочники;
   - `deliveries`, `shipments`, `sourceDocuments` — за 90 дней по своему siteId.
3. Запустить SSE-listener.
4. Запустить периодический WorkManager-sync (60 сек) + триггер по сети.
5. UI: показать список приёмок, кнопку «Новая приёмка», иконку Inbox с
   количеством не привязанных УПД из `sourceDocuments[]`.

## Verification: ручная проверка API

После любого breaking-change в `openapi.json` прогони smoke-test через curl:

```bash
# 1. Login → проверить siteId в user
curl -X POST https://staging/api/v1/auth/login \
  -H "Content-Type: application/json" -H "X-Client-Type: mobile" \
  -d '{"email":"…","password":"…"}' | jq '.user.siteId'

# 2. Sync со всеми полями
curl 'https://staging/api/v1/sync?windowDays=90' -H "Authorization: Bearer $T" \
  | jq '{cp: .counterparties|length, st: .statuses|length, del: .deletedIds,
         ship: .shipments|length,
         pending: [.deliveries[]|select(.pendingDeletionAt!=null)]|length}'

# 3. Mark + DELETE
curl -X POST https://staging/api/v1/deliveries/<filled-id>/mark-deletion \
  -H "Authorization: Bearer $T" -H "Content-Type: application/json" \
  -d '{"reason":"тест"}'

# 4. Корзина
curl 'https://staging/api/v1/deliveries?trash=1' -H "Authorization: Bearer $T" \
  | jq '.items|length'

# 5. SSE (в отдельном окне)
curl -N https://staging/api/v1/events -H "Authorization: Bearer $T"
# в другом окне выполнить mark/unmark/delete → события должны нести entityId
```

## Где задавать вопросы

- Технические вопросы по API: создай issue в репозитории `matcheck` с тегом
  `mobile-api`.
- Breaking changes контракта согласовываются заранее в issue/Slack.
- Drift между Zod и openapi.json ловит CI-job `contracts-drift`. Если он
  упал — выполни локально в репо `matcheck`:
  ```bash
  pnpm --filter @matcheck/contracts gen:openapi
  git add packages/contracts/openapi.json
  ```
