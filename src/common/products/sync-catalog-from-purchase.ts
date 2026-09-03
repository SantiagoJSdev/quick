import { Prisma, ProductPricingMode } from '@prisma/client';
import { computeProductMarginDerivatives } from '../../modules/products/product-margin-derivatives';
import { productRelationInclude } from '../../modules/products/product-relations.include';
import { productSyncPullPayload } from '../../modules/products/product-pull-payload';

export type CatalogFromPurchaseResult = {
  costUpdated: boolean;
  priceUpdated: boolean;
  catalogCostBeforeFunctional: Prisma.Decimal | null;
  catalogPriceBefore: Prisma.Decimal | null;
};

/**
 * Política costo v1: último costo de factura → `Product.cost` (funcional).
 * Si no es MANUAL_PRICE, recalcula `price` con margen de tienda.
 */
export async function applyCatalogFromPurchaseLine(
  tx: Prisma.TransactionClient,
  params: {
    productId: string;
    unitCostFunctional: Prisma.Decimal;
    defaultMarginPercent: Prisma.Decimal | null;
  },
): Promise<CatalogFromPurchaseResult> {
  const empty: CatalogFromPurchaseResult = {
    costUpdated: false,
    priceUpdated: false,
    catalogCostBeforeFunctional: null,
    catalogPriceBefore: null,
  };

  if (
    !params.unitCostFunctional.isFinite() ||
    params.unitCostFunctional.lte(0)
  ) {
    return empty;
  }

  const product = await tx.product.findUnique({
    where: { id: params.productId },
  });
  if (!product) {
    return empty;
  }

  const catalogCostBeforeFunctional = product.cost;
  const catalogPriceBefore = product.price;

  const { suggestedPrice } = computeProductMarginDerivatives(
    {
      pricingMode: product.pricingMode,
      marginPercentOverride: product.marginPercentOverride,
      cost: params.unitCostFunctional,
      price: product.price,
    },
    { defaultMarginPercent: params.defaultMarginPercent },
  );

  const data: Prisma.ProductUpdateInput = {
    cost: params.unitCostFunctional,
  };
  let priceUpdated = false;
  if (
    product.pricingMode !== ProductPricingMode.MANUAL_PRICE &&
    suggestedPrice != null
  ) {
    data.price = new Prisma.Decimal(suggestedPrice);
    priceUpdated = true;
  }

  const updated = await tx.product.update({
    where: { id: params.productId },
    data,
    include: productRelationInclude,
  });

  await tx.serverChangeLog.create({
    data: {
      opType: 'PRODUCT_UPDATED',
      payload: productSyncPullPayload(updated) as Prisma.InputJsonValue,
      storeScopeId: updated.catalogStoreId,
    },
  });

  return {
    costUpdated: true,
    priceUpdated,
    catalogCostBeforeFunctional,
    catalogPriceBefore: priceUpdated ? catalogPriceBefore : null,
  };
}

/** IN_ADJUST / stock inicial: solo actualiza `Product.cost` (sin recalcular precio). */
export async function applyCatalogCostFromAdjust(
  tx: Prisma.TransactionClient,
  params: {
    productId: string;
    unitCostFunctional: Prisma.Decimal;
  },
): Promise<boolean> {
  if (
    !params.unitCostFunctional.isFinite() ||
    params.unitCostFunctional.lte(0)
  ) {
    return false;
  }

  const updated = await tx.product.update({
    where: { id: params.productId },
    data: { cost: params.unitCostFunctional },
    include: productRelationInclude,
  });

  await tx.serverChangeLog.create({
    data: {
      opType: 'PRODUCT_UPDATED',
      payload: productSyncPullPayload(updated) as Prisma.InputJsonValue,
      storeScopeId: updated.catalogStoreId,
    },
  });

  return true;
}

/** Revierte catálogo al snapshot guardado en la línea de compra (VOID). */
export async function revertCatalogFromPurchaseLine(
  tx: Prisma.TransactionClient,
  line: {
    productId: string;
    catalogCostBeforeFunctional: Prisma.Decimal | null;
    catalogPriceBefore: Prisma.Decimal | null;
  },
): Promise<void> {
  if (line.catalogCostBeforeFunctional == null) {
    return;
  }

  const data: Prisma.ProductUpdateInput = {
    cost: line.catalogCostBeforeFunctional,
  };
  if (line.catalogPriceBefore != null) {
    data.price = line.catalogPriceBefore;
  }

  const updated = await tx.product.update({
    where: { id: line.productId },
    data,
    include: productRelationInclude,
  });

  await tx.serverChangeLog.create({
    data: {
      opType: 'PRODUCT_UPDATED',
      payload: productSyncPullPayload(updated) as Prisma.InputJsonValue,
      storeScopeId: updated.catalogStoreId,
    },
  });
}
