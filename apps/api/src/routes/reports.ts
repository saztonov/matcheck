import type { FastifyInstance } from 'fastify';
import { sql as drSql } from 'drizzle-orm';
import { z } from 'zod';
import { asZod } from '../lib/fastify.js';
import {
  IntakeJournalResponseSchema,
  ShipmentJournalResponseSchema,
  ShipmentKindSchema,
  StockBalanceResponseSchema,
} from '@matcheck/contracts';

const StockQuerySchema = z.object({
  siteId: z.string().uuid().optional(),
  materialId: z.string().uuid().optional(),
  q: z.string().optional(),
  date: z.string().datetime().optional(),
  limit: z.coerce.number().int().positive().max(500).default(200),
  offset: z.coerce.number().int().nonnegative().default(0),
});

const IntakeQuerySchema = z.object({
  siteId: z.string().uuid().optional(),
  q: z.string().optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  limit: z.coerce.number().int().positive().max(500).default(100),
  offset: z.coerce.number().int().nonnegative().default(0),
});

const ShipmentJournalQuerySchema = z.object({
  siteId: z.string().uuid().optional(),
  kind: ShipmentKindSchema.optional(),
  q: z.string().optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  limit: z.coerce.number().int().positive().max(500).default(100),
  offset: z.coerce.number().int().nonnegative().default(0),
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHIPMENT_KIND_RE = /^(contractor|return|transfer|writeoff)$/;
const ISO_TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function safeUuid(v: string | undefined): string | null {
  return v && UUID_RE.test(v) ? v : null;
}

function safeTimestamp(v: string | undefined): string | null {
  return v && ISO_TS_RE.test(v) ? v : null;
}

function safeKind(v: string | undefined): string | null {
  return v && SHIPMENT_KIND_RE.test(v) ? v : null;
}

function escapeLike(q: string): string {
  return q.replace(/'/g, "''").replace(/\\/g, '\\\\');
}

function maybeDateIso(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function maybeDocDate(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function execRows(app: any, sqlText: string): Promise<Record<string, unknown>[]> {
  const res = await app.db.execute(drSql.raw(sqlText));
  return (res as { rows?: Record<string, unknown>[] }).rows ?? (res as Record<string, unknown>[]);
}

export async function reportRoutes(rawApp: FastifyInstance): Promise<void> {
  const app = asZod(rawApp);

  // ─── Остатки на сейчас или на дату («На объекте») ──────────────────────
  app.get(
    '/api/v1/reports/stock',
    {
      preHandler: [app.authenticate],
      schema: { querystring: StockQuerySchema, response: { 200: StockBalanceResponseSchema } },
    },
    async (req) => {
      const { siteId, materialId, q, date, limit, offset } = req.query;
      const sId = safeUuid(siteId);
      const mId = safeUuid(materialId);
      const dateTs = safeTimestamp(date);

      // baseAgg вычисляет qty_in/qty_out/balance в разрезе material × site × unit.
      // Если задан date — пересчитываем на лету (фильтр по ts); иначе читаем готовый v_stock_balance.
      const baseAgg = dateTs
        ? `
          SELECT material_id, site_id, unit,
                 SUM(CASE WHEN direction =  1 THEN qty ELSE 0 END)::numeric(18,4) AS qty_in,
                 SUM(CASE WHEN direction = -1 THEN qty ELSE 0 END)::numeric(18,4) AS qty_out,
                 SUM(direction * qty)::numeric(18,4)                              AS balance
          FROM v_stock_movements
          WHERE ts <= '${dateTs}'::timestamptz AND material_id IS NOT NULL
          GROUP BY material_id, site_id, unit
          HAVING SUM(direction * qty) <> 0
        `
        : `SELECT material_id, site_id, unit, qty_in, qty_out, balance FROM v_stock_balance`;

      const filters: string[] = [];
      if (sId) filters.push(`b.site_id = '${sId}'::uuid`);
      if (mId) filters.push(`b.material_id = '${mId}'::uuid`);
      if (q) {
        const safeQ = escapeLike(q);
        filters.push(
          `(COALESCE(m.name, '') ILIKE '%${safeQ}%' OR COALESCE(m.code, '') ILIKE '%${safeQ}%')`,
        );
      }
      const whereSql = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

      const rows = await execRows(
        app,
        `
        WITH bal AS (${baseAgg})
        SELECT
          b.material_id AS "materialId",
          COALESCE(m.name, '— без материала —') AS "materialName",
          b.site_id   AS "siteId",
          si.code     AS "siteCode",
          si.name     AS "siteName",
          b.unit      AS "unit",
          b.qty_in::text  AS "qtyIn",
          b.qty_out::text AS "qtyOut",
          b.balance::text AS "balance"
        FROM bal b
        LEFT JOIN materials m ON m.id = b.material_id
        JOIN sites si        ON si.id = b.site_id
        ${whereSql}
        ORDER BY si.code, COALESCE(m.name, '— без материала —')
        LIMIT ${limit} OFFSET ${offset}
        `,
      );

      const totalRows = await execRows(
        app,
        `
        WITH bal AS (${baseAgg})
        SELECT count(*)::int AS count
        FROM bal b
        LEFT JOIN materials m ON m.id = b.material_id
        JOIN sites si        ON si.id = b.site_id
        ${whereSql}
        `,
      );

      return {
        items: rows.map((r) => ({
          materialId: (r.materialId as string | null) ?? null,
          materialName: String(r.materialName),
          siteId: String(r.siteId),
          siteCode: String(r.siteCode),
          siteName: String(r.siteName),
          unit: String(r.unit),
          qtyIn: String(r.qtyIn ?? '0'),
          qtyOut: String(r.qtyOut ?? '0'),
          balance: String(r.balance ?? '0'),
        })),
        total: Number(totalRows[0]?.count ?? 0),
      };
    },
  );

  // ─── Журнал «Поступление» ──────────────────────────────────────────────
  app.get(
    '/api/v1/reports/intake',
    {
      preHandler: [app.authenticate],
      schema: { querystring: IntakeQuerySchema, response: { 200: IntakeJournalResponseSchema } },
    },
    async (req) => {
      const { siteId, q, dateFrom, dateTo, limit, offset } = req.query;
      const sId = safeUuid(siteId);
      const from = safeTimestamp(dateFrom);
      const to = safeTimestamp(dateTo);

      const where: string[] = [`st.entity_type = 'delivery'`, `st.code = 'filled'`];
      if (sId) where.push(`d.site_id = '${sId}'::uuid`);
      if (from) where.push(`COALESCE(d.arrived_at, d.updated_at) >= '${from}'::timestamptz`);
      if (to) where.push(`COALESCE(d.arrived_at, d.updated_at) <= '${to}'::timestamptz`);
      if (q) {
        const safe = escapeLike(q);
        where.push(
          `(di.name_raw ILIKE '%${safe}%' OR COALESCE(m.name, '') ILIKE '%${safe}%' OR COALESCE(sup.name, '') ILIKE '%${safe}%')`,
        );
      }
      const whereSql = where.join(' AND ');

      const rows = await execRows(
        app,
        `
        SELECT
          di.id AS "itemId",
          d.id AS "deliveryId",
          d.arrived_at AS "arrivedAt",
          d.site_id AS "siteId",
          si.code AS "siteCode",
          si.name AS "siteName",
          di.material_id AS "materialId",
          COALESCE(m.name, di.name_raw) AS "materialName",
          COALESCE(di.qty_actual, di.qty_planned)::text AS "qty",
          di.unit AS "unit",
          d.supplier_id AS "supplierId",
          sup.name AS "supplierName",
          d.contractor_id AS "contractorId",
          con.name AS "contractorName",
          sd.doc_number AS "docNumber",
          sd.doc_date AS "docDate"
        FROM delivery_items di
        JOIN deliveries d ON d.id = di.delivery_id
        JOIN statuses st ON st.id = d.status_id
        JOIN sites si ON si.id = d.site_id
        LEFT JOIN materials m ON m.id = di.material_id
        LEFT JOIN counterparties sup ON sup.id = d.supplier_id
        LEFT JOIN counterparties con ON con.id = d.contractor_id
        LEFT JOIN LATERAL (
          SELECT sdoc.doc_number, sdoc.doc_date
          FROM delivery_sources ds
          JOIN source_documents sdoc ON sdoc.id = ds.source_document_id
          WHERE ds.delivery_id = d.id
          ORDER BY sdoc.doc_date DESC NULLS LAST
          LIMIT 1
        ) sd ON true
        WHERE ${whereSql}
        ORDER BY COALESCE(d.arrived_at, d.updated_at) DESC, di.line_no
        LIMIT ${limit} OFFSET ${offset}
        `,
      );

      const totalRows = await execRows(
        app,
        `
        SELECT count(*)::int AS count
        FROM delivery_items di
        JOIN deliveries d ON d.id = di.delivery_id
        JOIN statuses st ON st.id = d.status_id
        LEFT JOIN materials m ON m.id = di.material_id
        LEFT JOIN counterparties sup ON sup.id = d.supplier_id
        WHERE ${whereSql}
        `,
      );

      return {
        items: rows.map((r) => ({
          itemId: String(r.itemId),
          deliveryId: String(r.deliveryId),
          arrivedAt: maybeDateIso(r.arrivedAt),
          siteId: String(r.siteId),
          siteCode: String(r.siteCode),
          siteName: String(r.siteName),
          materialId: (r.materialId as string | null) ?? null,
          materialName: String(r.materialName),
          qty: r.qty === null || r.qty === undefined ? null : String(r.qty),
          unit: String(r.unit),
          supplierId: (r.supplierId as string | null) ?? null,
          supplierName: (r.supplierName as string | null) ?? null,
          contractorId: (r.contractorId as string | null) ?? null,
          contractorName: (r.contractorName as string | null) ?? null,
          docNumber: (r.docNumber as string | null) ?? null,
          docDate: maybeDocDate(r.docDate),
        })),
        total: Number(totalRows[0]?.count ?? 0),
      };
    },
  );

  // ─── Журнал «Отгрузка» ─────────────────────────────────────────────────
  app.get(
    '/api/v1/reports/shipment',
    {
      preHandler: [app.authenticate],
      schema: {
        querystring: ShipmentJournalQuerySchema,
        response: { 200: ShipmentJournalResponseSchema },
      },
    },
    async (req) => {
      const { siteId, kind, q, dateFrom, dateTo, limit, offset } = req.query;
      const sId = safeUuid(siteId);
      const k = safeKind(kind);
      const from = safeTimestamp(dateFrom);
      const to = safeTimestamp(dateTo);

      const where: string[] = [`st.entity_type = 'shipment'`, `st.code = 'shipped'`];
      if (sId) where.push(`s.site_id = '${sId}'::uuid`);
      if (k) where.push(`s.kind = '${k}'::shipment_kind`);
      if (from) where.push(`COALESCE(s.shipped_at, s.updated_at) >= '${from}'::timestamptz`);
      if (to) where.push(`COALESCE(s.shipped_at, s.updated_at) <= '${to}'::timestamptz`);
      if (q) {
        const safe = escapeLike(q);
        where.push(
          `(si2.name_raw ILIKE '%${safe}%' OR COALESCE(m.name, '') ILIKE '%${safe}%' OR COALESCE(rc.name, '') ILIKE '%${safe}%')`,
        );
      }
      const whereSql = where.join(' AND ');

      const rows = await execRows(
        app,
        `
        SELECT
          si2.id AS "itemId",
          s.id AS "shipmentId",
          s.shipped_at AS "shippedAt",
          s.kind AS "kind",
          s.site_id AS "siteId",
          so.code AS "siteCode",
          so.name AS "siteName",
          s.dest_site_id AS "destSiteId",
          ds.name AS "destSiteName",
          s.receiver_counterparty_id AS "receiverCounterpartyId",
          rc.name AS "receiverName",
          si2.material_id AS "materialId",
          COALESCE(m.name, si2.name_raw) AS "materialName",
          COALESCE(si2.qty_actual, si2.qty_planned)::text AS "qty",
          si2.unit AS "unit",
          sd.doc_number AS "docNumber",
          sd.doc_date AS "docDate"
        FROM shipment_items si2
        JOIN shipments s ON s.id = si2.shipment_id
        JOIN statuses st ON st.id = s.status_id
        JOIN sites so ON so.id = s.site_id
        LEFT JOIN sites ds ON ds.id = s.dest_site_id
        LEFT JOIN materials m ON m.id = si2.material_id
        LEFT JOIN counterparties rc ON rc.id = s.receiver_counterparty_id
        LEFT JOIN LATERAL (
          SELECT sdoc.doc_number, sdoc.doc_date
          FROM shipment_sources ss
          JOIN source_documents sdoc ON sdoc.id = ss.source_document_id
          WHERE ss.shipment_id = s.id
          ORDER BY sdoc.doc_date DESC NULLS LAST
          LIMIT 1
        ) sd ON true
        WHERE ${whereSql}
        ORDER BY COALESCE(s.shipped_at, s.updated_at) DESC, si2.line_no
        LIMIT ${limit} OFFSET ${offset}
        `,
      );

      const totalRows = await execRows(
        app,
        `
        SELECT count(*)::int AS count
        FROM shipment_items si2
        JOIN shipments s ON s.id = si2.shipment_id
        JOIN statuses st ON st.id = s.status_id
        LEFT JOIN materials m ON m.id = si2.material_id
        LEFT JOIN counterparties rc ON rc.id = s.receiver_counterparty_id
        WHERE ${whereSql}
        `,
      );

      return {
        items: rows.map((r) => ({
          itemId: String(r.itemId),
          shipmentId: String(r.shipmentId),
          shippedAt: maybeDateIso(r.shippedAt),
          kind: r.kind as 'contractor' | 'return' | 'transfer' | 'writeoff',
          siteId: String(r.siteId),
          siteCode: String(r.siteCode),
          siteName: String(r.siteName),
          destSiteId: (r.destSiteId as string | null) ?? null,
          destSiteName: (r.destSiteName as string | null) ?? null,
          receiverCounterpartyId: (r.receiverCounterpartyId as string | null) ?? null,
          receiverName: (r.receiverName as string | null) ?? null,
          materialId: (r.materialId as string | null) ?? null,
          materialName: String(r.materialName),
          qty: r.qty === null || r.qty === undefined ? null : String(r.qty),
          unit: String(r.unit),
          docNumber: (r.docNumber as string | null) ?? null,
          docDate: maybeDocDate(r.docDate),
        })),
        total: Number(totalRows[0]?.count ?? 0),
      };
    },
  );
}
