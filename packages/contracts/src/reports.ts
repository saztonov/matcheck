import { z } from 'zod';
import { ShipmentKindSchema } from './shipments.js';

/**
 * Строка отчёта «На объекте» (остатки сейчас).
 */
export const StockBalanceRowSchema = z.object({
  materialId: z.string().uuid().nullable(),
  materialName: z.string(),
  siteId: z.string().uuid(),
  siteCode: z.string(),
  siteName: z.string(),
  unit: z.string(),
  qtyIn: z.string(),
  qtyOut: z.string(),
  balance: z.string(),
});
export type StockBalanceRow = z.infer<typeof StockBalanceRowSchema>;

export const StockBalanceResponseSchema = z.object({
  items: z.array(StockBalanceRowSchema),
  total: z.number(),
});
export type StockBalanceResponse = z.infer<typeof StockBalanceResponseSchema>;

/**
 * Строка журнала «Поступление».
 */
export const IntakeJournalRowSchema = z.object({
  itemId: z.string().uuid(),
  deliveryId: z.string().uuid(),
  arrivedAt: z.string().nullable(),
  siteId: z.string().uuid(),
  siteCode: z.string(),
  siteName: z.string(),
  materialId: z.string().uuid().nullable(),
  materialName: z.string(),
  qty: z.string().nullable(),
  unit: z.string(),
  supplierId: z.string().uuid().nullable(),
  supplierName: z.string().nullable(),
  contractorId: z.string().uuid().nullable(),
  contractorName: z.string().nullable(),
  docNumber: z.string().nullable(),
  docDate: z.string().nullable(),
});
export type IntakeJournalRow = z.infer<typeof IntakeJournalRowSchema>;

export const IntakeJournalResponseSchema = z.object({
  items: z.array(IntakeJournalRowSchema),
  total: z.number(),
});
export type IntakeJournalResponse = z.infer<typeof IntakeJournalResponseSchema>;

/**
 * Строка журнала «Отгрузка».
 */
export const ShipmentJournalRowSchema = z.object({
  itemId: z.string().uuid(),
  shipmentId: z.string().uuid(),
  shippedAt: z.string().nullable(),
  kind: ShipmentKindSchema,
  siteId: z.string().uuid(),
  siteCode: z.string(),
  siteName: z.string(),
  destSiteId: z.string().uuid().nullable(),
  destSiteName: z.string().nullable(),
  receiverCounterpartyId: z.string().uuid().nullable(),
  receiverName: z.string().nullable(),
  materialId: z.string().uuid().nullable(),
  materialName: z.string(),
  qty: z.string().nullable(),
  unit: z.string(),
  docNumber: z.string().nullable(),
  docDate: z.string().nullable(),
});
export type ShipmentJournalRow = z.infer<typeof ShipmentJournalRowSchema>;

export const ShipmentJournalResponseSchema = z.object({
  items: z.array(ShipmentJournalRowSchema),
  total: z.number(),
});
export type ShipmentJournalResponse = z.infer<typeof ShipmentJournalResponseSchema>;
