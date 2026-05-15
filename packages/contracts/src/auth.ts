import { z } from 'zod';

export const UserRoleSchema = z.enum(['admin', 'manager', 'inspector_kpp']);
export type UserRole = z.infer<typeof UserRoleSchema>;

export const EmailSchema = z.string().email().max(254).toLowerCase().trim();
export const PasswordSchema = z.string().min(8).max(256);

export const LoginRequestSchema = z.object({
  email: EmailSchema,
  password: PasswordSchema,
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const RegisterRequestSchema = z.object({
  email: EmailSchema,
  password: PasswordSchema,
  fullName: z.string().min(1).max(200).optional(),
});
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

export const UserDtoSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  role: UserRoleSchema,
  isActive: z.boolean(),
  // Объект, привязанный к пользователю. Обязателен для inspector_kpp;
  // для admin/manager всегда null.
  siteId: z.string().uuid().nullable(),
  createdAt: z.string(),
});
export type UserDto = z.infer<typeof UserDtoSchema>;

export const UserAdminPatchSchema = z.object({
  role: UserRoleSchema.optional(),
  isActive: z.boolean().optional(),
  siteId: z.string().uuid().nullable().optional(),
});
export type UserAdminPatch = z.infer<typeof UserAdminPatchSchema>;

export const LoginResponseSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number(),
  user: UserDtoSchema,
  // Возвращаются только мобильным клиентам (X-Client-Type: mobile).
  // Веб использует HttpOnly-cookie и эти поля игнорирует.
  refreshToken: z.string().optional(),
  refreshExpiresIn: z.number().optional(),
});
export type LoginResponse = z.infer<typeof LoginResponseSchema>;

export const RefreshResponseSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number(),
  refreshToken: z.string().optional(),
  refreshExpiresIn: z.number().optional(),
});
export type RefreshResponse = z.infer<typeof RefreshResponseSchema>;

export const RegisterResponseSchema = z.object({
  ok: z.literal(true),
  user: UserDtoSchema,
});

export const ErrorResponseSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
  details: z.unknown().optional(),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
