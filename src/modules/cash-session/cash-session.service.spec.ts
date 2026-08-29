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
        update: jest.fn(),
      },
    };
    const posDevice = {
      touchOrRegister: jest.fn().mockResolvedValue(deviceId),
    };
    const kpis = { captureTodayOnCashClose: jest.fn() };
    const service = new CashSessionService(
      prisma as never,
      posDevice as never,
      kpis as never,
    );

    const result = await service.open(storeId, {
      deviceId,
      openingCash: '80.00',
    });
    expect(result.id).toBe(sessionId);
    expect(result.status).toBe('OPEN');
    expect(result.openingCash).toBe('50');
    expect(prisma.cashSession.create).not.toHaveBeenCalled();
    expect(prisma.cashSession.update).not.toHaveBeenCalled();
  });

  it('open claims zombie OPEN with openingCash 0', async () => {
    const existing = openRow({ openingCash: new Prisma.Decimal('0') });
    const updated = openRow({ openingCash: new Prisma.Decimal('80') });
    const prisma = {
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({}),
      ),
      cashSession: {
        findFirst: jest.fn().mockResolvedValue(existing),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue(updated),
      },
    };
    const posDevice = {
      touchOrRegister: jest.fn().mockResolvedValue(deviceId),
    };
    const service = new CashSessionService(
      prisma as never,
      posDevice as never,
      { captureTodayOnCashClose: jest.fn() } as never,
    );

    const result = await service.open(storeId, {
      deviceId,
      openingCash: '80.00',
    });
    expect(result.openingCash).toBe('80');
    expect(prisma.cashSession.update).toHaveBeenCalledWith({
      where: { id: sessionId },
      data: { openingCash: expect.any(Prisma.Decimal) },
    });
  });

  it('open creates with clientOpenedAt as openedAt', async () => {
    const clientOpenedAt = '2026-07-26T08:00:00.000Z';
    const created = openRow({
      openedAt: new Date(clientOpenedAt),
      openingCash: new Prisma.Decimal('80'),
    });
    const prisma = {
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({}),
      ),
      cashSession: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(created),
      },
    };
    jest.useFakeTimers().setSystemTime(new Date('2026-07-26T16:00:00.000Z'));
    const service = new CashSessionService(
      prisma as never,
      { touchOrRegister: jest.fn() } as never,
      { captureTodayOnCashClose: jest.fn() } as never,
    );

    const result = await service.open(storeId, {
      deviceId,
      openingCash: '80.00',
      clientOpenedAt,
    });
    expect(result.openedAt).toBe(clientOpenedAt);
    expect(prisma.cashSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        openedAt: new Date(clientOpenedAt),
        openingCash: expect.any(Prisma.Decimal),
      }),
    });
    jest.useRealTimers();
  });

  it('open rejects clientOpenedAt older than 36h', async () => {
    const prisma = {
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({}),
      ),
      cashSession: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    jest.useFakeTimers().setSystemTime(new Date('2026-07-28T12:00:00.000Z'));
    const service = new CashSessionService(
      prisma as never,
      { touchOrRegister: jest.fn() } as never,
      { captureTodayOnCashClose: jest.fn() } as never,
    );
    await expect(
      service.open(storeId, {
        deviceId,
        clientOpenedAt: '2026-07-26T08:00:00.000Z',
      }),
    ).rejects.toThrow(/36 hours/);
    jest.useRealTimers();
  });

  it('close rejects already closed session', async () => {
    const prisma = {
      cashSession: {
        findFirst: jest.fn().mockResolvedValue(openRow({ status: 'CLOSED' })),
      },
    };
    const service = new CashSessionService(
      prisma as never,
      {} as never,
      {} as never,
    );
    await expect(
      service.close(storeId, sessionId, { closeMode: 'ONLINE' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('findCurrent 404 when none open', async () => {
    const prisma = {
      cashSession: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const service = new CashSessionService(
      prisma as never,
      {} as never,
      {} as never,
    );
    await expect(service.findCurrent(storeId, deviceId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
