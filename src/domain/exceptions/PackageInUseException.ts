// ============================================================================
// Platform: Commercial MikroTik Network & HotSpot Card Management System
// File: src/domain/exceptions/PackageInUseException.ts
// Domain Exception: Package In Use Conflict (Rule 14, Rule 19)
// ============================================================================

import { ConflictException } from './ConflictException.js';

export class PackageInUseException extends ConflictException {
  constructor(
    message: string = 'لا يمكن حذف باقة مرتبطة بكروت أو دفعات سابقة',
    public readonly cardsCount: number = 0,
    public readonly batchesCount: number = 0
  ) {
    super(message, 'PACKAGE_IN_USE');
    this.name = 'PackageInUseException';
  }
}
