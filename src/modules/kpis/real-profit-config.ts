import { Prisma } from '@prisma/client';

/** Config fase 1 — ganancia real diaria (por tienda, JSON en BusinessSettings). */
export type RealProfitEmployee = {
  name: string;
  dailyPay: string;
};

export type RealProfitConfig = {
  bag: {
    productId: string;
    packSize: number;
    /** Fracción de tickets que reciben 1 bolsa (0–1). */
    ticketCoverageRate: number;
  };
  charcuterieWrap: {
    productIds: string[];
    unitCost: string;
  };
  employees: RealProfitEmployee[];
  fixedDaily: {
    utilities: string;
    rent: string;
    transport: string;
  };
};

/** Defaults del minimarket (fase 1). Se usan si la tienda aún no guardó config. */
export const DEFAULT_REAL_PROFIT_CONFIG: RealProfitConfig = {
  bag: {
    productId: 'e63d9367-d5bb-46b5-98e6-85b1d2703b89',
    packSize: 100,
    ticketCoverageRate: 0.9,
  },
  charcuterieWrap: {
    productIds: [
      '2f3f9970-e06a-4693-b139-86b4076fe33d',
      '5fbbd052-f93d-400b-88f2-6ad7dfcbbed7',
      '9c54f501-1184-4209-90a8-e634eeb44442',
      '16e1c2af-2065-4188-861b-10a11418dc60',
      'b5fceb18-1537-49c6-bce5-43a4f721d052',
      '4e1d472a-9499-4800-af80-24b86bac8c69',
      'd996b1ad-8d3f-4b7a-a6bb-e7fe0c36ef73',
      'fbd7b13f-8fd5-4a94-9a97-f39314519ddb',
      '6a54dc9e-5780-4d6c-9a2b-376fb007669a',
      '7ef4d747-125e-4514-a5a4-0c4d35591131',
      '51a33f03-5294-441f-9265-9ea36dbf5a77',
    ],
    unitCost: '0.025',
  },
  employees: [
    { name: 'Empleado 1', dailyPay: '11.66' },
    { name: 'Empleado 2', dailyPay: '8.33' },
    { name: 'Empleado 3', dailyPay: '4.16' },
  ],
  fixedDaily: {
    utilities: '1.46',
    rent: '2.5',
    transport: '4.41',
  },
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function asString(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : fallback;
}

function asNumber(v: unknown, fallback: number): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

/** Parsea JSON de BD o aplica default fase 1. */
export function resolveRealProfitConfig(raw: unknown): RealProfitConfig {
  const d = DEFAULT_REAL_PROFIT_CONFIG;
  const root = asRecord(raw);
  if (!root) {
    return structuredClone(d);
  }

  const bag = asRecord(root.bag) ?? {};
  const wrap = asRecord(root.charcuterieWrap) ?? {};
  const fixed = asRecord(root.fixedDaily) ?? {};
  const employeesRaw = Array.isArray(root.employees) ? root.employees : null;

  const productIds = Array.isArray(wrap.productIds)
    ? wrap.productIds.filter((x): x is string => typeof x === 'string')
    : d.charcuterieWrap.productIds;

  const employees: RealProfitEmployee[] = employeesRaw
    ? employeesRaw
        .map((e) => {
          const r = asRecord(e);
          if (!r) return null;
          return {
            name: asString(r.name, 'Empleado'),
            dailyPay: asString(r.dailyPay, '0'),
          };
        })
        .filter((e): e is RealProfitEmployee => e != null)
    : d.employees;

  return {
    bag: {
      productId: asString(bag.productId, d.bag.productId),
      packSize: Math.max(1, Math.floor(asNumber(bag.packSize, d.bag.packSize))),
      ticketCoverageRate: Math.min(
        1,
        Math.max(0, asNumber(bag.ticketCoverageRate, d.bag.ticketCoverageRate)),
      ),
    },
    charcuterieWrap: {
      productIds: productIds.length > 0 ? productIds : d.charcuterieWrap.productIds,
      unitCost: asString(wrap.unitCost, d.charcuterieWrap.unitCost),
    },
    employees: employees.length > 0 ? employees : d.employees,
    fixedDaily: {
      utilities: asString(fixed.utilities, d.fixedDaily.utilities),
      rent: asString(fixed.rent, d.fixedDaily.rent),
      transport: asString(fixed.transport, d.fixedDaily.transport),
    },
  };
}

export function sumEmployeeDaily(cfg: RealProfitConfig): Prisma.Decimal {
  return cfg.employees.reduce(
    (acc, e) => acc.plus(new Prisma.Decimal(e.dailyPay || '0')),
    new Prisma.Decimal(0),
  );
}

export function sumFixedDaily(cfg: RealProfitConfig): Prisma.Decimal {
  const f = cfg.fixedDaily;
  return new Prisma.Decimal(f.utilities || '0')
    .plus(f.rent || '0')
    .plus(f.transport || '0');
}

/** Días calendario inclusivos en el rango de reporte (para prorratear fijos). */
export function inclusiveCalendarDays(dateFrom: string, dateTo: string): number {
  const a = Date.parse(`${dateFrom}T00:00:00Z`);
  const b = Date.parse(`${dateTo}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 1;
  return Math.floor((b - a) / 86_400_000) + 1;
}
