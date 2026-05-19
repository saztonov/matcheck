# Краткая выжимка корпоративного стандарта

## 1. Базовая архитектура и инфраструктура

Корпоративный портал разворачивается как web-приложение с backend API, frontend, reverse proxy, managed PostgreSQL и S3-compatible object storage.

Обязательный стек:

- reverse proxy: **Nginx**;
- backend: **Node.js + TypeScript + Fastify**;
- frontend: **React + TypeScript + Ant Design 5**;
- БД: **Yandex Managed PostgreSQL**;
- файловое хранилище: **S3-compatible object storage**;
- ORM/runtime query layer: **Drizzle ORM**;
- миграции: **Drizzle Kit + SQL-first migrations**;
- JWT: **jose**;
- логи: **pino JSON logs**;
- валидация входных данных: **zod**.

Nginx используется как основной reverse proxy и отвечает за TLS termination, redirect HTTP → HTTPS, проксирование запросов, базовые security headers, ограничения размера запросов и таймауты.

PostgreSQL используется как основная БД. Подключение к БД выполняется только от доверенных backend-сервисов, по TLS, с ограничением доступа через network/security rules. Runtime-пользователь БД должен иметь минимально необходимые права. Backups обязательны, PITR используется при наличии такой возможности.

Расширения PostgreSQL, например `pgcrypto`, `citext`, `pg_trgm`, включаются вручную в настройках Yandex Managed PostgreSQL до запуска миграций. SQL-миграции приложения не должны управлять расширениями через `CREATE EXTENSION`.

Миграции выполняются в SQL-first подходе. Источником правды являются versioned SQL-файлы. Drizzle ORM используется в runtime, а Drizzle Kit — для применения SQL-миграций, генерации черновиков, custom SQL migrations, проверки миграционной истории и Drizzle Studio. `drizzle-kit push` не используется в production. Миграции применяются отдельным шагом deployment pipeline и не запускаются автоматически из каждого экземпляра backend.

Для простых и средних порталов фоновые задачи реализуются через PostgreSQL-based jobs и transactional outbox. Redis не входит в обязательный минимальный стек. Redis/BullMQ применяются только при необходимости высокой пропускной способности очередей, распределённого rate-limit/backoff, большого количества фоновых задач, pub/sub, websocket-сценариев или при заметной нагрузке PostgreSQL jobs на основную БД.

Секреты хранятся в protected runtime secret storage: protected environment variables, Docker secrets, secret files с ограниченными правами доступа или secret manager. Production-секреты не хранятся в git, Docker image, frontend-коде, логах или БД. Master keys не должны храниться в той же БД, где находятся данные, которые они защищают.

## 2. Аутентификация, токены и авторизация

Для пользователей используется модель:

- короткоживущий **access JWT**;
- долгоживущий **opaque refresh token**;
- refresh rotation;
- refresh reuse detection.

Access token выпускается в формате JWT. Рекомендуемый алгоритм подписи — **EdDSA / Ed25519**. TTL access token — **10–15 минут**. Токен передаётся через `Authorization: Bearer <access_token>`. Backend проверяет подпись, срок действия, issuer, audience и достаточность прав. Для критичных операций дополнительно проверяется актуальность сессии.

Refresh token не должен быть JWT. Он генерируется криптографически стойким способом, имеет энтропию не менее 256 бит, хранится в БД только в виде hash, привязан к пользовательской сессии и ротируется при каждом успешном refresh. Rolling TTL refresh token — **14 дней**, absolute max lifetime — **90 дней**. Повторное использование уже отозванного refresh token считается индикатором возможного угона сессии и приводит к отзыву соответствующей цепочки токенов.

Для web-клиента access token хранится только в памяти приложения и не хранится в `localStorage` или `sessionStorage`. Refresh token хранится только в HttpOnly Secure SameSite cookie. Для мобильных приложений refresh token хранится в защищённом хранилище платформы, например Android Keystore или EncryptedSharedPreferences.

Portal-to-portal интеграции используют отдельную machine-to-machine схему. Для каждого портала или внутреннего сервиса создаётся service account с client id, client secret, allowed scopes и allowed audiences. Machine token выпускается как короткоживущий JWT с TTL **5–15 минут** и не использует refresh token.

Login должен защищать от enumeration: на любую ошибку возвращается единый ответ, система не раскрывает существование пользователя, а для несуществующего пользователя выполняется dummy password verify. Успешный login создаёт сессию, access token и refresh token, пишет событие в audit log и отправляет уведомление о новом входе.

Пароли:

- минимальная длина — **8 символов**;
- рекомендуемая длина — **12+ символов**;
- максимальная длина — не менее **64 символов**;
- пароль не должен совпадать с email, именем пользователя или названием организации;
- пароль проверяется по списку распространённых или скомпрометированных паролей;
- разрешены paste, autofill и password managers;
- хэширование: **bcrypt cost 12** или **Argon2id**.

MFA является опциональной возможностью. Для пользователей с расширенными правами MFA рекомендуется. Для критичных операций система может требовать MFA, если она включена; если MFA не включена, допускается повторный ввод пароля.

Авторизация выполняется только на backend. Все endpoints закрыты по умолчанию. Публичными являются только явно объявленные endpoints: login, refresh, healthcheck и публичная регистрация, если она предусмотрена бизнес-логикой. Для пользовательских действий применяется RBAC, для portal-to-portal API — scopes. Клиентские проверки ролей используются только для UX.

## 3. Фоновые задачи, файлы, аудит и эксплуатационные требования

Для операций с файлами, заявками, приёмками и документами используется принцип: бизнес-состояние фиксируется в PostgreSQL синхронно, а побочные действия выполняются асинхронно через PostgreSQL-based jobs и transactional outbox.

К фоновым задачам относятся:

- физическое удаление файлов из S3;
- генерация документов;
- генерация preview;
- извлечение metadata;
- отправка уведомлений;
- синхронизация с другим порталом;
- повторная попытка внешней операции.

Фоновые задачи должны поддерживать retry с exponential backoff и небольшим jitter. После превышения максимального количества попыток задача переводится в dead-состояние и становится доступна для административного анализа или ручного retry. Все фоновые задачи должны быть идемпотентными: повторное удаление уже удалённого S3-объекта считается успешным, повторная генерация файла использует стабильный object key или проверяет существующий результат, а offline-операции используют client operation id.

Загрузка файлов выполняется через upload session и presigned URL. Backend создаёт upload session, выдаёт presigned URL, frontend загружает файл в S3, подтверждает завершение загрузки, после чего backend создаёт file record и фоновые задачи обработки файла. Удаление документов и файлов выполняется через soft delete и фоновое физическое удаление из S3. Для пользователя объект считается удалённым после выставления deleted state.

Rate-limit и backoff обязательны для login и refresh. Для login используется лимит по IP и account/email, а также exponential backoff до 30 секунд. Для нескольких backend-инстансов используется общее хранилище лимитов: PostgreSQL для умеренной нагрузки или Redis для высокой частоты запросов.

CSRF-защита применяется к cookie-based endpoints: refresh, logout и logout all. API-запросы с access JWT в заголовке `Authorization` отдельной CSRF-защиты не требуют. Для cookie-based endpoints применяются `SameSite=Strict`, проверка Origin и Fetch Metadata headers, если они доступны.

Transport security обязателен: production-портал доступен только по HTTPS, HTTP перенаправляется на HTTPS. Должны использоваться базовые security headers, включая HSTS, X-Content-Type-Options, Referrer-Policy, X-Frame-Options или CSP frame-ancestors, а также Content-Security-Policy. Если frontend и backend находятся на одном origin, CORS не включается; если CORS нужен, используется exact allowlist origins.

Audit log должен фиксировать ключевые события: login success/failure, refresh, refresh token reuse, logout, смену пароля, MFA-события, изменение ролей, создание service account, выдачу machine token, password reset, dead jobs и критичные ошибки удаления файлов. Email в audit log хранится как HMAC, а не как plain hash.

Application logs пишутся в JSON-формате через pino. Из логов удаляются или маскируются пароли, Authorization header, cookies, access/refresh tokens, client secrets, OTP/TOTP values, recovery codes, приватные ключи и другие секреты.

При старте production-сервис должен проверять наличие обязательных env-секретов, отсутствие дефолтных значений, корректность JWT secret/private key, наличие log HMAC key, наличие encryption key для TOTP при использовании MFA, наличие S3 credentials и отсутствие dev-настроек в production. Если критичная настройка отсутствует или небезопасна, сервис должен завершать запуск с ошибкой.
