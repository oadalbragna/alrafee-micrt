// ============================================================================
// Platform: Commercial MikroTik Network & HotSpot Card Management System
// File: src/application/use-cases/admin/RestoreTenantUseCase.ts
// Use Case: Restore Archived Tenant (Super Admin Only)
// ============================================================================

import { PrismaClient } from '@prisma/client/wasm.js';
import { prisma as defaultPrisma } from '../../../infrastructure/database/prisma.js';
import { IAuditLogger } from '../../interfaces/IAuditLogger.js';
import { defaultAuditLogger } from '../../../infrastructure/logging/AuditLogger.js';

export interface RestoreTenantInput {
  tenantId: string;
  adminUserId: string;
}

export class RestoreTenantUseCase {
  constructor(
    private readonly prisma: PrismaClient = defaultPrisma,
    private readonly auditLogger: IAuditLogger = defaultAuditLogger
  ) {}

  async execute(input: RestoreTenantInput) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: input.tenantId },
    });

    if (!tenant) {
      throw new Error('الشركة أو الشبكة غير موجودة');
    }

    if (!tenant.isDeleted) {
      throw new Error('هذا الحساب غير موجود في الأرشيف (نشط بالفعل)');
    }

    const now = new Date();
    let targetStatus =
      tenant.previousSubscriptionStatus ??
      (tenant.subscriptionStatus !== 'SUSPENDED' ? tenant.subscriptionStatus : 'ACTIVE');

    // If restoring to TRIAL, verify whether trial period has expired
    if (targetStatus === 'TRIAL' && tenant.trialEndsAt.getTime() <= now.getTime()) {
      targetStatus = 'EXPIRED';
    }

    // If restoring to ACTIVE, verify whether paid subscription has expired
    if (
      targetStatus === 'ACTIVE' &&
      tenant.subscriptionEndsAt &&
      tenant.subscriptionEndsAt.getTime() <= now.getTime()
    ) {
      targetStatus = 'EXPIRED';
    }

    const updated = await this.prisma.tenant.update({
      where: { id: input.tenantId },
      data: {
        isDeleted: false,
        deletedAt: null,
        status: 'ACTIVE',
        subscriptionStatus: targetStatus,
        previousSubscriptionStatus: null,
      },
    });

    if (this.auditLogger) {
      await this.auditLogger.log(
        tenant.id,
        input.adminUserId,
        'UPDATE',
        'Tenant',
        tenant.id,
        `تم استرجاع الشبكة "${tenant.name}" من الأرشيف وإعادة تفعيلها بحالة اشتراك (${targetStatus}) بواسطة مدير المنصة`,
        'SUCCESS'
      );
    }

    return {
      success: true,
      id: updated.id,
      name: updated.name,
      slug: updated.slug,
      isDeleted: updated.isDeleted,
      deletedAt: updated.deletedAt,
      status: updated.status,
      subscriptionStatus: updated.subscriptionStatus,
      message: `تم استرجاع الحساب من الأرشيف بنجاح بحالة اشتراك (${updated.subscriptionStatus})`,
    };
  }
}
