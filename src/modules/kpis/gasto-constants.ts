/**
 * Constantes de gasto Quick Market — espejo de docs/KPI_GASTOS_CONSTANTES.md
 * Cambiar montos/%: primero el MD, luego este archivo + seed/PATCH (mismo PR).
 */
export const QUICK_MARKET_STORE_ID =
  '0b54c944-28ba-4542-991a-4840c4801906';

export const GASTO_FIXED_DAILY = {
  utilities: '1.46',
  rent: '2.5',
  transport: '4.41',
} as const;

export const GASTO_EMPLOYEES = [
  { name: 'Empleado 1', dailyPay: '11.66' },
  { name: 'Empleado 2', dailyPay: '8.33' },
  { name: 'Empleado 3', dailyPay: '4.16' },
] as const;

export const GASTO_BAG = {
  productId: 'e63d9367-d5bb-46b5-98e6-85b1d2703b89',
  packSize: 100,
  ticketCoverageRate: 0.9,
} as const;

export const GASTO_CHARCUTERIE_WRAP = {
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
} as const;

/** Seed Paso 3 — no inventar % en el servicio de KPIs. */
export const GASTO_PAYMENT_METHODS = [
  {
    code: 'CASH_USD',
    name: 'Efectivo USD',
    commissionPercent: '0',
    isCashLike: true,
  },
  {
    code: 'CASH_VES',
    name: 'Efectivo VES',
    commissionPercent: '0',
    isCashLike: true,
  },
  {
    code: 'DEBITO_BDV',
    name: 'Débito Banco de Venezuela',
    commissionPercent: '2.1',
    isCashLike: false,
  },
  {
    code: 'DEBITO_BNC',
    name: 'Débito BNC',
    commissionPercent: '2.0',
    isCashLike: false,
  },
] as const;
