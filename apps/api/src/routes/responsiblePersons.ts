import type { FastifyInstance } from 'fastify';
import { and, eq, ilike, sql as drSql } from 'drizzle-orm';
import { z } from 'zod';
import { asZod } from '../lib/fastify.js';
import {
  ResponsiblePersonListResponseSchema,
  ResponsiblePersonSchema,
  ResponsiblePersonUpsertSchema,
  ErrorResponseSchema,
} from '@matcheck/contracts';
import { entityDeletions, responsiblePersons } from '../db/schema.js';

const ListQuerySchema = z.object({
  q: z.string().optional(),
  activeOnly: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().positive().max(500).default(100),
  offset: z.coerce.number().int().nonnegative().default(0),
});

function row(r: typeof responsiblePersons.$inferSelect) {
  return {
    id: r.id,
    fullName: r.fullName,
    phone: r.phone,
    position: r.position,
    isActive: r.isActive,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export async function responsiblePersonRoutes(rawApp: FastifyInstance): Promise<void> {
  const app = asZod(rawApp);

  app.get(
    '/api/v1/responsible-persons',
    {
      preHandler: [app.authenticate],
      schema: {
        querystring: ListQuerySchema,
        response: { 200: ResponsiblePersonListResponseSchema },
      },
    },
    async (req) => {
      const { q, activeOnly, limit, offset } = req.query;
      const filters = [];
      if (q) filters.push(ilike(responsiblePersons.fullName, `%${q}%`));
      if (activeOnly) filters.push(eq(responsiblePersons.isActive, true));
      const where = filters.length ? and(...filters) : undefined;

      const rows = await app.db
        .select()
        .from(responsiblePersons)
        .where(where)
        .orderBy(responsiblePersons.fullName)
        .limit(limit)
        .offset(offset);
      const [{ count } = { count: 0 }] = await app.db
        .select({ count: drSql<number>`count(*)::int` })
        .from(responsiblePersons)
        .where(where);
      return { items: rows.map(row), total: count };
    },
  );

  app.post(
    '/api/v1/responsible-persons',
    {
      preHandler: [app.authenticate, app.authorize('admin', 'manager')],
      schema: { body: ResponsiblePersonUpsertSchema, response: { 201: ResponsiblePersonSchema } },
    },
    async (req, reply) => {
      const [created] = await app.db.insert(responsiblePersons).values(req.body).returning();
      if (!created) throw new Error('insert failed');
      reply.code(201);
      return row(created);
    },
  );

  app.patch(
    '/api/v1/responsible-persons/:id',
    {
      preHandler: [app.authenticate, app.authorize('admin', 'manager')],
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: ResponsiblePersonUpsertSchema.partial(),
        response: { 200: ResponsiblePersonSchema, 404: ErrorResponseSchema },
      },
    },
    async (req, reply) => {
      const [updated] = await app.db
        .update(responsiblePersons)
        .set({ ...req.body, updatedAt: new Date() })
        .where(eq(responsiblePersons.id, req.params.id))
        .returning();
      if (!updated) return reply.code(404).send({ error: 'not_found' });
      return row(updated);
    },
  );

  app.delete(
    '/api/v1/responsible-persons/:id',
    {
      preHandler: [app.authenticate, app.authorize('admin')],
      schema: { params: z.object({ id: z.string().uuid() }) },
    },
    async (req, reply) => {
      // Hard-delete + запись в журнал hard-delete, чтобы офлайн-клиенты
      // удалили локальную копию через /sync.deletedIds.responsiblePersons.
      // siteId=null — это глобальный справочник, не привязан к объекту.
      const result = await app.db.transaction(async (tx) => {
        const deleted = await tx
          .delete(responsiblePersons)
          .where(eq(responsiblePersons.id, req.params.id))
          .returning({ id: responsiblePersons.id });
        if (deleted.length === 0) return null;
        await tx.insert(entityDeletions).values({
          entityType: 'responsible_person',
          entityId: req.params.id,
          siteId: null,
          deletedByUserId: req.user?.id ?? null,
        });
        return deleted[0];
      });
      if (!result) return reply.code(404).send({ error: 'not_found' });
      return { ok: true };
    },
  );
}
