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
import { CreateSaleDto } from './dto/create-sale.dto';
import { SalesListQueryDto } from './dto/sales-list-query.dto';
import { SalesService } from './sales.service';

@ApiTags('sales')
@ApiSecurity('X-Store-Id')
@ApiHeader({
  name: 'X-Store-Id',
  description: 'Store UUID (must exist with BusinessSettings)',
  required: true,
})
@Controller('sales')
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  @Post()
  @ApiBody({ type: CreateSaleDto })
  @ApiOkResponse({ description: 'Venta confirmada con líneas' })
  async create(@Req() req: Request, @Body() dto: CreateSaleDto) {
    const storeId = req.storeContext?.storeId;
    if (!storeId) {
      throw new InternalServerErrorException('Missing store context');
    }
    return this.sales.create(storeId, dto);
  }

  /** Historial de ventas (antes de `:id` para no capturar "id" como UUID). */
  @Get()
  @ApiOkResponse({
    description:
      'Por defecto `{ items, nextCursor, meta }`. Con `format=array`, solo el array de ventas (sin paginación por cursor).',
  })
  async list(@Req() req: Request, @Query() query: SalesListQueryDto) {
    const storeId = req.storeContext?.storeId;
    if (!storeId) {
      throw new InternalServerErrorException('Missing store context');
    }
    const r = await this.sales.listHistory(storeId, query);
    if (query.format === 'array') {
      return r.items;
    }
    return r;
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
    const row = await this.sales.findOne(storeId, id);
    if (!row) {
      throw new NotFoundException('Sale not found');
    }
    return row;
  }
}
