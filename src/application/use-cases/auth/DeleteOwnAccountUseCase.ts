// ============================================================================
// Platform: Commercial MikroTik Network & HotSpot Card Management System
// File: src/application/use-cases/auth/DeleteOwnAccountUseCase.ts
// Application Use Case: Self-Service Account Deletion / Archiving (Google Play Policy)
// ============================================================================

import { PrismaClient } from '@prisma/client/wasm.js';
import { prisma as defaultPrisma } from '../../../infrastructure/database/prisma.js';
import { IAuditLogger } from '../../interfaces/IAuditLogger.js';
import { defaultAuditLogger } from '../../../infrastructure/logging/AuditLogger.js';
import { verifyPassword } from '../../../infrastructure/security/password.js';
import { InvalidCredentialsException } from '../../../domain/exceptions/InvalidCredentialsException.js';

export interface DeleteOwnAccountInput {
  userId: string;
  tenantId: string;
  role: string;
  password: string;
}

export class ForbiddenAccountDeletionException extends Error {
  constructor(
    message: string,
    public readonly errorCode: string = 'FORBIDDEN'
  ) {
    super(message);
    this.name = 'ForbiddenAccountDeletionException';
  }
}

export class DeleteOwnAccountUseCase {
  constructor(
    private readonly prisma: PrismaClient = defaultPrisma,
    private readonly auditLogger: IAuditLogger = defaultAuditLogger
  ) {}

  async execute(input: DeleteOwnAccountInput) {
    // 1. SUPER_ADMIN is strictly forbidden from self-deletion
    if (input.role === 'SUPER_ADMIN') {
      throw new ForbiddenAccountDeletionException(
        'لا يُسمح بحذف حساب مدير المنصة العام (SUPER_ADMIN)',
        'SUPER_ADMIN_DELETION_FORBIDDEN'
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: input.userId },
    });

    if (!user) {
      throw new InvalidCredentialsException('بيانات الدخول غير صحيحة');
    }

    if (user.role === 'SUPER_ADMIN') {
      throw new ForbiddenAccountDeletionException(
        'لا يُسمح بحذف حساب مدير المنصة العام (SUPER_ADMIN)',
        'SUPER_ADMIN_DELETION_FORBIDDEN'
      );
    }

    // 2. Verify current user's password
    const isMatch = await verifyPassword(input.password, user.passwordHash);
    if (!isMatch) {
      if (this.auditLogger) {
        await this.auditLogger.log(
          user.tenantId,
          user.id,
          'DELETE',
          'User',
          user.id,
          `فشل طلب ذاتي لحذف الحساب للمستخدم "${user.username}" بسبب كلمة مرور خاطئة`,
          'FAILURE'
        );
      }
      throw new InvalidCredentialsException('كلمة المرور غير صحيحة');
    }

    // 3. TENANT_ADMIN archives their entire network/tenant with a self-request audit log
    if (user.role === 'TENANT_ADMIN') {
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: user.tenantId },
      });

      if (!tenant || tenant.isDeleted) {
        throw new Error('الشركة أو الشبكة غير موجودة أو مؤرشفة مسبقاً');
      }

      if (tenant.slug === 'default' || tenant.slug === 'soft-zone-platform') {
        throw new ForbiddenAccountDeletionException(
          'لا يمكن حذف الحساب الافتراضي للمنصة',
          'PROTECTED_TENANT'
        );
      }

      const previousStatus = tenant.subscriptionStatus !== 'SUSPENDED'
        ? tenant.subscriptionStatus
        : (tenant.previousSubscriptionStatus ?? 'ACTIVE');

      const updatedTenant = await this.prisma.tenant.update({
        where: { id: tenant.id },
        data: {
          isDeleted: true,
          deletedAt: new Date(),
          status: 'INACTIVE',
          previousSubscriptionStatus: previousStatus,
        },
      });

      if (this.auditLogger) {
        await this.auditLogger.log(
          tenant.id,
          user.id,
          'DELETE',
          'Tenant',
          tenant.id,
          `طلب ذاتي لحذف الحساب: تمت أرشفة الشبكة "${tenant.name}" بناءً على طلب مالك الحساب "${user.username}"`,
          'SUCCESS'
        );
      }

      return {
        success: true,
        scope: 'TENANT_ARCHIVED' as const,
        tenantId: updatedTenant.id,
        deletedAt: updatedTenant.deletedAt,
        message: 'تم استلام طلب حذف الحساب وأرشفة الشبكة بنجاح. يمكنك التواصل مع فريق الدعم الفني خلال فترة الحفظ لاستعادة الحساب.',
      };
    }

    // 4. Staff / Employee (OPERATOR, RESELLER, ACCOUNTANT): deactivate own user account only
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        status: 'INACTIVE',
      },
    });

    if (this.auditLogger) {
      await this.auditLogger.log(
        user.tenantId,
        user.id,
        'DELETE',
        'User',
        user.id,
        `طلب ذاتي لحذف الحساب: تم تعطيل حساب الموظف "${user.username}" (${user.role}) بناءً على طلبه`,
        'SUCCESS'
      );
    }

    return {
      success: true,
      scope: 'USER_DEACTIVATED' as const,
      userId: user.id,
      status: 'INACTIVE',
      message: 'تم تعطيل حسابك بنجاح بناءً على طلبك.',
    };
  }
}
