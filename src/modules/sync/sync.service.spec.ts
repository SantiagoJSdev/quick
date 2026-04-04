import { SyncService } from './sync.service';

describe('SyncService', () => {
  it('returns empty buckets when ops is empty without opening a transaction', async () => {
    const prisma = {
      $transaction: jest.fn(),
    } as unknown as import('../../prisma/prisma.service').PrismaService;

    const service = new SyncService(prisma);
    const result = await service.push(
      { deviceId: 'device-x', ops: [] },
      '00000000-0000-4000-8000-000000000001',
    );

    expect(result.acked).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
