# matcheck

Портал автоматизации приёмки материалов.

- **Backend (`apps/api`):** Fastify + TypeScript + Drizzle ORM + PostgreSQL + Redis
- **Frontend (`apps/web`):** React 18 + Vite + Ant Design 5 + TanStack Query + Zustand + PWA (offline-first)
- **Shared (`packages/contracts`):** общие zod-схемы для DTO между BE и FE

Архитектурный план: [`C:/Users/Usr/.claude/plans/cryptic-crafting-simon.md`](../.claude/plans/cryptic-crafting-simon.md).

## Требования

- Node.js ≥ 22 (см. `.nvmrc`)
- pnpm ≥ 9

## Установка и запуск

```bash
pnpm install
pnpm dev          # запускает api + web параллельно
pnpm typecheck    # проверка типов во всех пакетах
pnpm lint
pnpm build        # сборка всех приложений
```

## Структура

```
matcheck/
├── apps/
│   ├── api/        # Fastify backend
│   └── web/        # React PWA
├── packages/
│   └── contracts/  # общие zod-схемы
└── infra/          # docker-compose, caddy (будет позже)
```
