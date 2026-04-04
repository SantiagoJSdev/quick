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
import { CreatePurchaseDto } from './dto/create-purchase.dto';
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
  @ApiOkResponse({ description: 'Compra recibida con líneas e inventario' })
  async create(@Req() req: Request, @Body() dto: CreatePurchaseDto) {
    const storeId = req.storeContext?.storeId;
    if (!storeId) {
      throw new InternalServerErrorException('Missing store context');
    }
    return this.purchases.create(storeId, dto);
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
}
