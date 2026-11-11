// ============================================================================
// Platform: Commercial MikroTik Network & HotSpot Card Management System
// File: src/application/use-cases/admin/PermanentDeleteTenantUseCase.ts
// Use Case: Permanent Physical Delete of an Archived Tenant after Retention Period
// ============================================================================

import { PrismaClient } from '@prisma/client/wasm.js';
import { prisma as defaultPrisma } from '../../../infrastructure/database/prisma.js';

export interface PermanentDeleteTenantInput {
  tenantId: string;
  confirmName: string;
  adminUserId: string;
  adminTenantId?: string | undefined;
}

export class PermanentDeleteTenantException extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 400,
    public readonly errorCode: string = 'OPERATION_FAILED'
  ) {
    super(message);
    this.name = 'PermanentDeleteTenantException';
  }
}

export class PermanentDeleteTenantUseCase {
  constructor(
    private readonly prisma: PrismaClient = defaultPrisma
  ) {}

  async execute(input: PermanentDeleteTenantInput) {
    // 1. Feature flag guard: disabled by default unless ENABLE_PERMANENT_DELETE === 'true'
    if (process.env.ENABLE_PERMANENT_DELETE !== 'true') {
      throw new PermanentDeleteTenantException(
        'الحذف النهائي للحسابات معطل حالياً في إعدادات النظام (ENABLE_PERMANENT_DELETE)',
        403,
        'PERMANENT_DELETE_DISABLED'
      );
    }

    // 2. Fetch target tenant with owner and relational counts for audit summary
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: input.tenantId },
      include: {
        users: {
          where: { role: 'TENANT_ADMIN' },
          select: {
            id: true,
            username: true,
            fullName: true,
            email: true,
            phone: true,
          },
          orderBy: { createdAt: 'asc' },
          take: 1,
        },
        _count: {
          select: {
            users: true,
            routers: true,
            packages: true,
            cardBatches: true,
            cards: true,
            sales: true,
            sessions: true,
            subscriptionRequests: true,
          },
        },
      },
    });

    if (!tenant) {
      throw new PermanentDeleteTenantException(
        'الشركة أو الشبكة غير موجودة',
        404,
        'TENANT_NOT_FOUND'
      );
    }

    // 3. Protect platform and default tenants from permanent deletion
    if (tenant.slug === 'default' || tenant.slug === 'soft-zone-platform') {
      throw new PermanentDeleteTenantException(
        'لا يمكن الحذف النهائي لحساب المنصة الأساسي أو الافتراضي',
        403,
        'PROTECTED_TENANT'
      );
    }

    // 4. Require tenant to be in archive (soft-deleted) first
    if (!tenant.isDeleted || !tenant.deletedAt) {
      throw new PermanentDeleteTenantException(
        'لا يمكن تنفيذ الحذف النهائي إلا للحسابات الموجودة في الأرشيف',
        400,
        'TENANT_NOT_ARCHIVED'
      );
    }

    // 5. Enforce ARCHIVE_RETENTION_DAYS waiting period (default 30 days)
    const rawRetentionDays = process.env.ARCHIVE_RETENTION_DAYS !== undefined
      ? Number(process.env.ARCHIVE_RETENTION_DAYS)
      : 30;
    const retentionDays = Number.isNaN(rawRetentionDays) || rawRetentionDays < 0
      ? 30
      : rawRetentionDays;
    const retentionMs = retentionDays * 24 * 60 * 60 * 1000;
    const elapsedMs = Date.now() - tenant.deletedAt.getTime();

    if (elapsedMs < retentionMs) {
      const remainingHours = Math.ceil((retentionMs - elapsedMs) / (1000 * 60 * 60));
      throw new PermanentDeleteTenantException(
        `لا يمكن الحذف النهائي قبل انقضاء مدة الحفظ في الأرشيف (${retentionDays} يوم). المتبقي: ${remainingHours} ساعة`,
        400,
        'RETENTION_PERIOD_NOT_ELAPSED'
      );
    }

    // 6. Enforce exact literal confirmation of the network name
    if (typeof input.confirmName !== 'string' || input.confirmName !== tenant.name) {
      throw new PermanentDeleteTenantException(
        'اسم الشبكة التأكيدي غير مطابق لاسم الشبكة المطلوب حذفها حرفياً',
        400,
        'CONFIRM_NAME_MISMATCH'
      );
    }

    // 7. Resolve platform tenant ID to host the surviving AuditLog entry
    const adminUser = input.adminUserId
      ? await this.prisma.user.findUnique({
          where: { id: input.adminUserId },
          select: { id: true, tenantId: true },
        })
      : null;

    let auditTenantId: string | null = null;
    const candidateAdminTenantId = input.adminTenantId || adminUser?.tenantId;
    if (candidateAdminTenantId && candidateAdminTenantId !== tenant.id) {
      const candidateTenant = await this.prisma.tenant.findUnique({
        where: { id: candidateAdminTenantId },
        select: { id: true },
      });
      if (candidateTenant) {
        auditTenantId = candidateTenant.id;
      }
    }

    if (!auditTenantId) {
      const platformTenant = await this.prisma.tenant.findFirst({
        where: {
          slug: { in: ['soft-zone-platform', 'default'] },
          id: { not: tenant.id },
        },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      auditTenantId = platformTenant?.id ?? null;
    }

    const owner = tenant.users[0] ?? null;
    const deletedSummary = {
      tenantId: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      contactEmail: tenant.contactEmail,
      contactPhone: tenant.contactPhone,
      deletedAt: tenant.deletedAt.toISOString(),
      permanentlyDeletedAt: new Date().toISOString(),
      owner: owner
        ? {
            id: owner.id,
            username: owner.username,
            fullName: owner.fullName,
            email: owner.email,
            phone: owner.phone,
          }
        : null,
      counts: {
        users: tenant._count.users,
        routers: tenant._count.routers,
        packages: tenant._count.packages,
        cardBatches: tenant._count.cardBatches,
        cards: tenant._count.cards,
        sales: tenant._count.sales,
        sessions: tenant._count.sessions,
        subscriptionRequests: tenant._count.subscriptionRequests,
      },
    };

    const auditDescription = `حذف نهائي للشبكة المؤرشفة "${tenant.name}" (${tenant.slug}) ومالكها (${owner?.email ?? owner?.username ?? 'غير محدد'}) — المحذوفات: مستخدمين=${tenant._count.users}، راوترات=${tenant._count.routers}، باقات=${tenant._count.packages}، دفعات=${tenant._count.cardBatches}، كروت=${tenant._count.cards}، مبيعات=${tenant._count.sales}`;

    // TODO: When migrating file uploads (user avatars in uploads/avatars and subscription receipts
    // in uploads/receipts) from ephemeral serverless storage (Vercel) to persistent object storage
    // (S3/R2), collect associated file URLs before transaction and delete physical objects after commit.

    // 8. Execute physical deletion in reverse dependency order inside a single transaction
    let auditLogId: string | null = null;
    await this.prisma.$transaction(async (tx) => {
      // 8.1 SaleItem (has onDelete: Restrict to Card)
      await tx.saleItem.deleteMany({
        where: {
          OR: [
            { sale: { tenantId: tenant.id } },
            { card: { tenantId: tenant.id } },
          ],
        },
      });

      // 8.2 Sale (has onDelete: Restrict to User.soldById)
      await tx.sale.deleteMany({
        where: { tenantId: tenant.id },
      });

      // 8.3 Session
      await tx.session.deleteMany({
        where: { tenantId: tenant.id },
      });

      // 8.4 Card (has onDelete: Restrict to Package)
      await tx.card.deleteMany({
        where: { tenantId: tenant.id },
      });

      // 8.5 CardBatch (has onDelete: Restrict to Package & User.createdById)
      await tx.cardBatch.deleteMany({
        where: { tenantId: tenant.id },
      });

      // 8.6 Package
      await tx.package.deleteMany({
        where: { tenantId: tenant.id },
      });

      // 8.7 RouterCredentials & Router
      await tx.routerCredentials.deleteMany({
        where: { router: { tenantId: tenant.id } },
      });
      await tx.router.deleteMany({
        where: { tenantId: tenant.id },
      });

      // 8.8 SubscriptionRequest
      await tx.subscriptionRequest.deleteMany({
        where: { tenantId: tenant.id },
      });

      // 8.9 User-dependent security & notification tables
      await tx.notificationRead.deleteMany({
        where: { user: { tenantId: tenant.id } },
      });
      await tx.passwordResetOtp.deleteMany({
        where: { user: { tenantId: tenant.id } },
      });
      await tx.loginOtp.deleteMany({
        where: { user: { tenantId: tenant.id } },
      });
      await tx.trustedDevice.deleteMany({
        where: { user: { tenantId: tenant.id } },
      });

      // 8.10 Tenant notifications & tenant's own audit logs
      await tx.notification.deleteMany({
        where: { tenantId: tenant.id },
      });
      await tx.auditLog.deleteMany({
        where: { tenantId: tenant.id },
      });

      // 8.11 Detach any license codes redeemed by this tenant
      await tx.licenseCode.updateMany({
        where: { usedByTenantId: tenant.id },
        data: { usedByTenantId: null },
      });

      // 8.12 Users of the tenant
      await tx.user.deleteMany({
        where: { tenantId: tenant.id },
      });

      // 8.13 Tenant row itself
      await tx.tenant.delete({
        where: { id: tenant.id },
      });

      // 8.14 Persist permanent deletion audit log under the platform tenant
      if (auditTenantId) {
        const createdLog = await tx.auditLog.create({
          data: {
            tenantId: auditTenantId,
            userId: adminUser?.id ?? null,
            action: 'DELETE',
            entityType: 'Tenant',
            entityId: tenant.id,
            description: auditDescription,
            metadata: deletedSummary as any,
            result: 'SUCCESS',
          },
        });
        auditLogId = createdLog.id;
      }
    });

    return {
      success: true,
      deletedTenantId: tenant.id,
      deletedTenantName: tenant.name,
      auditTenantId,
      auditLogId,
      summary: deletedSummary,
      message: `تم الحذف النهائي للشبكة "${tenant.name}" وجميع بياناتها المرتبطة وتحرير البريد الإلكتروني واسم المستخدم بنجاح`,
    };
  }
}
