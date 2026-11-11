// ============================================================================
// Platform: Commercial MikroTik Network & HotSpot Card Management System
// File: tests/presentation/TenantArchiveAndAccountDeletion.test.ts
// Integration Tests: Tenant Archive, Restore, Permanent Delete, Login Security & Self-Delete
// ============================================================================

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/presentation/http/server.js';
import { signToken } from '../../src/infrastructure/security/jwt.js';
import { hashPassword } from '../../src/infrastructure/security/password.js';
import { prisma } from '../../src/infrastructure/database/prisma.js';

describe('Tenant Archive, Restore, Permanent Delete, Login Security & Self-Delete Suite', () => {
  let app: FastifyInstance;

  let superAdminTenantId: string;
  let superAdminUserId: string;
  let superAdminToken: string;

  const createdTenantIds: string[] = [];
  const originalEnablePermanentDelete = process.env.ENABLE_PERMANENT_DELETE;
  const originalRetentionDays = process.env.ARCHIVE_RETENTION_DAYS;

  before(async () => {
    // Strict safety assertion: NEVER run destructive tests against non-local database
    const dbUrl = process.env.DATABASE_URL || '';
    assert.ok(
      dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost'),
      `Refusing to run tests on non-local DATABASE_URL: ${dbUrl}`
    );
    assert.ok(
      !dbUrl.includes('aivencloud'),
      'Refusing to run tests on Aiven cloud database'
    );

    app = await buildApp();
    await app.ready();

    // Provision a dedicated Platform Host tenant & SUPER_ADMIN user
    superAdminTenantId = randomUUID();
    await prisma.tenant.create({
      data: {
        id: superAdminTenantId,
        name: 'Platform Host Archive Test',
        slug: `platform-archive-host-${Date.now()}`,
        currency: 'SDG',
        subscriptionStatus: 'ACTIVE',
        approvalStatus: 'APPROVED',
        maxRoutersLimit: 9999,
      },
    });
    createdTenantIds.push(superAdminTenantId);

    superAdminUserId = randomUUID();
    await prisma.user.create({
      data: {
        id: superAdminUserId,
        tenantId: superAdminTenantId,
        username: `super_archive_${Date.now()}`,
        email: `super_archive_${Date.now()}@local.test`,
        passwordHash: await hashPassword('SuperPass123!'),
        fullName: 'Super Admin Archive Tester',
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
      },
    });

    superAdminToken = signToken({
      userId: superAdminUserId,
      tenantId: superAdminTenantId,
      role: 'SUPER_ADMIN',
    });
  });

  after(async () => {
    if (originalEnablePermanentDelete === undefined) {
      delete process.env.ENABLE_PERMANENT_DELETE;
    } else {
      process.env.ENABLE_PERMANENT_DELETE = originalEnablePermanentDelete;
    }

    if (originalRetentionDays === undefined) {
      delete process.env.ARCHIVE_RETENTION_DAYS;
    } else {
      process.env.ARCHIVE_RETENTION_DAYS = originalRetentionDays;
    }

    for (const tId of createdTenantIds) {
      try {
        await prisma.saleItem.deleteMany({ where: { sale: { tenantId: tId } } });
        await prisma.sale.deleteMany({ where: { tenantId: tId } });
        await prisma.session.deleteMany({ where: { tenantId: tId } });
        await prisma.card.deleteMany({ where: { tenantId: tId } });
        await prisma.cardBatch.deleteMany({ where: { tenantId: tId } });
        await prisma.package.deleteMany({ where: { tenantId: tId } });
        await prisma.routerCredentials.deleteMany({ where: { router: { tenantId: tId } } });
        await prisma.router.deleteMany({ where: { tenantId: tId } });
        await prisma.auditLog.deleteMany({ where: { tenantId: tId } });
        await prisma.user.deleteMany({ where: { tenantId: tId } });
        await prisma.tenant.deleteMany({ where: { id: tId } });
      } catch (_) {}
    }

    await app.close();
  });

  // --------------------------------------------------------------------------
  // 1. Route Permissions & Access Control
  // --------------------------------------------------------------------------
  describe('1. Route Permissions & Access Control', () => {
    it('rejects unauthenticated (401) and non-SUPER_ADMIN (403) access to archive endpoints', async () => {
      const tenantToken = signToken({
        userId: randomUUID(),
        tenantId: randomUUID(),
        role: 'TENANT_ADMIN',
      });

      // Unauthenticated -> 401
      const unauthList = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/tenants/archived',
      });
      assert.strictEqual(unauthList.statusCode, 401);

      const unauthRestore = await app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/tenants/${randomUUID()}/restore`,
      });
      assert.strictEqual(unauthRestore.statusCode, 401);

      const unauthPerm = await app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/tenants/${randomUUID()}/permanent`,
      });
      assert.strictEqual(unauthPerm.statusCode, 401);

      const unauthSelfDelete = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/delete-account',
        payload: { password: 'Password123!' },
      });
      assert.strictEqual(unauthSelfDelete.statusCode, 401);

      // Non-SUPER_ADMIN -> 403
      const forbiddenList = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/tenants/archived',
        headers: { authorization: `Bearer ${tenantToken}` },
      });
      assert.strictEqual(forbiddenList.statusCode, 403);

      const forbiddenRestore = await app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/tenants/${randomUUID()}/restore`,
        headers: { authorization: `Bearer ${tenantToken}` },
      });
      assert.strictEqual(forbiddenRestore.statusCode, 403);

      const forbiddenPerm = await app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/tenants/${randomUUID()}/permanent`,
        headers: { authorization: `Bearer ${tenantToken}` },
      });
      assert.strictEqual(forbiddenPerm.statusCode, 403);
    });
  });

  // --------------------------------------------------------------------------
  // 2. Archiving, Listing Archived, Login Security, Restore (Valid & Expired)
  // --------------------------------------------------------------------------
  describe('2. Archive, List Archived, Login Security & Restore Lifecycle', () => {
    let lifecycleTenantId: string;
    let lifecycleAdminId: string;
    const lifecycleUsername = `arch_owner_${Date.now()}`;
    const lifecycleEmail = `arch_owner_${Date.now()}@local.test`;
    const lifecyclePassword = 'OwnerSecretPass123!';

    before(async () => {
      lifecycleTenantId = randomUUID();
      await prisma.tenant.create({
        data: {
          id: lifecycleTenantId,
          name: 'شركة الأرشيف التجريبية',
          slug: `archive-lifecycle-${Date.now()}`,
          contactEmail: lifecycleEmail,
          currency: 'SDG',
          status: 'ACTIVE',
          subscriptionStatus: 'ACTIVE',
          approvalStatus: 'APPROVED',
          trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          subscriptionEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          maxRoutersLimit: 5,
        },
      });
      createdTenantIds.push(lifecycleTenantId);

      lifecycleAdminId = randomUUID();
      await prisma.user.create({
        data: {
          id: lifecycleAdminId,
          tenantId: lifecycleTenantId,
          username: lifecycleUsername,
          email: lifecycleEmail,
          passwordHash: await hashPassword(lifecyclePassword),
          fullName: 'مالك شركة الأرشيف',
          role: 'TENANT_ADMIN',
          status: 'ACTIVE',
        },
      });
    });

    it('archives tenant via PATCH /api/v1/admin/tenants/:id/delete and saves previousSubscriptionStatus', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/tenants/${lifecycleTenantId}/delete`,
        headers: { authorization: `Bearer ${superAdminToken}` },
      });

      assert.strictEqual(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.isDeleted, true);

      const dbTenant = await prisma.tenant.findUniqueOrThrow({
        where: { id: lifecycleTenantId },
      });
      assert.strictEqual(dbTenant.isDeleted, true);
      assert.ok(dbTenant.deletedAt instanceof Date);
      assert.strictEqual(dbTenant.status, 'INACTIVE');
      assert.strictEqual(dbTenant.previousSubscriptionStatus, 'ACTIVE');
    });

    it('lists archived tenant in GET /api/v1/admin/tenants/archived with counts and remainingRetentionHours', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/tenants/archived',
        headers: { authorization: `Bearer ${superAdminToken}` },
      });

      assert.strictEqual(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.strictEqual(body.success, true);
      assert.ok(Array.isArray(body.data));

      const item = body.data.find((t: any) => t.id === lifecycleTenantId);
      assert.ok(item, 'Archived tenant should appear in /admin/tenants/archived');
      assert.strictEqual(item.usersCount, 1);
      assert.strictEqual(item.routersCount, 0);
      assert.strictEqual(item.cardsCount, 0);
      assert.strictEqual(item.salesCount, 0);
      assert.ok(item.remainingRetentionHours > 0 && item.remainingRetentionHours <= 720);
      assert.strictEqual(item.canPermanentDelete, false);
      assert.strictEqual(item.owner?.email, lifecycleEmail);
    });

    it('login with WRONG password to archived account returns 401 INVALID_CREDENTIALS (no status leak)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          identifier: lifecycleEmail,
          password: 'WrongPassword999!',
        },
      });

      assert.strictEqual(res.statusCode, 401);
      const body = JSON.parse(res.body);
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.errorCode, 'INVALID_CREDENTIALS');
      assert.strictEqual(body.errorMessage, 'بيانات الدخول غير صحيحة');
    });

    it('login with CORRECT password to archived account returns 403 ACCOUNT_INACTIVE with support message', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          identifier: lifecycleEmail,
          password: lifecyclePassword,
        },
      });

      assert.strictEqual(res.statusCode, 403);
      const body = JSON.parse(res.body);
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.errorCode, 'ACCOUNT_INACTIVE');
      assert.strictEqual(
        body.errorMessage,
        'هذا الحساب غير نشط حالياً. للاستفسار أو طلب استعادة الحساب، يرجى التواصل مع فريق الدعم الفني.'
      );
    });

    it('registration with archived account email or username returns 409 without mentioning "محذوف"', async () => {
      const emailConflictRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          networkName: 'شبكة جديدة',
          adminFullName: 'مستخدم جديد',
          username: `new_user_${Date.now()}`,
          email: lifecycleEmail,
          password: 'Password123!',
        },
      });

      assert.strictEqual(emailConflictRes.statusCode, 409);
      const emailBody = JSON.parse(emailConflictRes.body);
      assert.strictEqual(emailBody.errorCode, 'EMAIL_ALREADY_EXISTS');
      assert.ok(!emailBody.errorMessage.includes('محذوف'));

      const userConflictRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          networkName: 'شبكة جديدة 2',
          adminFullName: 'مستخدم جديد 2',
          username: lifecycleUsername,
          email: `unique_${Date.now()}@local.test`,
          password: 'Password123!',
        },
      });

      assert.strictEqual(userConflictRes.statusCode, 409);
      const userBody = JSON.parse(userConflictRes.body);
      assert.strictEqual(userBody.errorCode, 'USERNAME_ALREADY_EXISTS');
      assert.ok(!userBody.errorMessage.includes('محذوف'));
    });

    it('restores archived tenant with valid subscription back to ACTIVE and allows login', async () => {
      const restoreRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/tenants/${lifecycleTenantId}/restore`,
        headers: { authorization: `Bearer ${superAdminToken}` },
      });

      assert.strictEqual(restoreRes.statusCode, 200);
      const restoreBody = JSON.parse(restoreRes.body);
      assert.strictEqual(restoreBody.success, true);
      assert.strictEqual(restoreBody.data.isDeleted, false);
      assert.strictEqual(restoreBody.data.deletedAt, null);
      assert.strictEqual(restoreBody.data.status, 'ACTIVE');
      assert.strictEqual(restoreBody.data.subscriptionStatus, 'ACTIVE');

      const loginRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          identifier: lifecycleEmail,
          password: lifecyclePassword,
        },
      });
      assert.strictEqual(loginRes.statusCode, 200);
    });

    it('restores archived tenant with expired subscriptionEndsAt/trialEndsAt to EXPIRED status', async () => {
      // Archive again and set subscriptionEndsAt in the past
      await app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/tenants/${lifecycleTenantId}/delete`,
        headers: { authorization: `Bearer ${superAdminToken}` },
      });

      await prisma.tenant.update({
        where: { id: lifecycleTenantId },
        data: {
          subscriptionEndsAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        },
      });

      const restoreRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/tenants/${lifecycleTenantId}/restore`,
        headers: { authorization: `Bearer ${superAdminToken}` },
      });

      assert.strictEqual(restoreRes.statusCode, 200);
      const restoreBody = JSON.parse(restoreRes.body);
      assert.strictEqual(restoreBody.success, true);
      assert.strictEqual(restoreBody.data.isDeleted, false);
      assert.strictEqual(restoreBody.data.status, 'ACTIVE');
      assert.strictEqual(restoreBody.data.subscriptionStatus, 'EXPIRED');
    });
  });

  // --------------------------------------------------------------------------
  // 3. Self-Service Account Deletion (POST /api/v1/auth/delete-account)
  // --------------------------------------------------------------------------
  describe('3. Self-Service Account Deletion (POST /api/v1/auth/delete-account)', () => {
    let selfTenantId: string;
    let ownerUserId: string;
    let operatorUserId: string;
    let ownerToken: string;
    let operatorToken: string;
    const ownerPass = 'OwnerPass123!';
    const operatorPass = 'OperatorPass123!';

    before(async () => {
      selfTenantId = randomUUID();
      await prisma.tenant.create({
        data: {
          id: selfTenantId,
          name: 'شبكة الحذف الذاتي',
          slug: `self-del-net-${Date.now()}`,
          currency: 'SDG',
          status: 'ACTIVE',
          subscriptionStatus: 'TRIAL',
          approvalStatus: 'APPROVED',
          trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });
      createdTenantIds.push(selfTenantId);

      ownerUserId = randomUUID();
      await prisma.user.create({
        data: {
          id: ownerUserId,
          tenantId: selfTenantId,
          username: `self_owner_${Date.now()}`,
          email: `self_owner_${Date.now()}@local.test`,
          passwordHash: await hashPassword(ownerPass),
          fullName: 'مالك الشبكة',
          role: 'TENANT_ADMIN',
          status: 'ACTIVE',
        },
      });
      ownerToken = signToken({
        userId: ownerUserId,
        tenantId: selfTenantId,
        role: 'TENANT_ADMIN',
      });

      operatorUserId = randomUUID();
      await prisma.user.create({
        data: {
          id: operatorUserId,
          tenantId: selfTenantId,
          username: `self_op_${Date.now()}`,
          email: `self_op_${Date.now()}@local.test`,
          passwordHash: await hashPassword(operatorPass),
          fullName: 'موظف المبيعات',
          role: 'OPERATOR',
          status: 'ACTIVE',
        },
      });
      operatorToken = signToken({
        userId: operatorUserId,
        tenantId: selfTenantId,
        role: 'OPERATOR',
      });
    });

    it('forbids SUPER_ADMIN from deleting their account (403)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/delete-account',
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: { password: 'SuperPass123!' },
      });

      assert.strictEqual(res.statusCode, 403);
      const body = JSON.parse(res.body);
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.errorCode, 'SUPER_ADMIN_DELETION_FORBIDDEN');
    });

    it('rejects self-delete when password is wrong (401 INVALID_CREDENTIALS)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/delete-account',
        headers: { authorization: `Bearer ${operatorToken}` },
        payload: { password: 'WrongPassword!' },
      });

      assert.strictEqual(res.statusCode, 401);
      const body = JSON.parse(res.body);
      assert.strictEqual(body.errorCode, 'INVALID_CREDENTIALS');
    });

    it('deactivates only the staff user when OPERATOR calls POST /auth/delete-account', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/delete-account',
        headers: { authorization: `Bearer ${operatorToken}` },
        payload: { password: operatorPass },
      });

      assert.strictEqual(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.scope, 'USER_DEACTIVATED');

      const dbOperator = await prisma.user.findUniqueOrThrow({ where: { id: operatorUserId } });
      assert.strictEqual(dbOperator.status, 'INACTIVE');

      const dbTenant = await prisma.tenant.findUniqueOrThrow({ where: { id: selfTenantId } });
      assert.strictEqual(dbTenant.isDeleted, false);

      const audit = await prisma.auditLog.findFirst({
        where: {
          tenantId: selfTenantId,
          userId: operatorUserId,
          action: 'DELETE',
          entityType: 'User',
        },
      });
      assert.ok(audit);
      assert.match(audit.description, /طلب ذاتي/);
    });

    it('archives the tenant and logs "طلب ذاتي" when TENANT_ADMIN calls POST /auth/delete-account', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/delete-account',
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { password: ownerPass },
      });

      assert.strictEqual(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.scope, 'TENANT_ARCHIVED');

      const dbTenant = await prisma.tenant.findUniqueOrThrow({ where: { id: selfTenantId } });
      assert.strictEqual(dbTenant.isDeleted, true);
      assert.ok(dbTenant.deletedAt instanceof Date);
      assert.strictEqual(dbTenant.status, 'INACTIVE');
      assert.strictEqual(dbTenant.previousSubscriptionStatus, 'TRIAL');

      const audit = await prisma.auditLog.findFirst({
        where: {
          tenantId: selfTenantId,
          userId: ownerUserId,
          action: 'DELETE',
          entityType: 'Tenant',
        },
      });
      assert.ok(audit);
      assert.match(audit.description, /طلب ذاتي/);
    });
  });

  // --------------------------------------------------------------------------
  // 4. Permanent Delete Guards, Full Relational Cascade & Email Liberation
  // --------------------------------------------------------------------------
  describe('4. Permanent Delete Guards, Relational Cascade, AuditLog Preservation & Re-Registration', () => {
    let permTenantId: string;
    let permOwnerId: string;
    const permTenantName = 'شبكة الحذف النهائي المتكاملة';
    const permUsername = `perm_owner_${Date.now()}`;
    const permEmail = `perm_owner_${Date.now()}@local.test`;
    const permPassword = 'PermPassword123!';

    before(async () => {
      permTenantId = randomUUID();
      await prisma.tenant.create({
        data: {
          id: permTenantId,
          name: permTenantName,
          slug: `perm-del-net-${Date.now()}`,
          contactEmail: permEmail,
          currency: 'SDG',
          status: 'ACTIVE',
          subscriptionStatus: 'ACTIVE',
          approvalStatus: 'APPROVED',
        },
      });
      createdTenantIds.push(permTenantId);

      permOwnerId = randomUUID();
      await prisma.user.create({
        data: {
          id: permOwnerId,
          tenantId: permTenantId,
          username: permUsername,
          email: permEmail,
          passwordHash: await hashPassword(permPassword),
          fullName: 'مالك شبكة الحذف النهائي',
          role: 'TENANT_ADMIN',
          status: 'ACTIVE',
        },
      });

      // Seed interconnected relational records (Router, Credentials, Package, CardBatch, Card, Sale, SaleItem, Session)
      const routerId = randomUUID();
      await prisma.router.create({
        data: {
          id: routerId,
          tenantId: permTenantId,
          name: 'Main MikroTik Router',
          host: '10.10.10.1',
          apiPort: 8728,
        },
      });

      await prisma.routerCredentials.create({
        data: {
          routerId,
          username: 'admin',
          encryptedPassword: 'enc',
          encryptionIv: 'iv',
          encryptionTag: 'tag',
        },
      });

      const packageId = randomUUID();
      await prisma.package.create({
        data: {
          id: packageId,
          tenantId: permTenantId,
          name: 'باقة يومية',
          code: 'DAILY-1',
          downloadSpeedLimit: '4M',
          uploadSpeedLimit: '2M',
          durationMinutes: 1440,
          validityDays: 1,
          price: 500,
          hotspotProfileName: 'default',
        },
      });

      const batchId = randomUUID();
      await prisma.cardBatch.create({
        data: {
          id: batchId,
          tenantId: permTenantId,
          packageId,
          createdById: permOwnerId,
          batchNumber: 'BATCH-001',
          name: 'دفعة تجريبية',
          quantity: 1,
          unitPrice: 500,
          totalPrice: 500,
        },
      });

      const cardId = randomUUID();
      await prisma.card.create({
        data: {
          id: cardId,
          tenantId: permTenantId,
          batchId,
          packageId,
          routerId,
          username: '99887766',
          password: '',
          status: 'SOLD',
          price: 500,
        },
      });

      await prisma.session.create({
        data: {
          id: randomUUID(),
          tenantId: permTenantId,
          cardId,
          routerId,
          startedAt: new Date(),
          isActive: false,
        },
      });

      const saleId = randomUUID();
      await prisma.sale.create({
        data: {
          id: saleId,
          tenantId: permTenantId,
          soldById: permOwnerId,
          totalAmount: 500,
          paymentMethod: 'CASH',
        },
      });

      await prisma.saleItem.create({
        data: {
          id: randomUUID(),
          saleId,
          cardId,
          unitPrice: 500,
        },
      });
    });

    it('rejects permanent delete when ENABLE_PERMANENT_DELETE is not enabled (default disabled -> 403)', async () => {
      delete process.env.ENABLE_PERMANENT_DELETE;

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/tenants/${permTenantId}/permanent`,
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: { confirmName: permTenantName },
      });

      assert.strictEqual(res.statusCode, 403);
      const body = JSON.parse(res.body);
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.errorCode, 'PERMANENT_DELETE_DISABLED');
    });

    it('rejects permanent delete on protected default/platform tenant (403 PROTECTED_TENANT)', async () => {
      process.env.ENABLE_PERMANENT_DELETE = 'true';

      const defaultTenant = await prisma.tenant.findFirst({
        where: { slug: { in: ['default', 'soft-zone-platform'] } },
      });

      if (defaultTenant) {
        const res = await app.inject({
          method: 'DELETE',
          url: `/api/v1/admin/tenants/${defaultTenant.id}/permanent`,
          headers: { authorization: `Bearer ${superAdminToken}` },
          payload: { confirmName: defaultTenant.name },
        });
        assert.strictEqual(res.statusCode, 403);
        assert.strictEqual(JSON.parse(res.body).errorCode, 'PROTECTED_TENANT');
      }
    });

    it('rejects permanent delete when tenant is not yet archived (400 TENANT_NOT_ARCHIVED)', async () => {
      process.env.ENABLE_PERMANENT_DELETE = 'true';

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/tenants/${permTenantId}/permanent`,
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: { confirmName: permTenantName },
      });

      assert.strictEqual(res.statusCode, 400);
      const body = JSON.parse(res.body);
      assert.strictEqual(body.errorCode, 'TENANT_NOT_ARCHIVED');
    });

    it('rejects permanent delete before ARCHIVE_RETENTION_DAYS has elapsed (400 RETENTION_PERIOD_NOT_ELAPSED)', async () => {
      process.env.ENABLE_PERMANENT_DELETE = 'true';
      process.env.ARCHIVE_RETENTION_DAYS = '30';

      // Archive the tenant first
      const archiveRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/tenants/${permTenantId}/delete`,
        headers: { authorization: `Bearer ${superAdminToken}` },
      });
      assert.strictEqual(archiveRes.statusCode, 200);

      // Attempt permanent delete immediately -> must be rejected
      const permRes = await app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/tenants/${permTenantId}/permanent`,
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: { confirmName: permTenantName },
      });

      assert.strictEqual(permRes.statusCode, 400);
      const body = JSON.parse(permRes.body);
      assert.strictEqual(body.errorCode, 'RETENTION_PERIOD_NOT_ELAPSED');
    });

    it('rejects permanent delete after retention period if confirmName is missing or does not match literally (400)', async () => {
      process.env.ENABLE_PERMANENT_DELETE = 'true';
      process.env.ARCHIVE_RETENTION_DAYS = '30';

      // Backdate deletedAt to 31 days ago
      await prisma.tenant.update({
        where: { id: permTenantId },
        data: {
          deletedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
        },
      });

      // Missing confirmName
      const missingNameRes = await app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/tenants/${permTenantId}/permanent`,
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: {},
      });
      assert.strictEqual(missingNameRes.statusCode, 400);
      assert.strictEqual(JSON.parse(missingNameRes.body).errorCode, 'CONFIRM_NAME_MISMATCH');

      // Partial/wrong confirmName
      const wrongNameRes = await app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/tenants/${permTenantId}/permanent`,
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: { confirmName: 'شبكة الحذف النهائي' },
      });
      assert.strictEqual(wrongNameRes.statusCode, 400);
      assert.strictEqual(JSON.parse(wrongNameRes.body).errorCode, 'CONFIRM_NAME_MISMATCH');
    });

    it('permanently deletes archived tenant with all relational data in transaction and preserves AuditLog under platform tenant', async () => {
      process.env.ENABLE_PERMANENT_DELETE = 'true';
      process.env.ARCHIVE_RETENTION_DAYS = '30';

      const permRes = await app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/tenants/${permTenantId}/permanent`,
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: { confirmName: permTenantName },
      });

      assert.strictEqual(permRes.statusCode, 200);
      const body = JSON.parse(permRes.body);
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.deletedTenantId, permTenantId);
      assert.strictEqual(body.data.auditTenantId, superAdminTenantId);
      assert.ok(body.data.auditLogId);

      // Verify all tenant data is completely wiped from database
      assert.strictEqual(await prisma.tenant.count({ where: { id: permTenantId } }), 0);
      assert.strictEqual(await prisma.user.count({ where: { tenantId: permTenantId } }), 0);
      assert.strictEqual(await prisma.router.count({ where: { tenantId: permTenantId } }), 0);
      assert.strictEqual(await prisma.package.count({ where: { tenantId: permTenantId } }), 0);
      assert.strictEqual(await prisma.cardBatch.count({ where: { tenantId: permTenantId } }), 0);
      assert.strictEqual(await prisma.card.count({ where: { tenantId: permTenantId } }), 0);
      assert.strictEqual(await prisma.sale.count({ where: { tenantId: permTenantId } }), 0);
      assert.strictEqual(await prisma.session.count({ where: { tenantId: permTenantId } }), 0);

      // Verify AuditLog record survived under the platform tenant with full summary
      const survivingLog = await prisma.auditLog.findUnique({
        where: { id: body.data.auditLogId },
      });
      assert.ok(survivingLog, 'Permanent delete AuditLog must survive under platform tenant');
      assert.strictEqual(survivingLog.tenantId, superAdminTenantId);
      assert.strictEqual(survivingLog.entityType, 'Tenant');
      assert.strictEqual(survivingLog.entityId, permTenantId);
      assert.match(survivingLog.description, /حذف نهائي للشبكة المؤرشفة/);
    });

    it('allows registering a new account with the same email and username after permanent delete (201)', async () => {
      const registerRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          networkName: 'شبكة جديدة بعد التحرير',
          adminFullName: 'مالك جديد بنفس البريد',
          username: permUsername,
          email: permEmail,
          password: 'NewStrongPass123!',
          phone: '0912345678',
        },
      });

      assert.strictEqual(registerRes.statusCode, 201);
      const regBody = JSON.parse(registerRes.body);
      assert.strictEqual(regBody.success, true);
      assert.strictEqual(regBody.data.user.email, permEmail);
      assert.strictEqual(regBody.data.user.username, permUsername);

      if (regBody.data.tenant?.id) {
        createdTenantIds.push(regBody.data.tenant.id);
      }
    });
  });

  // --------------------------------------------------------------------------
  // 5. Comprehensive Login Matrix (All States + Wrong Password + Archived Staff)
  // --------------------------------------------------------------------------
  describe('5. Comprehensive Login Matrix (All States + Wrong Password + Archived Staff)', () => {
    const validPass = 'MatrixPass123!';
    const wrongPass = 'WrongMatrixPass999!';

    let activeTenantId: string;
    let activeUserEmail: string;
    let inactiveUserUsername: string;

    let pendingTenantId: string;
    let pendingUserUsername: string;

    let suspendedTenantId: string;
    let suspendedUserUsername: string;

    let expiredTrialTenantId: string;
    let expiredTrialUsername: string;

    let archivedTenantId: string;
    let archivedStaffUsername: string;

    before(async () => {
      const ts = Date.now();
      const hashed = await hashPassword(validPass);

      // 1. Active Tenant (with normal active user + inactive user)
      activeTenantId = randomUUID();
      await prisma.tenant.create({
        data: {
          id: activeTenantId,
          name: 'Active Matrix Network',
          slug: `matrix-active-${ts}`,
          status: 'ACTIVE',
          subscriptionStatus: 'ACTIVE',
          approvalStatus: 'APPROVED',
        },
      });
      createdTenantIds.push(activeTenantId);

      activeUserEmail = `matrix_active_${ts}@local.test`;
      await prisma.user.create({
        data: {
          id: randomUUID(),
          tenantId: activeTenantId,
          username: `matrix_active_${ts}`,
          email: activeUserEmail,
          passwordHash: hashed,
          fullName: 'Active Owner',
          role: 'TENANT_ADMIN',
          status: 'ACTIVE',
        },
      });

      inactiveUserUsername = `matrix_inactive_${ts}`;
      await prisma.user.create({
        data: {
          id: randomUUID(),
          tenantId: activeTenantId,
          username: inactiveUserUsername,
          passwordHash: hashed,
          fullName: 'Inactive Staff',
          role: 'OPERATOR',
          status: 'INACTIVE',
        },
      });

      // 2. Pending Approval Tenant
      pendingTenantId = randomUUID();
      await prisma.tenant.create({
        data: {
          id: pendingTenantId,
          name: 'Pending Matrix Network',
          slug: `matrix-pending-${ts}`,
          status: 'ACTIVE',
          subscriptionStatus: 'TRIAL',
          approvalStatus: 'PENDING',
        },
      });
      createdTenantIds.push(pendingTenantId);

      pendingUserUsername = `matrix_pending_${ts}`;
      await prisma.user.create({
        data: {
          id: randomUUID(),
          tenantId: pendingTenantId,
          username: pendingUserUsername,
          passwordHash: hashed,
          fullName: 'Pending Owner',
          role: 'TENANT_ADMIN',
          status: 'ACTIVE',
        },
      });

      // 3. Suspended Tenant
      suspendedTenantId = randomUUID();
      await prisma.tenant.create({
        data: {
          id: suspendedTenantId,
          name: 'Suspended Matrix Network',
          slug: `matrix-suspended-${ts}`,
          status: 'ACTIVE',
          subscriptionStatus: 'SUSPENDED',
          approvalStatus: 'APPROVED',
        },
      });
      createdTenantIds.push(suspendedTenantId);

      suspendedUserUsername = `matrix_suspended_${ts}`;
      await prisma.user.create({
        data: {
          id: randomUUID(),
          tenantId: suspendedTenantId,
          username: suspendedUserUsername,
          passwordHash: hashed,
          fullName: 'Suspended Owner',
          role: 'TENANT_ADMIN',
          status: 'ACTIVE',
        },
      });

      // 4. Expired Trial Tenant
      expiredTrialTenantId = randomUUID();
      await prisma.tenant.create({
        data: {
          id: expiredTrialTenantId,
          name: 'Expired Trial Matrix Network',
          slug: `matrix-expired-${ts}`,
          status: 'ACTIVE',
          subscriptionStatus: 'EXPIRED',
          approvalStatus: 'APPROVED',
          trialEndsAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
        },
      });
      createdTenantIds.push(expiredTrialTenantId);

      expiredTrialUsername = `matrix_expired_${ts}`;
      await prisma.user.create({
        data: {
          id: randomUUID(),
          tenantId: expiredTrialTenantId,
          username: expiredTrialUsername,
          passwordHash: hashed,
          fullName: 'Expired Trial Owner',
          role: 'TENANT_ADMIN',
          status: 'ACTIVE',
        },
      });

      // 5. Archived Tenant with an Employee (OPERATOR, not TENANT_ADMIN)
      archivedTenantId = randomUUID();
      await prisma.tenant.create({
        data: {
          id: archivedTenantId,
          name: 'Archived Matrix Network',
          slug: `matrix-archived-${ts}`,
          status: 'INACTIVE',
          subscriptionStatus: 'ACTIVE',
          approvalStatus: 'APPROVED',
          isDeleted: true,
          deletedAt: new Date(),
        },
      });
      createdTenantIds.push(archivedTenantId);

      archivedStaffUsername = `matrix_arch_staff_${ts}`;
      await prisma.user.create({
        data: {
          id: randomUUID(),
          tenantId: archivedTenantId,
          username: archivedStaffUsername,
          passwordHash: hashed,
          fullName: 'Archived Network Employee',
          role: 'OPERATOR',
          status: 'ACTIVE',
        },
      });
    });

    it('1) Normal Active User: wrong password -> 401, right password -> 200 with JWT', async () => {
      const wrongRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { identifier: activeUserEmail, password: wrongPass },
      });
      assert.strictEqual(wrongRes.statusCode, 401);
      assert.strictEqual(JSON.parse(wrongRes.body).errorCode, 'INVALID_CREDENTIALS');

      const okRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { identifier: activeUserEmail, password: validPass },
      });
      assert.strictEqual(okRes.statusCode, 200);
      assert.ok(JSON.parse(okRes.body).data.token);
    });

    it('2) New Device (OTP challenge in NODE_ENV=test): wrong password -> 401, right password -> 200 requiresDeviceVerification', async () => {
      const wrongRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          identifier: activeUserEmail,
          password: wrongPass,
          deviceFingerprint: `fp-new-${Date.now()}`,
          deviceLabel: 'Test Android Phone',
        },
      });
      assert.strictEqual(wrongRes.statusCode, 401);
      assert.strictEqual(JSON.parse(wrongRes.body).errorCode, 'INVALID_CREDENTIALS');

      const otpRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          identifier: activeUserEmail,
          password: validPass,
          deviceFingerprint: `fp-new-${Date.now()}`,
          deviceLabel: 'Test Android Phone',
        },
      });
      assert.strictEqual(otpRes.statusCode, 200);
      const body = JSON.parse(otpRes.body);
      assert.strictEqual(body.data.requiresDeviceVerification, true);
      assert.ok(body.data.tempToken);
    });

    it('3) Pending Tenant (PENDING): wrong password -> 401, right password -> 403 ACCOUNT_PENDING_APPROVAL', async () => {
      const wrongRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { identifier: pendingUserUsername, password: wrongPass },
      });
      assert.strictEqual(wrongRes.statusCode, 401);
      assert.strictEqual(JSON.parse(wrongRes.body).errorCode, 'INVALID_CREDENTIALS');

      const pendingRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { identifier: pendingUserUsername, password: validPass },
      });
      assert.strictEqual(pendingRes.statusCode, 403);
      assert.strictEqual(JSON.parse(pendingRes.body).errorCode, 'ACCOUNT_PENDING_APPROVAL');
    });

    it('4) Suspended Tenant (SUSPENDED): wrong password -> 401, right password -> 403 ACCOUNT_INACTIVE', async () => {
      const wrongRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { identifier: suspendedUserUsername, password: wrongPass },
      });
      assert.strictEqual(wrongRes.statusCode, 401);
      assert.strictEqual(JSON.parse(wrongRes.body).errorCode, 'INVALID_CREDENTIALS');

      const suspRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { identifier: suspendedUserUsername, password: validPass },
      });
      assert.strictEqual(suspRes.statusCode, 403);
      const body = JSON.parse(suspRes.body);
      assert.strictEqual(body.errorCode, 'ACCOUNT_INACTIVE');
      assert.strictEqual(body.errorMessage, 'تم إيقاف هذا الحساب مؤقتاً، يرجى التواصل مع إدارة المنصة');
    });

    it('5) Expired Trial Tenant (EXPIRED): wrong password -> 401, right password -> 200 (allows login for renewal)', async () => {
      const wrongRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { identifier: expiredTrialUsername, password: wrongPass },
      });
      assert.strictEqual(wrongRes.statusCode, 401);
      assert.strictEqual(JSON.parse(wrongRes.body).errorCode, 'INVALID_CREDENTIALS');

      const okRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { identifier: expiredTrialUsername, password: validPass },
      });
      assert.strictEqual(okRes.statusCode, 200);
      assert.ok(JSON.parse(okRes.body).data.token);
    });

    it('6) Inactive User (INACTIVE): wrong password -> 401, right password -> 403 ACCOUNT_INACTIVE', async () => {
      const wrongRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { identifier: inactiveUserUsername, password: wrongPass },
      });
      assert.strictEqual(wrongRes.statusCode, 401);
      assert.strictEqual(JSON.parse(wrongRes.body).errorCode, 'INVALID_CREDENTIALS');

      const inactiveRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { identifier: inactiveUserUsername, password: validPass },
      });
      assert.strictEqual(inactiveRes.statusCode, 403);
      const body = JSON.parse(inactiveRes.body);
      assert.strictEqual(body.errorCode, 'ACCOUNT_INACTIVE');
      assert.strictEqual(body.errorMessage, 'هذا الحساب معطل، يرجى التواصل مع مسؤول النظام');
    });

    it('7) Super Admin (SUPER_ADMIN): wrong password -> 401, right password -> 200 with SUPER_ADMIN role', async () => {
      const superUser = await prisma.user.findUniqueOrThrow({ where: { id: superAdminUserId } });

      const wrongRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { identifier: superUser.username, password: wrongPass },
      });
      assert.strictEqual(wrongRes.statusCode, 401);
      assert.strictEqual(JSON.parse(wrongRes.body).errorCode, 'INVALID_CREDENTIALS');

      const okRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { identifier: superUser.username, password: 'SuperPass123!' },
      });
      assert.strictEqual(okRes.statusCode, 200);
      const body = JSON.parse(okRes.body);
      assert.strictEqual(body.data.user.role, 'SUPER_ADMIN');
    });

    it('8) Employee (OPERATOR) of an Archived Tenant: wrong password -> 401, right password -> 403 ACCOUNT_INACTIVE with unified support message', async () => {
      const wrongRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { identifier: archivedStaffUsername, password: wrongPass },
      });
      assert.strictEqual(wrongRes.statusCode, 401);
      assert.strictEqual(JSON.parse(wrongRes.body).errorCode, 'INVALID_CREDENTIALS');

      const rightRes = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { identifier: archivedStaffUsername, password: validPass },
      });
      assert.strictEqual(rightRes.statusCode, 403);
      const body = JSON.parse(rightRes.body);
      assert.strictEqual(body.errorCode, 'ACCOUNT_INACTIVE');
      assert.strictEqual(
        body.errorMessage,
        'هذا الحساب غير نشط حالياً. للاستفسار أو طلب استعادة الحساب، يرجى التواصل مع فريق الدعم الفني.'
      );
    });
  });
});
