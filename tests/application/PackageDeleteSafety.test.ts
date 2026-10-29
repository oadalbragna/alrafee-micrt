// ============================================================================
// Platform: Commercial MikroTik Network & HotSpot Card Management System
// File: tests/application/PackageDeleteSafety.test.ts
// Unit Tests: Safe Package Deletion, RestrictViolation Guard, & Error Sanitization
// Master Reference: Rule 16 (Ports & Adapters), Rule 19 (Validation & Error Handling)
// ============================================================================

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  IPackageRepository,
  Package,
  PackageUsage,
  CreatePackageData,
  UpdatePackageData,
} from '../../src/application/interfaces/IPackageRepository.js';
import { IAuditLogger } from '../../src/application/interfaces/IAuditLogger.js';
import { DeletePackageUseCase } from '../../src/application/use-cases/packages/DeletePackageUseCase.js';
import { PackageInUseException } from '../../src/domain/exceptions/PackageInUseException.js';
import { handlePrismaOrServerError } from '../../src/presentation/http/errors/prismaErrorHandler.js';

class InMemoryAuditLogger implements IAuditLogger {
  public logs: Array<{
    tenantId: string;
    userId: string | null;
    action: string;
    entityType: string;
    entityId: string | null;
    description: string;
    result: string;
  }> = [];

  async log(
    tenantId: string,
    userId: string | null,
    action: string,
    entityType: string,
    entityId: string | null,
    description: string,
    result: string = 'SUCCESS'
  ): Promise<void> {
    this.logs.push({ tenantId, userId, action, entityType, entityId, description, result });
  }
}

class FakePackageRepository implements IPackageRepository {
  public packages: Package[] = [];
  public usageMap = new Map<string, { cardsCount: number; batchesCount: number }>();
  public simulateRestrictViolationOnDelete = false;
  public simulateGenericPrismaCrashOnDelete = false;

  async create(data: CreatePackageData): Promise<Package> {
    const pkg: Package = {
      id: `pkg-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      tenantId: data.tenantId,
      name: data.name,
      code: data.code,
      downloadSpeedLimit: data.downloadSpeedLimit,
      uploadSpeedLimit: data.uploadSpeedLimit,
      durationMinutes: data.durationMinutes,
      validityDays: data.validityDays,
      dataLimitBytes: BigInt(0),
      price: data.price,
      currency: 'SDG',
      simultaneousSessions: 1,
      hotspotProfileName: data.hotspotProfileName,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.packages.push(pkg);
    return pkg;
  }

  async findById(id: string, tenantId: string): Promise<Package | null> {
    const found = this.packages.find((p) => p.id === id && p.tenantId === tenantId);
    return found ? { ...found } : null;
  }

  async findAllByTenant(tenantId: string): Promise<Package[]> {
    return this.packages.filter((p) => p.tenantId === tenantId);
  }

  async update(id: string, tenantId: string, data: UpdatePackageData): Promise<Package> {
    const index = this.packages.findIndex((p) => p.id === id && p.tenantId === tenantId);
    if (index === -1) throw new Error('Package not found');
    const updated = { ...this.packages[index]!, ...data, updatedAt: new Date() };
    this.packages[index] = updated;
    return updated;
  }

  async checkUsage(id: string, tenantId: string): Promise<PackageUsage> {
    const usage = this.usageMap.get(id) ?? { cardsCount: 0, batchesCount: 0 };
    return {
      inUse: usage.cardsCount > 0 || usage.batchesCount > 0,
      cardsCount: usage.cardsCount,
      batchesCount: usage.batchesCount,
    };
  }

  async delete(id: string, tenantId: string): Promise<void> {
    if (this.simulateRestrictViolationOnDelete) {
      // Simulate raw Prisma WASM RestrictViolation
      throw new Error(
        'Invalid prisma.package.delete() invocation:\n\nWASM_ERROR\nunknown variant RestrictViolation, expected one of Custom, Database, etc.'
      );
    }

    if (this.simulateGenericPrismaCrashOnDelete) {
      throw new Error(
        'Invalid `prisma.package.delete()` invocation:\n\nCan\'t reach database server at `127.0.0.1:5432`\n    at LibraryEngine.ts:217'
      );
    }

    const index = this.packages.findIndex((p) => p.id === id && p.tenantId === tenantId);
    if (index === -1) {
      throw new Error(`Package with id ${id} not found for tenant ${tenantId}`);
    }
    this.packages.splice(index, 1);
  }
}

// Mock Fastify Reply & Logger for HTTP presentation handler tests
class MockFastifyReply {
  public statusCode = 200;
  public sentPayload: any = null;

  status(code: number) {
    this.statusCode = code;
    return this;
  }

  send(payload: any) {
    this.sentPayload = payload;
    return this;
  }
}

const mockLogger: any = {
  error: () => {},
  warn: () => {},
  info: () => {},
};

describe('Safe Package Deletion & Error Handling Unit Tests', () => {
  const TENANT_ID = 'tenant-audit-123';
  const USER_ID = 'user-admin-456';

  let repo: FakePackageRepository;
  let auditLogger: InMemoryAuditLogger;
  let deleteUseCase: DeletePackageUseCase;

  beforeEach(() => {
    repo = new FakePackageRepository();
    auditLogger = new InMemoryAuditLogger();
    deleteUseCase = new DeletePackageUseCase(repo, auditLogger);
  });

  // --------------------------------------------------------------------------
  // Requirement 5.1: Unused Package Deletion (Success)
  // --------------------------------------------------------------------------
  it('1. should successfully delete an unused package with no linked cards or batches', async () => {
    const pkg = await repo.create({
      tenantId: TENANT_ID,
      name: 'باقة تجريبية فارغة',
      code: 'TEST-EMPTY',
      downloadSpeedLimit: '5M',
      uploadSpeedLimit: '2M',
      durationMinutes: 60,
      validityDays: 1,
      price: 100,
      hotspotProfileName: 'default',
    });

    // Verify it is initially unused
    const usage = await repo.checkUsage(pkg.id, TENANT_ID);
    assert.strictEqual(usage.inUse, false);

    // Execute deletion
    await deleteUseCase.execute({
      id: pkg.id,
      tenantId: TENANT_ID,
      userId: USER_ID,
    });

    // Assert package was removed
    const remaining = await repo.findById(pkg.id, TENANT_ID);
    assert.strictEqual(remaining, null);

    // Assert audit log was recorded
    assert.strictEqual(auditLogger.logs.length, 1);
    assert.strictEqual(auditLogger.logs[0]?.action, 'DELETE');
    assert.strictEqual(auditLogger.logs[0]?.result, 'SUCCESS');
  });

  // --------------------------------------------------------------------------
  // Requirement 5.2: In-Use Package (Cards / Batches Linked) -> Conflict (409)
  // --------------------------------------------------------------------------
  it('2. should reject deleting package linked to active cards and throw PackageInUseException with Arabic guidance', async () => {
    const pkg = await repo.create({
      tenantId: TENANT_ID,
      name: 'باقة يومية 1GB',
      code: 'DAILY-1G',
      downloadSpeedLimit: '5M',
      uploadSpeedLimit: '2M',
      durationMinutes: 1440,
      validityDays: 1,
      price: 500,
      hotspotProfileName: 'default',
    });

    // Mark package as in use by 50 cards and 2 batches
    repo.usageMap.set(pkg.id, { cardsCount: 50, batchesCount: 2 });

    await assert.rejects(
      async () => {
        await deleteUseCase.execute({
          id: pkg.id,
          tenantId: TENANT_ID,
          userId: USER_ID,
        });
      },
      (err: any) => {
        assert.ok(err instanceof PackageInUseException);
        assert.strictEqual(err.name, 'PackageInUseException');
        assert.strictEqual(err.errorCode, 'PACKAGE_IN_USE');
        assert.strictEqual(err.cardsCount, 50);
        assert.strictEqual(err.batchesCount, 2);
        assert.ok(err.message.includes('لا يمكن حذف باقة مرتبطة بكروت'));
        return true;
      }
    );

    // Verify package was NOT deleted
    const stillExists = await repo.findById(pkg.id, TENANT_ID);
    assert.ok(stillExists !== null);
    assert.strictEqual(stillExists?.id, pkg.id);
  });

  // --------------------------------------------------------------------------
  // Requirement 5.3: Presentation Layer Error Sanitization (409 on In-Use)
  // --------------------------------------------------------------------------
  it('3. handlePrismaOrServerError should map PackageInUseException to HTTP 409 with clear Arabic message', () => {
    const reply = new MockFastifyReply();
    const exception = new PackageInUseException('لا يمكن حذف باقة مرتبطة بكروت أو دفعات سابقة', 10, 1);

    handlePrismaOrServerError(exception, reply as any, mockLogger);

    assert.strictEqual(reply.statusCode, 409);
    assert.strictEqual(reply.sentPayload.success, false);
    assert.strictEqual(reply.sentPayload.errorCode, 'PACKAGE_IN_USE');
    assert.strictEqual(reply.sentPayload.errorMessage, 'لا يمكن حذف باقة مرتبطة بكروت أو دفعات سابقة');
    assert.strictEqual(reply.sentPayload.details.cardsCount, 10);
  });

  // --------------------------------------------------------------------------
  // Requirement 5.4: Intercepting WASM_ERROR RestrictViolation into Safe 409
  // --------------------------------------------------------------------------
  it('4. handlePrismaOrServerError should catch raw WASM_ERROR RestrictViolation and convert it to HTTP 409 without leaking internal error', () => {
    const reply = new MockFastifyReply();
    const rawWasmError = new Error(
      'Invalid prisma.package.delete() invocation:\n\nWASM_ERROR\nunknown variant RestrictViolation, expected one of...'
    );

    handlePrismaOrServerError(rawWasmError, reply as any, mockLogger);

    assert.strictEqual(reply.statusCode, 409);
    assert.strictEqual(reply.sentPayload.success, false);
    assert.strictEqual(reply.sentPayload.errorCode, 'PACKAGE_IN_USE');
    assert.strictEqual(reply.sentPayload.errorMessage, 'لا يمكن حذف باقة مرتبطة بكروت أو دفعات سابقة');
    // Ensure raw WASM or prisma error strings are NEVER exposed to user
    assert.strictEqual(String(reply.sentPayload.errorMessage).includes('WASM_ERROR'), false);
    assert.strictEqual(String(reply.sentPayload.errorMessage).includes('RestrictViolation'), false);
    assert.strictEqual(String(reply.sentPayload.errorMessage).includes('invocation'), false);
  });

  // --------------------------------------------------------------------------
  // Requirement 5.5: Unexpected Prisma Error -> Safe 500 without leaking stack
  // --------------------------------------------------------------------------
  it('5. handlePrismaOrServerError should sanitize unexpected Prisma errors into safe HTTP 500 and hide internal details', () => {
    const reply = new MockFastifyReply();
    const unexpectedError = new Error(
      'Invalid `prisma.package.delete()` invocation:\n\nCan\'t reach database server at `127.0.0.1:5432`\n    at LibraryEngine.ts:217'
    );

    handlePrismaOrServerError(
      unexpectedError,
      reply as any,
      mockLogger,
      'فشل حذف الباقة بسبب خطأ غير متوقع في الخادم'
    );

    assert.strictEqual(reply.statusCode, 500);
    assert.strictEqual(reply.sentPayload.success, false);
    assert.strictEqual(reply.sentPayload.errorCode, 'INTERNAL_ERROR');
    assert.strictEqual(reply.sentPayload.errorMessage, 'فشل حذف الباقة بسبب خطأ غير متوقع في الخادم');
    // Ensure no database host, library path, or prisma invocation is in the response
    assert.strictEqual(String(reply.sentPayload.errorMessage).includes('127.0.0.1'), false);
    assert.strictEqual(String(reply.sentPayload.errorMessage).includes('LibraryEngine'), false);
    assert.strictEqual(String(reply.sentPayload.errorMessage).includes('prisma'), false);
  });

  // --------------------------------------------------------------------------
  // Requirement 5.6: Not Found returns clean 404
  // --------------------------------------------------------------------------
  it('6. handlePrismaOrServerError should map not found errors to clean HTTP 404', () => {
    const reply = new MockFastifyReply();
    const notFoundError = new Error('Package with id pkg-999 not found for tenant');

    handlePrismaOrServerError(notFoundError, reply as any, mockLogger);

    assert.strictEqual(reply.statusCode, 404);
    assert.strictEqual(reply.sentPayload.success, false);
    assert.strictEqual(reply.sentPayload.errorCode, 'PACKAGE_NOT_FOUND');
    assert.strictEqual(reply.sentPayload.errorMessage, 'باقة الكروت غير موجودة');
  });

  // --------------------------------------------------------------------------
  // P2002 Unique Constraint Preserves Exact Target/Main Contract
  // --------------------------------------------------------------------------
  it('7. handlePrismaOrServerError preserves exact HTTP 409, PACKAGE_CODE_EXISTS and original message on P2002', () => {
    const reply = new MockFastifyReply();
    const p2002Error: any = new Error('Unique constraint failed on the fields: (`tenantId`,`code`)');
    p2002Error.code = 'P2002';

    handlePrismaOrServerError(p2002Error, reply as any, mockLogger);

    assert.strictEqual(reply.statusCode, 409);
    assert.strictEqual(reply.sentPayload.success, false);
    assert.strictEqual(reply.sentPayload.errorCode, 'PACKAGE_CODE_EXISTS');
    assert.strictEqual(
      reply.sentPayload.errorMessage,
      'A package with this code already exists for this tenant'
    );
  });
});
