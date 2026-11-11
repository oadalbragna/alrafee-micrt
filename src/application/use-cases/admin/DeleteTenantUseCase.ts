// ============================================================================
// Platform: Commercial MikroTik Network & HotSpot Card Management System
// File: src/application/use-cases/admin/DeleteTenantUseCase.ts
// Use Case: Soft-Delete Tenant (Super Admin Only - Master Rule 30 No Physical Delete)
// ============================================================================

import { PrismaClient } from '@prisma/client/wasm.js';
import { prisma as defaultPrisma } from '../../../infrastructure/database/prisma.js';
import { IAuditLogger } from '../../interfaces/IAuditLogger.js';
import { defaultAuditLogger } from '../../../infrastructure/logging/AuditLogger.js';

export interface DeleteTenantInput {
  tenantId: string;
  adminUserId: string;
}

export class DeleteTenantUseCase {
  constructor(
    private readonly prisma: PrismaClient = defaultPrisma,
    private readonly auditLogger: IAuditLogger = defaultAuditLogger
  ) {}

  async execute(input: DeleteTenantInput) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: input.tenantId },
    });

    if (!tenant || tenant.isDeleted) {
      throw new Error('الشركة أو الشبكة غير موجودة أو محذوفة مسبقاً');
    }

    // Protect default and platform tenants from deletion
    if (tenant.slug === 'default' || tenant.slug === 'soft-zone-platform') {
      throw new Error('لا يمكن حذف الحساب الافتراضي للمنصة');
    }

    // Preserve current subscriptionStatus so restore can recover it
    const previousStatus = tenant.subscriptionStatus !== 'SUSPENDED'
      ? tenant.subscriptionStatus
      : (tenant.previousSubscriptionStatus ?? 'ACTIVE');

    // Soft delete (archive): sets isDeleted=true, deletedAt=now, status=INACTIVE, and saves previousSubscriptionStatus
    const updated = await this.prisma.tenant.update({
      where: { id: input.tenantId },
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
        input.adminUserId,
        'DELETE',
        'Tenant',
        tenant.id,
        `تم حذف وإخفاء الشبكة "${tenant.name}" منطقياً (Soft Delete) بواسطة مدير المنصة`,
        'SUCCESS'
      );
    }

    return {
      success: true,
      id: updated.id,
      name: updated.name,
      isDeleted: true,
      deletedAt: updated.deletedAt,
      message: 'تم إخفاء وحذف المستأجر بنجاح (حذف منطقي دون المساس بالبيانات المالية والتاريخية)',
    };
  }
}
