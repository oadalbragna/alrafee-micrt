// ============================================================================
// Platform: Commercial MikroTik Network & HotSpot Card Management System
// File: src/presentation/http/routes/auth.routes.ts
// Presentation Route: Authentication Endpoints (Rule 14, Rule 19)
// ============================================================================

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { loginSchema, forgotPasswordSchema, resetPasswordSchema, verifyDeviceOtpSchema, deleteAccountSchema } from '../../validators/auth.validator.js';
import { registerSchema } from '../../validators/register.validator.js';
import { LoginUseCase } from '../../../application/use-cases/auth/LoginUseCase.js';
import { VerifyDeviceOtpUseCase } from '../../../application/use-cases/auth/VerifyDeviceOtpUseCase.js';
import { RegisterTenantUseCase } from '../../../application/use-cases/auth/RegisterTenantUseCase.js';
import { RequestPasswordResetUseCase } from '../../../application/use-cases/auth/RequestPasswordResetUseCase.js';
import { ResetPasswordWithOtpUseCase } from '../../../application/use-cases/auth/ResetPasswordWithOtpUseCase.js';
import { DeleteOwnAccountUseCase, ForbiddenAccountDeletionException } from '../../../application/use-cases/auth/DeleteOwnAccountUseCase.js';
import { PrismaUserRepository } from '../../../infrastructure/database/repositories/PrismaUserRepository.js';
import { AuditLogger } from '../../../infrastructure/logging/AuditLogger.js';
import { InvalidCredentialsException } from '../../../domain/exceptions/InvalidCredentialsException.js';
import { InactiveUserException } from '../../../domain/exceptions/InactiveUserException.js';
import { PendingApprovalException } from '../../../domain/exceptions/PendingApprovalException.js';
import { ConflictException } from '../../../domain/exceptions/ConflictException.js';
import { InvalidOtpException } from '../../../domain/exceptions/OtpExceptions.js';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import { prisma } from '../../../infrastructure/database/prisma.js';
import { verifyTempToken } from '../../../infrastructure/security/jwt.js';
import { defaultEmailService } from '../../../infrastructure/email/EmailService.js';
import { hashPassword } from '../../../infrastructure/security/password.js';

export const authRoutes: FastifyPluginAsync = async (
  fastify: FastifyInstance
): Promise<void> => {
  const userRepository = new PrismaUserRepository();
  const auditLogger = new AuditLogger();
  const loginUseCase = new LoginUseCase(userRepository, auditLogger);
  const verifyDeviceOtpUseCase = new VerifyDeviceOtpUseCase(undefined, auditLogger);
  const registerTenantUseCase = new RegisterTenantUseCase(undefined, auditLogger);
  const requestPasswordResetUseCase = new RequestPasswordResetUseCase();
  const resetPasswordWithOtpUseCase = new ResetPasswordWithOtpUseCase(undefined, auditLogger);
  const deleteOwnAccountUseCase = new DeleteOwnAccountUseCase(undefined, auditLogger);

  // --------------------------------------------------------------------------
  // POST /api/v1/auth/login
  // --------------------------------------------------------------------------
  fastify.post('/login', async (request, reply) => {
    const parseResult = loginSchema.safeParse(request.body);

    if (!parseResult.success) {
      return reply.status(400).send({
        success: false,
        errorCode: 'VALIDATION_ERROR',
        errorMessage: 'بيانات تسجيل الدخول غير صالحة',
        details: parseResult.error.flatten().fieldErrors,
      });
    }

    try {
      const identifier = parseResult.data.identifier || parseResult.data.username || '';
      const result = await loginUseCase.execute({
        identifier,
        username: identifier,
        password: parseResult.data.password,
        deviceFingerprint: parseResult.data.deviceFingerprint,
        deviceLabel: parseResult.data.deviceLabel,
        ip: request.ip,
      });

      return reply.status(200).send({
        success: true,
        data: result,
      });
    } catch (err: any) {
      if (
        err instanceof PendingApprovalException ||
        err.name === 'PendingApprovalException' ||
        err.code === 'ACCOUNT_PENDING_APPROVAL' ||
        err.errorCode === 'ACCOUNT_PENDING_APPROVAL'
      ) {
        return reply.status(403).send({
          success: false,
          errorCode: 'ACCOUNT_PENDING_APPROVAL',
          errorMessage: err.message,
        });
      }

      if (err instanceof InactiveUserException || err.name === 'InactiveUserException') {
        return reply.status(403).send({
          success: false,
          errorCode: 'ACCOUNT_INACTIVE',
          errorMessage: err.message,
        });
      }

      if (err instanceof InvalidCredentialsException) {
        return reply.status(401).send({
          success: false,
          errorCode: 'INVALID_CREDENTIALS',
          errorMessage: err.message,
        });
      }

      fastify.log.error(err, 'Unexpected login error');
      return reply.status(500).send({
        success: false,
        errorCode: 'INTERNAL_ERROR',
        errorMessage: 'حدث خطأ داخلي أثناء تسجيل الدخول',
      });
    }
  });

  // --------------------------------------------------------------------------
  // POST /api/v1/auth/register
  // Public self-registration for new network/tenant & initial TENANT_ADMIN user
  // --------------------------------------------------------------------------
  fastify.post('/register', async (request, reply) => {
    const parseResult = registerSchema.safeParse(request.body);

    if (!parseResult.success) {
      return reply.status(400).send({
        success: false,
        errorCode: 'VALIDATION_ERROR',
        errorMessage: 'بيانات التسجيل غير صالحة',
        details: parseResult.error.flatten().fieldErrors,
      });
    }

    try {
      const result = await registerTenantUseCase.execute({
        networkName: parseResult.data.networkName,
        adminFullName: parseResult.data.adminFullName,
        username: parseResult.data.username,
        email: parseResult.data.email,
        password: parseResult.data.password,
        phone: parseResult.data.phone,
        ip: request.ip,
      });

      return reply.status(201).send({
        success: true,
        data: result,
      });
    } catch (err: any) {
      if (err instanceof ConflictException || err.name === 'ConflictException') {
        return reply.status(409).send({
          success: false,
          errorCode: err.errorCode || 'CONFLICT',
          errorMessage: err.message,
        });
      }

      fastify.log.error(err, 'Unexpected registration error');
      return reply.status(500).send({
        success: false,
        errorCode: 'INTERNAL_ERROR',
        errorMessage: 'حدث خطأ داخلي أثناء تسجيل الحساب',
      });
    }
  });

  // --------------------------------------------------------------------------
  // POST /api/v1/auth/forgot-password
  // Request Password Reset OTP via Email
  // --------------------------------------------------------------------------
  fastify.post('/forgot-password', async (request, reply) => {
    const parseResult = forgotPasswordSchema.safeParse(request.body);

    if (!parseResult.success) {
      return reply.status(400).send({
        success: false,
        errorCode: 'VALIDATION_ERROR',
        errorMessage: 'البريد الإلكتروني غير صالح',
        details: parseResult.error.flatten().fieldErrors,
      });
    }

    try {
      const result = await requestPasswordResetUseCase.execute({
        email: parseResult.data.email,
      });

      return reply.status(200).send({
        success: true,
        data: result,
      });
    } catch (err: any) {
      fastify.log.error(err, 'Unexpected forgot-password error');
      return reply.status(500).send({
        success: false,
        errorCode: 'INTERNAL_ERROR',
        errorMessage: 'حدث خطأ أثناء معالجة طلب استعادة كلمة المرور',
      });
    }
  });

  // --------------------------------------------------------------------------
  // POST /api/v1/auth/reset-password
  // Verify OTP and reset password
  // --------------------------------------------------------------------------
  fastify.post('/reset-password', async (request, reply) => {
    const parseResult = resetPasswordSchema.safeParse(request.body);

    if (!parseResult.success) {
      return reply.status(400).send({
        success: false,
        errorCode: 'VALIDATION_ERROR',
        errorMessage: 'بيانات إعادة تعيين كلمة المرور غير صالحة',
        details: parseResult.error.flatten().fieldErrors,
      });
    }

    try {
      const result = await resetPasswordWithOtpUseCase.execute({
        email: parseResult.data.email,
        otpCode: parseResult.data.otpCode,
        newPassword: parseResult.data.newPassword,
      });

      return reply.status(200).send({
        success: true,
        data: result,
      });
    } catch (err: any) {
      if (err instanceof InvalidOtpException || err.code === 'INVALID_OR_EXPIRED_OTP') {
        return reply.status(400).send({
          success: false,
          errorCode: 'INVALID_OR_EXPIRED_OTP',
          errorMessage: err.message,
        });
      }

      fastify.log.error(err, 'Unexpected reset-password error');
      return reply.status(500).send({
        success: false,
        errorCode: 'INTERNAL_ERROR',
        errorMessage: 'حدث خطأ أثناء إعادة تعيين كلمة المرور',
      });
    }
  });

  // --------------------------------------------------------------------------
  // POST /api/v1/auth/verify-device-otp
  // Verify OTP for new device login, register TrustedDevice, and issue JWT
  // --------------------------------------------------------------------------
  fastify.post('/verify-device-otp', async (request, reply) => {
    const parseResult = verifyDeviceOtpSchema.safeParse(request.body);

    if (!parseResult.success) {
      return reply.status(400).send({
        success: false,
        errorCode: 'VALIDATION_ERROR',
        errorMessage: 'بيانات تأكيد الجهاز غير صالحة',
        details: parseResult.error.flatten().fieldErrors,
      });
    }

    try {
      const result = await verifyDeviceOtpUseCase.execute({
        tempToken: parseResult.data.tempToken,
        otpCode: parseResult.data.otpCode,
        deviceFingerprint: parseResult.data.deviceFingerprint,
        deviceLabel: parseResult.data.deviceLabel,
        ip: request.ip,
        userAgent: (request.headers['user-agent'] as string) || undefined,
      });

      return reply.status(200).send({
        success: true,
        data: result,
      });
    } catch (err: any) {
      if (err instanceof InvalidOtpException || err.code === 'INVALID_OR_EXPIRED_OTP') {
        return reply.status(400).send({
          success: false,
          errorCode: 'INVALID_OR_EXPIRED_OTP',
          errorMessage: err.message,
        });
      }

      if (err instanceof InactiveUserException || err.name === 'InactiveUserException') {
        return reply.status(403).send({
          success: false,
          errorCode: 'ACCOUNT_INACTIVE',
          errorMessage: err.message,
        });
      }

      fastify.log.error(err, 'Unexpected verify-device-otp error');
      return reply.status(500).send({
        success: false,
        errorCode: 'INTERNAL_ERROR',
        errorMessage: 'حدث خطأ أثناء تأكيد الجهاز',
      });
    }
  });

  // --------------------------------------------------------------------------
  // POST /api/v1/auth/resend-device-otp
  // Resend OTP for new device login with 60-second cooldown rate limit
  // --------------------------------------------------------------------------
  fastify.post('/resend-device-otp', async (request, reply) => {
    const body = (request.body as any) || {};
    const { tempToken, deviceLabel } = body;

    if (!tempToken || typeof tempToken !== 'string') {
      return reply.status(400).send({
        success: false,
        errorCode: 'VALIDATION_ERROR',
        errorMessage: 'رمز الجلسة المؤقت مطلوب',
      });
    }

    let payload: any;
    try {
      payload = verifyTempToken(tempToken);
    } catch {
      return reply.status(401).send({
        success: false,
        errorCode: 'INVALID_TEMP_TOKEN',
        errorMessage: 'انتهت صلاحية الجلسة، يرجى إعادة تسجيل الدخول',
      });
    }

    try {
      const user = await prisma.user.findUnique({
        where: { id: payload.userId },
      });

      if (!user || user.status !== 'ACTIVE' || !user.email) {
        return reply.status(404).send({
          success: false,
          errorCode: 'USER_NOT_FOUND',
          errorMessage: 'تعذر العثور على المستخدم أو لا يوجد بريد إلكتروني مسجل',
        });
      }

      // 60-second cooldown rate limit
      const lastOtp = await prisma.loginOtp.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
      });

      if (lastOtp && Date.now() - lastOtp.createdAt.getTime() < 60 * 1000) {
        const remainingSeconds = Math.ceil((60 * 1000 - (Date.now() - lastOtp.createdAt.getTime())) / 1000);
        return reply.status(429).send({
          success: false,
          errorCode: 'RATE_LIMIT_EXCEEDED',
          errorMessage: `يرجى الانتظار ${remainingSeconds} ثانية قبل طلب رمز جديد`,
        });
      }

      // Invalidate previous unused OTPs for this user
      await prisma.loginOtp.updateMany({
        where: { userId: user.id, used: false },
        data: { used: true },
      });

      const otpCode = crypto.randomInt(100000, 1000000).toString();
      const otpHash = await hashPassword(otpCode);
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

      await prisma.loginOtp.create({
        data: {
          userId: user.id,
          otpHash,
          expiresAt,
          used: false,
        },
      });

      let emailSent = false;
      try {
        emailSent = await defaultEmailService.sendDeviceVerificationOtpEmail(
          user.email,
          otpCode,
          deviceLabel
        );
      } catch (emailErr) {
        fastify.log.error(emailErr, 'Failed to resend device verification email');
      }

      if (!emailSent && process.env.NODE_ENV !== 'test') {
        return reply.status(502).send({
          success: false,
          errorCode: 'EMAIL_DELIVERY_FAILED',
          errorMessage: 'فشل إرسال رمز التحقق إلى بريدك الإلكتروني. تأكد من إعدادات الخادم أو حاول لاحقاً',
        });
      }

      return reply.status(200).send({
        success: true,
        message: 'تم إرسال رمز تحقق جديد إلى بريدك الإلكتروني بنجاح',
      });
    } catch (err: any) {
      fastify.log.error(err, 'Unexpected resend-device-otp error');
      return reply.status(500).send({
        success: false,
        errorCode: 'INTERNAL_ERROR',
        errorMessage: 'حدث خطأ أثناء إعادة إرسال رمز التحقق',
      });
    }
  });

  // --------------------------------------------------------------------------
  // GET /api/v1/auth/me
  // Get current authenticated user profile
  // --------------------------------------------------------------------------
  fastify.get('/me', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const { userId } = request.user!;
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { tenant: { select: { name: true, slug: true } } },
      });

      if (!user) {
        return reply.status(404).send({
          success: false,
          errorCode: 'USER_NOT_FOUND',
          errorMessage: 'المستخدم غير موجود',
        });
      }

      return reply.status(200).send({
        success: true,
        data: {
          id: user.id,
          username: user.username,
          fullName: user.fullName,
          email: user.email,
          phone: user.phone,
          avatarUrl: user.avatarUrl,
          role: user.role,
          status: user.status,
          tenantId: user.tenantId,
          networkName: user.tenant?.name ?? 'الشبكة الافتراضية',
          tenantSlug: user.tenant?.slug ?? '',
        },
      });
    } catch (err: any) {
      fastify.log.error(err, 'Failed to fetch current user profile');
      return reply.status(500).send({
        success: false,
        errorCode: 'INTERNAL_ERROR',
        errorMessage: 'فشل جلب بيانات الملف الشخصي',
      });
    }
  });

  // --------------------------------------------------------------------------
  // AVATAR STORAGE UTILITIES
  // --------------------------------------------------------------------------
  const AVATAR_UPLOAD_DIR = path.resolve(process.cwd(), 'uploads/avatars');
  try {
    if (!fs.existsSync(AVATAR_UPLOAD_DIR)) {
      fs.mkdirSync(AVATAR_UPLOAD_DIR, { recursive: true });
    }
  } catch (_) {}

  const saveBase64Avatar = (userId: string, base64Input: string): { relativeUrl: string } => {
    let rawBase64 = base64Input.trim();
    let ext = 'jpg';
    const dataUriMatch = rawBase64.match(/^data:image\/([a-zA-Z0-9+.-]+);base64,(.+)$/s);
    if (dataUriMatch && dataUriMatch[1] && dataUriMatch[2]) {
      const rawType = dataUriMatch[1].toLowerCase();
      if (rawType.includes('png')) ext = 'png';
      else if (rawType.includes('webp')) ext = 'webp';
      else ext = 'jpg';
      rawBase64 = dataUriMatch[2].trim();
    }

    const buffer = Buffer.from(rawBase64, 'base64');
    if (buffer.length === 0) {
      throw new Error('بيانات الصورة فارغة أو تالفة');
    }
    if (buffer.length > 5 * 1024 * 1024) {
      throw new Error('حجم الصورة يتجاوز الحد المسموح به (5 ميجابايت)');
    }

    try {
      // Clean up previous avatars of this user to preserve disk space
      try {
        const existing = fs.readdirSync(AVATAR_UPLOAD_DIR);
        for (const file of existing) {
          if (file.startsWith(`avatar_${userId}_`)) {
            fs.unlinkSync(path.join(AVATAR_UPLOAD_DIR, file));
          }
        }
      } catch (_) {}

      const filename = `avatar_${userId}_${Date.now()}.${ext}`;
      const filePath = path.join(AVATAR_UPLOAD_DIR, filename);
      fs.writeFileSync(filePath, buffer);

      return { relativeUrl: `/api/v1/auth/avatar/${filename}` };
    } catch (_) {
      // Serverless / read-only filesystem fallback: return sanitized data URI directly
      return { relativeUrl: `data:image/${ext};base64,${rawBase64}` };
    }
  };

  // --------------------------------------------------------------------------
  // GET /api/v1/auth/avatar/:filename (Public static avatar streaming)
  // --------------------------------------------------------------------------
  fastify.get('/avatar/:filename', async (request: any, reply) => {
    const { filename } = request.params;
    const safeName = path.basename(filename);
    if (safeName !== filename || safeName.includes('..')) {
      return reply.status(400).send({
        success: false,
        errorCode: 'INVALID_FILENAME',
        errorMessage: 'اسم الملف غير صالح',
      });
    }

    const filePath = path.join(AVATAR_UPLOAD_DIR, safeName);
    if (!fs.existsSync(filePath)) {
      return reply.status(404).send({
        success: false,
        errorCode: 'AVATAR_NOT_FOUND',
        errorMessage: 'الصورة غير موجودة',
      });
    }

    const ext = path.extname(safeName).toLowerCase();
    let contentType = 'image/jpeg';
    if (ext === '.png') contentType = 'image/png';
    else if (ext === '.webp') contentType = 'image/webp';

    reply.type(contentType).header('Cache-Control', 'public, max-age=86400');
    return reply.send(fs.createReadStream(filePath));
  });

  // --------------------------------------------------------------------------
  // POST /api/v1/auth/profile/avatar
  // Upload authenticated user avatar (base64 image or direct URL)
  // --------------------------------------------------------------------------
  fastify.post('/profile/avatar', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const { userId } = request.user!;
      const body = (request.body as any) || {};
      const { imageBase64, avatarUrl } = body;

      let savedUrl: string | null = null;
      if (imageBase64 && typeof imageBase64 === 'string' && imageBase64.trim().length > 0) {
        const res = saveBase64Avatar(userId, imageBase64);
        savedUrl = res.relativeUrl;
      } else if (avatarUrl && typeof avatarUrl === 'string') {
        const trimmed = avatarUrl.trim();
        if (trimmed.length > 500) {
          return reply.status(400).send({
            success: false,
            errorCode: 'VALIDATION_ERROR',
            errorMessage: 'رابط الصورة طويل جداً',
          });
        }
        savedUrl = trimmed.length > 0 ? trimmed : null;
      } else {
        return reply.status(400).send({
          success: false,
          errorCode: 'VALIDATION_ERROR',
          errorMessage: 'يرجى تقديم بيانات الصورة بصيغة Base64 أو رابط صالح',
        });
      }

      const updated = await prisma.user.update({
        where: { id: userId },
        data: { avatarUrl: savedUrl },
        include: { tenant: { select: { name: true, slug: true } } },
      });

      return reply.status(200).send({
        success: true,
        data: {
          id: updated.id,
          username: updated.username,
          fullName: updated.fullName,
          email: updated.email,
          phone: updated.phone,
          avatarUrl: updated.avatarUrl,
          role: updated.role,
          status: updated.status,
          tenantId: updated.tenantId,
          networkName: updated.tenant?.name ?? 'الشبكة الافتراضية',
          tenantSlug: updated.tenant?.slug ?? '',
        },
        message: 'تم تحديث الصورة الشخصية بنجاح',
      });
    } catch (err: any) {
      fastify.log.error(err, 'Failed to upload user avatar');
      return reply.status(400).send({
        success: false,
        errorCode: 'AVATAR_UPLOAD_FAILED',
        errorMessage: err.message || 'فشل رفع الصورة الشخصية',
      });
    }
  });

  // --------------------------------------------------------------------------
  // PUT /api/v1/auth/profile
  // Update authenticated user profile details (fullName, phone, avatarUrl)
  // --------------------------------------------------------------------------
  fastify.put('/profile', { preHandler: authMiddleware }, async (request, reply) => {
    try {
      const { userId } = request.user!;
      const body = (request.body as any) || {};
      const { fullName, phone, avatarUrl } = body;

      const dataToUpdate: Record<string, any> = {};
      if (fullName !== undefined) {
        const trimmed = String(fullName).trim();
        if (trimmed.length < 2 || trimmed.length > 100) {
          return reply.status(400).send({
            success: false,
            errorCode: 'VALIDATION_ERROR',
            errorMessage: 'الاسم الكامل يجب أن يكون بين حرفين و 100 حرف',
          });
        }
        dataToUpdate.fullName = trimmed;
      }

      if (phone !== undefined) {
        dataToUpdate.phone = phone ? String(phone).trim() : null;
      }

      if (avatarUrl !== undefined) {
        const trimmedAvatar = avatarUrl ? String(avatarUrl).trim() : null;
        if (trimmedAvatar) {
          // If a base64 payload is provided directly to PUT /profile, persist it gracefully
          if (trimmedAvatar.startsWith('data:image/') || trimmedAvatar.length > 500) {
            try {
              const res = saveBase64Avatar(userId, trimmedAvatar);
              dataToUpdate.avatarUrl = res.relativeUrl;
            } catch (saveErr: any) {
              return reply.status(400).send({
                success: false,
                errorCode: 'VALIDATION_ERROR',
                errorMessage: saveErr.message || 'بيانات الصورة غير صالحة',
              });
            }
          } else {
            dataToUpdate.avatarUrl = trimmedAvatar;
          }
        } else {
          dataToUpdate.avatarUrl = null;
        }
      }

      const updated = await prisma.user.update({
        where: { id: userId },
        data: dataToUpdate,
        include: { tenant: { select: { name: true, slug: true } } },
      });

      return reply.status(200).send({
        success: true,
        data: {
          id: updated.id,
          username: updated.username,
          fullName: updated.fullName,
          email: updated.email,
          phone: updated.phone,
          avatarUrl: updated.avatarUrl,
          role: updated.role,
          status: updated.status,
          tenantId: updated.tenantId,
          networkName: updated.tenant?.name ?? 'الشبكة الافتراضية',
          tenantSlug: updated.tenant?.slug ?? '',
        },
        message: 'تم تحديث بيانات الملف الشخصي بنجاح',
      });
    } catch (err: any) {
      fastify.log.error(err, 'Failed to update user profile');
      return reply.status(500).send({
        success: false,
        errorCode: 'INTERNAL_ERROR',
        errorMessage: err.message || 'فشل تحديث بيانات الملف الشخصي',
      });
    }
  });

  // --------------------------------------------------------------------------
  // POST /api/v1/auth/delete-account
  // Self-service account deletion/archiving (requires password confirmation)
  // --------------------------------------------------------------------------
  fastify.post('/delete-account', { preHandler: authMiddleware }, async (request, reply) => {
    const parseResult = deleteAccountSchema.safeParse(request.body);

    if (!parseResult.success) {
      return reply.status(400).send({
        success: false,
        errorCode: 'VALIDATION_ERROR',
        errorMessage: 'يرجى إدخال كلمة المرور لتأكيد حذف الحساب',
        details: parseResult.error.flatten().fieldErrors,
      });
    }

    try {
      const { userId, tenantId, role } = request.user!;
      const result = await deleteOwnAccountUseCase.execute({
        userId,
        tenantId,
        role,
        password: parseResult.data.password,
      });

      return reply.status(200).send({
        success: true,
        data: result,
        message: result.message,
      });
    } catch (err: any) {
      if (err instanceof InvalidCredentialsException || err.name === 'InvalidCredentialsException') {
        return reply.status(401).send({
          success: false,
          errorCode: 'INVALID_CREDENTIALS',
          errorMessage: err.message,
        });
      }

      if (err instanceof ForbiddenAccountDeletionException || err.name === 'ForbiddenAccountDeletionException') {
        return reply.status(403).send({
          success: false,
          errorCode: err.errorCode || 'FORBIDDEN',
          errorMessage: err.message,
        });
      }

      fastify.log.error(err, 'Failed to process self-service account deletion');
      return reply.status(400).send({
        success: false,
        errorCode: 'OPERATION_FAILED',
        errorMessage: err.message || 'فشل تنفيذ طلب حذف الحساب',
      });
    }
  });
};

