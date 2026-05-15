-- УПД-очередь: новые значения enum source_status.
--
-- PostgreSQL не разрешает использовать только что добавленное значение
-- enum в той же транзакции (см. ошибку 55P04 «unsafe use of new value»).
-- Drizzle migrator оборачивает каждую миграцию в одну транзакцию, поэтому
-- значения добавляются здесь, а все индексы/check'и/INSERT'ы, которые
-- ссылаются на новые значения — в следующей миграции 0016.

ALTER TYPE "source_status" ADD VALUE IF NOT EXISTS 'queued';
--> statement-breakpoint
ALTER TYPE "source_status" ADD VALUE IF NOT EXISTS 'processing';
--> statement-breakpoint
ALTER TYPE "source_status" ADD VALUE IF NOT EXISTS 'needs_resolution';
