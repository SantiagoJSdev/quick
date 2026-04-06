import { Prisma, ProductPricingMode } from '@prisma/client';

export type ProductMarginDerivatives = {
  effectiveMarginPercent: string | null;
  marginComputedPercent: string | null;
  suggestedPrice: string | null;
};

function toDecimalLoose(v: unknown): Prisma.Decimal | null {
  if (v === undefined || v === null) {
    return null;
  }
  if (v instanceof Prisma.Decimal) {
    return v.isFinite() ? v : null;
  }
  try {
    const d = new Prisma.Decimal(String(v));
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

/**
 * Reglas M7 (MVP): margen efectivo según `pricingMode`; precio sugerido = costo × (1 + m/100)
 * cuando hay margen efectivo y costo &gt; 0. `marginComputedPercent` = (precio − costo) / costo × 100
 * si costo &gt; 0 (indicativo si moneda de lista ≠ funcional).
 */
export function computeProductMarginDerivatives(
  row: {
    pricingMode?: string | null;
    marginPercentOverride?: unknown;
    price?: unknown;
    cost?: unknown;
  },
  ctx: { defaultMarginPercent?: Prisma.Decimal | null },
): ProductMarginDerivatives {
  const mode = (row.pricingMode ??
    ProductPricingMode.USE_STORE_DEFAULT) as ProductPricingMode;
  const storeM = ctx.defaultMarginPercent;
  const override = toDecimalLoose(row.marginPercentOverride);
  const price = toDecimalLoose(row.price);
  const cost = toDecimalLoose(row.cost);

  let effective: Prisma.Decimal | null = null;
  if (mode === ProductPricingMode.MANUAL_PRICE) {
    effective = null;
  } else if (mode === ProductPricingMode.USE_STORE_DEFAULT) {
    effective = storeM != null && storeM.isFinite() ? storeM : null;
  } else if (mode === ProductPricingMode.USE_PRODUCT_OVERRIDE) {
    effective = override;
  }

  const effectiveMarginPercent = effective ? effective.toString() : null;

  let marginComputedPercent: string | null = null;
  if (price && cost && cost.gt(0)) {
    marginComputedPercent = price.sub(cost).div(cost).mul(100).toString();
  }

  let suggestedPrice: string | null = null;
  if (
    mode !== ProductPricingMode.MANUAL_PRICE &&
    effective &&
    cost &&
    cost.gt(0)
  ) {
    const mult = new Prisma.Decimal(1).add(effective.div(100));
    suggestedPrice = cost.mul(mult).toString();
  }

  return { effectiveMarginPercent, marginComputedPercent, suggestedPrice };
}
