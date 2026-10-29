// ============================================================================
// Platform: Commercial MikroTik Network & HotSpot Card Management System
// File: src/application/interfaces/IPackageRepository.ts
// Application Interface: Package Repository Abstract Contract (Rule 16 - Ports)
// ============================================================================

export interface Package {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  downloadSpeedLimit: string;
  uploadSpeedLimit: string;
  durationMinutes: number;
  validityDays: number;
  dataLimitBytes: bigint | number;
  price: number;
  currency: string;
  simultaneousSessions: number;
  hotspotProfileName: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePackageData {
  tenantId: string;
  name: string;
  code: string;
  downloadSpeedLimit: string;
  uploadSpeedLimit: string;
  durationMinutes: number;
  validityDays: number;
  dataLimitBytes?: bigint | number | undefined;
  price: number;
  currency?: string | undefined;
  simultaneousSessions?: number | undefined;
  hotspotProfileName: string;
  isActive?: boolean | undefined;
}

export interface UpdatePackageData {
  name?: string | undefined;
  code?: string | undefined;
  downloadSpeedLimit?: string | undefined;
  uploadSpeedLimit?: string | undefined;
  durationMinutes?: number | undefined;
  validityDays?: number | undefined;
  dataLimitBytes?: bigint | number | undefined;
  price?: number | undefined;
  currency?: string | undefined;
  simultaneousSessions?: number | undefined;
  hotspotProfileName?: string | undefined;
  isActive?: boolean | undefined;
}

export interface PackageUsage {
  inUse: boolean;
  cardsCount: number;
  batchesCount: number;
}

export interface IPackageRepository {
  create(data: CreatePackageData): Promise<Package>;
  findById(id: string, tenantId: string): Promise<Package | null>;
  findAllByTenant(tenantId: string): Promise<Package[]>;
  update(id: string, tenantId: string, data: UpdatePackageData): Promise<Package>;
  delete(id: string, tenantId: string): Promise<void>;
  checkUsage(id: string, tenantId: string): Promise<PackageUsage>;
}
