import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CashSessionService } from './cash-session.service';

describe('CashSessionService', () => {
  const storeId = '10000000-0000-4000-8000-000000000001';
  const deviceId = 'dev-1';
  const sessionId = '40000000-0000-4000-8000-000000000004';

  function openRow(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: sessionId,
      storeId,
      deviceId,
      status: 'OPEN',
      openedAt: new Date('2026-07-26T12:00:00.000Z'),
      closedAt: null,
      openingCash: new Prisma.Decimal('50'),
      countedCash: null,
      closeMode: null,
      notes: null,
      pendingSalesJson: null,
      pendingCount: 0,
      ticketsCount: null,
      salesTotalFunctional: null,
      returnsTotalFunctional: null,
      stockConflictSalesCount: null,
      negativeSkuCount: null,
      syncFailedCount: null,
      closeWarningsJson: null,
      createdAt: new Date('2026-07-26T12:00:00.000Z'),
      updatedAt: new Date('2026-07-26T12:00:00.000Z'),
      ...overrides,
    };
  }

  it('open returns existing OPEN session for device', async () => {
    const existing = openRow();
    const prisma = {
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({}),
      ),
      cashSession: {
        findFirst: jest.fn().mockResolvedValue(existing),
        create: jest.fn(),
      },
    };
    const posDevice = {
      touchOrRegister: jest.fn().mockResolvedValue(deviceId),
    };
    const service = new CashSessionService(prisma as never, posDevice as never);

    const result = await service.open(storeId, { deviceId });
    expect(result.id).toBe(sessionId);
    expect(result.status).toBe('OPEN');
    expect(prisma.cashSession.create).not.toHaveBeenCalled();
  });

  it('close rejects already closed session', async () => {
    const prisma = {
      cashSession: {
        findFirst: jest.fn().mockResolvedValue(openRow({ status: 'CLOSED' })),
      },
    };
    const service = new CashSessionService(prisma as never, {} as never);
    await expect(
      service.close(storeId, sessionId, { closeMode: 'ONLINE' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('findCurrent 404 when none open', async () => {
    const prisma = {
      cashSession: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const service = new CashSessionService(prisma as never, {} as never);
    await expect(service.findCurrent(storeId, deviceId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
