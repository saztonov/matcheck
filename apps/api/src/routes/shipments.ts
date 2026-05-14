import type { FastifyInstance } from 'fastify';
import { and, desc, eq, gte, ne, or, sql as drSql } from 'drizzle-orm';
import { z } from 'zod';
import { asZod } from '../lib/fastify.js';
import {
  ErrorResponseSchema,
  ShipmentConflictResponseSchema,
  ShipmentKindSchema,
  ShipmentListResponseSchema,
  ShipmentSchema,
  ShipmentStatusCodeSchema,
  ShipmentUpsertSchema,
} from '@matcheck/contracts';
import {
  shipments,
  shipmentItems,
  shipmentPhotos,
  shipmentSources,
  statuses,
} from '../db/schema.js';
import { deleteObject } from '../domain/storage/s3.signer.js';
import { resolveStatusId as resolveStatusIdShared } from '../domain/statuses/lookup.js';
import { publishEvent } from './events.js';

const ListQuerySchema = z.object({
  status: ShipmentStatusCodeSchema.optional(),
  kind: ShipmentKindSchema.optional(),
  siteId: z.string().uuid().optional(),
  inspectorId: z.string().uuid().optional(),
  changedSince: z.string().datetime().optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

type StatusRow = typeof statuses.$inferSelect;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const resolveStatusId = (app: any, code: string) =>
  resolveStatusIdShared(app, 'shipment', code);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function buildShipmentDto(app: any, id: string) {
  const rows = await app.db
    .select({ s: shipments, st: statuses })
    .from(shipments)
    .innerJoin(statuses, eq(shipments.statusId, statuses.id))
    .where(eq(shipments.id, id))
    .limit(1);
  const r = rows[0] as { s: typeof shipments.$inferSelect; st: StatusRow } | undefined;
  if (!r) return null;
  const s = r.s;
  const st = r.st;
  const items: (typeof shipmentItems.$inferSelect)[] = await app.db
    .select()
    .from(shipmentItems)
    .where(eq(shipmentItems.shipmentId, id))
    .orderBy(shipmentItems.lineNo);
  const photos: (typeof shipmentPhotos.$inferSelect)[] = await app.db
    .select()
    .from(shipmentPhotos)
    .where(eq(shipmentPhotos.shipmentId, id));
  const sources: { sourceDocumentId: string }[] = await app.db
    .select({ sourceDocumentId: shipmentSources.sourceDocumentId })
    .from(shipmentSources)
    .where(eq(shipmentSources.shipmentId, id));
  return {
    id: s.id,
    status: {
      id: st.id,
      entityType: st.entityType,
      code: st.code,
      label: st.label,
      color: st.color,
      sortOrder: st.sortOrder,
    },
    kind: s.kind,
    siteId: s.siteId,
    receiverCounterpartyId: s.receiverCounterpartyId,
    destSiteId: s.destSiteId,
    vehiclePlate: s.vehiclePlate,
    driverName: s.driverName,
    shippedAt: s.shippedAt?.toISOString() ?? null,
    inspectorId: s.inspectorId,
    comment: s.comment,
    version: s.version,
    sourceDocumentIds: sources.map((x) => x.sourceDocumentId),
    items: items.map((i) => ({
      id: i.id,
      materialId: i.materialId,
      nameRaw: i.nameRaw,
      qtyPlanned: i.qtyPlanned,
      qtyActual: i.qtyActual,
      unit: i.unit,
      comment: i.comment,
      lineNo: i.lineNo,
      volumeM3: i.volumeM3,
      massKg: i.massKg,
      volumeConfidence: i.volumeConfidence as 'low' | 'medium' | 'high' | null,
      groupName: i.groupName,
    })),
    photos: photos.map((p) => ({
      id: p.id,
      kind: p.kind,
      s3Key: p.s3Key,
      thumbS3Key: p.thumbS3Key,
      contentHash: p.contentHash,
      takenAt: p.takenAt.toISOString(),
    })),
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

export async function shipmentRoutes(rawApp: FastifyInstance): Promise<void> {
  const app = asZod(rawApp);

  app.get(
    '/api/v1/shipments',
    {
      preHandler: [app.authenticate],
      schema: { querystring: ListQuerySchema, response: { 200: ShipmentListResponseSchema } },
    },
    async (req) => {
      const { status, kind, siteId, inspectorId, changedSince, limit, offset } = req.query;
      const filters = [];
      if (status) {
        const statusId = await resolveStatusId(app, status);
        filters.push(eq(shipments.statusId, statusId));
      }
      if (kind) filters.push(eq(shipments.kind, kind));
      if (siteId) filters.push(eq(shipments.siteId, siteId));
      if (req.user?.role === 'inspector_kpp') {
        filters.push(eq(shipments.inspectorId, req.user.id));
      } else if (inspectorId) {
        filters.push(eq(shipments.inspectorId, inspectorId));
      }
      if (!status && req.user?.role !== 'inspector_kpp' && req.user) {
        const draftId = await resolveStatusId(app, 'draft');
        filters.push(
          or(ne(shipments.statusId, draftId), eq(shipments.inspectorId, req.user.id))!,
        );
      }
      if (changedSince) filters.push(gte(shipments.updatedAt, new Date(changedSince)));
      const where = filters.length ? and(...filters) : undefined;

      const rows = await app.db
        .select({ id: shipments.id })
        .from(shipments)
        .where(where)
        .orderBy(desc(shipments.updatedAt))
        .limit(limit)
        .offset(offset);
      const [{ count } = { count: 0 }] = await app.db
        .select({ count: drSql<number>`count(*)::int` })
        .from(shipments)
        .where(where);

      const items = (await Promise.all(rows.map((r) => buildShipmentDto(app, r.id)))).filter(
        (x): x is NonNullable<typeof x> => x !== null,
      );
      return { items, total: count };
    },
  );

  app.get(
    '/api/v1/shipments/:id',
    {
      preHandler: [app.authenticate],
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: ShipmentSchema, 404: ErrorResponseSchema },
      },
    },
    async (req, reply) => {
      const dto = await buildShipmentDto(app, req.params.id);
      if (!dto) return reply.code(404).send({ error: 'not_found' });
      if (req.user?.role === 'inspector_kpp' && dto.inspectorId !== req.user.id) {
        return reply.code(404).send({ error: 'not_found' });
      }
      return dto;
    },
  );

  app.post(
    '/api/v1/shipments',
    {
      preHandler: [app.authenticate],
      schema: {
        body: ShipmentUpsertSchema,
        response: {
          200: ShipmentSchema,
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
          409: ShipmentConflictResponseSchema,
        },
      },
    },
    async (req, reply) => {
      const input = req.body;
      const inspectorId = req.user?.role === 'inspector_kpp' ? req.user.id : (req.user?.id ?? null);
      const statusId = await resolveStatusId(app, input.statusCode);

      // Дополнительная валидация согласованности kind ↔ receiver/destSite,
      // BD-CHECK даст более грубое сообщение — отдадим клиенту что-то понятное.
      const linksError = validateKindLinks(input);
      if (linksError) {
        return reply.code(400).send({ error: 'invalid_kind_links', message: linksError });
      }

      if (input.id) {
        const [existing] = await app.db
          .select()
          .from(shipments)
          .where(eq(shipments.id, input.id))
          .limit(1);
        if (!existing) {
          await createShipment(app, input, statusId, inspectorId);
        } else {
          if (input.baseVersion !== undefined && input.baseVersion !== existing.version) {
            const server = await buildShipmentDto(app, existing.id);
            return reply.code(409).send({
              error: 'conflict' as const,
              serverVersion: existing.version,
              server: server!,
            });
          }
          await updateShipment(app, existing.id, input, statusId);
        }
        const dto = await buildShipmentDto(app, input.id);
        if (!dto) return reply.code(404).send({ error: 'not_found' });
        publishEvent(app, { type: 'shipment_updated', id: dto.id, ts: new Date().toISOString() });
        return dto;
      }

      const created = await createShipment(app, input, statusId, inspectorId);
      const dto = await buildShipmentDto(app, created.id);
      if (!dto) throw new Error('Shipment missing after create');
      publishEvent(app, { type: 'shipment_updated', id: dto.id, ts: new Date().toISOString() });
      return dto;
    },
  );

  app.delete(
    '/api/v1/shipments/:id',
    {
      preHandler: [app.authenticate],
      schema: { params: z.object({ id: z.string().uuid() }) },
    },
    async (req, reply) => {
      const [existing] = await app.db
        .select()
        .from(shipments)
        .where(eq(shipments.id, req.params.id))
        .limit(1);
      if (!existing) return reply.code(404).send({ error: 'not_found' });

      const role = req.user?.role;
      const isOwner = existing.inspectorId === req.user?.id;
      if (role === 'inspector_kpp' && !isOwner) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      if (role !== 'admin' && role !== 'manager' && role !== 'inspector_kpp') {
        return reply.code(403).send({ error: 'forbidden' });
      }

      const photos = await app.db
        .select({ s3Key: shipmentPhotos.s3Key, thumbS3Key: shipmentPhotos.thumbS3Key })
        .from(shipmentPhotos)
        .where(eq(shipmentPhotos.shipmentId, req.params.id));
      for (const p of photos) {
        try {
          await deleteObject(p.s3Key);
          if (p.thumbS3Key) await deleteObject(p.thumbS3Key);
        } catch (err) {
          req.log.warn({ err, s3Key: p.s3Key }, 'failed to delete s3 object');
        }
      }

      await app.db.delete(shipments).where(eq(shipments.id, req.params.id));
      publishEvent(app, {
        type: 'shipment_deleted',
        id: req.params.id,
        ts: new Date().toISOString(),
      });
      return { ok: true };
    },
  );
}

function validateKindLinks(input: z.infer<typeof ShipmentUpsertSchema>): string | null {
  const { kind, receiverCounterpartyId, destSiteId, siteId } = input;
  if (kind === 'contractor' || kind === 'return') {
    if (!receiverCounterpartyId) return 'Для отгрузки этого типа нужен получатель';
    if (destSiteId) return 'destSiteId допустим только для перемещения';
    return null;
  }
  if (kind === 'transfer') {
    if (!destSiteId) return 'Для перемещения нужен объект-получатель';
    if (destSiteId === siteId) return 'Объект-получатель не может совпадать с источником';
    if (receiverCounterpartyId) return 'Контрагент-получатель не указывается при перемещении';
    return null;
  }
  // writeoff
  if (receiverCounterpartyId || destSiteId) return 'Для списания получатель не указывается';
  return null;
}

async function createShipment(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app: any,
  input: z.infer<typeof ShipmentUpsertSchema>,
  statusId: string,
  inspectorId: string | null,
) {
  const [created] = await app.db
    .insert(shipments)
    .values({
      id: input.id,
      statusId,
      kind: input.kind,
      siteId: input.siteId,
      receiverCounterpartyId: input.receiverCounterpartyId ?? null,
      destSiteId: input.destSiteId ?? null,
      vehiclePlate: input.vehiclePlate ?? null,
      driverName: input.driverName ?? null,
      shippedAt: input.shippedAt ? new Date(input.shippedAt) : null,
      inspectorId,
      comment: input.comment ?? null,
      version: 1,
    })
    .returning();
  if (!created) throw new Error('Failed to insert shipment');
  if (input.items.length) {
    await app.db.insert(shipmentItems).values(
      input.items.map((i) => ({
        shipmentId: created.id,
        materialId: i.materialId ?? null,
        nameRaw: i.nameRaw,
        qtyPlanned: i.qtyPlanned ?? null,
        qtyActual: i.qtyActual ?? null,
        unit: i.unit,
        comment: i.comment ?? null,
        lineNo: i.lineNo,
        volumeM3: i.volumeM3 ?? null,
        massKg: i.massKg ?? null,
        volumeConfidence: i.volumeConfidence ?? null,
        groupName: i.groupName ?? null,
      })),
    );
  }
  if (input.sourceDocumentIds.length) {
    await app.db
      .insert(shipmentSources)
      .values(
        input.sourceDocumentIds.map((sid) => ({ shipmentId: created.id, sourceDocumentId: sid })),
      );
  }
  return created;
}

async function updateShipment(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app: any,
  id: string,
  input: z.infer<typeof ShipmentUpsertSchema>,
  statusId: string,
) {
  await app.db
    .update(shipments)
    .set({
      statusId,
      kind: input.kind,
      siteId: input.siteId,
      receiverCounterpartyId: input.receiverCounterpartyId ?? null,
      destSiteId: input.destSiteId ?? null,
      vehiclePlate: input.vehiclePlate ?? null,
      driverName: input.driverName ?? null,
      shippedAt: input.shippedAt ? new Date(input.shippedAt) : null,
      comment: input.comment ?? null,
      version: drSql`${shipments.version} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(shipments.id, id));
  await app.db.delete(shipmentItems).where(eq(shipmentItems.shipmentId, id));
  if (input.items.length) {
    await app.db.insert(shipmentItems).values(
      input.items.map((i) => ({
        shipmentId: id,
        materialId: i.materialId ?? null,
        nameRaw: i.nameRaw,
        qtyPlanned: i.qtyPlanned ?? null,
        qtyActual: i.qtyActual ?? null,
        unit: i.unit,
        comment: i.comment ?? null,
        lineNo: i.lineNo,
        volumeM3: i.volumeM3 ?? null,
        massKg: i.massKg ?? null,
        volumeConfidence: i.volumeConfidence ?? null,
        groupName: i.groupName ?? null,
      })),
    );
  }
  await app.db.delete(shipmentSources).where(eq(shipmentSources.shipmentId, id));
  if (input.sourceDocumentIds.length) {
    await app.db
      .insert(shipmentSources)
      .values(input.sourceDocumentIds.map((sid) => ({ shipmentId: id, sourceDocumentId: sid })));
  }
}
