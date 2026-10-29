// ============================================================================
// Platform: Commercial MikroTik Network & HotSpot Card Management System
// File: src/presentation/http/errors/prismaErrorHandler.ts
// Presentation Utility: Sanitized Prisma & Database Error Mapping
// ============================================================================

import { FastifyReply, FastifyBaseLogger } from 'fastify';
import { PackageInUseException } from '../../../domain/exceptions/PackageInUseException.js';
import { ConflictException } from '../../../domain/exceptions/ConflictException.js';

/**
 * Safely maps and sanitizes Prisma, WASM, and internal database errors.
 * Strictly prevents leaking raw internal schemas, SQL queries, or WASM engine crashes to users.
 * Logs the full error stack details on the server for debugging.
 */
export function handlePrismaOrServerError(
  err: any,
  reply: FastifyReply,
  logger: FastifyBaseLogger,
  fallbackMessage = 'فشل تنفيذ العملية بسبب خطأ في الخادم'
) {
  logger.error(err, 'Database or Server execution failure');

  const errStr = String(err?.message || '');
  const errCode = String(err?.code || '');
  const errName = String(err?.name || '');

  // 1. Explicit domain PackageInUseException or conflict
  if (
    err instanceof PackageInUseException ||
    errName === 'PackageInUseException' ||
    err?.errorCode === 'PACKAGE_IN_USE'
  ) {
    return reply.status(409).send({
      success: false,
      errorCode: 'PACKAGE_IN_USE',
      errorMessage: err.message || 'لا يمكن حذف باقة مرتبطة بكروت أو دفعات سابقة',
      details: {
        cardsCount: err.cardsCount ?? 0,
        batchesCount: err.batchesCount ?? 0,
      },
    });
  }

  // 2. Foreign Key Constraint / RestrictViolation (WASM_ERROR, unknown variant RestrictViolation, P2003)
  if (
    errStr.includes('RestrictViolation') ||
    errStr.includes('foreign key constraint') ||
    errStr.includes('Foreign key constraint') ||
    errStr.includes('violates foreign key') ||
    errCode === 'P2003'
  ) {
    return reply.status(409).send({
      success: false,
      errorCode: 'PACKAGE_IN_USE',
      errorMessage: 'لا يمكن حذف باقة مرتبطة بكروت أو دفعات سابقة',
    });
  }

  // 3. Generic ConflictException
  if (err instanceof ConflictException || errName === 'ConflictException') {
    return reply.status(409).send({
      success: false,
      errorCode: err.errorCode || 'CONFLICT',
      errorMessage: err.message,
    });
  }

  // 4. Unique constraint violation (P2002) - Exactly preserves original target/main contract
  if (errCode === 'P2002' || errStr.includes('Unique constraint')) {
    return reply.status(409).send({
      success: false,
      errorCode: 'PACKAGE_CODE_EXISTS',
      errorMessage: 'A package with this code already exists for this tenant',
    });
  }

  // 5. Record not found
  if (errCode === 'P2025' || errStr.toLowerCase().includes('not found')) {
    return reply.status(404).send({
      success: false,
      errorCode: 'PACKAGE_NOT_FOUND',
      errorMessage: 'باقة الكروت غير موجودة',
    });
  }

  // 6. Prisma / WASM Engine / Database Internal Failures
  // Strictly prevent leaking stack traces, WASM errors, or prisma invocations to the client
  return reply.status(500).send({
    success: false,
    errorCode: 'INTERNAL_ERROR',
    errorMessage: fallbackMessage,
  });
}
