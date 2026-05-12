1. Общий стек используемых языков и технологий

- Устройство: портал разворачивается на VPS в docker, БД – облачный Yandex managed postgresql, файлохранилище – облачный S3 cloud.ru
- Backend: Node.js + TypeScript + Fastify (плагины @fastify/helmet, @fastify/cookie, @fastify/rate-limit, @fastify/cors, @fastify/csrf-protection, @fastify/type-provider-zod).
- ORM/SQL: Drizzle ORM + drizzle-kit (SQL-first, легко добавить триггеры/частичные индексы/CHECK через сырые миграции; полная поддержка Postgres-фич).
- JWT: jose (Ed25519 EdDSA из коробки).
- Cache/rate-limit/backoff: Redis (ioredis).
- Логи: pino + redaction.
- Frontend: React 18 + TypeScript + Vite + Ant Design 5 + Zustand (auth/UI) + TanStack Query (server state) + React Hook Form + zod.
- Monorepo: pnpm workspaces; общий пакет @reference-hub/contracts со схемами zod, разделяемыми между FE и BE.

Деплой: Docker Compose (Caddy + api + web + redis); БД — внешний Yandex Managed PostgreSQL.

2. Авторизация и безопасность.

- B.1 Топология
- Клиент (SPA) ↔ обратный прокси (TLS-термин., HSTS, CSP, rate-limit) ↔ Auth API (Node.js) ↔ реляционная БД (Postgres) со схемой users, refresh*tokens, sessions, auth_events, mfa*\*. Секреты — в секрет-менеджере (Vault / Lockbox / Secrets Manager); ключ для шифрования TOTP-секретов — в KMS (envelope encryption).
- B.2 Аутентификация
- • Endpoint POST /api/v1/auth/login; валидация ввода через схему (zod / Joi / pydantic).
- • Unified error на любую ошибку: «неверный email или пароль» — анти-enumeration.
- • Unified latency: если пользователь не найден, всё равно выполнить «холостой» verify на дамми-хэше той же стоимости — время ответа не должно раскрывать существование пользователя.
- • Экспоненциальный backoff по ключу email (Redis / in-memory с TTL): 1с → 2с → 4с → … до 30с.
- B.3 Пароли
- Базовый минимум:
- • bcrypt, cost = 12.
- • Проверка HIBP k-anonymity API (префикс SHA-1 из 5 символов): на compromised = reject.
- • zxcvbn score ≥ 3; длина ≥ 8; классы ≥ 2, 3 из 4; запрет совпадения с email/именем/названием организации.
- • Поле password_changed_at в users инвалидирует все активные access+refresh токены пользователя (см. B.5).
- B.4 Access-токен
- • JWT EdDSA (Ed25519) — современный алгоритм, небольшой размер. Публичный ключ можно раздавать микросервисам, приватный — только в auth-сервисе. Альтернатива: HS512 (одно приложение, симметричный секрет в секрет-менеджере).
- • TTL = 15 минут.
- • Payload: sub (user id), role, aal (auth assurance level), sid (session id), iat, exp, iss, aud.
- • Хранение на клиенте: только в памяти (state приложения / closure). Никакого localStorage / sessionStorage — даже один XSS = угон сессии.
- • Передача: заголовок Authorization: Bearer ...
- • Проверка на каждый запрос: подпись + exp + sessionsInvalidatedAt пользователя (LRU-кэш 15 секунд во избежание лишних SELECT).
- B.5 Refresh-токен
- • Opaque (НЕ JWT): CSPRNG 256 бит, base64url. JWT для refresh не использовать — opaque-токен невозможно «прочитать», у него нет полезной нагрузки, его сложнее эксплуатировать при утечке.
- • В cookie: \_\_Host-refresh; HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth.
- • В БД — только SHA-256 хэш токена, вместе с session_id, issued_at, expires_at, revoked_at, replaced_by, ip, user_agent.
- • Rolling rotation: каждый успешный /refresh возвращает новый токен и помечает старый revoked_at = now(), replaced_by = new.id.
- • Reuse detection: если пришёл уже revoked токен — revoke всей цепочки (вся session_id) + алерт. Это реальный индикатор угона, оставлять обязательно.
- • User-Agent и IP при каждом refresh ЛОГИРУЮТСЯ в sessions.last_seen_ua/ip, но НЕ используются как триггер автоматического revoke (мобильный CGNAT, VPN, смена Wi-Fi, обновление браузера дают ложные срабатывания; пользователи привыкают игнорить «подозрительная активность» → защита перестаёт работать, а UX ломается).
- • Endpoint GET /api/v1/me/sessions — список активных сессий (UA, IP, GeoIP-город, last_seen, текущая highlighted).
- • Endpoint DELETE /api/v1/me/sessions/:id — ручной revoke пользователем (модель GitHub / Google).
- • Email-уведомление — только на новый login (первое появление session_id), не на каждый refresh и не на смену UA/IP.
- • TTL 14 дней rolling (сдвигается при каждом refresh). Абсолютный максимум absolute_max = 90 дней от issued_at первого токена цепочки.
- • POST /logout: revoke текущего refresh и пометка sessions.invalidated_at = now() → access-JWT отклоняется middleware до своего TTL.
- • POST /logout-all: revoke всех refresh пользователя.
- B.7 Защита от brute-force
- • Rate-limits (например, express-rate-limit + Redis): /auth/login — 5 / 15 мин / IP; 10 / час / email. /auth/refresh — 60 / мин / IP. /auth/register — 3 / час / IP.
- • Остальные write — 100 / мин; read — 1000 / мин.
- • CAPTCHA (Turnstile / hCaptcha / reCAPTCHA) — после 3 неудачных попыток по IP/email.
- • Блокировка аккаунта на 30 минут после 10 неудач + email-уведомление.
- • Fail2ban-паттерн на уровне reverse-proxy: бан IP при > N HTTP 401 за минуту.
- B.8 RBAC (авторизация)
- • Список ролей определяется бизнесом приложения; типичные: admin, manager, user, read-only — но конкретный набор и иерархия зависят от предметной области.
- • Проверка ролей — в middleware на сервере (authorize(...roles) / requireRole). Клиентские guard-компоненты — только UX, не защита.
- • Каждый защищённый endpoint требует authenticate + (где нужно) authorize. По умолчанию — закрыт; явно открываются только публичные (login, register, refresh, healthcheck).
- • Привилегированные операции (смена роли, удаление пользователя, экспорт ПДн) дополнительно требуют MFA aal2 и пишутся в audit-log.
- B.9 CSRF / open-redirect / path-traversal
- • SameSite=Strict на refresh-cookie.
- • Access-токен в заголовке Authorization (браузер не отправляет автоматически) → CSRF неактуален для этого пути.
- • Double-submit CSRF-token на state-changing endpoints, использующих cookies для аутентификации.
- • returnUrl валидируется: startsWith('/'), не '//', не содержит '://', длина ≤ 256. Список разрешённых хостов — в whitelist, если нужны кросс-доменные редиректы.
- • Пути к файлам/ресурсам — из whitelist enum; имена — через санитайзер; никогда не строить storage-ключ конкатенацией пользовательского ввода.
- B.10 Transport и заголовки
- • Reverse-proxy терминирует TLS (Let's Encrypt / managed certificate). Редирект 80 → 443 обязателен.
- • HSTS: max-age=63072000; includeSubDomains; preload.
- • CSP: default-src 'self'; script-src 'self' 'nonce-XYZ'; style-src 'self' 'nonce-XYZ'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'.
- • Referrer-Policy: strict-origin-when-cross-origin; X-Content-Type-Options: nosniff; X-Frame-Options: DENY; Permissions-Policy — по минимуму.
- • Helmet/secure-headers middleware на backend плюс заголовки на reverse-proxy — двойная линия (если одно из звеньев пропустит, второе подстрахует).
- B.11 Аудит и observability
- • Таблица auth_events: user_id, email_hash, ip, user_agent, event, ts, meta jsonb. События: login_success, login_failure, refresh_success, refresh_reuse_detected, logout, logout_all, password_change, mfa_enroll, mfa_verify_success/failure, account_locked, password_reset_requested/completed, role_changed.
- • Таблица unauthorized_access_log: 401/403 с user_id, statusCode, method, path, ip, user_agent, error_message.
- • Логи в JSON (pino / winston / serilog), redaction: password, currentPassword, newPassword, authorization, cookie, token, refreshToken.
- • Экспорт в централизованное хранилище (ELK / Cloud Logging / Splunk / Loki). Алерты: refresh_reuse_detected (S1, потенциальный угон), всплески login_failure (S2), массовый password_reset_requested (S2).
- B.12 Секреты и инфраструктура
- • Секрет-менеджер (Vault / Lockbox / Secrets Manager) для: DB connection URL, JWT signing key (private + public), SMTP-пароль, CAPTCHA secret, OAuth client secrets.
- • KMS — для шифрования TOTP-секретов (envelope encryption); опционально — pepper-ключ для паролей.
- • Managed PostgreSQL / MySQL: TLS в коннекшен-строке обязательно (sslmode=verify-full + CA); сетевая изоляция (security groups / VPC / private subnet) — БД доступна только из подсети backend-сервиса.
- • Бэкапы БД с шифрованием at rest; PITR (point-in-time recovery) включено; хранение — в отдельном регионе.

• .env в .gitignore. На старте сервис проверяет: JWT signing key присутствует и валиден (длина / алгоритм); pepper-ключ (если используется) достаётся из KMS; TLS-коннект к БД установлен; обязательные переменные не дефолтные.
