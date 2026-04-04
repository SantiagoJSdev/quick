import { randomUUID } from 'crypto';
import { InventoryService } from '../inventory/inventory.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SyncService } from './sync.service';

const run = process.env.RUN_INTEGRATION === '1';

(run ? describe : describe.skip)('SyncService (integration, RUN_INTEGRATION=1)', () => {
  let prisma: PrismaService;
  let service: SyncService;
  let storeId: string;
  const deviceId = `it-device-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    const inventory = new InventoryService(prisma);
    service = new SyncService(prisma, inventory);

    const store = await prisma.store.findFirst({
      include: { businessSettings: true },
    });
    if (!store?.businessSettings) {
      throw new Error(
        'No store with BusinessSettings; run npm run db:seed before integration tests',
      );
    }
    storeId = store.id;
  });

  afterAll(async () => {
    await prisma.syncOperation.deleteMany({ where: { deviceId } });
    await prisma.pOSDevice.deleteMany({ where: { deviceId } });
    await prisma.$disconnect();
  });

  it('NOOP acks then same opId is skipped', async () => {
    const opId = randomUUID();
    const ts = new Date().toISOString();

    const first = await service.push(
      {
        deviceId,
        ops: [
          {
            opId,
            opType: 'NOOP',
            timestamp: ts,
            payload: { ping: true },
          },
        ],
      },
      storeId,
    );

    expect(first.acked).toHaveLength(1);
    expect(first.acked[0].opId).toBe(opId);
    expect(first.acked[0].serverVersion).toBeGreaterThan(0);
    expect(first.skipped).toHaveLength(0);
    expect(first.failed).toHaveLength(0);

    const second = await service.push(
      {
        deviceId,
        ops: [
          {
            opId,
            opType: 'NOOP',
            timestamp: ts,
            payload: { ping: true },
          },
        ],
      },
      storeId,
    );

    expect(second.acked).toHaveLength(0);
    expect(second.skipped).toEqual([
      { opId, reason: 'already_applied' },
    ]);
    expect(second.failed).toHaveLength(0);
  });

  it('pull returns ordered ops and stable shape', async () => {
    const r = await service.pull(storeId, 0, 50);
    expect(r.fromVersion).toBe(0);
    expect(Array.isArray(r.ops)).toBe(true);
    expect(typeof r.toVersion).toBe('number');
    expect(r.toVersion).toBeGreaterThanOrEqual(0);
    expect(typeof r.hasMore).toBe('boolean');
    for (let i = 1; i < r.ops.length; i++) {
      expect(r.ops[i].serverVersion).toBeGreaterThan(r.ops[i - 1].serverVersion);
    }
  });
});
