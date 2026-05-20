import { z } from 'zod';

export const StatusSchema = z.object({
  id: z.string().uuid(),
  entityType: z.string(),
  code: z.string(),
  label: z.string(),
  color: z.string().nullable(),
  sortOrder: z.number(),
});
export type Status = z.infer<typeof StatusSchema>;

export const StatusListResponseSchema = z.object({
  items: z.array(StatusSchema),
});
export type StatusListResponse = z.infer<typeof StatusListResponseSchema>;

/**
 * Допустимые коды статусов для приёмки.
 * Берутся из таблицы statuses (entity_type='delivery').
 *
 * `no_document` — приёмка создана инспектором на планшете без выбранной УПД
 * (документ ещё не подгрузили на портал). Диспетчер на портале затем
 * привязывает УПД вручную, и статус автоматически переходит в обычный.
 */
export const DeliveryStatusCodeSchema = z.enum([
  'no_document',
  'not_filled',
  'draft',
  'filled',
  'confirmed_mol',
]);
export type DeliveryStatusCode = z.infer<typeof DeliveryStatusCodeSchema>;

/**
 * Допустимые коды статусов для отгрузки (entity_type='shipment').
 */
export const ShipmentStatusCodeSchema = z.enum([
  'no_document',
  'not_filled',
  'draft',
  'shipped',
  'confirmed_mol',
]);
export type ShipmentStatusCode = z.infer<typeof ShipmentStatusCodeSchema>;
