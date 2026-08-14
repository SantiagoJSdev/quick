import {
  Body,
  Controller,
  Get,
  InternalServerErrorException,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
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
import { CreatePurchasePaymentDto } from './dto/create-purchase-payment.dto';
import { CreatePurchaseDto } from './dto/create-purchase.dto';
import { PurchasesListQueryDto } from './dto/purchases-list-query.dto';
import { VoidPurchaseDto } from './dto/void-purchase.dto';
import { PurchasesService } from './purchases.service';

@ApiTags('purchases')
@ApiSecurity('X-Store-Id')
@ApiHeader({
  name: 'X-Store-Id',
  description: 'Store UUID (must exist with BusinessSettings)',
  required: true,
})
@Controller('purchases')
export class PurchasesController {
  constructor(private readonly purchases: PurchasesService) {}

  @Post()
  @ApiBody({ type: CreatePurchaseDto })
  @ApiOkResponse({ description: 'Compra recibida con líneas, pago e inventario' })
  async create(@Req() req: Request, @Body() dto: CreatePurchaseDto) {
    const storeId = req.storeContext?.storeId;
    if (!storeId) {
      throw new InternalServerErrorException('Missing store context');
    }
    return this.purchases.create(storeId, dto);
  }

  @Get()
  @ApiOkResponse({ description: 'Listado de compras (filtros opcionales)' })
  async list(@Req() req: Request, @Query() query: PurchasesListQueryDto) {
    const storeId = req.storeContext?.storeId;
    if (!storeId) {
      throw new InternalServerErrorException('Missing store context');
    }
    return this.purchases.list(storeId, query);
  }

  @Get('payables')
  @ApiOkResponse({ description: 'Deuda abierta agrupada por proveedor' })
  async payables(@Req() req: Request) {
    const storeId = req.storeContext?.storeId;
    if (!storeId) {
      throw new InternalServerErrorException('Missing store context');
    }
    return this.purchases.payablesSummary(storeId);
  }

  @Get(':id')
  async findOne(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const storeId = req.storeContext?.storeId;
    if (!storeId) {
      throw new InternalServerErrorException('Missing store context');
    }
    const row = await this.purchases.findOne(storeId, id);
    if (!row) {
      throw new NotFoundException('Purchase not found');
    }
    return row;
  }

  @Post(':id/payments')
  @ApiBody({ type: CreatePurchasePaymentDto })
  @ApiOkResponse({ description: 'Abono registrado; compra actualizada' })
  async addPayment(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreatePurchasePaymentDto,
  ) {
    const storeId = req.storeContext?.storeId;
    if (!storeId) {
      throw new InternalServerErrorException('Missing store context');
    }
    return this.purchases.addPayment(storeId, id, dto);
  }

  @Post(':id/void-preview')
  @ApiOkResponse({
    description:
      'Evalúa anulación: stock reversible vs omitido, abonos y deuda (sin mutar)',
  })
  async voidPreview(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const storeId = req.storeContext?.storeId;
    if (!storeId) {
      throw new InternalServerErrorException('Missing store context');
    }
    return this.purchases.voidPreview(storeId, id);
  }

  @Post(':id/void')
  @ApiBody({ type: VoidPurchaseDto })
  @ApiOkResponse({
    description:
      'Anula factura: stock reversible OUT_PURCHASE_VOID, deuda 0, pagos R1',
  })
  async voidPurchase(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VoidPurchaseDto,
  ) {
    const storeId = req.storeContext?.storeId;
    if (!storeId) {
      throw new InternalServerErrorException('Missing store context');
    }
    return this.purchases.voidPurchase(storeId, id, dto);
  }
}
