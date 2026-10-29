// ============================================================================
// Platform: Commercial MikroTik Network & HotSpot Card Management System
// File: tests/application/CardUseCases.test.ts
// Unit Tests: Card & Card Batch Use Cases and State Machine Enforcement
// Test Runner: Node.js Built-in Test Runner via tsx
// Master Reference: Rule 9 (Cards), Rule 10 (Packages), Rule 16 (Clean Architecture)
// ============================================================================

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  ICardBatchRepository,
  CardBatch,
  CreateCardBatchData,
} from '../../src/application/interfaces/ICardBatchRepository.js';
import {
  ICardRepository,
  Card,
  CreateCardData,
  FindCardsFilter,
} from '../../src/application/interfaces/ICardRepository.js';
import {
  IPackageRepository,
  Package,
  CreatePackageData,
  UpdatePackageData,
} from '../../src/application/interfaces/IPackageRepository.js';
import { IAuditLogger } from '../../src/application/interfaces/IAuditLogger.js';
import { GenerateCardBatchUseCase } from '../../src/application/use-cases/cards/GenerateCardBatchUseCase.js';
import { ListCardsUseCase } from '../../src/application/use-cases/cards/ListCardsUseCase.js';
import { UpdateCardStatusUseCase } from '../../src/application/use-cases/cards/UpdateCardStatusUseCase.js';
import {
  CardStateMachine,
  CardStatus,
} from '../../src/domain/state-machines/CardStateMachine.js';
import { InvalidCardTransitionException } from '../../src/domain/exceptions/InvalidCardTransitionException.js';
import { MockRouterConnector } from '../../src/infrastructure/mikrotik/adapters/MockRouterConnector.js';
import { IRouterRepository } from '../../src/application/interfaces/IRouterRepository.js';

class InMemoryRouterRepository implements IRouterRepository {
  public routers: any[] = [];
  async create(data: any): Promise<any> {
    const r = { id: `r-${Date.now()}`, ...data };
    this.routers.push(r);
    return r;
  }
  async findById(id: string, tenantId: string): Promise<any> {
    return this.routers.find((r) => r.id === id && r.tenantId === tenantId) || null;
  }
  async findAllByTenant(tenantId: string): Promise<any[]> {
    return this.routers.filter((r) => r.tenantId === tenantId);
  }
  async update(id: string, tenantId: string, data: any): Promise<any> {
    const idx = this.routers.findIndex((r) => r.id === id && r.tenantId === tenantId);
    if (idx === -1) throw new Error('not found');
    this.routers[idx] = { ...this.routers[idx], ...data };
    return this.routers[idx];
  }
  async delete(id: string, tenantId: string): Promise<void> {
    this.routers = this.routers.filter((r) => !(r.id === id && r.tenantId === tenantId));
  }
  async getDecryptedCredentials(id: string, tenantId: string): Promise<any> {
    const r = this.routers.find((r) => r.id === id && r.tenantId === tenantId);
    if (!r) return null;
    return {
      username: 'admin',
      password: 'password123',
      connectionMethod: 'ROUTEROS_API_SSL',
      host: r.host,
      apiPort: r.apiPort || 8729,
    };
  }
}

// In-Memory Fakes
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
    return this.packages.filter((p) => p.tenantId === tenantId).map((p) => ({ ...p }));
  }

  async update(id: string, tenantId: string, data: UpdatePackageData): Promise<Package> {
    const index = this.packages.findIndex((p) => p.id === id && p.tenantId === tenantId);
    if (index === -1) throw new Error('Package not found');
    const updated = { ...this.packages[index]!, ...data, updatedAt: new Date() };
    this.packages[index] = updated as Package;
    return { ...updated } as Package;
  }

  async delete(id: string, tenantId: string): Promise<void> {
    const index = this.packages.findIndex((p) => p.id === id && p.tenantId === tenantId);
    if (index !== -1) this.packages.splice(index, 1);
  }

  async checkUsage(id: string, tenantId: string): Promise<any> {
    return { inUse: false, cardsCount: 0, batchesCount: 0 };
  }
}

class InMemoryCardBatchRepository implements ICardBatchRepository {
  public batches: CardBatch[] = [];

  async create(data: CreateCardBatchData): Promise<CardBatch> {
    const batch: CardBatch = {
      id: data.id ?? `batch-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      tenantId: data.tenantId,
      packageId: data.packageId,
      createdById: data.createdById,
      batchNumber: data.batchNumber,
      name: data.name,
      quantity: data.quantity,
      prefix: data.prefix ?? null,
      userLength: data.userLength ?? 6,
      passwordLength: data.passwordLength ?? 4,
      unitPrice: data.unitPrice,
      totalPrice: data.totalPrice,
      isExported: false,
      exportedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.batches.push(batch);
    return { ...batch };
  }

  async findById(id: string, tenantId: string): Promise<CardBatch | null> {
    const found = this.batches.find((b) => b.id === id && b.tenantId === tenantId);
    return found ? { ...found } : null;
  }

  async findAllByTenant(tenantId: string): Promise<CardBatch[]> {
    return this.batches.filter((b) => b.tenantId === tenantId).map((b) => ({ ...b }));
  }
}

class InMemoryCardRepository implements ICardRepository {
  public cards: Card[] = [];

  async createMany(cardsData: CreateCardData[]): Promise<Card[]> {
    const createdList: Card[] = [];
    for (const c of cardsData) {
      const duplicate = this.cards.find(
        (existing) => existing.tenantId === c.tenantId && existing.username === c.username
      );
      if (duplicate) {
        throw new Error(`Card with username "${c.username}" already exists in tenant`);
      }

      const card: Card = {
        id: c.id ?? `card-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
        tenantId: c.tenantId,
        batchId: c.batchId,
        packageId: c.packageId,
        routerId: c.routerId ?? null,
        username: c.username,
        password: c.password,
        status: c.status ?? 'GENERATED',
        price: c.price,
        firstLoginAt: null,
        expiresAt: null,
        totalUsedSeconds: BigInt(0),
        totalBytesIn: BigInt(0),
        totalBytesOut: BigInt(0),
        boundMacAddress: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.cards.push(card);
      createdList.push({ ...card });
    }
    return createdList;
  }

  async findById(id: string, tenantId: string): Promise<Card | null> {
    const found = this.cards.find((c) => c.id === id && c.tenantId === tenantId);
    return found ? { ...found } : null;
  }

  async findByIds(ids: string[], tenantId: string): Promise<Card[]> {
    const idSet = new Set(ids);
    return this.cards
      .filter((c) => idSet.has(c.id) && c.tenantId === tenantId)
      .map((c) => ({ ...c }));
  }

  async findByBatchId(batchId: string, tenantId: string): Promise<Card[]> {
    return this.cards
      .filter((c) => c.batchId === batchId && c.tenantId === tenantId)
      .map((c) => ({ ...c }));
  }

  async findAllByTenant(tenantId: string, filter?: FindCardsFilter): Promise<Card[]> {
    let result = this.cards.filter((c) => c.tenantId === tenantId);
    if (filter?.status) {
      result = result.filter((c) => c.status === filter.status);
    }
    if (filter?.batchId) {
      result = result.filter((c) => c.batchId === filter.batchId);
    }
    return result.map((c) => ({ ...c }));
  }

  async updateStatus(id: string, tenantId: string, newStatus: CardStatus): Promise<Card> {
    const index = this.cards.findIndex((c) => c.id === id && c.tenantId === tenantId);
    if (index === -1) {
      throw new Error(`Card with ID '${id}' not found for tenant`);
    }

    const currentCard = this.cards[index]!;
    // Strict State Machine Verification inside repository layer
    const validatedStatus = CardStateMachine.transition(currentCard.status, newStatus);

    const updated: Card = {
      ...currentCard,
      status: validatedStatus,
      updatedAt: new Date(),
    };
    this.cards[index] = updated;
    return { ...updated };
  }
}

describe('Card & Card Batch Use Cases Unit Tests', () => {
  const TENANT_1 = 'tenant-uuid-1';
  const TENANT_2 = 'tenant-uuid-2';
  const USER_ID = 'user-uuid-1';

  let packageRepo: InMemoryPackageRepository;
  let batchRepo: InMemoryCardBatchRepository;
  let cardRepo: InMemoryCardRepository;
  let auditLogger: InMemoryAuditLogger;

  let generateUseCase: GenerateCardBatchUseCase;
  let listUseCase: ListCardsUseCase;
  let updateStatusUseCase: UpdateCardStatusUseCase;

  let activePackage: Package;
  let inactivePackage: Package;

  beforeEach(async () => {
    packageRepo = new InMemoryPackageRepository();
    batchRepo = new InMemoryCardBatchRepository();
    cardRepo = new InMemoryCardRepository();
    auditLogger = new InMemoryAuditLogger();

    generateUseCase = new GenerateCardBatchUseCase(
      batchRepo,
      cardRepo,
      packageRepo,
      auditLogger
    );
    listUseCase = new ListCardsUseCase(cardRepo);
    updateStatusUseCase = new UpdateCardStatusUseCase(cardRepo, auditLogger);

    activePackage = await packageRepo.create({
      tenantId: TENANT_1,
      name: 'باقة يومية 5 ميجا',
      code: 'DAILY-5M',
      downloadSpeedLimit: '5M',
      uploadSpeedLimit: '2M',
      durationMinutes: 1440,
      validityDays: 1,
      price: 500,
      hotspotProfileName: 'hs_daily_5m',
      isActive: true,
    });

    inactivePackage = await packageRepo.create({
      tenantId: TENANT_1,
      name: 'باقة موقوفة',
      code: 'INACTIVE-PKG',
      downloadSpeedLimit: '1M',
      uploadSpeedLimit: '1M',
      durationMinutes: 60,
      validityDays: 1,
      price: 100,
      hotspotProfileName: 'hs_inactive',
      isActive: false,
    });
  });

  describe('GenerateCardBatchUseCase', () => {
    it('should successfully generate a batch with exact requested quantity of cards with unique usernames', async () => {
      const quantity = 50;
      const result = await generateUseCase.execute({
        tenantId: TENANT_1,
        packageId: activePackage.id,
        quantity,
        prefix: 'SZ',
        userLength: 6,
        passwordLength: 4,
        createdById: USER_ID,
      });

      assert.ok(result.batch.id);
      assert.strictEqual(result.batch.quantity, quantity);
      assert.strictEqual(result.batch.unitPrice, 500);
      assert.strictEqual(result.batch.totalPrice, 25000);
      assert.strictEqual(result.cards.length, quantity);

      // Verify all cards are GENERATED
      for (const card of result.cards) {
        assert.strictEqual(card.status, 'GENERATED');
        assert.strictEqual(card.packageId, activePackage.id);
        assert.strictEqual(card.batchId, result.batch.id);
        assert.strictEqual(card.price, 500);
        assert.ok(card.username.startsWith('SZ'));
        assert.strictEqual(card.username.length, 2 + 6); // prefix (2) + random (6)
        assert.strictEqual(card.password.length, 4);
      }

      // Verify 100% uniqueness of usernames within batch
      const usernamesSet = new Set(result.cards.map((c) => c.username));
      assert.strictEqual(usernamesSet.size, quantity);

      // Verify audit log
      assert.strictEqual(auditLogger.logs.length, 1);
      assert.strictEqual(auditLogger.logs[0]?.action, 'GENERATE_BATCH');
      assert.strictEqual(auditLogger.logs[0]?.entityType, 'CardBatch');
      assert.strictEqual(auditLogger.logs[0]?.entityId, result.batch.id);
    });

    it('should throw error when package is not found for tenant', async () => {
      await assert.rejects(
        async () => {
          await generateUseCase.execute({
            tenantId: TENANT_1,
            packageId: 'non-existent-package-id',
            quantity: 10,
            createdById: USER_ID,
          });
        },
        { message: /not found/i }
      );
    });

    it('should throw error when package is inactive', async () => {
      await assert.rejects(
        async () => {
          await generateUseCase.execute({
            tenantId: TENANT_1,
            packageId: inactivePackage.id,
            quantity: 10,
            createdById: USER_ID,
          });
        },
        { message: /inactive/i }
      );
    });

    it('should throw error when quantity is invalid (< 1 or > 1000)', async () => {
      await assert.rejects(
        async () => {
          await generateUseCase.execute({
            tenantId: TENANT_1,
            packageId: activePackage.id,
            quantity: 0,
            createdById: USER_ID,
          });
        },
        { message: /Quantity must be an integer between 1 and 1000/ }
      );

      await assert.rejects(
        async () => {
          await generateUseCase.execute({
            tenantId: TENANT_1,
            packageId: activePackage.id,
            quantity: 1001,
            createdById: USER_ID,
          });
        },
        { message: /Quantity must be an integer between 1 and 1000/ }
      );
    });

    it('should successfully provision hotspot users on router via connector when routerId is provided', async () => {
      const inMemRouterRepo = new InMemoryRouterRepository();
      const mockConnector = new MockRouterConnector();

      const router = await inMemRouterRepo.create({
        tenantId: TENANT_1,
        name: 'Main Router',
        host: '192.168.88.1',
        apiPort: 8729,
        connectionMethod: 'ROUTEROS_API_SSL',
        username: 'admin',
        password: 'password123',
      });

      const useCaseWithRouter = new GenerateCardBatchUseCase(
        batchRepo,
        cardRepo,
        packageRepo,
        auditLogger,
        inMemRouterRepo,
        mockConnector
      );

      const quantity = 3;
      const result = await useCaseWithRouter.execute({
        tenantId: TENANT_1,
        packageId: activePackage.id,
        quantity,
        createdById: USER_ID,
        routerId: router.id,
      });

      assert.strictEqual(result.cards.length, quantity);
      for (const card of result.cards) {
        assert.strictEqual(card.routerId, router.id);
      }

      // Verify users exist on the connector with speed and uptime limits applied
      const usersRes = await mockConnector.getHotspotUsers({
        host: '192.168.88.1',
        port: 8729,
        username: 'admin',
        password: 'password123',
      });
      assert.strictEqual(usersRes.success, true);
      if (usersRes.success) {
        const usernames = usersRes.data.map((u) => u.username);
        for (const card of result.cards) {
          assert.ok(usernames.includes(card.username));
          const mockUser = (mockConnector as any).hotspotUsersMap.get(card.username);
          assert.ok(mockUser, 'Mock user should be recorded in mock connector');
          assert.strictEqual(mockUser.rateLimit, '2M/5M');
          assert.strictEqual(mockUser.limitUptimeSeconds, 1440 * 60);
          assert.strictEqual(mockUser.profile, 'hs_daily_5m');
        }
      }
    });

    it('should handle partial failure and rollback router users when connector rejects a user', async () => {
      const inMemRouterRepo = new InMemoryRouterRepository();
      const mockConnector = new MockRouterConnector();

      // Configure host 'fail.test' which mockConnector rejects
      const router = await inMemRouterRepo.create({
        tenantId: TENANT_1,
        name: 'Failing Router',
        host: 'fail.test',
        apiPort: 8729,
        connectionMethod: 'ROUTEROS_API_SSL',
        username: 'admin',
        password: 'password123',
      });

      const useCaseWithRouter = new GenerateCardBatchUseCase(
        batchRepo,
        cardRepo,
        packageRepo,
        auditLogger,
        inMemRouterRepo,
        mockConnector
      );

      await assert.rejects(
        async () => {
          await useCaseWithRouter.execute({
            tenantId: TENANT_1,
            packageId: activePackage.id,
            quantity: 5,
            createdById: USER_ID,
            routerId: router.id,
          });
        },
        { message: /فشل إنشاء بطاقات الهوتسبوت على الراوتر/ }
      );

      // Verify no cards were saved in the repository
      const allCards = await cardRepo.findAllByTenant(TENANT_1);
      assert.strictEqual(allCards.length, 0);
    });
  });

  describe('ListCardsUseCase', () => {
    it('should list cards filtered by status and batchId', async () => {
      const batch1 = await generateUseCase.execute({
        tenantId: TENANT_1,
        packageId: activePackage.id,
        quantity: 5,
        createdById: USER_ID,
      });

      const batch2 = await generateUseCase.execute({
        tenantId: TENANT_1,
        packageId: activePackage.id,
        quantity: 3,
        createdById: USER_ID,
      });

      // Transition one card in batch1 to AVAILABLE
      const cardToUpdate = batch1.cards[0]!;
      await updateStatusUseCase.execute({
        cardId: cardToUpdate.id,
        tenantId: TENANT_1,
        newStatus: 'AVAILABLE',
      });

      // Filter by batchId
      const batch1Cards = await listUseCase.execute({
        tenantId: TENANT_1,
        batchId: batch1.batch.id,
      });
      assert.strictEqual(batch1Cards.length, 5);

      // Filter by status AVAILABLE
      const availableCards = await listUseCase.execute({
        tenantId: TENANT_1,
        status: 'AVAILABLE',
      });
      assert.strictEqual(availableCards.length, 1);
      assert.strictEqual(availableCards[0]?.id, cardToUpdate.id);

      // Filter by status GENERATED
      const generatedCards = await listUseCase.execute({
        tenantId: TENANT_1,
        status: 'GENERATED',
      });
      assert.strictEqual(generatedCards.length, 7); // 4 from batch1 + 3 from batch2
    });

    it('should enforce tenant isolation when listing cards', async () => {
      await generateUseCase.execute({
        tenantId: TENANT_1,
        packageId: activePackage.id,
        quantity: 4,
        createdById: USER_ID,
      });

      const tenant2Cards = await listUseCase.execute({ tenantId: TENANT_2 });
      assert.strictEqual(tenant2Cards.length, 0);
    });
  });

  describe('UpdateCardStatusUseCase & CardStateMachine Enforcement', () => {
    it('should allow valid transition from GENERATED to AVAILABLE', async () => {
      const batch = await generateUseCase.execute({
        tenantId: TENANT_1,
        packageId: activePackage.id,
        quantity: 1,
        createdById: USER_ID,
      });

      const card = batch.cards[0]!;
      assert.strictEqual(card.status, 'GENERATED');

      auditLogger.clear();

      const updated = await updateStatusUseCase.execute({
        cardId: card.id,
        tenantId: TENANT_1,
        newStatus: 'AVAILABLE',
      });

      assert.strictEqual(updated.status, 'AVAILABLE');

      // Verify audit
      assert.strictEqual(auditLogger.logs.length, 1);
      assert.strictEqual(auditLogger.logs[0]?.action, 'UPDATE');
      assert.strictEqual(auditLogger.logs[0]?.entityType, 'Card');
      assert.strictEqual(auditLogger.logs[0]?.entityId, card.id);
    });

    it('should strictly prohibit illegal transition from GENERATED directly to ACTIVE and throw InvalidCardTransitionException', async () => {
      const batch = await generateUseCase.execute({
        tenantId: TENANT_1,
        packageId: activePackage.id,
        quantity: 1,
        createdById: USER_ID,
      });

      const card = batch.cards[0]!;
      assert.strictEqual(card.status, 'GENERATED');

      await assert.rejects(
        async () => {
          await updateStatusUseCase.execute({
            cardId: card.id,
            tenantId: TENANT_1,
            newStatus: 'ACTIVE',
          });
        },
        (err: any) => {
          assert.ok(err instanceof InvalidCardTransitionException);
          assert.strictEqual(err.fromStatus, 'GENERATED');
          assert.strictEqual(err.toStatus, 'ACTIVE');
          return true;
        }
      );

      // Verify card status remained GENERATED in repo
      const cardInRepo = await cardRepo.findById(card.id, TENANT_1);
      assert.strictEqual(cardInRepo?.status, 'GENERATED');
    });

    it('should throw error when card is not found', async () => {
      await assert.rejects(
        async () => {
          await updateStatusUseCase.execute({
            cardId: 'non-existent-card-id',
            tenantId: TENANT_1,
            newStatus: 'AVAILABLE',
          });
        },
        { message: /not found/i }
      );
    });
  });
});
