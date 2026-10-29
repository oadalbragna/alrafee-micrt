// ============================================================================
// Platform: Commercial MikroTik Network & HotSpot Card Management System
// File: tests/application/Phase14BackendFeatures.test.ts
// Unit Tests: Phase 14 Features (Trial Lock, Numbers-Only Generation, Subscription Plans & Activation Requests)
// ============================================================================

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { GenerateCardBatchUseCase } from '../../src/application/use-cases/cards/GenerateCardBatchUseCase.js';
import { TrialCardGenerationLockedException } from '../../src/domain/exceptions/TrialCardGenerationLockedException.js';
import { ICardBatchRepository, CardBatch, CreateCardBatchData } from '../../src/application/interfaces/ICardBatchRepository.js';
import { ICardRepository, Card, CreateCardData } from '../../src/application/interfaces/ICardRepository.js';
import { IPackageRepository, Package } from '../../src/application/interfaces/IPackageRepository.js';
import { IRouterConnector, RouterCredentialsInput, RouterConnectorResult } from '../../src/application/interfaces/IRouterConnector.js';
import { SubscriptionGuard } from '../../src/infrastructure/security/SubscriptionGuard.js';

class InMemoryCardBatchRepository implements ICardBatchRepository {
  private batches: CardBatch[] = [];

  async create(data: CreateCardBatchData): Promise<CardBatch> {
    const batch: CardBatch = {
      id: `batch-${this.batches.length + 1}`,
      tenantId: data.tenantId,
      packageId: data.packageId,
      createdById: data.createdById,
      batchNumber: data.batchNumber,
      name: data.name,
      quantity: data.quantity,
      prefix: data.prefix ?? null,
      userLength: data.userLength,
      passwordLength: data.passwordLength,
      unitPrice: data.unitPrice,
      totalPrice: data.totalPrice,
      createdAt: new Date(),
    };
    this.batches.push(batch);
    return batch;
  }

  async findById(id: string, tenantId: string): Promise<CardBatch | null> {
    return this.batches.find((b) => b.id === id && b.tenantId === tenantId) ?? null;
  }

  async findAllByTenant(tenantId: string): Promise<CardBatch[]> {
    return this.batches.filter((b) => b.tenantId === tenantId);
  }
}

class InMemoryCardRepository implements ICardRepository {
  private cards: Card[] = [];

  async createMany(data: CreateCardData[]): Promise<Card[]> {
    const created: Card[] = data.map((d, i) => ({
      id: `card-${this.cards.length + i + 1}`,
      tenantId: d.tenantId,
      batchId: d.batchId,
      packageId: d.packageId,
      routerId: d.routerId ?? null,
      username: d.username,
      password: d.password,
      status: d.status,
      price: d.price,
      firstLoginAt: null,
      expiresAt: null,
      totalUsedSeconds: BigInt(0),
      totalBytesIn: BigInt(0),
      totalBytesOut: BigInt(0),
      boundMacAddress: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
    this.cards.push(...created);
    return created;
  }

  async findById(id: string, tenantId: string): Promise<Card | null> {
    return this.cards.find((c) => c.id === id && c.tenantId === tenantId) ?? null;
  }

  async findAllByTenant(tenantId: string): Promise<Card[]> {
    return this.cards.filter((c) => c.tenantId === tenantId);
  }

  async updateStatus(): Promise<Card> {
    throw new Error('Not implemented');
  }

  async findByUsername(username: string, tenantId: string): Promise<Card | null> {
    return this.cards.find((c) => c.username === username && c.tenantId === tenantId) ?? null;
  }
}

class InMemoryPackageRepository implements IPackageRepository {
  private packages: Package[] = [];

  constructor(initialPackages: Package[] = []) {
    this.packages = [...initialPackages];
  }

  async create(pkg: any): Promise<Package> {
    this.packages.push(pkg);
    return pkg;
  }

  async findById(id: string, tenantId: string): Promise<Package | null> {
    return this.packages.find((p) => p.id === id && p.tenantId === tenantId) ?? null;
  }

  async findByCode(code: string, tenantId: string): Promise<Package | null> {
    return this.packages.find((p) => p.code === code && p.tenantId === tenantId) ?? null;
  }

  async findAllByTenant(tenantId: string): Promise<Package[]> {
    return this.packages.filter((p) => p.tenantId === tenantId);
  }

  async update(): Promise<Package> {
    throw new Error('Not implemented');
  }

  async delete(): Promise<void> {
    throw new Error('Not implemented');
  }

  async checkUsage(): Promise<any> {
    return { inUse: false, cardsCount: 0, batchesCount: 0 };
  }
}

describe('Phase 14: Trial Period Lock & Numbers-Only Card Generation', () => {
  const tenantId = 'test-tenant-p14';
  const samplePackage: Package = {
    id: 'pkg-p14',
    tenantId,
    name: 'باقة يومية 1GB',
    code: 'DAILY-1GB',
    price: 500,
    downloadSpeedLimit: '2M',
    uploadSpeedLimit: '1M',
    durationMinutes: 1440,
    validityDays: 1,
    dataLimitBytes: 1073741824,
    hotspotProfileName: 'default',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('1. should throw TrialCardGenerationLockedException when tenant is on TRIAL status', async () => {
    const mockGuard = {
      getTenantSubscriptionInfo: async () => ({
        isAllowed: true,
        subscriptionStatus: 'TRIAL' as const,
        trialEndsAt: new Date(Date.now() + 5 * 86400000),
        subscriptionEndsAt: null,
        daysRemaining: 5,
        planName: null,
        currentRoutersCount: 1,
        maxRoutersLimit: 5,
      }),
    } as unknown as SubscriptionGuard;

    const batchRepo = new InMemoryCardBatchRepository();
    const cardRepo = new InMemoryCardRepository();
    const pkgRepo = new InMemoryPackageRepository([samplePackage]);

    const useCase = new GenerateCardBatchUseCase(
      batchRepo,
      cardRepo,
      pkgRepo,
      undefined,
      undefined,
      undefined,
      mockGuard
    );

    await assert.rejects(
      async () => {
        await useCase.execute({
          tenantId,
          packageId: samplePackage.id,
          quantity: 10,
          createdById: 'admin-user',
        });
      },
      (err: any) => {
        assert.ok(err instanceof TrialCardGenerationLockedException);
        assert.strictEqual(err.code, 'TRIAL_CARD_GENERATION_LOCKED');
        assert.ok(err.message.includes('الفترة التجريبية'));
        return true;
      }
    );
  });

  it('2. should allow card generation when tenant is ACTIVE', async () => {
    const mockGuard = {
      getTenantSubscriptionInfo: async () => ({
        isAllowed: true,
        subscriptionStatus: 'ACTIVE' as const,
        trialEndsAt: new Date(0),
        subscriptionEndsAt: new Date(Date.now() + 30 * 86400000),
        daysRemaining: 30,
        planName: 'باقة شهر واحد',
        currentRoutersCount: 1,
        maxRoutersLimit: 5,
      }),
    } as unknown as SubscriptionGuard;

    const batchRepo = new InMemoryCardBatchRepository();
    const cardRepo = new InMemoryCardRepository();
    const pkgRepo = new InMemoryPackageRepository([samplePackage]);

    const useCase = new GenerateCardBatchUseCase(
      batchRepo,
      cardRepo,
      pkgRepo,
      undefined,
      undefined,
      undefined,
      mockGuard
    );

    const result = await useCase.execute({
      tenantId,
      packageId: samplePackage.id,
      quantity: 5,
      createdById: 'admin-user',
    });

    assert.strictEqual(result.cards.length, 5);
    assert.strictEqual(result.batch.quantity, 5);
    for (const card of result.cards) {
      assert.ok(card.username.length >= 6);
      assert.ok(card.password.length >= 4);
    }
  });

  it('3. should generate NUMBERS_ONLY cards with numeric usernames and empty passwords', async () => {
    const mockGuard = {
      getTenantSubscriptionInfo: async () => ({
        isAllowed: true,
        subscriptionStatus: 'ACTIVE' as const,
        trialEndsAt: new Date(0),
        subscriptionEndsAt: new Date(Date.now() + 30 * 86400000),
        daysRemaining: 30,
        planName: 'باقة شهر واحد',
        currentRoutersCount: 1,
        maxRoutersLimit: 5,
      }),
    } as unknown as SubscriptionGuard;

    const batchRepo = new InMemoryCardBatchRepository();
    const cardRepo = new InMemoryCardRepository();
    const pkgRepo = new InMemoryPackageRepository([samplePackage]);

    const useCase = new GenerateCardBatchUseCase(
      batchRepo,
      cardRepo,
      pkgRepo,
      undefined,
      undefined,
      undefined,
      mockGuard
    );

    const result = await useCase.execute({
      tenantId,
      packageId: samplePackage.id,
      quantity: 20,
      userLength: 8,
      generationMode: 'NUMBERS_ONLY',
      createdById: 'admin-user',
    });

    assert.strictEqual(result.cards.length, 20);
    assert.ok(result.batch.name.includes('أرقام فقط'));

    const seenUsernames = new Set<string>();
    for (const card of result.cards) {
      assert.strictEqual(card.username.length, 8);
      assert.match(card.username, /^[0-9]+$/);
      assert.strictEqual(card.password, ''); // Numbers-only cards have blank passwords
      assert.ok(!seenUsernames.has(card.username), 'Username must be unique in batch');
      seenUsernames.add(card.username);
    }
  });
});
