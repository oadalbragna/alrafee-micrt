// ============================================================================
// Platform: Commercial MikroTik Network & HotSpot Card Management System
// File: src/application/use-cases/packages/DeletePackageUseCase.ts
// Application Use Case: Delete Package Entity (Rule 16)
// ============================================================================

import { IPackageRepository } from '../../interfaces/IPackageRepository.js';
import { IAuditLogger } from '../../interfaces/IAuditLogger.js';
import { PackageInUseException } from '../../../domain/exceptions/PackageInUseException.js';

export interface DeletePackageInput {
  id: string;
  tenantId: string;
  userId?: string | null;
}

export class DeletePackageUseCase {
  constructor(
    private readonly packageRepository: IPackageRepository,
    private readonly auditLogger?: IAuditLogger
  ) {}

  async execute(input: DeletePackageInput): Promise<void> {
    if (!input.id || input.id.trim().length === 0) {
      throw new Error('Package ID is required for deletion');
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new Error('Tenant ID is required for deletion');
    }

    // 1. Verify existence and tenant ownership
    const existing = await this.packageRepository.findById(input.id, input.tenantId);
    if (!existing) {
      throw new Error(`Package with id ${input.id} not found for tenant ${input.tenantId}`);
    }

    // 2. Pre-check if package is linked to active cards or batches
    const usage = await this.packageRepository.checkUsage(input.id, input.tenantId);
    if (usage.inUse) {
      throw new PackageInUseException(
        'لا يمكن حذف باقة مرتبطة بكروت أو دفعات سابقة',
        usage.cardsCount,
        usage.batchesCount
      );
    }

    // 3. Safe deletion
    await this.packageRepository.delete(input.id, input.tenantId);

    if (this.auditLogger) {
      await this.auditLogger.log(
        input.tenantId,
        input.userId ?? null,
        'DELETE',
        'Package',
        input.id,
        `Deleted package "${existing.name}" (${input.id})`,
        'SUCCESS'
      );
    }
  }
}
