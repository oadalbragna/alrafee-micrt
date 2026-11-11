// ============================================================================
// Platform: Commercial MikroTik Network & HotSpot Card Management System
// File: src/application/use-cases/auth/LoginUseCase.ts
// Application Use Case: User Authentication & JWT Issuance (Rule 14, Rule 19)
// ============================================================================

import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { IUserRepository } from '../../interfaces/IUserRepository.js';
import { IAuditLogger } from '../../interfaces/IAuditLogger.js';
import { verifyPassword } from '../../../infrastructure/security/password.js';
import { signToken, signTempToken } from '../../../infrastructure/security/jwt.js';
import { PrismaClient } from '@prisma/client/wasm.js';
import { prisma as defaultPrisma } from '../../../infrastructure/database/prisma.js';
import { IEmailService, defaultEmailService } from '../../../infrastructure/email/EmailService.js';
import { InvalidCredentialsException } from '../../../domain/exceptions/InvalidCredentialsException.js';
import { InactiveUserException } from '../../../domain/exceptions/InactiveUserException.js';
import { PendingApprovalException } from '../../../domain/exceptions/PendingApprovalException.js';

export interface LoginInput {
  identifier?: string | undefined;
  username?: string | undefined;
  password: string;
  ip?: string | undefined;
  deviceFingerprint?: string | undefined;
  deviceLabel?: string | undefined;
}

export interface LoginOutput {
  token?: string | undefined;
  user?: {
    id: string;
    username: string;
    fullName: string;
    email?: string | null | undefined;
    role: string;
    tenantId: string;
    networkName?: string | undefined;
  } | undefined;
  requiresDeviceVerification?: boolean | undefined;
  tempToken?: string | undefined;
  emailMasked?: string | undefined;
  message?: string | undefined;
}

export class LoginUseCase {
  constructor(
    private readonly userRepository: IUserRepository,
    private readonly auditLogger?: IAuditLogger,
    private readonly prisma: PrismaClient = defaultPrisma,
    private readonly emailService: IEmailService = defaultEmailService
  ) {}

  async execute(input: LoginInput): Promise<LoginOutput> {
    const rawIdentifier = input.identifier || input.username;
    const trimmedIdentifier = rawIdentifier?.trim();
    if (!trimmedIdentifier || !input.password) {
      throw new InvalidCredentialsException('بيانات الدخول غير صحيحة');
    }

    const user = typeof this.userRepository.findByIdentifier === 'function'
      ? await this.userRepository.findByIdentifier(trimmedIdentifier)
      : await this.userRepository.findByUsername(trimmedIdentifier);

    if (!user) {
      throw new InvalidCredentialsException('بيانات الدخول غير صحيحة');
    }

    // 1. Verify password FIRST before checking account or tenant status to prevent enumeration
    const isMatch = await verifyPassword(input.password, user.passwordHash);
    if (!isMatch) {
      if (this.auditLogger) {
        await this.auditLogger.log(
          user.tenantId,
          user.id,
          'LOGIN',
          'User',
          user.id,
          `Failed login attempt for user "${user.username}"`,
          'FAILURE'
        );
      }
      throw new InvalidCredentialsException('بيانات الدخول غير صحيحة');
    }

    // 2. Tenant-level archive, approval, and suspension lookup
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: user.tenantId },
    });

    if (tenant && tenant.isDeleted) {
      if (this.auditLogger) {
        await this.auditLogger.log(
          user.tenantId,
          user.id,
          'LOGIN',
          'User',
          user.id,
          `Login attempt for archived tenant "${tenant.name}" by user "${user.username}"`,
          'FAILURE'
        );
      }
      throw new InactiveUserException(
        'هذا الحساب غير نشط حالياً. للاستفسار أو طلب استعادة الحساب، يرجى التواصل مع فريق الدعم الفني.'
      );
    }

    // 3. User-level status enforcement
    if (user.status === 'INACTIVE' || user.status !== 'ACTIVE') {
      if (this.auditLogger) {
        await this.auditLogger.log(
          user.tenantId,
          user.id,
          'LOGIN',
          'User',
          user.id,
          `Login attempt for inactive user "${user.username}"`,
          'FAILURE'
        );
      }
      throw new InactiveUserException('هذا الحساب معطل، يرجى التواصل مع مسؤول النظام');
    }

    // 4. Tenant-level approval and suspension enforcement
    if (tenant) {
      if (tenant.approvalStatus === 'PENDING') {
        throw new PendingApprovalException('حسابك قيد المراجعة من الإدارة');
      }
      if (tenant.approvalStatus === 'REJECTED') {
        throw new InactiveUserException('تم رفض طلب تسجيل هذا الحساب من الإدارة');
      }
      if (tenant.subscriptionStatus === 'SUSPENDED') {
        throw new InactiveUserException('تم إيقاف هذا الحساب مؤقتاً، يرجى التواصل مع إدارة المنصة');
      }
    }

    // ------------------------------------------------------------------------
    // Device Fingerprint & Trust Verification (Security Rule 14)
    // ------------------------------------------------------------------------
    if (input.deviceFingerprint && input.deviceFingerprint.trim().length > 0) {
      const cleanFingerprint = input.deviceFingerprint.trim();
      const trustedDevice = await this.prisma.trustedDevice.findUnique({
        where: {
          userId_deviceFingerprint: {
            userId: user.id,
            deviceFingerprint: cleanFingerprint,
          },
        },
      });

      if (trustedDevice) {
        // Known trusted device: update lastUsedAt and proceed with normal login
        await this.prisma.trustedDevice.update({
          where: { id: trustedDevice.id },
          data: {
            lastUsedAt: new Date(),
            deviceLabel: input.deviceLabel ?? trustedDevice.deviceLabel,
          },
        });
      } else {
        // Untrusted / new device: verify whether email delivery is available
        const isEmailConfigured = typeof this.emailService.isConfigured === 'function'
          ? this.emailService.isConfigured()
          : (process.env.NODE_ENV === 'test' || Boolean(process.env.SMTP_USER?.trim() && process.env.SMTP_APP_PASSWORD?.trim()));

        let emailSent = false;
        const otpCode = crypto.randomInt(100000, 1000000).toString();

        if (user.email && isEmailConfigured) {
          const otpHash = await bcrypt.hash(otpCode, 10);
          const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

          await this.prisma.loginOtp.create({
            data: {
              userId: user.id,
              otpHash,
              expiresAt,
              used: false,
            },
          });

          try {
            emailSent = await this.emailService.sendDeviceVerificationOtpEmail(
              user.email,
              otpCode,
              input.deviceLabel
            );
          } catch (emailErr) {
            console.error('[LoginUseCase] Failed to send device verification email:', emailErr);
            emailSent = false;
          }
        }

        if (emailSent) {
          const tempToken = signTempToken({
            userId: user.id,
            tenantId: user.tenantId,
          });

          const maskEmail = (email?: string | null): string => {
            if (!email || !email.includes('@')) return 'بريدك الإلكتروني المسجل';
            const parts = email.split('@');
            const local = parts[0] || '';
            const domain = parts[1] || '';
            const maskedLocal = local.length <= 2 ? `${local}***` : `${local[0]}***${local[local.length - 1]}`;
            return `${maskedLocal}@${domain}`;
          };

          return {
            requiresDeviceVerification: true,
            tempToken,
            emailMasked: maskEmail(user.email),
            message: 'تم إرسال كود تحقق لبريدك لأن هذا جهاز جديد',
          };
        }

        // Fallback: When email is not configured, delivery fails, or user has no email,
        // do not block or trap the authenticated user in an impossible OTP challenge.
        // Auto-trust the device upon verified password, record security audit log, and proceed to issue token.
        await this.prisma.trustedDevice.upsert({
          where: {
            userId_deviceFingerprint: {
              userId: user.id,
              deviceFingerprint: cleanFingerprint,
            },
          },
          create: {
            userId: user.id,
            deviceFingerprint: cleanFingerprint,
            deviceLabel: input.deviceLabel ?? null,
            lastUsedAt: new Date(),
          },
          update: {
            lastUsedAt: new Date(),
            ...(input.deviceLabel ? { deviceLabel: input.deviceLabel } : {}),
          },
        });

        if (this.auditLogger) {
          await this.auditLogger.log(
            user.tenantId,
            user.id,
            'LOGIN',
            'User',
            user.id,
            `Device "${cleanFingerprint}" trusted upon login (email OTP delivery unavailable)`,
            'SUCCESS'
          );
        }
      }
    }

    // Update last login details
    await this.userRepository.updateLastLogin(user.id, input.ip);

    // Generate 24h JWT token containing authenticated context
    const token = signToken({
      userId: user.id,
      tenantId: user.tenantId,
      role: user.role,
    });

    if (this.auditLogger) {
      await this.auditLogger.log(
        user.tenantId,
        user.id,
        'LOGIN',
        'User',
        user.id,
        `User "${user.username}" (${user.role}) logged in successfully`,
        'SUCCESS'
      );
    }

    return {
      token,
      user: {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId,
        networkName: tenant?.name ?? user.tenantId,
      },
    };
  }
}
