// ============================================================================
// Platform: Commercial MikroTik Network & HotSpot Card Management System
// File: tests/application/LoginUseCase.test.ts
// Unit Tests: LoginUseCase Business Logic & Audit Logs (Rule 14, Rule 16)
// ============================================================================

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { LoginUseCase } from '../../src/application/use-cases/auth/LoginUseCase.js';
import {
  IUserRepository,
  User,
  CreateStaffUserInput,
} from '../../src/application/interfaces/IUserRepository.js';
import { IAuditLogger } from '../../src/application/interfaces/IAuditLogger.js';
import { hashPassword } from '../../src/infrastructure/security/password.js';
import { verifyToken } from '../../src/infrastructure/security/jwt.js';
import { InvalidCredentialsException } from '../../src/domain/exceptions/InvalidCredentialsException.js';
import { InactiveUserException } from '../../src/domain/exceptions/InactiveUserException.js';

class MockUserRepository implements IUserRepository {
  public users: User[] = [];
  public lastLoginUpdated: { id: string; ip?: string } | null = null;

  async findByUsername(username: string): Promise<User | null> {
    return this.users.find((u) => u.username === username) || null;
  }

  async findByIdentifier(identifier: string): Promise<User | null> {
    const trimmed = identifier.trim().toLowerCase();
    return (
      this.users.find(
        (u) =>
          u.username.toLowerCase() === trimmed ||
          (u.email && u.email.toLowerCase() === trimmed)
      ) || null
    );
  }

  async findById(id: string): Promise<User | null> {
    return this.users.find((u) => u.id === id) || null;
  }

  async findByIdAndTenant(id: string, tenantId: string): Promise<User | null> {
    return (
      this.users.find((u) => u.id === id && u.tenantId === tenantId) || null
    );
  }

  async findByTenantAndUsername(
    tenantId: string,
    username: string
  ): Promise<User | null> {
    return (
      this.users.find(
        (u) => u.tenantId === tenantId && u.username === username
      ) || null
    );
  }

  async updateLastLogin(id: string, ip?: string): Promise<void> {
    this.lastLoginUpdated = { id, ip };
  }

  async createStaffUser(input: CreateStaffUserInput): Promise<User> {
    const user: User = {
      id: input.id || 'mock-id',
      tenantId: input.tenantId,
      username: input.username,
      passwordHash: input.passwordHash,
      fullName: input.fullName,
      role: input.role,
      status: 'ACTIVE',
      email: input.email,
      phone: input.phone,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.users.push(user);
    return user;
  }

  async findAllByTenant(tenantId: string): Promise<User[]> {
    return this.users.filter((u) => u.tenantId === tenantId);
  }

  async updateRole(id: string, tenantId: string, role: string): Promise<User> {
    const user = this.users.find((u) => u.id === id && u.tenantId === tenantId);
    if (!user) throw new Error('User not found');
    user.role = role;
    return user;
  }

  async deactivateUser(id: string, tenantId: string): Promise<User> {
    const user = this.users.find((u) => u.id === id && u.tenantId === tenantId);
    if (!user) throw new Error('User not found');
    user.status = 'INACTIVE';
    return user;
  }
}

class MockAuditLogger implements IAuditLogger {
  public logs: any[] = [];

  async log(
    tenantId: string,
    userId: string | null,
    action: any,
    entity: string,
    entityId?: string | null,
    details?: string | null,
    status?: any
  ): Promise<void> {
    this.logs.push({
      tenantId,
      userId,
      action,
      entity,
      entityId,
      details,
      status,
    });
  }
}

describe('LoginUseCase Unit Tests', () => {
  let userRepo: MockUserRepository;
  let auditLogger: MockAuditLogger;
  let loginUseCase: LoginUseCase;

  beforeEach(async () => {
    userRepo = new MockUserRepository();
    auditLogger = new MockAuditLogger();
    loginUseCase = new LoginUseCase(userRepo, auditLogger);

    const hash = await hashPassword('AdminSecurePass123!');
    userRepo.users.push({
      id: 'usr-1',
      tenantId: 'tenant-123',
      username: 'admin',
      fullName: 'مدير النظام',
      passwordHash: hash,
      role: 'TENANT_ADMIN',
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  it('should authenticate user with valid credentials and return JWT token', async () => {
    const result = await loginUseCase.execute({
      username: 'admin',
      password: 'AdminSecurePass123!',
      ip: '192.168.1.100',
    });

    assert.ok(result.token);
    assert.strictEqual(result.user.username, 'admin');
    assert.strictEqual(result.user.role, 'TENANT_ADMIN');
    assert.strictEqual(result.user.tenantId, 'tenant-123');

    // Verify token claims
    const decoded = verifyToken(result.token);
    assert.strictEqual(decoded.userId, 'usr-1');
    assert.strictEqual(decoded.tenantId, 'tenant-123');
    assert.strictEqual(decoded.role, 'TENANT_ADMIN');

    // Verify last login updated
    assert.strictEqual(userRepo.lastLoginUpdated?.id, 'usr-1');
    assert.strictEqual(userRepo.lastLoginUpdated?.ip, '192.168.1.100');

    // Verify audit log
    assert.strictEqual(auditLogger.logs.length, 1);
    assert.strictEqual(auditLogger.logs[0].action, 'LOGIN');
    assert.strictEqual(auditLogger.logs[0].status, 'SUCCESS');
  });

  it('should reject invalid password with InvalidCredentialsException', async () => {
    await assert.rejects(
      async () => {
        await loginUseCase.execute({
          username: 'admin',
          password: 'WrongPassword999!',
        });
      },
      (err: any) => {
        assert.ok(err instanceof InvalidCredentialsException);
        assert.strictEqual(err.message, 'بيانات الدخول غير صحيحة');
        return true;
      }
    );

    // Verify audit log recorded failure
    assert.strictEqual(auditLogger.logs.length, 1);
    assert.strictEqual(auditLogger.logs[0].action, 'LOGIN');
    assert.strictEqual(auditLogger.logs[0].status, 'FAILURE');
  });

  it('should reject non-existent user with same generic message', async () => {
    await assert.rejects(
      async () => {
        await loginUseCase.execute({
          username: 'non_existent_user',
          password: 'SomePassword123!',
        });
      },
      (err: any) => {
        assert.ok(err instanceof InvalidCredentialsException);
        assert.strictEqual(err.message, 'بيانات الدخول غير صحيحة');
        return true;
      }
    );
  });

  it('should reject inactive/suspended users with clear message when password is correct', async () => {
    userRepo.users[0].status = 'INACTIVE';

    await assert.rejects(
      async () => {
        await loginUseCase.execute({
          username: 'admin',
          password: 'AdminSecurePass123!',
        });
      },
      (err: any) => {
        assert.ok(err instanceof InactiveUserException);
        assert.strictEqual(err.message, 'هذا الحساب معطل، يرجى التواصل مع مسؤول النظام');
        return true;
      }
    );
  });

  it('should reject inactive user with InvalidCredentialsException when password is wrong (password checked first)', async () => {
    userRepo.users[0].status = 'INACTIVE';

    await assert.rejects(
      async () => {
        await loginUseCase.execute({
          username: 'admin',
          password: 'WrongPassword999!',
        });
      },
      (err: any) => {
        assert.ok(err instanceof InvalidCredentialsException);
        assert.strictEqual(err.message, 'بيانات الدخول غير صحيحة');
        return true;
      }
    );
  });

  it('should authenticate successfully using email as identifier', async () => {
    userRepo.users[0].email = 'admin@jalsah.network';

    const result = await loginUseCase.execute({
      identifier: 'admin@jalsah.network',
      password: 'AdminSecurePass123!',
    });

    assert.ok(result.token);
    assert.strictEqual(result.user.username, 'admin');
    assert.strictEqual(result.user.role, 'TENANT_ADMIN');
  });

  it('should authenticate successfully using username via identifier field', async () => {
    const result = await loginUseCase.execute({
      identifier: 'admin',
      password: 'AdminSecurePass123!',
    });

    assert.ok(result.token);
    assert.strictEqual(result.user.username, 'admin');
  });
});
