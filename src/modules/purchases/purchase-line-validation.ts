import { BadRequestException } from '@nestjs/common';

/** Una factura no puede repetir el mismo productId en varias líneas. */
export function assertUniquePurchaseLineProducts(
  lines: { productId: string }[],
): void {
  const seen = new Set<string>();
  for (const line of lines) {
    if (seen.has(line.productId)) {
      throw new BadRequestException({
        code: 'DUPLICATE_PRODUCT_IN_PURCHASE',
        message:
          'Una factura no puede incluir el mismo producto en más de una línea.',
        productId: line.productId,
      });
    }
    seen.add(line.productId);
  }
}
