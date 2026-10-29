// ============================================================================
// Platform: Commercial MikroTik Network & HotSpot Card Management System
// File: src/infrastructure/database/repositories/PrismaPackageRepository.ts
// Infrastructure Adapter: Prisma PostgreSQL Implementation of IPackageRepository
// Master Reference: Rule 16 (Adapters), Rule 19 (Security)
// ============================================================================

import { PrismaClient } from '@prisma/client/wasm.js';
import { prisma as defaultPrisma } from '../prisma.js';
import {
  IPackageRepository,
  Package,
  PackageUsage,
  CreatePackageData,
  UpdatePackageData,
} from '../../../application/interfaces/IPackageRepository.js';
import { PackageInUseException } from '../../../domain/exceptions/PackageInUseException.js';

export class PrismaPackageRepository implements IPackageRepository {
  constructor(private readonly prisma: PrismaClient = defaultPrisma) {}

  async create(data: CreatePackageData): Promise<Package> {
    const record = await this.prisma.package.create({
      data: {
        tenantId: data.tenantId,
        name: data.name,
        code: data.code,
        downloadSpeedLimit: data.downloadSpeedLimit,
        uploadSpeedLimit: data.uploadSpeedLimit,
        durationMinutes: data.durationMinutes,
        validityDays: data.validityDays,
        dataLimitBytes:
          data.dataLimitBytes !== undefined ? BigInt(data.dataLimitBytes) : BigInt(0),
        price: data.price,
        currency: data.currency ?? 'SDG',
        simultaneousSessions: data.simultaneousSessions ?? 1,
        hotspotProfileName: data.hotspotProfileName,
        isActive: data.isActive ?? true,
      },
    });

    return this.mapToPackage(record);
  }

  async findById(id: string, tenantId: string): Promise<Package | null> {
    const record = await this.prisma.package.findFirst({
      where: {
        id,
        tenantId,
      },
    });

    if (!record) return null;
    return this.mapToPackage(record);
  }

  async findAllByTenant(tenantId: string): Promise<Package[]> {
    const records = await this.prisma.package.findMany({
      where: {
        tenantId,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return records.map((record) => this.mapToPackage(record));
  }

  async update(id: string, tenantId: string, data: UpdatePackageData): Promise<Package> {
    const existing = await this.prisma.package.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      throw new Error(`Package with id ${id} not found for tenant ${tenantId}`);
    }

    const updateData: any = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.code !== undefined) updateData.code = data.code;
    if (data.downloadSpeedLimit !== undefined) updateData.downloadSpeedLimit = data.downloadSpeedLimit;
    if (data.uploadSpeedLimit !== undefined) updateData.uploadSpeedLimit = data.uploadSpeedLimit;
    if (data.durationMinutes !== undefined) updateData.durationMinutes = data.durationMinutes;
    if (data.validityDays !== undefined) updateData.validityDays = data.validityDays;
    if (data.dataLimitBytes !== undefined) updateData.dataLimitBytes = BigInt(data.dataLimitBytes);
    if (data.price !== undefined) updateData.price = data.price;
    if (data.currency !== undefined) updateData.currency = data.currency;
    if (data.simultaneousSessions !== undefined) updateData.simultaneousSessions = data.simultaneousSessions;
    if (data.hotspotProfileName !== undefined) updateData.hotspotProfileName = data.hotspotProfileName;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;

    const updated = await this.prisma.package.update({
      where: { id },
      data: updateData,
    });

    return this.mapToPackage(updated);
  }

  async checkUsage(id: string, tenantId: string): Promise<PackageUsage> {
    const [cardsCount, batchesCount] = await Promise.all([
      this.prisma.card.count({
        where: { packageId: id, tenantId },
      }),
      this.prisma.cardBatch.count({
        where: { packageId: id, tenantId },
      }),
    ]);

    return {
      inUse: cardsCount > 0 || batchesCount > 0,
      cardsCount,
      batchesCount,
    };
  }

  async delete(id: string, tenantId: string): Promise<void> {
    const existing = await this.prisma.package.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      throw new Error(`Package with id ${id} not found for tenant ${tenantId}`);
    }

    try {
      await this.prisma.package.delete({
        where: { id },
      });
    } catch (err: any) {
      const errStr = String(err?.message || '');
      const errCode = String(err?.code || '');
      if (
        errStr.includes('RestrictViolation') ||
        errStr.includes('foreign key constraint') ||
        errStr.includes('Foreign key constraint') ||
        errStr.includes('violates foreign key') ||
        errCode === 'P2003'
      ) {
        throw new PackageInUseException('لا يمكن حذف باقة مرتبطة بكروت أو دفعات سابقة');
      }
      throw err;
    }
  }

  private mapToPackage(record: any): Package {
    return {
      id: record.id,
      tenantId: record.tenantId,
      name: record.name,
      code: record.code,
      downloadSpeedLimit: record.downloadSpeedLimit,
      uploadSpeedLimit: record.uploadSpeedLimit,
      durationMinutes: record.durationMinutes,
      validityDays: record.validityDays,
      dataLimitBytes: record.dataLimitBytes,
      price: typeof record.price === 'number' ? record.price : Number(record.price),
      currency: record.currency,
      simultaneousSessions: record.simultaneousSessions,
      hotspotProfileName: record.hotspotProfileName,
      isActive: record.isActive,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
