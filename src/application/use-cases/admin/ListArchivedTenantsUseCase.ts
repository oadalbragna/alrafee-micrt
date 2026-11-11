// ============================================================================
// Platform: Commercial MikroTik Network & HotSpot Card Management System
// File: src/application/use-cases/admin/ListArchivedTenantsUseCase.ts
// Use Case: List All Archived (Soft-Deleted) Tenants for Platform Super Admin
// ============================================================================

import { PrismaClient } from '@prisma/client/wasm.js';
import { prisma as defaultPrisma } from '../../../infrastructure/database/prisma.js';

export interface ArchivedTenantSummary {
  id: string;
  name: string;
  slug: string;
  contactEmail: string | null;
  contactPhone: string | null;
  currency: string;
  status: string;
  subscriptionStatus: string;
  previousSubscriptionStatus: string | null;
  approvalStatus: string;
  trialEndsAt: Date;
  subscriptionEndsAt: Date | null;
  planName: string | null;
  maxRoutersLimit: number;
  usersCount: number;
  routersCount: number;
  packagesCount: number;
  cardBatchesCount: number;
  cardsCount: number;
  salesCount: number;
  counts: {
    users: number;
    routers: number;
    packages: number;
    cardBatches: number;
    cards: number;
    sales: number;
  };
  owner: {
    id: string;
    username: string;
    fullName: string;
    email: string | null;
    phone: string | null;
  } | null;
  isDeleted: boolean;
  deletedAt: Date | null;
  retentionDays: number;
  remainingRetentionHours: number;
  canPermanentDelete: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class ListArchivedTenantsUseCase {
  constructor(private readonly prisma: PrismaClient = defaultPrisma) {}

  async execute(): Promise<ArchivedTenantSummary[]> {
    const rawRetentionDays = process.env.ARCHIVE_RETENTION_DAYS !== undefined
      ? Number(process.env.ARCHIVE_RETENTION_DAYS)
      : 30;
    const retentionDays = Number.isNaN(rawRetentionDays) || rawRetentionDays < 0
      ? 30
      : rawRetentionDays;
    const retentionMs = retentionDays * 24 * 60 * 60 * 1000;
    const isPermanentDeleteEnabled = process.env.ENABLE_PERMANENT_DELETE === 'true';
    const nowMs = Date.now();

    const tenants = await this.prisma.tenant.findMany({
      where: { isDeleted: true },
      orderBy: { deletedAt: 'desc' },
      select: {
        id: true,
        name: true,
        slug: true,
        contactEmail: true,
        contactPhone: true,
        currency: true,
        status: true,
        subscriptionStatus: true,
        previousSubscriptionStatus: true,
        approvalStatus: true,
        trialEndsAt: true,
        subscriptionEndsAt: true,
        planName: true,
        maxRoutersLimit: true,
        isDeleted: true,
        deletedAt: true,
        createdAt: true,
        updatedAt: true,
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
          },
        },
      },
    });

    return tenants.map((t) => {
      const deletedAtMs = t.deletedAt ? t.deletedAt.getTime() : nowMs;
      const elapsedMs = Math.max(0, nowMs - deletedAtMs);
      const remainingMs = Math.max(0, retentionMs - elapsedMs);
      const remainingRetentionHours = Math.ceil(remainingMs / (1000 * 60 * 60));

      return {
        id: t.id,
        name: t.name,
        slug: t.slug,
        contactEmail: t.contactEmail,
        contactPhone: t.contactPhone,
        currency: t.currency,
        status: t.status,
        subscriptionStatus: t.subscriptionStatus,
        previousSubscriptionStatus: t.previousSubscriptionStatus,
        approvalStatus: t.approvalStatus,
        trialEndsAt: t.trialEndsAt,
        subscriptionEndsAt: t.subscriptionEndsAt,
        planName: t.planName,
        maxRoutersLimit: t.maxRoutersLimit,
        usersCount: t._count.users,
        routersCount: t._count.routers,
        packagesCount: t._count.packages,
        cardBatchesCount: t._count.cardBatches,
        cardsCount: t._count.cards,
        salesCount: t._count.sales,
        counts: {
          users: t._count.users,
          routers: t._count.routers,
          packages: t._count.packages,
          cardBatches: t._count.cardBatches,
          cards: t._count.cards,
          sales: t._count.sales,
        },
        owner: t.users[0] ?? null,
        isDeleted: t.isDeleted,
        deletedAt: t.deletedAt,
        retentionDays,
        remainingRetentionHours,
        canPermanentDelete: isPermanentDeleteEnabled && remainingRetentionHours === 0,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      };
    });
  }
}
