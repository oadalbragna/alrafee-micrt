// ============================================================================
// Platform: Commercial MikroTik Network & HotSpot Card Management System
// File: tests/application/PackageCrudUseCases.test.ts
// Unit Tests: Package CRUD Use Cases with In-Memory Fake Repository
// Test Runner: Node.js Built-in Test Runner via tsx
// Master Reference: Rule 16 (DIP - No DB Dependency in Unit Tests)
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
import { CreatePackageUseCase } from '../../src/application/use-cases/packages/CreatePackageUseCase.js';
import { ListPackagesUseCase } from '../../src/application/use-cases/packages/ListPackagesUseCase.js';
import { UpdatePackageUseCase } from '../../src/application/use-cases/packages/UpdatePackageUseCase.js';
import { DeletePackageUseCase } from '../../src/application/use-cases/packages/DeletePackageUseCase.js';

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
    this.logs.push({
      tenantId,
      userId,
      action,
      entityType,
      entityId,
      description,
      result,
    });
  }

  clear(): void {
    this.logs = [];
  }
}

class InMemoryPackageRepository implements IPackageRepository {
  public packages: Package[] = [];

  async create(data: CreatePackageData): Promise<Package> {
    const duplicate = this.packages.find(
      (p) => p.tenantId === data.tenantId && p.code === data.code
    );
    if (duplicate) {
      throw new Error(`Package with code "${data.code}" already exists for this tenant`);
    }

    const pkg: Package = {
      id: `pkg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      tenantId: data.tenantId,
      name: data.name,
      code: data.code,
      downloadSpeedLimit: data.downloadSpeedLimit,
      uploadSpeedLimit: data.uploadSpeedLimit,
      durationMinutes: data.durationMinutes,
      validityDays: data.validityDays,
      dataLimitBytes: data.dataLimitBytes !== undefined ? BigInt(data.dataLimitBytes) : BigInt(0),
      price: data.price,
      currency: data.currency ?? 'SDG',
      simultaneousSessions: data.simultaneousSessions ?? 1,
      hotspotProfileName: data.hotspotProfileName,
      isActive: data.isActive ?? true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.packages.push(pkg);
    return { ...pkg };
  }

  async findById(id: string, tenantId: string): Promise<Package | null> {
    const found = this.packages.find((p) => p.id === id && p.tenantId === tenantId);
    return found ? { ...found } : null;
  }

  async findAllByTenant(tenantId: string): Promise<Package[]> {
    return this.packages
      .filter((p) => p.tenantId === tenantId)
      .map((p) => ({ ...p }));
  }

  async update(id: string, tenantId: string, data: UpdatePackageData): Promise<Package> {
    const index = this.packages.findIndex((p) => p.id === id && p.tenantId === tenantId);
    if (index === -1) {
      throw new Error(`Package with id ${id} not found for tenant ${tenantId}`);
    }

    const current = this.packages[index]!;

    if (data.code && data.code !== current.code) {
      const duplicate = this.packages.find(
        (p) => p.tenantId === tenantId && p.code === data.code && p.id !== id
      );
      if (duplicate) {
        throw new Error(`Package with code "${data.code}" already exists for this tenant`);
      }
    }

    const updated: Package = {
      ...current,
      name: data.name ?? current.name,
      code: data.code ?? current.code,
      downloadSpeedLimit: data.downloadSpeedLimit ?? current.downloadSpeedLimit,
      uploadSpeedLimit: data.uploadSpeedLimit ?? current.uploadSpeedLimit,
      durationMinutes: data.durationMinutes ?? current.durationMinutes,
      validityDays: data.validityDays ?? current.validityDays,
      dataLimitBytes:
        data.dataLimitBytes !== undefined ? BigInt(data.dataLimitBytes) : current.dataLimitBytes,
      price: data.price ?? current.price,
      currency: data.currency ?? current.currency,
      simultaneousSessions: data.simultaneousSessions ?? current.simultaneousSessions,
      hotspotProfileName: data.hotspotProfileName ?? current.hotspotProfileName,
      isActive: data.isActive ?? current.isActive,
      updatedAt: new Date(),
    };

    this.packages[index] = updated;
    return { ...updated };
  }

  public usageMap = new Map<string, { cardsCount: number; batchesCount: number }>();

  async checkUsage(id: string, tenantId: string): Promise<PackageUsage> {
    const stats = this.usageMap.get(id) ?? { cardsCount: 0, batchesCount: 0 };
    return {
      inUse: stats.cardsCount > 0 || stats.batchesCount > 0,
      cardsCount: stats.cardsCount,
      batchesCount: stats.batchesCount,
    };
  }

  async delete(id: string, tenantId: string): Promise<void> {
    const index = this.packages.findIndex((p) => p.id === id && p.tenantId === tenantId);
    if (index === -1) {
      throw new Error(`Package with id ${id} not found for tenant ${tenantId}`);
    }
    this.packages.splice(index, 1);
  }
}

describe('Package CRUD Use Cases (Unit Tests with Fake In-Memory Repository)', () => {
  const TENANT_1 = 'tenant-uuid-1';
  const TENANT_2 = 'tenant-uuid-2';

  let repo: InMemoryPackageRepository;
  let auditLogger: InMemoryAuditLogger;
  let createUseCase: CreatePackageUseCase;
  let listUseCase: ListPackagesUseCase;
  let updateUseCase: UpdatePackageUseCase;
  let deleteUseCase: DeletePackageUseCase;

  beforeEach(() => {
    repo = new InMemoryPackageRepository();
    auditLogger = new InMemoryAuditLogger();
    createUseCase = new CreatePackageUseCase(repo, auditLogger);
    listUseCase = new ListPackagesUseCase(repo);
    updateUseCase = new UpdatePackageUseCase(repo, auditLogger);
    deleteUseCase = new DeletePackageUseCase(repo, auditLogger);
  });

  describe('CreatePackageUseCase', () => {
    it('should successfully create a package with full configuration', async () => {
      const pkg = await createUseCase.execute({
        tenantId: TENANT_1,
        name: 'باقة يومية 5 ميجا',
        code: 'DAILY-5M',
        downloadSpeedLimit: '5M',
        uploadSpeedLimit: '2M',
        durationMinutes: 1440,
        validityDays: 1,
        dataLimitBytes: 5368709120, // 5GB
        price: 500,
        currency: 'SDG',
        simultaneousSessions: 1,
        hotspotProfileName: 'u_daily_5m',
        isActive: true,
      });

      assert.ok(pkg.id);
      assert.strictEqual(pkg.name, 'باقة يومية 5 ميجا');
      assert.strictEqual(pkg.code, 'DAILY-5M');
      assert.strictEqual(pkg.downloadSpeedLimit, '5M');
      assert.strictEqual(pkg.uploadSpeedLimit, '2M');
      assert.strictEqual(pkg.durationMinutes, 1440);
      assert.strictEqual(pkg.validityDays, 1);
      assert.strictEqual(pkg.dataLimitBytes, BigInt(5368709120));
      assert.strictEqual(pkg.price, 500);
      assert.strictEqual(pkg.currency, 'SDG');
      assert.strictEqual(pkg.hotspotProfileName, 'u_daily_5m');
      assert.strictEqual(pkg.isActive, true);

      // Verify audit logging
      assert.strictEqual(auditLogger.logs.length, 1);
      assert.strictEqual(auditLogger.logs[0]?.action, 'CREATE');
      assert.strictEqual(auditLogger.logs[0]?.entityType, 'Package');
      assert.strictEqual(auditLogger.logs[0]?.entityId, pkg.id);
      assert.strictEqual(auditLogger.logs[0]?.result, 'SUCCESS');
    });

    it('should successfully create a package with minimal configuration and defaults', async () => {
      const pkg = await createUseCase.execute({
        tenantId: TENANT_1,
        name: 'باقة مفتوحة',
        code: 'OPEN-BASIC',
        downloadSpeedLimit: '10M',
        uploadSpeedLimit: '5M',
        durationMinutes: 60,
        validityDays: 1,
        price: 150,
        hotspotProfileName: 'default',
      });

      assert.ok(pkg.id);
      assert.strictEqual(pkg.currency, 'SDG');
      assert.strictEqual(pkg.simultaneousSessions, 1);
      assert.strictEqual(pkg.isActive, true);
      assert.strictEqual(pkg.dataLimitBytes, BigInt(0));
    });

    it('should throw error when tenantId is empty', async () => {
      await assert.rejects(
        async () => {
          await createUseCase.execute({
            tenantId: '',
            name: 'باقة',
            code: 'PKG-1',
            downloadSpeedLimit: '1M',
            uploadSpeedLimit: '512k',
            durationMinutes: 60,
            validityDays: 1,
            price: 100,
            hotspotProfileName: 'prof1',
          });
        },
        { message: 'Tenant ID cannot be empty' }
      );
    });

    it('should throw error when name is empty', async () => {
      await assert.rejects(
        async () => {
          await createUseCase.execute({
            tenantId: TENANT_1,
            name: '   ',
            code: 'PKG-1',
            downloadSpeedLimit: '1M',
            uploadSpeedLimit: '512k',
            durationMinutes: 60,
            validityDays: 1,
            price: 100,
            hotspotProfileName: 'prof1',
          });
        },
        { message: 'Package name cannot be empty' }
      );
    });

    it('should throw error when code is empty', async () => {
      await assert.rejects(
        async () => {
          await createUseCase.execute({
            tenantId: TENANT_1,
            name: 'باقة سرعة',
            code: '',
            downloadSpeedLimit: '1M',
            uploadSpeedLimit: '512k',
            durationMinutes: 60,
            validityDays: 1,
            price: 100,
            hotspotProfileName: 'prof1',
          });
        },
        { message: 'Package code cannot be empty' }
      );
    });

    it('should throw error when downloadSpeedLimit or uploadSpeedLimit is empty', async () => {
      await assert.rejects(
        async () => {
          await createUseCase.execute({
            tenantId: TENANT_1,
            name: 'باقة',
            code: 'PKG-1',
            downloadSpeedLimit: '',
            uploadSpeedLimit: '512k',
            durationMinutes: 60,
            validityDays: 1,
            price: 100,
            hotspotProfileName: 'prof1',
          });
        },
        { message: 'Download speed limit cannot be empty' }
      );

      await assert.rejects(
        async () => {
          await createUseCase.execute({
            tenantId: TENANT_1,
            name: 'باقة',
            code: 'PKG-1',
            downloadSpeedLimit: '1M',
            uploadSpeedLimit: '',
            durationMinutes: 60,
            validityDays: 1,
            price: 100,
            hotspotProfileName: 'prof1',
          });
        },
        { message: 'Upload speed limit cannot be empty' }
      );
    });

    it('should throw error when durationMinutes or validityDays is non-positive', async () => {
      await assert.rejects(
        async () => {
          await createUseCase.execute({
            tenantId: TENANT_1,
            name: 'باقة',
            code: 'PKG-1',
            downloadSpeedLimit: '1M',
            uploadSpeedLimit: '512k',
            durationMinutes: 0,
            validityDays: 1,
            price: 100,
            hotspotProfileName: 'prof1',
          });
        },
        { message: 'Duration minutes must be a positive integer' }
      );

      await assert.rejects(
        async () => {
          await createUseCase.execute({
            tenantId: TENANT_1,
            name: 'باقة',
            code: 'PKG-1',
            downloadSpeedLimit: '1M',
            uploadSpeedLimit: '512k',
            durationMinutes: 60,
            validityDays: -1,
            price: 100,
            hotspotProfileName: 'prof1',
          });
        },
        { message: 'Validity days must be a positive integer' }
      );
    });

    it('should throw error when price is non-positive', async () => {
      await assert.rejects(
        async () => {
          await createUseCase.execute({
            tenantId: TENANT_1,
            name: 'باقة',
            code: 'PKG-1',
            downloadSpeedLimit: '1M',
            uploadSpeedLimit: '512k',
            durationMinutes: 60,
            validityDays: 1,
            price: 0,
            hotspotProfileName: 'prof1',
          });
        },
        { message: 'Price must be a positive number' }
      );
    });

    it('should throw error when dataLimitBytes is negative', async () => {
      await assert.rejects(
        async () => {
          await createUseCase.execute({
            tenantId: TENANT_1,
            name: 'باقة',
            code: 'PKG-1',
            downloadSpeedLimit: '1M',
            uploadSpeedLimit: '512k',
            durationMinutes: 60,
            validityDays: 1,
            price: 100,
            dataLimitBytes: -50,
            hotspotProfileName: 'prof1',
          });
        },
        { message: 'Data limit bytes must be >= 0' }
      );
    });

    it('should throw error when hotspotProfileName is empty', async () => {
      await assert.rejects(
        async () => {
          await createUseCase.execute({
            tenantId: TENANT_1,
            name: 'باقة',
            code: 'PKG-1',
            downloadSpeedLimit: '1M',
            uploadSpeedLimit: '512k',
            durationMinutes: 60,
            validityDays: 1,
            price: 100,
            hotspotProfileName: '   ',
          });
        },
        { message: 'Hotspot profile name cannot be empty' }
      );
    });

    it('should not record audit log if creation throws', async () => {
      await assert.rejects(async () => {
        await createUseCase.execute({
          tenantId: TENANT_1,
          name: '',
          code: 'FAIL',
          downloadSpeedLimit: '1M',
          uploadSpeedLimit: '1M',
          durationMinutes: 10,
          validityDays: 1,
          price: 50,
          hotspotProfileName: 'p',
        });
      });

      assert.strictEqual(auditLogger.logs.length, 0);
    });
  });

  describe('ListPackagesUseCase', () => {
    it('should list all packages belonging to a specific tenant', async () => {
      await createUseCase.execute({
        tenantId: TENANT_1,
        name: 'باقة T1 A',
        code: 'T1-A',
        downloadSpeedLimit: '2M',
        uploadSpeedLimit: '1M',
        durationMinutes: 60,
        validityDays: 1,
        price: 100,
        hotspotProfileName: 'p1',
      });

      await createUseCase.execute({
        tenantId: TENANT_1,
        name: 'باقة T1 B',
        code: 'T1-B',
        downloadSpeedLimit: '4M',
        uploadSpeedLimit: '2M',
        durationMinutes: 120,
        validityDays: 2,
        price: 200,
        hotspotProfileName: 'p2',
      });

      await createUseCase.execute({
        tenantId: TENANT_2,
        name: 'باقة T2 A',
        code: 'T2-A',
        downloadSpeedLimit: '10M',
        uploadSpeedLimit: '5M',
        durationMinutes: 300,
        validityDays: 5,
        price: 500,
        hotspotProfileName: 'p3',
      });

      const tenant1Packages = await listUseCase.execute({ tenantId: TENANT_1 });
      assert.strictEqual(tenant1Packages.length, 2);
      assert.strictEqual(tenant1Packages[0]?.name, 'باقة T1 A');
      assert.strictEqual(tenant1Packages[1]?.name, 'باقة T1 B');

      const tenant2Packages = await listUseCase.execute({ tenantId: TENANT_2 });
      assert.strictEqual(tenant2Packages.length, 1);
      assert.strictEqual(tenant2Packages[0]?.name, 'باقة T2 A');
    });

    it('should return empty list when tenant has no packages', async () => {
      const packages = await listUseCase.execute({ tenantId: 'empty-tenant' });
      assert.deepStrictEqual(packages, []);
    });

    it('should throw error when tenantId is empty', async () => {
      await assert.rejects(
        async () => {
          await listUseCase.execute({ tenantId: '' });
        },
        { message: 'Tenant ID is required to list packages' }
      );
    });
  });

  describe('UpdatePackageUseCase', () => {
    it('should update package attributes and log audit', async () => {
      const created = await createUseCase.execute({
        tenantId: TENANT_1,
        name: 'باقة أصلية',
        code: 'ORIG-1',
        downloadSpeedLimit: '2M',
        uploadSpeedLimit: '1M',
        durationMinutes: 60,
        validityDays: 1,
        price: 100,
        hotspotProfileName: 'orig-prof',
      });

      auditLogger.clear();

      const updated = await updateUseCase.execute({
        id: created.id,
        tenantId: TENANT_1,
        name: 'باقة معدلة',
        price: 150,
        downloadSpeedLimit: '6M',
      });

      assert.strictEqual(updated.name, 'باقة معدلة');
      assert.strictEqual(updated.price, 150);
      assert.strictEqual(updated.downloadSpeedLimit, '6M');
      assert.strictEqual(updated.uploadSpeedLimit, '1M'); // unmodified
      assert.strictEqual(updated.code, 'ORIG-1'); // unmodified

      // Verify audit
      assert.strictEqual(auditLogger.logs.length, 1);
      assert.strictEqual(auditLogger.logs[0]?.action, 'UPDATE');
      assert.strictEqual(auditLogger.logs[0]?.entityType, 'Package');
      assert.strictEqual(auditLogger.logs[0]?.entityId, created.id);
    });

    it('should throw error when updating non-existent package', async () => {
      await assert.rejects(
        async () => {
          await updateUseCase.execute({
            id: 'non-existent-id',
            tenantId: TENANT_1,
            name: 'اسم جديد',
          });
        },
        { message: `Package with id non-existent-id not found for tenant ${TENANT_1}` }
      );
    });

    it('should throw error when tenantId does not match package tenant', async () => {
      const created = await createUseCase.execute({
        tenantId: TENANT_1,
        name: 'باقة T1',
        code: 'T1-PKG',
        downloadSpeedLimit: '1M',
        uploadSpeedLimit: '1M',
        durationMinutes: 60,
        validityDays: 1,
        price: 100,
        hotspotProfileName: 'p1',
      });

      await assert.rejects(
        async () => {
          await updateUseCase.execute({
            id: created.id,
            tenantId: TENANT_2,
            name: 'قرصنة',
          });
        },
        { message: `Package with id ${created.id} not found for tenant ${TENANT_2}` }
      );
    });

    it('should reject update with invalid parameters (e.g. non-positive price or duration)', async () => {
      const created = await createUseCase.execute({
        tenantId: TENANT_1,
        name: 'باقة',
        code: 'PKG-V',
        downloadSpeedLimit: '1M',
        uploadSpeedLimit: '1M',
        durationMinutes: 60,
        validityDays: 1,
        price: 100,
        hotspotProfileName: 'p1',
      });

      await assert.rejects(
        async () => {
          await updateUseCase.execute({
            id: created.id,
            tenantId: TENANT_1,
            price: -10,
          });
        },
        { message: 'Price must be a positive number' }
      );

      await assert.rejects(
        async () => {
          await updateUseCase.execute({
            id: created.id,
            tenantId: TENANT_1,
            durationMinutes: 0,
          });
        },
        { message: 'Duration minutes must be a positive integer' }
      );

      await assert.rejects(
        async () => {
          await updateUseCase.execute({
            id: created.id,
            tenantId: TENANT_1,
            dataLimitBytes: -1,
          });
        },
        { message: 'Data limit bytes must be >= 0' }
      );
    });
  });

  describe('DeletePackageUseCase', () => {
    it('should successfully delete an existing package and log audit', async () => {
      const created = await createUseCase.execute({
        tenantId: TENANT_1,
        name: 'باقة للحذف',
        code: 'DEL-1',
        downloadSpeedLimit: '1M',
        uploadSpeedLimit: '1M',
        durationMinutes: 30,
        validityDays: 1,
        price: 50,
        hotspotProfileName: 'del-p',
      });

      auditLogger.clear();

      await deleteUseCase.execute({
        id: created.id,
        tenantId: TENANT_1,
      });

      const list = await listUseCase.execute({ tenantId: TENANT_1 });
      assert.strictEqual(list.length, 0);

      // Verify audit
      assert.strictEqual(auditLogger.logs.length, 1);
      assert.strictEqual(auditLogger.logs[0]?.action, 'DELETE');
      assert.strictEqual(auditLogger.logs[0]?.entityType, 'Package');
      assert.strictEqual(auditLogger.logs[0]?.entityId, created.id);
    });

    it('should throw error when deleting non-existent package', async () => {
      await assert.rejects(
        async () => {
          await deleteUseCase.execute({
            id: 'non-existent',
            tenantId: TENANT_1,
          });
        },
        { message: `Package with id non-existent not found for tenant ${TENANT_1}` }
      );
    });

    it('should throw error when tenantId does not match during delete', async () => {
      const created = await createUseCase.execute({
        tenantId: TENANT_1,
        name: 'باقة T1',
        code: 'T1-DEL',
        downloadSpeedLimit: '1M',
        uploadSpeedLimit: '1M',
        durationMinutes: 60,
        validityDays: 1,
        price: 100,
        hotspotProfileName: 'p1',
      });

      await assert.rejects(
        async () => {
          await deleteUseCase.execute({
            id: created.id,
            tenantId: TENANT_2,
          });
        },
        { message: `Package with id ${created.id} not found for tenant ${TENANT_2}` }
      );
    });
  });
});
