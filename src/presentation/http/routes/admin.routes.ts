// ============================================================================
// Platform: Commercial MikroTik Network & HotSpot Card Management System
// File: src/presentation/http/routes/admin.routes.ts
// Presentation Route: Super Admin Management Endpoints (Rule 14, Rule 19, Rule 26, Rule 30)
// ============================================================================

import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import { requireSuperAdmin } from '../middlewares/requireSuperAdmin.js';
import {
  generateLicenseCodeSchema,
  adminActivateTenantSchema,
  updateUserRoleSchema,
  createSuperAdminSchema,
  createSubscriptionPlanSchema,
  updateSubscriptionPlanSchema,
  reviewSubscriptionRequestSchema,
  createPaymentMethodSchema,
  updatePaymentMethodSchema,
} from '../../validators/admin.validator.js';
import { prisma } from '../../../infrastructure/database/prisma.js';
import { defaultAuditLogger } from '../../../infrastructure/logging/AuditLogger.js';
import { GenerateLicenseCodeUseCase } from '../../../application/use-cases/admin/GenerateLicenseCodeUseCase.js';
import { ListTenantsUseCase } from '../../../application/use-cases/admin/ListTenantsUseCase.js';
import { ListLicenseCodesUseCase } from '../../../application/use-cases/admin/ListLicenseCodesUseCase.js';
import { ApproveTenantUseCase } from '../../../application/use-cases/admin/ApproveTenantUseCase.js';
import { RejectTenantUseCase } from '../../../application/use-cases/admin/RejectTenantUseCase.js';
import { SuspendTenantUseCase } from '../../../application/use-cases/admin/SuspendTenantUseCase.js';
import { ReactivateTenantUseCase } from '../../../application/use-cases/admin/ReactivateTenantUseCase.js';
import { DeleteTenantUseCase } from '../../../application/use-cases/admin/DeleteTenantUseCase.js';
import { ListArchivedTenantsUseCase } from '../../../application/use-cases/admin/ListArchivedTenantsUseCase.js';
import { RestoreTenantUseCase } from '../../../application/use-cases/admin/RestoreTenantUseCase.js';
import {
  PermanentDeleteTenantUseCase,
  PermanentDeleteTenantException,
} from '../../../application/use-cases/admin/PermanentDeleteTenantUseCase.js';
import { UpdateUserRoleUseCase } from '../../../application/use-cases/admin/UpdateUserRoleUseCase.js';
import { AdminActivateTenantUseCase } from '../../../application/use-cases/admin/AdminActivateTenantUseCase.js';
import { ListTenantUsersUseCase } from '../../../application/use-cases/admin/ListTenantUsersUseCase.js';
import { CreateSuperAdminUseCase } from '../../../application/use-cases/admin/CreateSuperAdminUseCase.js';
import { UpdatePlatformSettingsUseCase } from '../../../application/use-cases/settings/UpdatePlatformSettingsUseCase.js';
import { SendNotificationUseCase } from '../../../application/use-cases/notifications/SendNotificationUseCase.js';
import { ConflictException } from '../../../domain/exceptions/ConflictException.js';

export const adminRoutes: FastifyPluginAsync = async (
  fastify: FastifyInstance
): Promise<void> => {
  // 1. Authenticate user JWT
  fastify.addHook('preHandler', authMiddleware);

  // 2. Enforce SUPER_ADMIN role strictly on all /api/v1/admin/* routes
  fastify.addHook('preHandler', requireSuperAdmin);

  const generateLicenseCodeUseCase = new GenerateLicenseCodeUseCase();
  const listTenantsUseCase = new ListTenantsUseCase();
  const listLicenseCodesUseCase = new ListLicenseCodesUseCase();
  const approveTenantUseCase = new ApproveTenantUseCase();
  const rejectTenantUseCase = new RejectTenantUseCase();
  const suspendTenantUseCase = new SuspendTenantUseCase();
  const reactivateTenantUseCase = new ReactivateTenantUseCase();
  const deleteTenantUseCase = new DeleteTenantUseCase();
  const listArchivedTenantsUseCase = new ListArchivedTenantsUseCase();
  const restoreTenantUseCase = new RestoreTenantUseCase();
  const permanentDeleteTenantUseCase = new PermanentDeleteTenantUseCase();
  const updateUserRoleUseCase = new UpdateUserRoleUseCase();
  const adminActivateTenantUseCase = new AdminActivateTenantUseCase();
  const listTenantUsersUseCase = new ListTenantUsersUseCase();
  const createSuperAdminUseCase = new CreateSuperAdminUseCase();
  const updatePlatformSettingsUseCase = new UpdatePlatformSettingsUseCase();
  const sendNotificationUseCase = new SendNotificationUseCase();

  // --------------------------------------------------------------------------
  // 1. GET /api/v1/admin/tenants (List all non-deleted registered tenants)
  // --------------------------------------------------------------------------
  fastify.get('/tenants', async (_request, reply) => {
    try {
      const tenants = await listTenantsUseCase.execute();
      return reply.status(200).send({
        success: true,
        data: tenants,
      });
    } catch (err: any) {
      fastify.log.error(err, 'Failed to list tenants for super admin');
      return reply.status(500).send({
        success: false,
        errorCode: 'INTERNAL_ERROR',
        errorMessage: err.message || 'فشل جلب قائمة الشركات والشبكات',
      });
    }
  });

  // --------------------------------------------------------------------------
  // 2. PATCH /api/v1/admin/tenants/:id/approve (Approve pending registration)
  // --------------------------------------------------------------------------
  fastify.patch('/tenants/:id/approve', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { userId } = request.user!;

    try {
      const result = await approveTenantUseCase.execute({
        tenantId: id,
        adminUserId: userId,
      });

      return reply.status(200).send({
        success: true,
        data: result,
      });
    } catch (err: any) {
      fastify.log.error(err, 'Failed to approve tenant');
      return reply.status(400).send({
        success: false,
        errorCode: 'OPERATION_FAILED',
        errorMessage: err.message || 'فشل الموافقة على طلب التسجيل',
      });
    }
  });

  // --------------------------------------------------------------------------
  // 3. PATCH /api/v1/admin/tenants/:id/reject (Reject pending registration)
  // --------------------------------------------------------------------------
  fastify.patch('/tenants/:id/reject', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { userId } = request.user!;

    try {
      const result = await rejectTenantUseCase.execute({
        tenantId: id,
        adminUserId: userId,
      });

      return reply.status(200).send({
        success: true,
        data: result,
      });
    } catch (err: any) {
      fastify.log.error(err, 'Failed to reject tenant');
      return reply.status(400).send({
        success: false,
        errorCode: 'OPERATION_FAILED',
        errorMessage: err.message || 'فشل رفض طلب التسجيل',
      });
    }
  });

  // --------------------------------------------------------------------------
  // 4. PATCH /api/v1/admin/tenants/:id/suspend (Suspend tenant subscription)
  // --------------------------------------------------------------------------
  fastify.patch('/tenants/:id/suspend', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { userId } = request.user!;

    try {
      const result = await suspendTenantUseCase.execute({
        tenantId: id,
        adminUserId: userId,
      });

      return reply.status(200).send({
        success: true,
        data: result,
      });
    } catch (err: any) {
      fastify.log.error(err, 'Failed to suspend tenant');
      return reply.status(400).send({
        success: false,
        errorCode: 'OPERATION_FAILED',
        errorMessage: err.message || 'فشل إيقاف حساب الشبكة',
      });
    }
  });

  // --------------------------------------------------------------------------
  // 5. PATCH /api/v1/admin/tenants/:id/reactivate (Reactivate tenant subscription)
  // --------------------------------------------------------------------------
  fastify.patch('/tenants/:id/reactivate', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { userId } = request.user!;

    try {
      const result = await reactivateTenantUseCase.execute({
        tenantId: id,
        adminUserId: userId,
      });

      return reply.status(200).send({
        success: true,
        data: result,
      });
    } catch (err: any) {
      fastify.log.error(err, 'Failed to reactivate tenant');
      return reply.status(400).send({
        success: false,
        errorCode: 'OPERATION_FAILED',
        errorMessage: err.message || 'فشل إعادة تفعيل حساب الشبكة',
      });
    }
  });

  // --------------------------------------------------------------------------
  // 6. PATCH /api/v1/admin/tenants/:id/delete (Soft delete tenant - Rule 30)
  // --------------------------------------------------------------------------
  fastify.patch('/tenants/:id/delete', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { userId } = request.user!;

    try {
      const result = await deleteTenantUseCase.execute({
        tenantId: id,
        adminUserId: userId,
      });

      return reply.status(200).send({
        success: true,
        data: result,
      });
    } catch (err: any) {
      fastify.log.error(err, 'Failed to soft delete tenant');
      return reply.status(400).send({
        success: false,
        errorCode: 'OPERATION_FAILED',
        errorMessage: err.message || 'فشل حذف الحساب',
      });
    }
  });

  // --------------------------------------------------------------------------
  // 6b. GET /api/v1/admin/tenants/archived (List all archived tenants)
  // --------------------------------------------------------------------------
  fastify.get('/tenants/archived', async (_request, reply) => {
    try {
      const archivedTenants = await listArchivedTenantsUseCase.execute();
      return reply.status(200).send({
        success: true,
        data: archivedTenants,
      });
    } catch (err: any) {
      fastify.log.error(err, 'Failed to list archived tenants for super admin');
      return reply.status(500).send({
        success: false,
        errorCode: 'INTERNAL_ERROR',
        errorMessage: err.message || 'فشل جلب قائمة الحسابات المؤرشفة',
      });
    }
  });

  // --------------------------------------------------------------------------
  // 6c. PATCH /api/v1/admin/tenants/:id/restore (Restore archived tenant)
  // --------------------------------------------------------------------------
  fastify.patch('/tenants/:id/restore', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { userId } = request.user!;

    try {
      const result = await restoreTenantUseCase.execute({
        tenantId: id,
        adminUserId: userId,
      });

      return reply.status(200).send({
        success: true,
        data: result,
        message: result.message,
      });
    } catch (err: any) {
      fastify.log.error(err, 'Failed to restore archived tenant');
      return reply.status(400).send({
        success: false,
        errorCode: 'OPERATION_FAILED',
        errorMessage: err.message || 'فشل استرجاع الحساب من الأرشيف',
      });
    }
  });

  // --------------------------------------------------------------------------
  // 6d. DELETE /api/v1/admin/tenants/:id/permanent (Permanent physical delete)
  // --------------------------------------------------------------------------
  fastify.delete('/tenants/:id/permanent', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { userId, tenantId: adminTenantId } = request.user!;
    const body = (request.body as { confirmName?: string } | null | undefined) || {};

    try {
      const result = await permanentDeleteTenantUseCase.execute({
        tenantId: id,
        confirmName: typeof body.confirmName === 'string' ? body.confirmName : '',
        adminUserId: userId,
        adminTenantId,
      });

      return reply.status(200).send({
        success: true,
        data: result,
        message: result.message,
      });
    } catch (err: any) {
      if (err instanceof PermanentDeleteTenantException || err.name === 'PermanentDeleteTenantException') {
        return reply.status(err.statusCode || 400).send({
          success: false,
          errorCode: err.errorCode || 'OPERATION_FAILED',
          errorMessage: err.message,
        });
      }

      fastify.log.error(err, 'Failed to permanently delete archived tenant');
      return reply.status(400).send({
        success: false,
        errorCode: 'OPERATION_FAILED',
        errorMessage: err.message || 'فشل الحذف النهائي للحساب',
      });
    }
  });

  // --------------------------------------------------------------------------
  // 7. POST /api/v1/admin/tenants/:id/activate-license (Direct License Activation)
  // --------------------------------------------------------------------------
  fastify.post('/tenants/:id/activate-license', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { userId } = request.user!;

    const parseResult = adminActivateTenantSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        success: false,
        errorCode: 'VALIDATION_ERROR',
        errorMessage: 'بيانات تفعيل الترخيص غير صالحة',
        details: parseResult.error.flatten().fieldErrors,
      });
    }

    try {
      const result = await adminActivateTenantUseCase.execute({
        tenantId: id,
        planName: parseResult.data.planName,
        durationDays: parseResult.data.durationDays,
        maxRoutersLimit: parseResult.data.maxRoutersLimit,
        adminUserId: userId,
      });

      return reply.status(200).send({
        success: true,
        data: result,
      });
    } catch (err: any) {
      fastify.log.error(err, 'Failed to directly activate tenant license');
      return reply.status(400).send({
        success: false,
        errorCode: 'OPERATION_FAILED',
        errorMessage: err.message || 'فشل تفعيل الترخيص المباشر',
      });
    }
  });

  // --------------------------------------------------------------------------
  // 8. GET /api/v1/admin/tenants/:id/users (List users of a tenant)
  // --------------------------------------------------------------------------
  fastify.get('/tenants/:id/users', async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const users = await listTenantUsersUseCase.execute(id);
      return reply.status(200).send({
        success: true,
        data: users,
      });
    } catch (err: any) {
      fastify.log.error(err, 'Failed to list tenant users');
      return reply.status(400).send({
        success: false,
        errorCode: 'OPERATION_FAILED',
        errorMessage: err.message || 'فشل جلب مستخدمي الشبكة',
      });
    }
  });

  // --------------------------------------------------------------------------
  // 9. PATCH /api/v1/admin/users/:id/role (Update user role / Promotion)
  // --------------------------------------------------------------------------
  fastify.patch('/users/:id/role', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { userId } = request.user!;

    const parseResult = updateUserRoleSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        success: false,
        errorCode: 'VALIDATION_ERROR',
        errorMessage: 'الدور المحدد غير صالح',
        details: parseResult.error.flatten().fieldErrors,
      });
    }

    try {
      const result = await updateUserRoleUseCase.execute({
        targetUserId: id,
        newRole: parseResult.data.role,
        adminUserId: userId,
      });

      return reply.status(200).send({
        success: true,
        data: result,
      });
    } catch (err: any) {
      fastify.log.error(err, 'Failed to update user role');
      return reply.status(400).send({
        success: false,
        errorCode: 'OPERATION_FAILED',
        errorMessage: err.message || 'فشل تحديث دور المستخدم',
      });
    }
  });

  // --------------------------------------------------------------------------
  // 10. GET /api/v1/admin/license-codes (List all generated license codes)
  // --------------------------------------------------------------------------
  fastify.get('/license-codes', async (_request, reply) => {
    try {
      const codes = await listLicenseCodesUseCase.execute();
      return reply.status(200).send({
        success: true,
        data: codes,
      });
    } catch (err: any) {
      fastify.log.error(err, 'Failed to list license codes for super admin');
      return reply.status(500).send({
        success: false,
        errorCode: 'INTERNAL_ERROR',
        errorMessage: err.message || 'فشل جلب قائمة أكواد الترخيص',
      });
    }
  });

  // --------------------------------------------------------------------------
  // 11. POST /api/v1/admin/license-codes (Generate new license code)
  // --------------------------------------------------------------------------
  fastify.post('/license-codes', async (request, reply) => {
    const parseResult = generateLicenseCodeSchema.safeParse(request.body);

    if (!parseResult.success) {
      return reply.status(400).send({
        success: false,
        errorCode: 'VALIDATION_ERROR',
        errorMessage: 'بيانات كود الترخيص غير صالحة',
        details: parseResult.error.flatten().fieldErrors,
      });
    }

    try {
      const { userId } = request.user!;
      const createdCode = await generateLicenseCodeUseCase.execute({
        planName: parseResult.data.planName,
        durationDays: parseResult.data.durationDays,
        maxRoutersLimit: parseResult.data.maxRoutersLimit,
        createdByUserId: userId,
      });

      return reply.status(201).send({
        success: true,
        data: createdCode,
      });
    } catch (err: any) {
      fastify.log.error(err, 'Failed to generate license code');
      return reply.status(500).send({
        success: false,
        errorCode: 'INTERNAL_ERROR',
        errorMessage: err.message || 'فشل توليد كود الترخيص',
      });
    }
  });

  // --------------------------------------------------------------------------
  // 12. POST /api/v1/admin/super-admins (Create new SUPER_ADMIN user)
  // --------------------------------------------------------------------------
  fastify.post('/super-admins', async (request, reply) => {
    const parseResult = createSuperAdminSchema.safeParse(request.body);

    if (!parseResult.success) {
      return reply.status(400).send({
        success: false,
        errorCode: 'VALIDATION_ERROR',
        errorMessage: 'بيانات إنشاء مدير المنصة غير صالحة',
        details: parseResult.error.flatten().fieldErrors,
      });
    }

    try {
      const { userId } = request.user!;
      const createdAdmin = await createSuperAdminUseCase.execute({
        fullName: parseResult.data.fullName,
        username: parseResult.data.username,
        email: parseResult.data.email,
        password: parseResult.data.password,
        adminUserId: userId,
      });

      return reply.status(201).send({
        success: true,
        data: createdAdmin,
      });
    } catch (err: any) {
      fastify.log.error(err, 'Failed to create platform super admin');
      if (err instanceof ConflictException) {
        return reply.status(409).send({
          success: false,
          errorCode: err.errorCode || 'CONFLICT',
          errorMessage: err.message,
        });
      }
      return reply.status(400).send({
        success: false,
        errorCode: 'OPERATION_FAILED',
        errorMessage: err.message || 'فشل إنشاء مدير المنصة',
      });
    }
  });

  // 14. PATCH /api/v1/admin/settings (Update dynamic platform settings)
  fastify.patch('/settings', async (request: any, reply) => {
    try {
      const { userId } = request.user!;
      const body = request.body || {};
      const updated = await updatePlatformSettingsUseCase.execute({
        adminUserId: userId,
        data: body,
      });

      return reply.status(200).send({
        success: true,
        data: updated,
        message: updated.message,
      });
    } catch (err: any) {
      return reply.status(400).send({
        success: false,
        errorCode: 'UPDATE_SETTINGS_FAILED',
        errorMessage: err.message || 'فشل تحديث إعدادات المنصة',
      });
    }
  });

  // 15. POST /api/v1/admin/notifications (Send manual notification or broadcast)
  fastify.post('/notifications', async (request: any, reply) => {
    try {
      const { userId } = request.user!;
      const body = request.body || {};
      const notification = await sendNotificationUseCase.execute({
        adminUserId: userId,
        title: body.title,
        body: body.body,
        tenantId: body.tenantId,
      });

      return reply.status(201).send({
        success: true,
        data: notification,
        message: notification.message,
      });
    } catch (err: any) {
      return reply.status(400).send({
        success: false,
        errorCode: 'SEND_NOTIFICATION_FAILED',
        errorMessage: err.message || 'فشل إرسال الإشعار',
      });
    }
  });

  // --------------------------------------------------------------------------
  // 16. SUBSCRIPTION PLANS MANAGEMENT (Super Admin)
  // --------------------------------------------------------------------------
  fastify.get('/subscription-plans', async (_request, reply) => {
    try {
      const plans = await prisma.subscriptionPlan.findMany({
        orderBy: { durationDays: 'asc' },
      });
      return reply.status(200).send({
        success: true,
        data: plans.map((p) => ({
          ...p,
          price: Number(p.price),
        })),
      });
    } catch (err: any) {
      fastify.log.error(err, 'Failed to fetch subscription plans');
      return reply.status(500).send({
        success: false,
        errorCode: 'INTERNAL_ERROR',
        errorMessage: 'فشل جلب باقات الاشتراك',
      });
    }
  });

  fastify.post('/subscription-plans', async (request, reply) => {
    const parseResult = createSubscriptionPlanSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        success: false,
        errorCode: 'VALIDATION_ERROR',
        errorMessage: 'بيانات الباقة غير صالحة',
        details: parseResult.error.flatten().fieldErrors,
      });
    }

    try {
      const { userId } = request.user!;
      const d = parseResult.data;
      const created = await prisma.subscriptionPlan.create({
        data: {
          name: d.name,
          durationDays: d.durationDays,
          price: d.price,
          currency: d.currency,
          description: d.description ?? null,
          maxRoutersLimit: d.maxRoutersLimit,
          isActive: d.isActive,
        },
      });

      await defaultAuditLogger.log(
        request.user!.tenantId,
        userId,
        'CREATE',
        'SubscriptionPlan',
        created.id,
        `تم إنشاء باقة اشتراك جديدة: "${created.name}" بسعر ${created.price} ${created.currency} لمدة ${created.durationDays} يوم`,
        'SUCCESS'
      );

      return reply.status(201).send({
        success: true,
        data: {
          ...created,
          price: Number(created.price),
        },
        message: 'تم إنشاء باقة الاشتراك بنجاح',
      });
    } catch (err: any) {
      fastify.log.error(err, 'Failed to create subscription plan');
      return reply.status(500).send({
        success: false,
        errorCode: 'INTERNAL_ERROR',
        errorMessage: 'فشل إنشاء باقة الاشتراك',
      });
    }
  });

  fastify.put('/subscription-plans/:id', async (request: any, reply) => {
    const { id } = request.params;
    const parseResult = updateSubscriptionPlanSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        success: false,
        errorCode: 'VALIDATION_ERROR',
        errorMessage: 'بيانات تعديل الباقة غير صالحة',
        details: parseResult.error.flatten().fieldErrors,
      });
    }

    try {
      const { userId } = request.user!;
      const d = parseResult.data;
      const dataToUpdate: any = {};
      if (d.name !== undefined) dataToUpdate.name = d.name;
      if (d.durationDays !== undefined) dataToUpdate.durationDays = d.durationDays;
      if (d.price !== undefined) dataToUpdate.price = d.price;
      if (d.currency !== undefined) dataToUpdate.currency = d.currency;
      if (d.description !== undefined) dataToUpdate.description = d.description;
      if (d.maxRoutersLimit !== undefined) dataToUpdate.maxRoutersLimit = d.maxRoutersLimit;
      if (d.isActive !== undefined) dataToUpdate.isActive = d.isActive;

      const updated = await prisma.subscriptionPlan.update({
        where: { id },
        data: dataToUpdate,
      });

      await defaultAuditLogger.log(
        request.user!.tenantId,
        userId,
        'UPDATE',
        'SubscriptionPlan',
        updated.id,
        `تم تعديل باقة الاشتراك: "${updated.name}"`,
        'SUCCESS'
      );

      return reply.status(200).send({
        success: true,
        data: {
          ...updated,
          price: Number(updated.price),
        },
        message: 'تم تحديث باقة الاشتراك بنجاح',
      });
    } catch (err: any) {
      fastify.log.error(err, 'Failed to update subscription plan');
      return reply.status(500).send({
        success: false,
        errorCode: 'INTERNAL_ERROR',
        errorMessage: 'فشل تحديث باقة الاشتراك',
      });
    }
  });

  fastify.patch('/subscription-plans/:id/toggle-active', async (request: any, reply) => {
    const { id } = request.params;
    try {
      const { userId } = request.user!;
      const plan = await prisma.subscriptionPlan.findUnique({
        where: { id },
      });

      if (!plan) {
        return reply.status(404).send({
          success: false,
          errorCode: 'PLAN_NOT_FOUND',
          errorMessage: 'باقة الاشتراك غير موجودة',
        });
      }

      const updated = await prisma.subscriptionPlan.update({
        where: { id },
        data: { isActive: !plan.isActive },
      });

      await defaultAuditLogger.log(
        request.user!.tenantId,
        userId,
        'UPDATE',
        'SubscriptionPlan',
        updated.id,
        `تم ${updated.isActive ? 'تفعيل' : 'تعطيل'} باقة الاشتراك: "${updated.name}"`,
        'SUCCESS'
      );

      return reply.status(200).send({
        success: true,
        data: {
          ...updated,
          price: Number(updated.price),
        },
        message: `تم ${updated.isActive ? 'تفعيل' : 'تعطيل'} باقة الاشتراك بنجاح`,
      });
    } catch (err: any) {
      fastify.log.error(err, 'Failed to toggle subscription plan status');
      return reply.status(500).send({
        success: false,
        errorCode: 'INTERNAL_ERROR',
        errorMessage: 'فشل تغيير حالة تفعيل باقة الاشتراك',
      });
    }
  });

  fastify.delete('/subscription-plans/:id', async (request: any, reply) => {
    const { id } = request.params;
    try {
      const { userId } = request.user!;
      const plan = await prisma.subscriptionPlan.findUnique({
        where: { id },
      });

      if (!plan) {
        return reply.status(404).send({
          success: false,
          errorCode: 'PLAN_NOT_FOUND',
          errorMessage: 'باقة الاشتراك غير موجودة',
        });
      }

      // Check if plan has existing tenant subscription requests
      const linkedRequestsCount = await prisma.subscriptionRequest.count({
        where: { planId: id },
      });

      if (linkedRequestsCount > 0) {
        // Non-destructive safe handling: Deactivate plan instead of deleting historical records
        const updated = await prisma.subscriptionPlan.update({
          where: { id },
          data: { isActive: false },
        });

        await defaultAuditLogger.log(
          request.user!.tenantId,
          userId,
          'UPDATE',
          'SubscriptionPlan',
          updated.id,
          `تم تعطيل باقة الاشتراك "${updated.name}" بدلاً من حذفها لوجود ${linkedRequestsCount} طلبات اشتراك سابقة مرتبطة بها`,
          'SUCCESS'
        );

        return reply.status(200).send({
          success: true,
          data: {
            ...updated,
            price: Number(updated.price),
          },
          deactivated: true,
          message: `تم تعطيل باقة الاشتراك بنجاح لحماية سجلات (${linkedRequestsCount}) طلبات اشتراك سابقة تابعة للمستأجرين.`,
        });
      }

      // If no requests are linked, safely delete the plan
      await prisma.subscriptionPlan.delete({
        where: { id },
      });

      await defaultAuditLogger.log(
        request.user!.tenantId,
        userId,
        'DELETE',
        'SubscriptionPlan',
        id,
        `تم حذف باقة الاشتراك "${plan.name}" نهائياً لعدم وجود اشتراكات سابقة مرتبطة بها`,
        'SUCCESS'
      );

      return reply.status(200).send({
        success: true,
        deleted: true,
        message: 'تم حذف باقة الاشتراك بنجاح',
      });
    } catch (err: any) {
      fastify.log.error(err, 'Failed to delete subscription plan');
      return reply.status(500).send({
        success: false,
        errorCode: 'INTERNAL_ERROR',
        errorMessage: 'فشل حذف أو تعطيل باقة الاشتراك',
      });
    }
  });

  // --------------------------------------------------------------------------
  // 17. SUBSCRIPTION ACTIVATION REQUESTS MANAGEMENT (Super Admin)
  // --------------------------------------------------------------------------
  fastify.get('/subscription-requests', async (request: any, reply) => {
    try {
      const { status } = request.query || {};
      const requests = await prisma.subscriptionRequest.findMany({
        where: status ? { status } : {},
        include: {
          tenant: { select: { id: true, name: true, slug: true, contactEmail: true, contactPhone: true } },
          user: { select: { id: true, username: true, fullName: true, email: true } },
          plan: true,
          paymentMethod: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      return reply.status(200).send({
        success: true,
        data: requests.map((r) => ({
          id: r.id,
          status: r.status,
          tenantId: r.tenantId,
          tenantName: r.tenant.name,
          tenantSlug: r.tenant.slug,
          contactEmail: r.tenant.contactEmail,
          contactPhone: r.tenant.contactPhone,
          requestedBy: {
            id: r.user.id,
            username: r.user.username,
            fullName: r.user.fullName,
            email: r.user.email,
          },
          plan: {
            id: r.plan.id,
            name: r.plan.name,
            durationDays: r.durationDaysSnapshot,
            price: Number(r.priceSnapshot),
            currency: r.currencySnapshot,
          },
          senderName: r.senderName,
          referenceNumber: r.referenceNumber,
          receiptUrl: r.receiptUrl,
          paymentMethod: r.paymentMethod
            ? {
                id: r.paymentMethod.id,
                providerName: r.paymentMethod.providerName,
                accountName: r.paymentMethod.accountName,
                accountNumber: r.paymentMethod.accountNumber,
              }
            : null,
          notes: r.notes,
          reviewNotes: r.reviewNotes,
          reviewedAt: r.reviewedAt?.toISOString() ?? null,
          createdAt: r.createdAt.toISOString(),
        })),
      });
    } catch (err: any) {
      fastify.log.error(err, 'Failed to list subscription requests');
      return reply.status(500).send({
        success: false,
        errorCode: 'INTERNAL_ERROR',
        errorMessage: 'فشل جلب طلبات التفعيل',
      });
    }
  });

  fastify.post('/subscription-requests/:id/approve', async (request: any, reply) => {
    const { id } = request.params;
    const parseResult = reviewSubscriptionRequestSchema.safeParse(request.body || {});
    if (!parseResult.success) {
      return reply.status(400).send({
        success: false,
        errorCode: 'VALIDATION_ERROR',
        errorMessage: 'بيانات المراجعة غير صالحة',
      });
    }

    try {
      const { userId } = request.user!;
      const subRequest = await prisma.subscriptionRequest.findUnique({
        where: { id },
        include: { tenant: true, plan: true },
      });

      if (!subRequest) {
        return reply.status(404).send({
          success: false,
          errorCode: 'REQUEST_NOT_FOUND',
          errorMessage: 'طلب التفعيل غير موجود',
        });
      }

      if (subRequest.status !== 'PENDING') {
        return reply.status(400).send({
          success: false,
          errorCode: 'REQUEST_ALREADY_REVIEWED',
          errorMessage: `هذا الطلب تمت مراجعته مسبقاً (الحالة الحالية: ${subRequest.status})`,
        });
      }

      // Anti-fraud: ensure reference number isn't duplicated across other approved requests
      if (subRequest.referenceNumber && subRequest.referenceNumber.trim().length > 0) {
        const otherApproved = await prisma.subscriptionRequest.findFirst({
          where: {
            id: { not: subRequest.id },
            referenceNumber: subRequest.referenceNumber.trim(),
            status: 'APPROVED',
          },
        });
        if (otherApproved) {
          return reply.status(400).send({
            success: false,
            errorCode: 'DUPLICATE_REFERENCE_NUMBER',
            errorMessage: 'رقم العملية المرجعي لهذا الطلب مستخدم مسبقاً في عملية اشتراك معتمدة أخرى',
          });
        }
      }

      const tenant = subRequest.tenant;
      const now = new Date();
      let baseDate = now;

      if (
        tenant.subscriptionStatus === 'ACTIVE' &&
        tenant.subscriptionEndsAt &&
        tenant.subscriptionEndsAt.getTime() > now.getTime()
      ) {
        baseDate = tenant.subscriptionEndsAt;
      }

      const newEndsAt = new Date(
        baseDate.getTime() + subRequest.durationDaysSnapshot * 24 * 60 * 60 * 1000
      );

      // Atomically approve request and activate tenant license inside a transaction
      await prisma.$transaction([
        prisma.subscriptionRequest.update({
          where: { id: subRequest.id },
          data: {
            status: 'APPROVED',
            reviewedByUserId: userId,
            reviewedAt: now,
            reviewNotes: parseResult.data?.reviewNotes ?? 'تم تأكيد السداد وتفعيل الباقة بنجاح',
          },
        }),
        prisma.tenant.update({
          where: { id: tenant.id },
          data: {
            subscriptionStatus: 'ACTIVE',
            approvalStatus: 'APPROVED',
            status: 'ACTIVE',
            planName: subRequest.plan.name,
            maxRoutersLimit: subRequest.plan.maxRoutersLimit,
            subscriptionEndsAt: newEndsAt,
          },
        }),
      ]);

      await defaultAuditLogger.log(
        tenant.id,
        userId,
        'UPDATE',
        'SubscriptionRequest',
        subRequest.id,
        `تمت الموافقة على طلب تفعيل الاشتراك للشبكة "${tenant.name}": باقة "${subRequest.plan.name}" لمدة ${subRequest.durationDaysSnapshot} يوم حتى ${newEndsAt.toISOString()}`,
        'SUCCESS'
      );

      return reply.status(200).send({
        success: true,
        data: {
          requestId: subRequest.id,
          status: 'APPROVED',
          tenantId: tenant.id,
          tenantName: tenant.name,
          planName: subRequest.plan.name,
          subscriptionEndsAt: newEndsAt.toISOString(),
        },
        message: `تمت الموافقة على طلب التفعيل بنجاح وتفعيل اشتراك الشبكة "${tenant.name}"`,
      });
    } catch (err: any) {
      fastify.log.error(err, 'Failed to approve subscription request');
      return reply.status(500).send({
        success: false,
        errorCode: 'INTERNAL_ERROR',
        errorMessage: 'حدث خطأ أثناء الموافقة على طلب التفعيل',
      });
    }
  });

  fastify.post('/subscription-requests/:id/reject', async (request: any, reply) => {
    const { id } = request.params;
    const parseResult = reviewSubscriptionRequestSchema.safeParse(request.body || {});
    if (!parseResult.success) {
      return reply.status(400).send({
        success: false,
        errorCode: 'VALIDATION_ERROR',
        errorMessage: 'بيانات المراجعة غير صالحة',
      });
    }

    try {
      const { userId } = request.user!;
      const subRequest = await prisma.subscriptionRequest.findUnique({
        where: { id },
        include: { tenant: true },
      });

      if (!subRequest) {
        return reply.status(404).send({
          success: false,
          errorCode: 'REQUEST_NOT_FOUND',
          errorMessage: 'طلب التفعيل غير موجود',
        });
      }

      if (subRequest.status !== 'PENDING') {
        return reply.status(400).send({
          success: false,
          errorCode: 'REQUEST_ALREADY_REVIEWED',
          errorMessage: `هذا الطلب تمت مراجعته مسبقاً (الحالة الحالية: ${subRequest.status})`,
        });
      }

      const now = new Date();
      const updated = await prisma.subscriptionRequest.update({
        where: { id: subRequest.id },
        data: {
          status: 'REJECTED',
          reviewedByUserId: userId,
          reviewedAt: now,
          reviewNotes: parseResult.data?.reviewNotes ?? 'تم رفض الطلب لعدم اكتمال بيانات الدفع أو التحقق',
        },
      });

      await defaultAuditLogger.log(
        subRequest.tenantId,
        userId,
        'UPDATE',
        'SubscriptionRequest',
        subRequest.id,
        `تم رفض طلب تفعيل الاشتراك للشبكة "${subRequest.tenant.name}". السبب: ${updated.reviewNotes}`,
        'WARNING'
      );

      return reply.status(200).send({
        success: true,
        data: {
          requestId: updated.id,
          status: 'REJECTED',
          reviewNotes: updated.reviewNotes,
        },
        message: 'تم رفض طلب التفعيل وتسجيل السبب',
      });
    } catch (err: any) {
      fastify.log.error(err, 'Failed to reject subscription request');
      return reply.status(500).send({
        success: false,
        errorCode: 'INTERNAL_ERROR',
        errorMessage: 'حدث خطأ أثناء رفض طلب التفعيل',
      });
    }
  });

  // --------------------------------------------------------------------------
  // 18. MANUAL PAYMENT METHODS MANAGEMENT (Super Admin)
  // --------------------------------------------------------------------------
  fastify.get('/payment-methods', async (_request, reply) => {
    try {
      const methods = await prisma.manualPaymentMethod.findMany({
        orderBy: [{ displayOrder: 'asc' }, { createdAt: 'desc' }],
      });

      return reply.status(200).send({
        success: true,
        data: methods.map((m) => ({
          id: m.id,
          providerName: m.providerName,
          accountName: m.accountName,
          accountNumber: m.accountNumber,
          beneficiaryName: m.beneficiaryName,
          instructions: m.instructions,
          currency: m.currency,
          isActive: m.isActive,
          displayOrder: m.displayOrder,
          createdAt: m.createdAt.toISOString(),
          updatedAt: m.updatedAt.toISOString(),
        })),
      });
    } catch (err: any) {
      fastify.log.error(err, 'Failed to list payment methods for admin');
      return reply.status(500).send({
        success: false,
        errorCode: 'INTERNAL_ERROR',
        errorMessage: 'فشل جلب وسائل الدفع للأدمن',
      });
    }
  });

  fastify.post('/payment-methods', async (request, reply) => {
    const parseResult = createPaymentMethodSchema.safeParse(request.body);
    if (!parseResult.success) {
      const details = parseResult.error.flatten().fieldErrors;
      const detailsStr = Object.entries(details)
        .map(([k, v]) => `${k}: ${v?.join(', ')}`)
        .join(' | ');
      return reply.status(400).send({
        success: false,
        errorCode: 'VALIDATION_ERROR',
        errorMessage: detailsStr ? `بيانات وسيلة الدفع غير صالحة (${detailsStr})` : 'بيانات وسيلة الدفع غير صالحة',
        details,
      });
    }

    try {
      const { userId } = request.user!;
      const d = parseResult.data;
      const created = await prisma.manualPaymentMethod.create({
        data: {
          providerName: d.providerName,
          accountName: d.accountName,
          accountNumber: d.accountNumber,
          beneficiaryName: d.beneficiaryName ?? (d as any).iban ?? null,
          instructions: d.instructions ?? null,
          currency: d.currency ?? 'SDG',
          isActive: d.isActive ?? true,
          displayOrder: d.displayOrder ?? 0,
        },
      });

      await defaultAuditLogger.log(
        request.user!.tenantId,
        userId,
        'CREATE',
        'ManualPaymentMethod',
        created.id,
        `تمت إضافة وسيلة دفع جديدة: "${created.providerName}" - حساب: ${created.accountNumber}`,
        'SUCCESS'
      );

      return reply.status(201).send({
        success: true,
        data: created,
        message: 'تمت إضافة وسيلة الدفع بنجاح',
      });
    } catch (err: any) {
      fastify.log.error(err, 'Failed to create payment method');
      return reply.status(500).send({
        success: false,
        errorCode: 'INTERNAL_ERROR',
        errorMessage: 'فشل إنشاء وسيلة الدفع',
      });
    }
  });

  fastify.put('/payment-methods/:id', async (request: any, reply) => {
    const { id } = request.params;
    const parseResult = updatePaymentMethodSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        success: false,
        errorCode: 'VALIDATION_ERROR',
        errorMessage: 'بيانات تعديل وسيلة الدفع غير صالحة',
        details: parseResult.error.flatten().fieldErrors,
      });
    }

    try {
      const { userId } = request.user!;
      const existing = await prisma.manualPaymentMethod.findUnique({ where: { id } });
      if (!existing) {
        return reply.status(404).send({
          success: false,
          errorCode: 'PAYMENT_METHOD_NOT_FOUND',
          errorMessage: 'وسيلة الدفع غير موجودة',
        });
      }

      const d = parseResult.data;
      const updated = await prisma.manualPaymentMethod.update({
        where: { id },
        data: {
          ...(d.providerName !== undefined ? { providerName: d.providerName } : {}),
          ...(d.accountName !== undefined ? { accountName: d.accountName } : {}),
          ...(d.accountNumber !== undefined ? { accountNumber: d.accountNumber } : {}),
          ...(d.beneficiaryName !== undefined ? { beneficiaryName: d.beneficiaryName } : {}),
          ...(d.instructions !== undefined ? { instructions: d.instructions } : {}),
          ...(d.currency !== undefined ? { currency: d.currency } : {}),
          ...(d.isActive !== undefined ? { isActive: d.isActive } : {}),
          ...(d.displayOrder !== undefined ? { displayOrder: d.displayOrder } : {}),
        },
      });

      await defaultAuditLogger.log(
        request.user!.tenantId,
        userId,
        'UPDATE',
        'ManualPaymentMethod',
        updated.id,
        `تم تعديل بيانات وسيلة الدفع: "${updated.providerName}"`,
        'SUCCESS'
      );

      return reply.status(200).send({
        success: true,
        data: updated,
        message: 'تم تحديث وسيلة الدفع بنجاح',
      });
    } catch (err: any) {
      fastify.log.error(err, 'Failed to update payment method');
      return reply.status(500).send({
        success: false,
        errorCode: 'INTERNAL_ERROR',
        errorMessage: 'فشل تحديث وسيلة الدفع',
      });
    }
  });

  fastify.patch('/payment-methods/:id/toggle-active', async (request: any, reply) => {
    const { id } = request.params;
    try {
      const { userId } = request.user!;
      const existing = await prisma.manualPaymentMethod.findUnique({ where: { id } });
      if (!existing) {
        return reply.status(404).send({
          success: false,
          errorCode: 'PAYMENT_METHOD_NOT_FOUND',
          errorMessage: 'وسيلة الدفع غير موجودة',
        });
      }

      const updated = await prisma.manualPaymentMethod.update({
        where: { id },
        data: { isActive: !existing.isActive },
      });

      await defaultAuditLogger.log(
        request.user!.tenantId,
        userId,
        'UPDATE',
        'ManualPaymentMethod',
        updated.id,
        `تم ${updated.isActive ? 'تفعيل' : 'تعطيل'} وسيلة الدفع: "${updated.providerName}"`,
        'SUCCESS'
      );

      return reply.status(200).send({
        success: true,
        data: updated,
        message: `تم ${updated.isActive ? 'تفعيل' : 'تعطيل'} وسيلة الدفع بنجاح`,
      });
    } catch (err: any) {
      fastify.log.error(err, 'Failed to toggle payment method active status');
      return reply.status(500).send({
        success: false,
        errorCode: 'INTERNAL_ERROR',
        errorMessage: 'فشل تغيير حالة وسيلة الدفع',
      });
    }
  });

  fastify.delete('/payment-methods/:id', async (request: any, reply) => {
    const { id } = request.params;
    try {
      const { userId } = request.user!;
      const existing = await prisma.manualPaymentMethod.findUnique({ where: { id } });
      if (!existing) {
        return reply.status(404).send({
          success: false,
          errorCode: 'PAYMENT_METHOD_NOT_FOUND',
          errorMessage: 'وسيلة الدفع غير موجودة',
        });
      }

      const linkedRequestsCount = await prisma.subscriptionRequest.count({
        where: { paymentMethodId: id },
      });

      if (linkedRequestsCount > 0) {
        // Safe preservation: deactivate instead of hard delete
        const updated = await prisma.manualPaymentMethod.update({
          where: { id },
          data: { isActive: false },
        });

        await defaultAuditLogger.log(
          request.user!.tenantId,
          userId,
          'UPDATE',
          'ManualPaymentMethod',
          updated.id,
          `تم تعطيل وسيلة الدفع "${updated.providerName}" بدلاً من حذفها لوجود ${linkedRequestsCount} طلبات اشتراك سابقة مرتبطة بها`,
          'SUCCESS'
        );

        return reply.status(200).send({
          success: true,
          data: updated,
          message: 'تم تعطيل وسيلة الدفع وحفظ سجلاتها التاريخية نظراً لوجود معاملات سابقة مرتبطة بها',
        });
      }

      await prisma.manualPaymentMethod.delete({ where: { id } });

      await defaultAuditLogger.log(
        request.user!.tenantId,
        userId,
        'DELETE',
        'ManualPaymentMethod',
        id,
        `تم حذف وسيلة الدفع "${existing.providerName}" بنجاح`,
        'WARNING'
      );

      return reply.status(200).send({
        success: true,
        message: 'تم حذف وسيلة الدفع بنجاح',
      });
    } catch (err: any) {
      fastify.log.error(err, 'Failed to delete payment method');
      return reply.status(500).send({
        success: false,
        errorCode: 'INTERNAL_ERROR',
        errorMessage: 'فشل حذف وسيلة الدفع',
      });
    }
  });
};

