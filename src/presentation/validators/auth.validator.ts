// ============================================================================
// Platform: Commercial MikroTik Network & HotSpot Card Management System
// File: src/presentation/validators/auth.validator.ts
// Request Validation: Authentication Payloads (Rule 19)
// ============================================================================

import { z } from 'zod';

export const loginSchema = z.object({
  identifier: z.string().min(1, 'اسم المستخدم أو البريد الإلكتروني مطلوب').optional(),
  username: z.string().min(1, 'اسم المستخدم مطلوب').optional(),
  password: z.string().min(1, 'كلمة المرور مطلوبة'),
  deviceFingerprint: z.string().optional(),
  deviceLabel: z.string().optional(),
}).refine((data) => Boolean(data.identifier || data.username), {
  message: 'اسم المستخدم أو البريد الإلكتروني مطلوب',
  path: ['identifier'],
});

export type LoginInputDto = z.infer<typeof loginSchema>;

export const verifyDeviceOtpSchema = z.object({
  tempToken: z.string().min(1, 'رمز التحقق المؤقت مطلوب'),
  otpCode: z.string().min(4, 'كود التحقق مطلوب').max(10, 'كود التحقق غير صالح'),
  deviceFingerprint: z.string().min(1, 'بصمة الجهاز مطلوبة'),
  deviceLabel: z.string().optional(),
});

export type VerifyDeviceOtpInputDto = z.infer<typeof verifyDeviceOtpSchema>;

export const forgotPasswordSchema = z.object({
  email: z.string().email('البريد الإلكتروني غير صالح'),
});

export type ForgotPasswordInputDto = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  email: z.string().email('البريد الإلكتروني غير صالح'),
  otpCode: z.string().length(6, 'كود التحقق يجب أن يتكون من 6 أرقام'),
  newPassword: z.string().min(8, 'كلمة المرور الجديدة يجب ألا تقل عن 8 أحرف'),
});

export type ResetPasswordInputDto = z.infer<typeof resetPasswordSchema>;

export const deleteAccountSchema = z.object({
  password: z.string().min(1, 'كلمة المرور مطلوبة لتأكيد حذف الحساب'),
});

export type DeleteAccountInputDto = z.infer<typeof deleteAccountSchema>;


