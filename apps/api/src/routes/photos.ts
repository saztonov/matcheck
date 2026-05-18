import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { asZod } from '../lib/fastify.js';
import {
  PhotoDeleteResponseSchema,
  PhotoGetUrlResponseSchema,
  PhotoPresignRequestSchema,
  PhotoPresignResponseSchema,
  ErrorResponseSchema,
} from '@matcheck/contracts';
import { deliveries, deliveryPhotos, shipments, shipmentPhotos } from '../db/schema.js';
import { deleteObject, presign } from '../domain/storage/s3.signer.js';
import { publishEvent } from './events.js';

const URL_TTL = 300; // 5 min

type OperationKind = 'delivery' | 'shipment';

/**
 * Тонкая абстракция: для каждой стороны (delivery|shipment) фиксируем
 * нужную таблицу фото и проверку доступа owner-only для inspector_kpp.
 */
type PhotoTable = {
  kind: OperationKind;
  prefix: string;
  publishUpdated: (app: ReturnType<typeof asZod>, opId: string) => void;
};

const TABLES: Record<OperationKind, PhotoTable> = {
  delivery: {
    kind: 'delivery',
    prefix: 'photos',
    publishUpdated: (app, id) =>
      publishEvent(app, { type: 'delivery_updated', id, ts: new Date().toISOString() }),
  },
  shipment: {
    kind: 'shipment',
    prefix: 'shipment_photos',
    publishUpdated: (app, id) =>
      publishEvent(app, { type: 'shipment_updated', id, ts: new Date().toISOString() }),
  },
};

export async function photoRoutes(rawApp: FastifyInstance): Promise<void> {
  const app = asZod(rawApp);

  app.post(
    '/api/v1/photos/presign',
    {
      preHandler: [app.authenticate],
      schema: {
        body: PhotoPresignRequestSchema,
        response: {
          200: PhotoPresignResponseSchema,
          400: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
    },
    async (req, reply) => {
      const body = req.body;
      const operationKind: OperationKind = body.operationKind ?? 'delivery';
      const operationId = body.operationId ?? body.deliveryId;
      if (!operationId) {
        return reply
          .code(400)
          .send({ error: 'bad_request', message: 'operationId is required' });
      }

      if (operationKind === 'delivery') {
        const [d] = await app.db
          .select({
            id: deliveries.id,
            inspectorId: deliveries.inspectorId,
            pendingDeletionAt: deliveries.pendingDeletionAt,
          })
          .from(deliveries)
          .where(eq(deliveries.id, operationId))
          .limit(1);
        if (!d) return reply.code(404).send({ error: 'delivery_not_found' });
        if (req.user?.role === 'inspector_kpp' && d.inspectorId !== req.user.id) {
          return reply.code(403).send({ error: 'forbidden' });
        }
        // Помеченный на удаление документ — read-only.
        if (d.pendingDeletionAt !== null) {
          return reply.code(409).send({
            error: 'pending_deletion',
            message: 'Документ помечен на удаление — мутации фото запрещены',
          });
        }

        const [existing] = await app.db
          .select()
          .from(deliveryPhotos)
          .where(
            and(
              eq(deliveryPhotos.deliveryId, operationId),
              eq(deliveryPhotos.contentHash, body.contentHash),
            ),
          )
          .limit(1);
        if (existing) {
          const uploadUrl = await presign({
            method: 'PUT',
            key: existing.s3Key,
            expiresIn: URL_TTL,
            contentType: body.contentType,
          }).catch(() => '');
          return {
            photoId: existing.id,
            s3Key: existing.s3Key,
            thumbS3Key: existing.thumbS3Key,
            uploadUrl: uploadUrl || '',
            thumbUploadUrl: null,
            expiresIn: URL_TTL,
            alreadyExists: true,
          };
        }

        const photoId = crypto.randomUUID();
        const s3Key = `${TABLES.delivery.prefix}/${operationId}/${photoId}.jpg`;
        const thumbS3Key = body.thumbContentHash
          ? `${TABLES.delivery.prefix}/${operationId}/${photoId}-thumb.jpg`
          : null;
        const [created] = await app.db
          .insert(deliveryPhotos)
          .values({
            id: photoId,
            deliveryId: operationId,
            kind: body.kind,
            s3Key,
            thumbS3Key,
            contentHash: body.contentHash,
            idempotencyKey: body.idempotencyKey,
          })
          .returning();
        if (!created) throw new Error('Failed to insert photo');

        const { uploadUrl, thumbUploadUrl } = await presignBoth(
          app,
          s3Key,
          thumbS3Key,
          body.contentType,
        );
        TABLES.delivery.publishUpdated(app, operationId);
        return {
          photoId,
          s3Key,
          thumbS3Key,
          uploadUrl,
          thumbUploadUrl,
          expiresIn: URL_TTL,
          alreadyExists: false,
        };
      }

      // operationKind === 'shipment'
      const [s] = await app.db
        .select({
          id: shipments.id,
          inspectorId: shipments.inspectorId,
          pendingDeletionAt: shipments.pendingDeletionAt,
        })
        .from(shipments)
        .where(eq(shipments.id, operationId))
        .limit(1);
      if (!s) return reply.code(404).send({ error: 'shipment_not_found' });
      if (req.user?.role === 'inspector_kpp' && s.inspectorId !== req.user.id) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      if (s.pendingDeletionAt !== null) {
        return reply.code(409).send({
          error: 'pending_deletion',
          message: 'Документ помечен на удаление — мутации фото запрещены',
        });
      }

      const [existing] = await app.db
        .select()
        .from(shipmentPhotos)
        .where(
          and(
            eq(shipmentPhotos.shipmentId, operationId),
            eq(shipmentPhotos.contentHash, body.contentHash),
          ),
        )
        .limit(1);
      if (existing) {
        const uploadUrl = await presign({
          method: 'PUT',
          key: existing.s3Key,
          expiresIn: URL_TTL,
          contentType: body.contentType,
        }).catch(() => '');
        return {
          photoId: existing.id,
          s3Key: existing.s3Key,
          thumbS3Key: existing.thumbS3Key,
          uploadUrl: uploadUrl || '',
          thumbUploadUrl: null,
          expiresIn: URL_TTL,
          alreadyExists: true,
        };
      }

      const photoId = crypto.randomUUID();
      const s3Key = `${TABLES.shipment.prefix}/${operationId}/${photoId}.jpg`;
      const thumbS3Key = body.thumbContentHash
        ? `${TABLES.shipment.prefix}/${operationId}/${photoId}-thumb.jpg`
        : null;
      const [created] = await app.db
        .insert(shipmentPhotos)
        .values({
          id: photoId,
          shipmentId: operationId,
          kind: body.kind,
          s3Key,
          thumbS3Key,
          contentHash: body.contentHash,
          idempotencyKey: body.idempotencyKey,
        })
        .returning();
      if (!created) throw new Error('Failed to insert shipment photo');

      const { uploadUrl, thumbUploadUrl } = await presignBoth(
        app,
        s3Key,
        thumbS3Key,
        body.contentType,
      );
      TABLES.shipment.publishUpdated(app, operationId);
      return {
        photoId,
        s3Key,
        thumbS3Key,
        uploadUrl,
        thumbUploadUrl,
        expiresIn: URL_TTL,
        alreadyExists: false,
      };
    },
  );

  // Backward-compatible GET без operationKind в пути — ищем сначала в deliveryPhotos,
  // потом в shipmentPhotos.
  app.get(
    '/api/v1/photos/:id/url',
    {
      preHandler: [app.authenticate],
      schema: {
        params: z.object({ id: z.string().uuid() }),
        querystring: z.object({ thumb: z.coerce.boolean().default(false) }),
        response: {
          200: PhotoGetUrlResponseSchema,
          404: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (req, reply) => {
      const found = await findPhoto(app, req.params.id);
      if (!found) return reply.code(404).send({ error: 'not_found' });
      const key = req.query.thumb && found.thumbS3Key ? found.thumbS3Key : found.s3Key;
      try {
        const url = await presign({ method: 'GET', key, expiresIn: URL_TTL });
        return { url, expiresIn: URL_TTL };
      } catch {
        return reply.code(500).send({ error: 's3_unavailable', message: 'S3 not configured' });
      }
    },
  );

  app.delete(
    '/api/v1/photos/:id',
    {
      preHandler: [app.authenticate, app.authorize('admin')],
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: {
          200: PhotoDeleteResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
        },
      },
    },
    async (req, reply) => {
      const found = await findPhoto(app, req.params.id);
      if (!found) return reply.code(404).send({ error: 'not_found' });

      // Помеченный документ — read-only; удаление целиком идёт через DELETE /deliveries|shipments/:id.
      if (found.kind === 'delivery') {
        const [parent] = await app.db
          .select({ pendingDeletionAt: deliveries.pendingDeletionAt })
          .from(deliveries)
          .where(eq(deliveries.id, found.operationId))
          .limit(1);
        if (parent?.pendingDeletionAt !== null && parent?.pendingDeletionAt !== undefined) {
          return reply.code(409).send({
            error: 'pending_deletion',
            message: 'Документ помечен на удаление — мутации фото запрещены',
          });
        }
        await app.db.delete(deliveryPhotos).where(eq(deliveryPhotos.id, req.params.id));
      } else {
        const [parent] = await app.db
          .select({ pendingDeletionAt: shipments.pendingDeletionAt })
          .from(shipments)
          .where(eq(shipments.id, found.operationId))
          .limit(1);
        if (parent?.pendingDeletionAt !== null && parent?.pendingDeletionAt !== undefined) {
          return reply.code(409).send({
            error: 'pending_deletion',
            message: 'Документ помечен на удаление — мутации фото запрещены',
          });
        }
        await app.db.delete(shipmentPhotos).where(eq(shipmentPhotos.id, req.params.id));
      }
      await deleteObject(found.s3Key).catch((err) =>
        app.log.warn({ err, key: found.s3Key }, 's3 delete failed'),
      );
      if (found.thumbS3Key) {
        await deleteObject(found.thumbS3Key).catch((err) =>
          app.log.warn({ err, key: found.thumbS3Key }, 's3 thumb delete failed'),
        );
      }
      TABLES[found.kind].publishUpdated(app, found.operationId);
      return { ok: true as const };
    },
  );
}

async function presignBoth(
  app: ReturnType<typeof asZod>,
  s3Key: string,
  thumbS3Key: string | null,
  contentType: string,
): Promise<{ uploadUrl: string; thumbUploadUrl: string | null }> {
  let uploadUrl = '';
  let thumbUploadUrl: string | null = null;
  try {
    uploadUrl = await presign({ method: 'PUT', key: s3Key, expiresIn: URL_TTL, contentType });
    if (thumbS3Key) {
      thumbUploadUrl = await presign({
        method: 'PUT',
        key: thumbS3Key,
        expiresIn: URL_TTL,
        contentType,
      });
    }
  } catch (err) {
    app.log.warn({ err }, 'presign failed — returning empty URLs');
  }
  return { uploadUrl, thumbUploadUrl };
}

async function findPhoto(
  app: ReturnType<typeof asZod>,
  id: string,
): Promise<
  | { kind: OperationKind; operationId: string; s3Key: string; thumbS3Key: string | null }
  | null
> {
  const [d] = await app.db
    .select({
      s3Key: deliveryPhotos.s3Key,
      thumbS3Key: deliveryPhotos.thumbS3Key,
      operationId: deliveryPhotos.deliveryId,
    })
    .from(deliveryPhotos)
    .where(eq(deliveryPhotos.id, id))
    .limit(1);
  if (d)
    return {
      kind: 'delivery',
      operationId: d.operationId,
      s3Key: d.s3Key,
      thumbS3Key: d.thumbS3Key,
    };

  const [s] = await app.db
    .select({
      s3Key: shipmentPhotos.s3Key,
      thumbS3Key: shipmentPhotos.thumbS3Key,
      operationId: shipmentPhotos.shipmentId,
    })
    .from(shipmentPhotos)
    .where(eq(shipmentPhotos.id, id))
    .limit(1);
  if (s)
    return {
      kind: 'shipment',
      operationId: s.operationId,
      s3Key: s.s3Key,
      thumbS3Key: s.thumbS3Key,
    };

  return null;
}
