import { Prisma } from '@prisma/client';
import {
  GASTO_BAG,
  GASTO_CHARCUTERIE_WRAP,
  GASTO_EMPLOYEES,
  GASTO_FIXED_DAILY,
} from './gasto-constants';

/** Config fase 1 — ganancia real diaria (por tienda, JSON en BusinessSettings).
 * Valores: docs/KPI_GASTOS_CONSTANTES.md y `gasto-constants.ts`.
 */
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
  bag: { ...GASTO_BAG },
  charcuterieWrap: {
    productIds: [...GASTO_CHARCUTERIE_WRAP.productIds],
    unitCost: GASTO_CHARCUTERIE_WRAP.unitCost,
  },
  employees: GASTO_EMPLOYEES.map((e) => ({
    name: e.name,
    dailyPay: e.dailyPay,
  })),
  fixedDaily: { ...GASTO_FIXED_DAILY },
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
