import {
  Controller,
  Get,
  InternalServerErrorException,
  Param,
  ParseUUIDPipe,
  Post,
  Body,
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
import { InventoryAdjustDto } from './dto/inventory-adjust.dto';
import { InventoryMovementsQueryDto } from './dto/inventory-movements-query.dto';
import { InventoryService } from './inventory.service';

@ApiTags('inventory')
@ApiSecurity('X-Store-Id')
@ApiHeader({
  name: 'X-Store-Id',
  description: 'Store UUID (must exist with BusinessSettings)',
  required: true,
})
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get()
  list(@Req() req: Request) {
    const storeId = req.storeContext?.storeId;
    if (!storeId) {
      throw new InternalServerErrorException('Missing store context');
    }
    return this.inventory.listForStore(storeId);
  }

  @Get('movements')
  movements(@Req() req: Request, @Query() query: InventoryMovementsQueryDto) {
    const storeId = req.storeContext?.storeId;
    if (!storeId) {
      throw new InternalServerErrorException('Missing store context');
    }
    return this.inventory.listMovements(
      storeId,
      query.productId,
      query.limit ?? 100,
    );
  }

  @Get(':productId')
  line(
    @Req() req: Request,
    @Param('productId', ParseUUIDPipe) productId: string,
  ) {
    const storeId = req.storeContext?.storeId;
    if (!storeId) {
      throw new InternalServerErrorException('Missing store context');
    }
    return this.inventory.getLine(storeId, productId);
  }

  @Post('adjustments')
  @ApiBody({ type: InventoryAdjustDto })
  @ApiOkResponse({
    description: '`applied` o `skipped` (opId duplicado)',
    schema: {
      oneOf: [
        {
          properties: {
            status: { enum: ['applied'] },
            movementId: { type: 'string', format: 'uuid' },
          },
        },
        {
          properties: {
            status: { enum: ['skipped'] },
            reason: { type: 'string' },
            movementId: { type: 'string', format: 'uuid' },
          },
        },
      ],
    },
  })
  async adjust(@Req() req: Request, @Body() dto: InventoryAdjustDto) {
    const storeId = req.storeContext?.storeId;
    if (!storeId) {
      throw new InternalServerErrorException('Missing store context');
    }
    const r = await this.inventory.adjust(storeId, dto);
    if (r.status === 'skipped') {
      return {
        status: 'skipped' as const,
        reason: r.reason,
        movementId: r.movementId,
      };
    }
    return { status: 'applied' as const, movementId: r.movementId };
  }
}
