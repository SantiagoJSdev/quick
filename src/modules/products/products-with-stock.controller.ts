import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  InternalServerErrorException,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiBody,
  ApiHeader,
  ApiOkResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { CreateProductWithStockDto } from './dto/create-product-with-stock.dto';
import {
  type ProductStoreContext,
  ProductsService,
} from './products.service';

/** Misma forma que `X-Store-Id` en `StoreConfiguredGuard`. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@ApiTags('products')
@ApiSecurity('X-Store-Id')
@ApiHeader({
  name: 'X-Store-Id',
  description: 'Store UUID (must exist with BusinessSettings)',
  required: true,
})
@ApiHeader({
  name: 'Idempotency-Key',
  description:
    'UUID único por intento de alta (generar en el cliente antes del POST). Reintentos del mismo flujo: misma clave + mismo JSON; cuerpo distinto con la misma clave → 409.',
  required: true,
})
@Controller('products-with-stock')
export class ProductsWithStockController {
  constructor(private readonly productsService: ProductsService) {}

  private storeContext(req: Request): ProductStoreContext {
    const ctx = req.storeContext;
    if (!ctx) {
      throw new InternalServerErrorException('Missing store context');
    }
    return ctx;
  }

  private parseIdempotencyKey(raw: string | string[] | undefined): string {
    const v = Array.isArray(raw) ? raw[0] : raw;
    const trimmed = v?.trim();
    if (!trimmed || !UUID_RE.test(trimmed)) {
      throw new BadRequestException(
        'Header Idempotency-Key is required: send a UUID (e.g. generate before POST). Reuse the same key when retrying the same product-with-stock request to avoid duplicate products.',
      );
    }
    return trimmed;
  }

  @Post()
  @ApiBody({ type: CreateProductWithStockDto })
  @ApiOkResponse({
    description:
      'Producto creado (misma semántica que `POST /products` + outbox) y línea de inventario tras `IN_ADJUST` en la misma transacción. Con la misma Idempotency-Key y cuerpo, respuesta repetida sin crear otro producto.',
  })
  create(
    @Body() dto: CreateProductWithStockDto,
    @Req() req: Request,
    @Headers('idempotency-key') idempotencyHeader?: string | string[],
  ) {
    const idempotencyKey = this.parseIdempotencyKey(idempotencyHeader);
    return this.productsService.createWithStock(
      dto,
      this.storeContext(req),
      idempotencyKey,
    );
  }
}
