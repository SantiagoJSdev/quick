import {
  Body,
  Controller,
  Get,
  InternalServerErrorException,
  NotFoundException,
  Param,
  ParseUUIDPipe,
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
import { CreateSaleReturnDto } from './dto/create-sale-return.dto';
import { SaleReturnsService } from './sale-returns.service';

@ApiTags('sale-returns')
@ApiSecurity('X-Store-Id')
@ApiHeader({
  name: 'X-Store-Id',
  description: 'Store UUID (must exist with BusinessSettings)',
  required: true,
})
@Controller('sale-returns')
export class SaleReturnsController {
  constructor(private readonly saleReturns: SaleReturnsService) {}

  @Post()
  @ApiBody({ type: CreateSaleReturnDto })
  @ApiOkResponse({
    description:
      'Devolución registrada. Por defecto FX comercial heredada de la venta; con `fxPolicy: SPOT_ON_RETURN` se usa tasa del día en el funcional. Inventario `IN_RETURN` siempre al COGS de la venta original.',
  })
  async create(@Req() req: Request, @Body() dto: CreateSaleReturnDto) {
    const storeId = req.storeContext?.storeId;
    if (!storeId) {
      throw new InternalServerErrorException('Missing store context');
    }
    return this.saleReturns.create(storeId, dto);
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
    const row = await this.saleReturns.findOne(storeId, id);
    if (!row) {
      throw new NotFoundException('Sale return not found');
    }
    return row;
  }
}
